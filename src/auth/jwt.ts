import { createHmac, timingSafeEqual } from 'node:crypto';

// Minimal JWT (HS256) for short-lived access tokens issued by our own /oauth/token.
// Only what we need: sign, and verify signature + expiry + issuer + audience.
// The algorithm is fixed to HS256 on purpose: never trust the "alg" a token claims.
export type Claims = {
  sub: string; // client_id
  tid: string; // tenant id
  role: 'admin' | 'operator' | 'viewer';
  iss: string;
  aud: string;
  iat: number;
  exp: number;
};

const b64 = (data: Buffer | string) => Buffer.from(data).toString('base64url');

export function signJwt(claims: Claims, secret: string): string {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(JSON.stringify(claims));
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function verifyJwt(token: string, secret: string, expected: { iss: string; aud: string }, now = Date.now()): Claims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expectedSig = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  const given = Buffer.from(signature, 'base64url');
  // Constant-time comparison: do not leak how many bytes matched.
  if (given.length !== expectedSig.length || !timingSafeEqual(given, expectedSig)) return null;
  try {
    const h = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (h.alg !== 'HS256') return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Claims;
    if (claims.iss !== expected.iss || claims.aud !== expected.aud) return null;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return null;
    return claims;
  } catch {
    return null;
  }
}
