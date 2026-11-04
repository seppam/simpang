// One-off: turns the public content of the portfolio site (seppam/septian-portfolio, src/data)
// into Markdown files under corpus/portfolio/, the knowledge base of the portfolio-qa driver.
// Usage: node scripts/export-portfolio-corpus.ts ~/Documents/portfolio-v2/src/data
// Only public, professional content is exported: no email, phone or address.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dataDir = resolve(process.argv[2] ?? '');
const outDir = join(import.meta.dirname, '../corpus/portfolio');
mkdirSync(outDir, { recursive: true });

const SKIP = new Set(['images', 'visual', 'slug', 'tier', 'order', 'href', 'email', 'icon', 'image', 'src', 'alt']);

// Generic renderer: picks the English side of { en, id } blocks, turns arrays into bullets
// and nested objects into labelled lines.
function render(value: unknown, depth = 0): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((v) => render(v, depth + 1))
      .filter(Boolean)
      .map((s) => `- ${s.replace(/\n/g, '\n  ')}`)
      .join('\n');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('en' in obj && 'id' in obj) return render(obj.en, depth);
    return Object.entries(obj)
      .filter(([k, v]) => !SKIP.has(k) && typeof v !== 'function')
      .map(([k, v]) => {
        const text = render(v, depth + 1);
        if (!text) return '';
        return text.includes('\n') ? `**${k}**:\n${text}` : `**${k}**: ${text}`;
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

const write = (name: string, title: string, body: string) => {
  writeFileSync(join(outDir, `${name}.md`), `# ${title}\n\nSource: https://septian-pamungkas.vercel.app\n\n${body.trim()}\n`);
  console.log('wrote', name);
};

const profile = await import(join(dataDir, 'profile.ts'));
const { contact } = profile;
write(
  'profile',
  `${contact.name}: profile`,
  [
    `Name: ${contact.name}\nLocation: ${contact.location}\nGitHub: ${contact.github}\nLinkedIn: ${contact.linkedin}`,
    ...['hero', 'openLine', 'about', 'approach', 'proof', 'currently'].map((k) => (profile[k] ? `## ${k}\n\n${render(profile[k])}` : '')),
  ].join('\n\n'),
);
write('timeline', 'Work and study timeline', render(profile.timeline));
write(
  'credentials',
  'Certificates and credentials',
  ['credentials', 'credentialsMore', 'internshipCert'].map((k) => (profile[k] ? render(profile[k]) : '')).join('\n\n'),
);

const { projects } = await import(join(dataDir, 'projects.ts'));
for (const p of projects as Record<string, unknown>[]) {
  write(`project-${p.slug}`, `Project: ${p.title as string}`, render(p));
}

const { caseStudies } = await import(join(dataDir, 'case-studies.ts'));
for (const [slug, study] of Object.entries(caseStudies as Record<string, unknown>)) {
  write(`case-study-${slug}`, `Case study: ${slug}`, render(study));
}
