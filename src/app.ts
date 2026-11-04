import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { requireApiKey } from './auth/plugin.ts';
import type { KeyStore } from './auth/keyStore.ts';
import type { Provider } from './providers/types.ts';
import type { UsageSink } from './metering/usageSink.ts';
import { unlimited, type QuotaGuard } from './metering/quota.ts';
import { loadCatalog, type Catalog } from './gateway/catalog.ts';
import { Router } from './gateway/router.ts';
import { CircuitBreaker } from './gateway/breaker.ts';
import { chatRoutes } from './routes/chat.ts';
import { driverRoutes } from './routes/drivers.ts';
import { DriverRegistry } from './drivers/registry.ts';
import { DriverRuntime } from './drivers/runtime.ts';
import type { Retriever } from './rag/retriever.ts';
import { ShadowRunner, type ShadowSink } from './eval/shadow.ts';
import type { AdminStore } from './admin/store.ts';
import { oauthRoutes } from './routes/oauth.ts';
import { adminRoutes } from './routes/admin.ts';

export type AppDeps = {
  keyStore: KeyStore;
  providers?: Record<string, Provider>; // keyed by the prefix used in "model", e.g. "mock"
  usageSink?: UsageSink;
  quota?: QuotaGuard;
  catalog?: Catalog;
  breaker?: CircuitBreaker;
  retriever?: Retriever;
  drivers?: DriverRegistry;
  shadow?: { sink: ShadowSink; sampleRate: number };
  // Control surface: OAuth2 token endpoint + /admin API. Off when not configured.
  admin?: { store: AdminStore; jwtSecret: string };
  consoleDir?: string; // built operator console; defaults to web/dist
  logger?: boolean; // on in server.ts, off in tests to keep output quiet
};

const discardUsage: UsageSink = { record: async () => {} };

const DEFAULT_CONSOLE_DIR = resolve(import.meta.dirname, '../web/dist');

const CONSOLE_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

// Serves the built operator console under /console. Only registered when the build exists.
// Unknown paths fall back to index.html so the console's client-side routes work on reload.
// A missing file that has an extension (a stale asset URL) is a 404, never HTML.
function registerConsole(app: FastifyInstance, dir: string) {
  const root = resolve(dir);
  const index = join(root, 'index.html');
  if (!existsSync(index)) return;

  function send(file: string, relative: string, reply: FastifyReply) {
    const type = CONSOLE_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    // Vite names built assets by content hash, so they can be cached for a year.
    const cache = relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    return reply.header('cache-control', cache).header('x-content-type-options', 'nosniff').type(type).send(createReadStream(file));
  }

  async function serve(relative: string, reply: FastifyReply) {
    // Resolve first, then check the result is still inside the build folder: "../" cannot escape.
    const target = resolve(root, relative.replace(/^\/+/, ''));
    if (target !== root && !target.startsWith(root + sep)) return reply.code(404).type('text/plain').send('Not found');

    const info = await stat(target).catch(() => null);
    if (info?.isFile()) return send(target, relative, reply);

    const ext = extname(relative).toLowerCase();
    if (ext && ext !== '.html') return reply.code(404).type('text/plain').send('Not found');
    return send(index, 'index.html', reply);
  }

  app.get('/console', (_request, reply) => serve('', reply));
  app.get<{ Params: { '*': string } }>('/console/*', (request, reply) => serve(request.params['*'], reply));
}

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
  const registry = deps.drivers ?? new DriverRegistry();
  const runtime = new DriverRuntime({ router, retriever: deps.retriever });
  const shadow = deps.shadow
    ? new ShadowRunner({ registry, runtime, sink: deps.shadow.sink, sampleRate: deps.shadow.sampleRate })
    : undefined;
  app.decorate('shadow', shadow);

  // Schema validation errors in the OpenAI error shape instead of Fastify's default.
  app.setErrorHandler((err: { validation?: unknown; message: string; statusCode?: number }, request, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: { type: 'invalid_request_error', code: 'invalid_body', message: err.message } });
    }
    request.log.error({ err }, 'unhandled error');
    return reply.code(err.statusCode ?? 500).send({ error: { type: 'server_error', code: 'internal', message: 'Internal error.' } });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  registerConsole(app, deps.consoleDir ?? DEFAULT_CONSOLE_DIR);

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
    driverRoutes(v1, { registry, runtime, quota: deps.quota ?? unlimited, shadow });
  }, { prefix: '/v1' });

  if (deps.admin) {
    const admin = deps.admin;
    app.register(async (scope) => oauthRoutes(scope, admin));
    app.register(async (scope) => adminRoutes(scope, { ...admin, registry, router, catalog, providers }), { prefix: '/admin' });
  }

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    router: Router;
    shadow?: ShadowRunner;
  }
}
