import { createHash, randomBytes } from 'node:crypto';

// 32 random bytes = 256 bits: impossible to guess, so a fast hash (SHA-256) is enough.
// (Human passwords are guessable and need a slow hash like argon2 instead.)
export function generateApiKey() {
  const key = `sk_${randomBytes(32).toString('base64url')}`;
  return { key, prefix: key.slice(0, 10), hash: hashKey(key) };
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
