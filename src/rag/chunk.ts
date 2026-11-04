// Splits a Markdown document into retrieval chunks.
// Strategy: keep paragraphs whole, pack them up to maxChars, and repeat the document title
// at the top of every chunk so a chunk still says what it is about when read alone.
export function chunkMarkdown(markdown: string, maxChars = 900): string[] {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? '';
  const body = markdown.replace(/^#\s+.+$/m, '').trim();
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    // A single huge paragraph is cut on line boundaries rather than mid-sentence where possible.
    const pieces = paragraph.length > maxChars ? splitLong(paragraph, maxChars) : [paragraph];
    for (const piece of pieces) {
      if (current && current.length + piece.length + 2 > maxChars) {
        chunks.push(current);
        current = '';
      }
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((c) => (title ? `${title}\n\n${c}` : c));
}

function splitLong(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current && current.length + line.length + 1 > maxChars) {
      out.push(current);
      current = '';
    }
    current = current ? `${current}\n${line}` : line;
    while (current.length > maxChars) {
      out.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
  }
  if (current) out.push(current);
  return out;
}
