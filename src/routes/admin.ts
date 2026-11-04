import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyJwt, type Claims } from '../auth/jwt.ts';
import { can, type Permission } from '../auth/rbac.ts';
import type { AdminStore, Scope } from '../admin/store.ts';
import type { DriverRegistry } from '../drivers/registry.ts';
import type { Router } from '../gateway/router.ts';
import type { Catalog } from '../gateway/catalog.ts';
import type { Provider } from '../providers/types.ts';
import { TOKEN_AUDIENCE, TOKEN_ISSUER } from './oauth.ts';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Claims;
  }
}

const RESULTS_DIR = join(import.meta.dirname, '../../eval/results');

function deny(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { type: status === 401 ? 'authentication_error' : 'permission_error', code, message } });
}

// Which tenant(s) a request may touch. Platform admins may pick any tenant (or all);
// everyone else is pinned to their own tenant, whatever they ask for.
function scopeOf(request: FastifyRequest<{ Querystring: { tenant?: string } }>): Scope {
  const p = request.principal;
  if (can(p.role, 'platform:all-tenants')) return request.query.tenant || null;
  return p.tid;
}

export function adminRoutes(
  app: FastifyInstance,
  deps: { store: AdminStore; jwtSecret: string; registry: DriverRegistry; router: Router; catalog: Catalog; providers: Record<string, Provider> },
) {
  app.addHook('onRequest', async (request, reply) => {
    const token = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '')?.[1];
    const claims = token ? verifyJwt(token, deps.jwtSecret, { iss: TOKEN_ISSUER, aud: TOKEN_AUDIENCE }) : null;
    if (!claims) return deny(reply, 401, 'invalid_token', 'Send a valid, unexpired bearer token from /oauth/token.');
    request.principal = claims;
  });

  const need = (permission: Permission) => async (request: FastifyRequest, reply: FastifyReply) => {
    if (!can(request.principal.role, permission)) {
      return deny(reply, 403, 'forbidden', `Role "${request.principal.role}" lacks permission "${permission}".`);
    }
  };

  app.get('/me', async (request) => ({ clientId: request.principal.sub, tenantId: request.principal.tid, role: request.principal.role }));

  app.get<{ Querystring: { days?: string; tenant?: string } }>('/usage', { preHandler: need('usage:read') }, async (request) => {
    const days = Math.min(Math.max(Number(request.query.days ?? 7), 1), 90);
    return { days, data: await deps.store.usage(scopeOf(request), days) };
  });

  // Provider health is platform-level (no tenant data): configured providers, circuit state,
  // and error rate / p95 latency over the last 15 minutes.
  app.get('/providers', { preHandler: need('providers:read') }, async () => {
    const health = await deps.store.providerHealth(15);
    const breaker = deps.router.breaker.snapshot();
    return {
      data: Object.keys(deps.providers).map((name) => ({
        name,
        circuitOpen: breaker[name]?.open ?? false,
        consecutiveFailures: breaker[name]?.failures ?? 0,
        models: deps.catalog.models.filter((m) => m.provider === name).map((m) => m.model),
        ...(health.find((h) => h.provider === name) ?? { requests: 0, errors: 0, errorRate: 0, p95LatencyMs: 0 }),
      })),
      routes: deps.catalog.routes,
      catalogVersion: deps.catalog.version,
    };
  });

  app.get<{ Querystring: { tenant?: string } }>('/tenants', { preHandler: need('tenants:read') }, async (request) => ({
    data: await deps.store.tenants(scopeOf(request)),
  }));

  app.patch<{ Params: { id: string }; Body: { monthlyTokenLimit: number | null } }>(
    '/tenants/:id/quota',
    {
      preHandler: need('tenants:write'),
      schema: { body: { type: 'object', required: ['monthlyTokenLimit'], properties: { monthlyTokenLimit: { type: ['integer', 'null'], minimum: 0 } } } },
    },
    async (request, reply) => {
      const ok = await deps.store.setQuota(request.params.id, request.body.monthlyTokenLimit);
      if (!ok) return deny(reply, 404, 'not_found', 'Unknown tenant.');
      await deps.store.audit({ tenantId: request.params.id, actor: request.principal.sub, action: 'tenant.quota', detail: request.body });
      return { ok: true };
    },
  );

  app.get<{ Querystring: { tenant?: string } }>('/keys', { preHandler: need('keys:read') }, async (request) => ({
    data: await deps.store.keys(scopeOf(request)),
  }));

  app.post<{ Body: { tenantId?: string } }>('/keys', { preHandler: need('keys:write') }, async (request, reply) => {
    const p = request.principal;
    // Non-admins can only create keys for their own tenant.
    const tenantId = can(p.role, 'platform:all-tenants') ? (request.body?.tenantId ?? p.tid) : p.tid;
    const created = await deps.store.createKey(tenantId);
    await deps.store.audit({ tenantId, actor: p.sub, action: 'api_key.create', target: created.id });
    reply.code(201).header('cache-control', 'no-store');
    return { ...created, note: 'Copy the key now: it is shown once and only its hash is stored.' };
  });

  app.delete<{ Params: { id: string }; Querystring: { tenant?: string } }>('/keys/:id', { preHandler: need('keys:write') }, async (request, reply) => {
    const ok = await deps.store.revokeKey(scopeOf(request), request.params.id);
    // 404 also for another tenant's key: do not confirm that it exists.
    if (!ok) return deny(reply, 404, 'not_found', 'No such active key.');
    await deps.store.audit({ tenantId: request.principal.tid, actor: request.principal.sub, action: 'api_key.revoke', target: request.params.id });
    return { ok: true };
  });

  // Drivers with their channels, the latest offline eval metrics, and live shadow agreement.
  app.get<{ Querystring: { tenant?: string } }>('/drivers', { preHandler: need('drivers:read') }, async (request) => {
    const shadow = await deps.store.shadow(scopeOf(request));
    return {
      data: deps.registry.list().map((d) => ({
        ...d,
        eval: Object.fromEntries(
          d.versions.map((v) => {
            const file = join(RESULTS_DIR, `${d.name}@${v}.json`);
            if (!existsSync(file)) return [v, null];
            const report = JSON.parse(readFileSync(file, 'utf8'));
            return [v, { metrics: report.metrics, createdAt: report.createdAt, gitSha: report.gitSha }];
          }),
        ),
        shadow: shadow.filter((s) => s.driver === d.name),
      })),
    };
  });
}
