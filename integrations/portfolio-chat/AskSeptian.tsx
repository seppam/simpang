'use client';
// Small "Ask about Septian" box for the portfolio site. Talks only to the site's own /api/ask.
import { useState } from 'react';

type Answer = { answer: string; sources: string[] };

export function AskSeptian() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? 'Something went wrong.');
      else setAnswer(data);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="ask-title" className="ask">
      <h2 id="ask-title">Ask about my work</h2>
      <p className="ask-note">
        Answers come from this site's content through my own LLM gateway (Simpang), with sources. It may be wrong: check the
        linked pages.
      </p>
      <form onSubmit={ask}>
        <label htmlFor="ask-q" className="sr-only">Your question</label>
        <input
          id="ask-q"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          placeholder="e.g. What did Septian build in GameForge AI?"
        />
        <button type="submit" disabled={loading || !question.trim()}>
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {answer && (
        <div aria-live="polite">
          <p>{answer.answer}</p>
          {answer.sources.length > 0 && <p className="ask-sources">Sources: {answer.sources.join(', ')}</p>}
        </div>
      )}
    </section>
  );
}
