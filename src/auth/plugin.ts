import type { FastifyInstance, FastifyReply } from 'fastify';
import { hashKey } from './keys.ts';
import type { ActiveKey, KeyStore } from './keyStore.ts';

declare module 'fastify' {
  interface FastifyRequest {
    auth: ActiveKey;
  }
}

// Same error shape as the OpenAI API, so existing OpenAI clients show the message properly.
function unauthorized(reply: FastifyReply, code: string, message: string) {
  return reply.code(401).send({ error: { type: 'authentication_error', code, message } });
}

// Registered inside the /v1 scope only: every route there needs a valid key, /health stays public.
export function requireApiKey(app: FastifyInstance, keyStore: KeyStore) {
  app.addHook('onRequest', async (request, reply) => {
    const header = request.headers.authorization ?? '';
    const match = /^Bearer (\S+)$/.exec(header);
    if (!match) return unauthorized(reply, 'missing_api_key', 'Send Authorization: Bearer <api key>.');

    const found = await keyStore.findActiveKey(hashKey(match[1]));
    // Same answer for "unknown" and "revoked": do not tell an attacker which keys once existed.
    if (!found) return unauthorized(reply, 'invalid_api_key', 'API key is invalid or revoked.');

    request.auth = found;
  });
}
