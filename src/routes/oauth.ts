import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { signJwt } from '../auth/jwt.ts';
import type { AdminStore } from '../admin/store.ts';
import { hashSecret } from '../db/pgAdminStore.ts';

export const TOKEN_ISSUER = 'simpang';
export const TOKEN_AUDIENCE = 'simpang-admin';
const TOKEN_TTL_SECONDS = 15 * 60; // short-lived: a leaked token stops working soon

type TokenBody = { grant_type?: string; client_id?: string; client_secret?: string; scope?: string };

// RFC 6749 error shape: { error, error_description }.
function oauthError(reply: FastifyReply, status: number, error: string, description: string) {
  return reply.code(status).header('cache-control', 'no-store').send({ error, error_description: description });
}

// OAuth2 client credentials grant (RFC 6749 section 4.4): a service or operator console
// exchanges its client_id + client_secret for a short-lived bearer token.
export function oauthRoutes(app: FastifyInstance, deps: { store: AdminStore; jwtSecret: string }) {
  // The spec requires application/x-www-form-urlencoded; Fastify only parses JSON by default.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.post<{ Body: TokenBody }>('/oauth/token', async (request, reply) => {
    const body = request.body ?? {};
    // Client credentials may come in the body or as HTTP Basic auth.
    let { client_id: clientId, client_secret: secret } = body;
    const basic = /^Basic (.+)$/.exec(request.headers.authorization ?? '');
    if (basic) {
      const [id, s] = Buffer.from(basic[1], 'base64').toString().split(':');
      clientId = decodeURIComponent(id ?? '');
      secret = decodeURIComponent(s ?? '');
    }
    if (body.grant_type !== 'client_credentials') {
      return oauthError(reply, 400, 'unsupported_grant_type', 'Only client_credentials is supported.');
    }
    if (!clientId || !secret) return oauthError(reply, 400, 'invalid_request', 'client_id and client_secret are required.');

    const client = await deps.store.findClient(clientId);
    const given = Buffer.from(hashSecret(secret));
    const ok = client && !client.revoked && timingSafeEqual(given, Buffer.from(client.secretHash));
    // One answer for "unknown client", "wrong secret" and "revoked": nothing to learn from it.
    if (!ok) return oauthError(reply, 401, 'invalid_client', 'Client authentication failed.');

    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      { sub: client.clientId, tid: client.tenantId, role: client.role, iss: TOKEN_ISSUER, aud: TOKEN_AUDIENCE, iat: now, exp: now + TOKEN_TTL_SECONDS },
      deps.jwtSecret,
    );
    reply.header('cache-control', 'no-store');
    return { access_token: token, token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS, role: client.role };
  });
}
