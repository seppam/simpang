# Simpang

[![CI](https://github.com/seppam/simpang/actions/workflows/ci.yml/badge.svg)](https://github.com/seppam/simpang/actions/workflows/ci.yml)

A small governed inference gateway: one OpenAI-compatible path to many LLM providers (hosted and self-hosted), with tenant policy, routing, fallback, metering in PostgreSQL, versioned agent drivers and evaluation gates.

Status: milestone 1 (foundation) done.

## What works today

- `POST /v1/chat/completions`: OpenAI-compatible request and response. The `model` field picks the provider by prefix: `mock/echo`, `groq/openai/gpt-oss-20b`.
- API keys per tenant (`Authorization: Bearer sk_...`), stored only as SHA-256 hashes; unknown and revoked keys get the same 401.
- Every provider call (success or failure) is metered into `usage_events`: tenant, key, provider, model, tokens from the vendor, latency, status.
- Provider failures return a generic 502; details go to the server log, with the auth header redacted.
- `GET /v1/me` checks a key without spending tokens; `GET /health` is public.

## Run

```bash
nvm use                 # Node 24
npm install
cp .env.example .env    # then add GROQ_API_KEY in an editor
npm run db:up           # Postgres + pgvector on localhost:5433
npm run migrate
npm test
npm run create-key -- my-tenant   # prints the key once
npm run dev                       # http://localhost:3000
```

```bash
curl -s localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"model":"groq/openai/gpt-oss-20b","messages":[{"role":"user","content":"halo"}]}'
```

## Tests

Unit tests use fakes (in-memory key store and usage sink, mock provider, fake `fetch`), so they need no network and no provider keys. Integration tests run against a separate `simpang_test` database. CI runs typecheck and all tests on every push with a Postgres service container.

## Milestones

1. ✅ Foundation: Fastify + TypeScript, Postgres, non-streaming chat endpoint, mock + Groq providers, per-tenant API keys, usage metering, CI
2. Multi-provider: SSE streaming, more providers, error classification and fallback, quotas, price catalogue
3. Drivers + RAG: versioned agent drivers, pgvector, self-hosted model via Ollama
4. Evaluation: datasets, baselines, regression gate in CI, shadow traffic, cost per completed task
5. Control surface: Vue 3 dashboard, OAuth2 client credentials, RBAC
6. Production: Go benchmark tool, Helm chart on kind, CI/CD, cloud deploy, live portfolio chat
