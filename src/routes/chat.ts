import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ChatMessage, Provider } from '../providers/types.ts';
import type { UsageSink } from '../metering/usageSink.ts';

type ChatBody = {
  model: string; // "<provider>/<model>", e.g. "mock/echo" or "groq/llama-3.1-8b-instant"
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
};

// JSON schema: Fastify rejects a bad body with 400 before our handler runs.
const bodySchema = {
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

export function chatRoutes(app: FastifyInstance, providers: Record<string, Provider>, usageSink: UsageSink) {
  app.post<{ Body: ChatBody }>('/chat/completions', { schema: { body: bodySchema } }, async (request, reply) => {
    const body = request.body;

    if (body.stream) {
      return reply.code(400).send({
        error: { type: 'invalid_request_error', code: 'stream_not_supported', message: 'Streaming arrives in milestone 2.' },
      });
    }

    const slash = body.model.indexOf('/');
    const provider = slash > 0 ? providers[body.model.slice(0, slash)] : undefined;
    if (!provider) {
      return reply.code(404).send({
        error: { type: 'invalid_request_error', code: 'model_not_found', message: `Unknown model "${body.model}".` },
      });
    }

    const model = body.model.slice(slash + 1);
    const started = performance.now();
    const meter = async (status: 'ok' | 'error', promptTokens = 0, completionTokens = 0) => {
      try {
        await usageSink.record({
          tenantId: request.auth.tenantId,
          apiKeyId: request.auth.apiKeyId,
          provider: provider.name,
          model,
          promptTokens,
          completionTokens,
          costUsd: 0,
          latencyMs: Math.round(performance.now() - started),
          status,
        });
      } catch (err) {
        // Trade-off: a metering outage must not take the whole gateway down,
        // so we log loudly and still answer. (A durable queue would close this gap later.)
        request.log.error({ err }, 'usage metering failed');
      }
    };

    let result;
    try {
      result = await provider.chat({
        model,
        messages: body.messages,
        temperature: body.temperature,
        maxTokens: body.max_tokens,
      });
    } catch (err) {
      await meter('error');
      // Full detail goes to our log for operators; the caller gets a generic message.
      request.log.error({ err, provider: provider.name }, 'provider call failed');
      return reply.code(502).send({
        error: { type: 'provider_error', code: 'upstream_failed', message: `Provider "${provider.name}" failed. Try again later.` },
      });
    }

    await meter('ok', result.promptTokens, result.completionTokens);

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
  });
}
