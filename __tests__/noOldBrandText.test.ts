/**
 * Regression guard for the rename to "Prime Barber": no code outside comments in src (the vendored src/web
 * renderer excluded) may spell the old brand with a space or hyphen ("AI Barber", "AI-Barber", "AIBarber"),
 * which is what a user would read, in a string, template, JSX text or accessibility label. The lowercase
 * internal key `aibarber` is allowed only as the exact booking-choice value, the URL scheme, a domain/URL or a
 * product id; code identifiers (isAiBarberBookingUrl) are not words a user sees.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'web') continue; // vendored renderer: never edited here
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Source with block comments and whole-line / trailing `//` comments blanked (keeps `://` in URLs). */
function code(src: string): string[] {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlock.split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1'));
}

const ALLOWED_LOWER = [
  /'aibarber'/, // the booking-choice value
  /\baibarber:\/\//, // URL scheme
  /\baibarber\.org\b/, // domain / URLs
  /com\.ibrahim1774\.aibarber/, // bundle and product ids
  /\baibarber:\s*['"`]/, // the choice key in the link-rule message map
];

describe('no old brand text in src', () => {
  const files = walk(SRC);

  it('scans files', () => expect(files.length).toBeGreaterThan(100));

  it('never spells "AI Barber", "AI-Barber" or "AIBarber" outside comments', () => {
    const hits: string[] = [];
    for (const f of files) {
      code(fs.readFileSync(f, 'utf8')).forEach((l, i) => {
        if (/\bai[ -]?barber\b/i.test(l.replace(/[a-z0-9_.]*aibarber[a-z0-9_.]*/g, ''))) {
          if (/\bAI[ -]?Barber\b/i.test(l)) hits.push(`${path.relative(SRC, f)}:${i + 1}: ${l.trim()}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it('lowercase "aibarber" appears only as a key, scheme, domain or product id', () => {
    const hits: string[] = [];
    for (const f of files) {
      code(fs.readFileSync(f, 'utf8')).forEach((l, i) => {
        const quoted = l.match(/(["'`])(?:(?!\1).)*aibarber(?:(?!\1).)*\1/gi) ?? [];
        for (const q of quoted) if (!ALLOWED_LOWER.some((a) => a.test(q))) hits.push(`${path.relative(SRC, f)}:${i + 1}: ${q}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
