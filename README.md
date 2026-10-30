# Simpang

A small governed inference gateway: one OpenAI-compatible path to many LLM providers (hosted and self-hosted), with tenant policy, routing, fallback, metering in PostgreSQL, versioned agent drivers and evaluation gates.

Status: milestone 1 in progress.

## Run

```bash
nvm use        # Node 24
npm install
npm test
npm run dev    # http://localhost:3000/health
```

## Milestones

1. Foundation: Fastify + TypeScript, Postgres, non-streaming chat endpoint, one provider, per-tenant API keys, usage metering, CI
2. Multi-provider: SSE streaming, more providers, fallback, quotas, price catalogue
3. Drivers + RAG: versioned agent drivers, pgvector, self-hosted model via Ollama
4. Evaluation: datasets, baselines, regression gate in CI, shadow traffic, cost per completed task
5. Control surface: Vue 3 dashboard, OAuth2 client credentials, RBAC
6. Production: Go benchmark tool, Helm chart on kind, CI/CD, cloud deploy, live portfolio chat
