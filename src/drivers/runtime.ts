import { Ajv, type ValidateFunction } from 'ajv';
import type { ChatMessage } from '../providers/types.ts';
import type { CallContext, Router } from '../gateway/router.ts';
import { GatewayError } from '../gateway/router.ts';
import type { Retriever } from '../rag/retriever.ts';
import type { UsageEvent, UsageSink } from '../metering/usageSink.ts';
import { TOOLS } from './tools.ts';
import type { DriverDefinition, DriverInput, DriverRunResult } from './types.ts';

const ajv = new Ajv({ allErrors: true });
const validators = new WeakMap<object, ValidateFunction>();

// Runs one driver invocation: retrieve -> (tool loop) -> model -> validate -> (one repair).
// Every model call goes through the router, so routing, fallback, metering and quotas apply.
export class DriverRuntime {
  private router: Router;
  private retriever?: Retriever;

  constructor(opts: { router: Router; retriever?: Retriever }) {
    this.router = opts.router;
    this.retriever = opts.retriever;
  }

  async run(ctx: CallContext, def: DriverDefinition, input: DriverInput): Promise<DriverRunResult> {
    const started = performance.now();
    const id = `${def.name}@${def.version}`;
    const steps: DriverRunResult['steps'] = [];
    const usage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };
    const callCtx: CallContext = { ...ctx, driver: id, onUsage: (e: UsageEvent) => addUsage(usage, e) };
    const userText = typeof input === 'string' ? input : renderObject(input);

    // 1. Retrieval (classic RAG): fetch passages first and put them in the prompt, numbered for citation.
    let system = def.system;
    const sources: string[] = [];
    if (def.retrieval && this.retriever) {
      const passages = await this.retriever.search({
        tenantId: ctx.tenantId,
        collection: def.retrieval.collection,
        query: userText,
        topK: def.retrieval.topK,
      });
      steps.push({ type: 'retrieve', detail: `${passages.length} passages from ${def.retrieval.collection}` });
      passages.forEach((p) => sources.push(p.source));
      system += `\n\nContext:\n${passages.map((p, i) => `[${i + 1}] (${p.source})\n${p.content}`).join('\n\n')}`;
    }

    // 2. Tools (agentic): native function calling. The model sees the tool specs and may ask
    // for tool runs; we execute them (only the ones this driver declares) and send results back.
    const tools = (def.tools ?? []).map((n) => TOOLS[n]).filter(Boolean);
    const toolSpecs = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));

    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: userText },
    ];
    const call = async (withTools: boolean) => {
      const { result, used } = await this.router.complete(callCtx, {
        model: def.model,
        messages,
        temperature: def.temperature,
        maxTokens: def.maxTokens,
        ...(withTools && toolSpecs.length ? { tools: toolSpecs } : {}),
      });
      steps.push({ type: 'model', detail: `${used.provider}/${used.model}` });
      return { text: result.content.trim(), toolCalls: result.toolCalls ?? [], used };
    };

    let { text, toolCalls, used } = await call(true);
    for (let step = 0; toolCalls.length; step++) {
      messages.push({ role: 'assistant', content: text, toolCalls });
      for (const callReq of toolCalls) {
        const allowed = def.tools?.includes(callReq.name) ? TOOLS[callReq.name] : undefined;
        const observation = allowed
          ? await allowed.run(callReq.arguments, { tenantId: ctx.tenantId, retriever: this.retriever, collection: def.toolCollection ?? def.retrieval?.collection })
          : `Error: unknown tool "${callReq.name}".`;
        steps.push({ type: 'tool', detail: `${callReq.name}(${JSON.stringify(callReq.arguments).slice(0, 120)})` });
        for (const m of observation.matchAll(/\[source: ([^\]]+)\]/g)) if (!sources.includes(m[1])) sources.push(m[1]);
        messages.push({ role: 'tool', toolCallId: callReq.id, name: callReq.name, content: observation });
      }
      // After the step budget, call once more WITHOUT tools so the model must answer.
      const lastStep = step + 1 >= (def.maxToolSteps ?? 3);
      ({ text, toolCalls, used } = await call(!lastStep));
      if (lastStep) break;
    }

    // 3. Validation: a technically successful answer that breaks the contract does not count.
    let output: unknown = text;
    if (def.output.type === 'json') {
      const validate = validatorFor(def.output.schema);
      let parsed = parseJson(text);
      if (!parsed.ok || !validate(parsed.value)) {
        const problem = parsed.ok ? ajv.errorsText(validate.errors) : 'not valid JSON';
        steps.push({ type: 'repair', detail: problem });
        // One repair attempt: show the model its own answer and what is wrong with it.
        messages.push(
          { role: 'assistant', content: text },
          { role: 'user', content: `Your answer is invalid (${problem}). Reply with ONLY the corrected JSON object, nothing else.` },
        );
        ({ text, used } = await call(false));
        parsed = parseJson(text);
        if (!parsed.ok || !validate(parsed.value)) {
          throw new GatewayError(422, 'driver_error', 'invalid_output', `${id} produced output that fails its schema after one repair.`);
        }
      }
      output = parsed.value;
    }

    const citations =
      def.output.type === 'text' && def.output.citations
        ? [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]
            .filter((n) => n >= 1 && n <= sources.length)
            .map((n) => ({ n, source: sources[n - 1] }))
        : [];

    return {
      driver: id,
      output,
      citations,
      steps,
      usage: { ...usage, costUsd: Math.round(usage.costUsd * 1e6) / 1e6 },
      latencyMs: Math.round(performance.now() - started),
      provider: used.provider,
      model: used.model,
    };
  }
}

function addUsage(total: { promptTokens: number; completionTokens: number; costUsd: number }, e: UsageEvent) {
  total.promptTokens += e.promptTokens;
  total.completionTokens += e.completionTokens;
  total.costUsd += e.costUsd;
}

function validatorFor(schema: Record<string, unknown>): ValidateFunction {
  let v = validators.get(schema);
  if (!v) {
    v = ajv.compile(schema);
    validators.set(schema, v);
  }
  return v;
}

// Models often wrap JSON in ```json fences or add a sentence around it: accept the first {...} block.
export function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch {
    return { ok: false };
  }
}

function renderObject(input: Record<string, unknown>): string {
  return Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
}
