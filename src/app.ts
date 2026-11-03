import Fastify from 'fastify';
import { requireApiKey } from './auth/plugin.ts';
import type { KeyStore } from './auth/keyStore.ts';
import type { Provider } from './providers/types.ts';
import { chatRoutes } from './routes/chat.ts';

export type AppDeps = {
  keyStore: KeyStore;
  providers?: Record<string, Provider>; // keyed by the prefix used in "model", e.g. "mock"
};

// buildApp() only builds the app; it does not listen on a port.
// That split lets tests use app.inject() while server.ts does the real listen().
// Dependencies come in as arguments, so tests can pass fakes instead of a real database.
export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: false });

  // Schema validation errors in the OpenAI error shape instead of Fastify's default.
  app.setErrorHandler((err: { validation?: unknown; message: string; statusCode?: number }, _request, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: { type: 'invalid_request_error', code: 'invalid_body', message: err.message } });
    }
    return reply.code(err.statusCode ?? 500).send({ error: { type: 'server_error', code: 'internal', message: 'Internal error.' } });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(async (v1) => {
    requireApiKey(v1, deps.keyStore);

    // "Who am I?": lets a client check its key without spending tokens.
    v1.get('/me', async (request) => ({ tenant: request.auth.tenantName }));

    chatRoutes(v1, deps.providers ?? {});
  }, { prefix: '/v1' });

  return app;
}
