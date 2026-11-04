// Next.js App Router handler for the portfolio site: src/app/api/ask/route.ts
// The browser calls /api/ask; this server-side route adds the Simpang API key, so the key
// never reaches the browser. It also limits abuse before any tokens are spent.
//
// Env (Vercel project settings, never in git):
//   SIMPANG_URL      e.g. https://simpang.onrender.com
//   SIMPANG_API_KEY  an sk_... key for a dedicated "portfolio-chat" tenant with a monthly quota
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const MAX_QUESTION_CHARS = 500;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
// Best-effort per-instance limiter. The real budget is the tenant quota inside Simpang.
const hits = new Map<string, number[]>();

function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (limited(ip)) return NextResponse.json({ error: 'Too many questions, try again in a minute.' }, { status: 429 });

  const body = (await request.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json({ error: `Ask a question of 1 to ${MAX_QUESTION_CHARS} characters.` }, { status: 400 });
  }

  const res = await fetch(`${process.env.SIMPANG_URL}/v1/drivers/portfolio-qa/invoke`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SIMPANG_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ input: question }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);

  if (!res?.ok) {
    // Do not forward gateway details to the public; the gateway logs them.
    const status = res?.status === 429 ? 429 : 502;
    return NextResponse.json({ error: 'The assistant is unavailable right now. Please use LinkedIn instead.' }, { status });
  }
  const data = (await res.json()) as { output: string; citations: { n: number; source: string }[] };
  return NextResponse.json({ answer: data.output, sources: data.citations.map((c) => c.source) });
}
