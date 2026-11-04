# Cloud deployment plan (prepared, not executed)

Free or near-free, matching what the app needs:

| Part | Service | Why |
|---|---|---|
| Postgres + pgvector | Neon (free tier) or Supabase | Managed Postgres with the `vector` extension; backups and TLS handled |
| Simpang container | Render web service (Docker), or Fly.io | Runs the same `Dockerfile` as kind; health check on `/health` |
| Models | Groq / Gemini / OpenRouter free tiers | Ollama stays local (a CPU container on a free plan is too slow) |

Steps:
1. Create the Neon project; run `CREATE EXTENSION IF NOT EXISTS vector;` (migration 003 does this too if the role is allowed).
2. Create the Render service from the GitHub repo with `render.yaml` (Docker runtime). Set secrets in the dashboard: `DATABASE_URL` (Neon, `sslmode=require`), `JWT_SECRET`, `GROQ_API_KEY`, optional `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN`.
3. The pre-deploy command runs migrations (`node src/db/migrate-cli.ts`), like the Helm hook does in Kubernetes.
4. Create the first admin client: Render shell, `node src/db/create-client-cli.ts platform admin`.
5. Ingest the corpus once: `npm run ingest -- portfolio corpus/portfolio` with `DATABASE_URL` pointing at Neon. Known gap: today the embedder is Ollama (`OLLAMA_BASE_URL`) or the offline hash embedder. Without Ollama in the cloud, both ingestion and queries fall back to the hash embedder (lexical, weaker). Vectors are stored with the embedder name and the retriever only compares vectors of the same embedder, so a mismatch returns no results rather than wrong ones. Next step: an `EMBEDDING_BASE_URL` option for a hosted OpenAI-compatible embedding endpoint.
6. Point the portfolio route at the service (see `integrations/portfolio-chat/README.md`).

Notes:
- Free Render services sleep when idle: the first request after a pause takes ~30-60 s. Acceptable for a portfolio demo, stated on the page.
- Rollback: Render keeps previous deploys (one click); in Kubernetes, `helm rollback simpang <revision>`.
