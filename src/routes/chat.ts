import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ChatMessage } from '../providers/types.ts';
import { GatewayError, type CallContext, type Router } from '../gateway/router.ts';
import type { QuotaGuard } from '../metering/quota.ts';

type ChatBody = {
  model: string; // "<provider>/<model>" (e.g. "groq/openai/gpt-oss-20b") or a route "simpang/fast"
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
};

// JSON schema: Fastify rejects a bad body with 400 before our handler runs.
export const chatBodySchema = {
  type: 'object',
  required: ['model', 'messages'],
  properties: {
    model: { type: 'string', minLength: 3 },
    messages: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['role', 'content'],
        properties: {
          role: { type: 'string', enum: ['system', 'user', 'assistant'] },
          content: { type: 'string' },
        },
      },
    },
    temperature: { type: 'number', minimum: 0, maximum: 2 },
    max_tokens: { type: 'integer', minimum: 1 },
    stream: { type: 'boolean' },
  },
} as const;

export function sendError(reply: FastifyReply, err: GatewayError) {
  return reply.code(err.status).send({ error: { type: err.type, code: err.code, message: err.message } });
}

// Aborts the upstream call when the caller disconnects, so we stop paying for tokens nobody reads.
export function callContext(request: FastifyRequest, reply: FastifyReply): { ctx: CallContext; done: () => void } {
  const controller = new AbortController();
  let finished = false;
  reply.raw.on('close', () => {
    if (!finished) controller.abort();
  });
  return {
    ctx: { tenantId: request.auth.tenantId, apiKeyId: request.auth.apiKeyId, signal: controller.signal, log: request.log },
    done: () => {
      finished = true;
    },
  };
}

export async function checkQuota(quota: QuotaGuard, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const status = await quota.check(request.auth.tenantId);
  if (status.allowed) return true;
  sendError(
    reply,
    new GatewayError(429, 'rate_limit_error', 'quota_exceeded', `Monthly token quota reached (${status.used}/${status.limit}).`),
  );
  return false;
}

export function chatRoutes(app: FastifyInstance, router: Router, quota: QuotaGuard) {
  app.post<{ Body: ChatBody }>('/chat/completions', { schema: { body: chatBodySchema } }, async (request, reply) => {
    const body = request.body;
    if (!(await checkQuota(quota, request, reply))) return reply;

    const input = { model: body.model, messages: body.messages, temperature: body.temperature, maxTokens: body.max_tokens };
    const { ctx, done } = callContext(request, reply);

    if (!body.stream) {
      try {
        const { result, used, attempts } = await router.complete(ctx, input);
        done();
        reply.header('x-simpang-provider', used.provider).header('x-simpang-model', used.model).header('x-simpang-attempts', attempts);
        // OpenAI response shape, so any OpenAI SDK can talk to Simpang unchanged.
        return {
          id: `chatcmpl-${randomUUID()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [{ index: 0, message: { role: 'assistant', content: result.content }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: result.promptTokens,
            completion_tokens: result.completionTokens,
            total_tokens: result.promptTokens + result.completionTokens,
          },
        };
      } catch (err) {
        done();
        if (err instanceof GatewayError) return sendError(reply, err);
        throw err;
      }
    }

    // Streaming (SSE). Pull the first event before committing to a 200 stream:
    // routing errors and "every provider failed before answering" still get a normal JSON error.
    const events = router.stream(ctx, input);
    let first;
    try {
      first = await events.next();
    } catch (err) {
      done();
      if (err instanceof GatewayError) return sendError(reply, err);
      throw err;
    }

    const id = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const chunk = (choices: unknown[], extra: object = {}) =>
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: body.model, choices, ...extra })}\n\n`;

    reply.hijack(); // from here on we write the raw HTTP response ourselves
    const used = first.value && 'used' in first.value ? first.value.used : undefined;
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // ask proxies (nginx) not to buffer the stream
      ...(used ? { 'x-simpang-provider': used.provider, 'x-simpang-model': used.model } : {}),
    });
    reply.raw.write(chunk([{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]));

    try {
      let next = first;
      while (!next.done) {
        const event = next.value;
        if (event.type === 'delta') {
          reply.raw.write(chunk([{ index: 0, delta: { content: event.text }, finish_reason: null }]));
        } else if (event.type === 'usage') {
          reply.raw.write(chunk([{ index: 0, delta: {}, finish_reason: 'stop' }]));
          const u = event.usage;
          reply.raw.write(
            chunk([], { usage: { prompt_tokens: u.promptTokens, completion_tokens: u.completionTokens, total_tokens: u.promptTokens + u.completionTokens } }),
          );
        }
        next = await events.next();
      }
    } catch (err) {
      // Mid-stream failure: the 200 header is already sent, so report it inside the stream.
      const e = err instanceof GatewayError ? err : new GatewayError(502, 'provider_error', 'upstream_failed', 'Stream interrupted.');
      if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify({ error: { type: e.type, code: e.code, message: e.message } })}\n\n`);
    } finally {
      done();
      if (!reply.raw.destroyed) reply.raw.end('data: [DONE]\n\n');
    }
  });
}
