import Fastify from 'fastify';
import { requireApiKey } from './auth/plugin.ts';
import type { KeyStore } from './auth/keyStore.ts';

export type AppDeps = {
  keyStore: KeyStore;
};

// buildApp() only builds the app; it does not listen on a port.
// That split lets tests use app.inject() while server.ts does the real listen().
// Dependencies come in as arguments, so tests can pass fakes instead of a real database.
export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(async (v1) => {
    requireApiKey(v1, deps.keyStore);

    // "Who am I?": lets a client check its key without spending tokens.
    v1.get('/me', async (request) => ({ tenant: request.auth.tenantName }));
  }, { prefix: '/v1' });

  return app;
}
