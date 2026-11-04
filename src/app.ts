import Fastify from 'fastify';
import { requireApiKey } from './auth/plugin.ts';
import type { KeyStore } from './auth/keyStore.ts';
import type { Provider } from './providers/types.ts';
import type { UsageSink } from './metering/usageSink.ts';
import { unlimited, type QuotaGuard } from './metering/quota.ts';
import { loadCatalog, type Catalog } from './gateway/catalog.ts';
import { Router } from './gateway/router.ts';
import { CircuitBreaker } from './gateway/breaker.ts';
import { chatRoutes } from './routes/chat.ts';

export type AppDeps = {
  keyStore: KeyStore;
  providers?: Record<string, Provider>; // keyed by the prefix used in "model", e.g. "mock"
  usageSink?: UsageSink;
  quota?: QuotaGuard;
  catalog?: Catalog;
  breaker?: CircuitBreaker;
  logger?: boolean; // on in server.ts, off in tests to keep output quiet
};

const discardUsage: UsageSink = { record: async () => {} };

// buildApp() only builds the app; it does not listen on a port.
// That split lets tests use app.inject() while server.ts does the real listen().
// Dependencies come in as arguments, so tests can pass fakes instead of a real database.
export function buildApp(deps: AppDeps) {
  // Never log the Authorization header: it carries the caller's API key.
  const app = Fastify({ logger: deps.logger ? { redact: ['req.headers.authorization'] } : false });

  const providers = deps.providers ?? {};
  const catalog = deps.catalog ?? loadCatalog();
  const router = new Router({ providers, catalog, usageSink: deps.usageSink ?? discardUsage, breaker: deps.breaker });
  app.decorate('router', router);

  // Schema validation errors in the OpenAI error shape instead of Fastify's default.
  app.setErrorHandler((err: { validation?: unknown; message: string; statusCode?: number }, request, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: { type: 'invalid_request_error', code: 'invalid_body', message: err.message } });
    }
    request.log.error({ err }, 'unhandled error');
    return reply.code(err.statusCode ?? 500).send({ error: { type: 'server_error', code: 'internal', message: 'Internal error.' } });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(async (v1) => {
    requireApiKey(v1, deps.keyStore);

    // "Who am I?": lets a client check its key without spending tokens.
    v1.get('/me', async (request) => ({ tenant: request.auth.tenantName }));

    // OpenAI-style model list: concrete models whose provider is configured, plus routes.
    v1.get('/models', async () => ({
      object: 'list',
      data: [
        ...catalog.models
          .filter((m) => providers[m.provider])
          .map((m) => ({ id: `${m.provider}/${m.model}`, object: 'model', owned_by: m.provider })),
        ...Object.keys(catalog.routes).map((r) => ({ id: `simpang/${r}`, object: 'model', owned_by: 'simpang' })),
      ],
    }));

    chatRoutes(v1, router, deps.quota ?? unlimited);
  }, { prefix: '/v1' });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    router: Router;
  }
}
