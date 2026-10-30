import Fastify from 'fastify';

// buildApp() only builds the app; it does not listen on a port.
// That split lets tests use app.inject() while server.ts does the real listen().
export function buildApp() {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
