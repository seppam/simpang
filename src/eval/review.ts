import type { Row, RowResult } from './runner.ts';

// Failures go to a Markdown file a person can read and label: error analysis and human review.
export function reviewMarkdown(name: string, version: string, rows: Row[], results: RowResult[]): string {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const failures = results.filter((r) => !r.grade.success);
  return [
    `# Review: ${name}@${version} (${failures.length} of ${results.length} not successful)`,
    '',
    'Mark each case: model wrong / label wrong / ambiguous. Label mistakes go back into the dataset.',
    '',
    ...failures.map((f) => {
      const row = byId.get(f.id)!;
      const failed = Object.entries(f.grade.checks).filter(([, ok]) => !ok).map(([k]) => k).join(', ');
      return [
        `## ${f.id}${f.run > 1 ? ` (run ${f.run})` : ''}: ${f.error ?? `failed ${failed}`}`,
        '',
        '**Input**', '```', typeof row.input === 'string' ? row.input : JSON.stringify(row.input, null, 2), '```',
        `**Expected**: \`${JSON.stringify(row.expected)}\``,
        '',
        `**Output**: ${typeof f.output === 'string' ? f.output : '`' + JSON.stringify(f.output) + '`'}`,
        row.note ? `\n**Labeler note**: ${row.note}` : '',
        '',
        '- [ ] model wrong  - [ ] label wrong  - [ ] ambiguous',
        '',
      ].join('\n');
    }),
  ].join('\n');
}
