# Portfolio chat integration (prepared, not deployed)

Gives the portfolio site (seppam/septian-portfolio, Next.js) an "Ask about my work" box backed by the `portfolio-qa` driver.

```
browser ──> portfolio /api/ask (Next.js, server) ──Bearer sk_...──> Simpang /v1/drivers/portfolio-qa/invoke
            rate limit + input checks                                tenant quota, routing, RAG, metering
```

Why a server route: the Simpang API key must never be shipped to the browser. The route also rejects empty or long questions and rate-limits per IP before any tokens are spent; the tenant's monthly quota in Simpang is the hard budget.

## Steps when Simpang is deployed

1. In Simpang: `npm run create-key -- portfolio-chat`, then as admin set a monthly quota for the tenant (console, Tenants page, or `PATCH /admin/tenants/:id/quota`).
2. In the portfolio repo: copy `route.ts` to `src/app/api/ask/route.ts` and `AskSeptian.tsx` to `src/components/`, place `<AskSeptian />` on the home page, style it with the site's tokens.
3. In Vercel project settings add `SIMPANG_URL` and `SIMPANG_API_KEY` (never in git).
4. Re-run `npm run ingest -- portfolio corpus/portfolio` after the portfolio content changes (or regenerate the corpus with `scripts/export-portfolio-corpus.ts`).
