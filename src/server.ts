import pg from 'pg';
import { buildApp } from './app.ts';
import { PgKeyStore } from './db/pgKeyStore.ts';
import { PgUsageSink } from './db/pgUsageSink.ts';
import { MockProvider } from './providers/mock.ts';
import { OpenAICompatibleProvider } from './providers/openaiCompatible.ts';
import type { Provider } from './providers/types.ts';

const port = Number(process.env.PORT ?? 3000);
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://simpang:simpang@localhost:5433/simpang',
});

// A provider is switched on only when its key is configured (in .env, never in code).
const providers: Record<string, Provider> = { mock: new MockProvider() };
if (process.env.GROQ_API_KEY) {
  providers.groq = new OpenAICompatibleProvider({
    name: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY,
  });
}

const app = buildApp({
  keyStore: new PgKeyStore(pool),
  providers,
  usageSink: new PgUsageSink(pool),
  logger: true,
});

await app.listen({ port, host: '0.0.0.0' });
console.log(`simpang listening on http://localhost:${port} (providers: ${Object.keys(providers).join(', ')})`);
