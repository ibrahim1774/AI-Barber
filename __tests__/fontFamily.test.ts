// Lint-style guard: the app has ONE typeface (src/theme/fonts.ts). Nothing else may name a family,
// use fontWeight, or size text without a family (iOS would fall back to the system font).
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', 'src');
const SKIP = [path.join(SRC, 'web'), path.join(SRC, 'theme', 'fonts.ts')];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (SKIP.includes(p)) continue;
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

// Style objects that set fontSize but inherit the family from a base style they are merged onto.
// Keyed by file + short snippet so line edits do not break the list.
const ALLOWED_OVERRIDES: { file: string; snippet: string }[] = [
  { file: 'components/Button.tsx', snippet: 'fontSize' },
  { file: 'app/start.tsx', snippet: 'fontSize' },
  { file: 'components/FlowParts.tsx', snippet: 'fontSize' },
];

const files = walk(SRC).map((f) => ({ rel: path.relative(SRC, f), text: fs.readFileSync(f, 'utf8') }));
const lineOf = (text: string, idx: number) => text.slice(0, idx).split('\n').length;

describe('one font family', () => {
  test('fonts.mono is not a second family', () => {
    const src = fs.readFileSync(path.join(SRC, 'theme', 'fonts.ts'), 'utf8');
    expect(src).toMatch(/\bmono:\s*family\.medium\b/);
  });

  test('every fontFamily comes from fonts.*', () => {
    const bad: string[] = [];
    for (const { rel, text } of files) {
      for (const m of text.matchAll(/fontFamily\s*:\s*([^,}\n]+)/g)) {
        if (!/^fonts\.[A-Za-z]+$/.test(m[1].trim())) bad.push(`${rel}:${lineOf(text, m.index!)} ${m[0]}`);
      }
      for (const m of text.matchAll(/['"`](Menlo|System|Helvetica[^'"`]*|Courier[^'"`]*|SF Pro[^'"`]*|Inter|PlusJakarta[^'"`]*)['"`]/g)) {
        bad.push(`${rel}:${lineOf(text, m.index!)} ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('no fontWeight (weight comes from the family name)', () => {
    const bad: string[] = [];
    for (const { rel, text } of files) {
      for (const m of text.matchAll(/\bfontWeight\b/g)) bad.push(`${rel}:${lineOf(text, m.index!)}`);
    }
    expect(bad).toEqual([]);
  });

  test('every sized text style names a font', () => {
    const bad: string[] = [];
    for (const { rel, text } of files) {
      for (const m of text.matchAll(/\{[^{}]*\bfontSize\b[^{}]*\}/g)) {
        if (/\bfontFamily\b/.test(m[0])) continue;
        if (ALLOWED_OVERRIDES.some((a) => rel === a.file && m[0].includes(a.snippet))) continue;
        bad.push(`${rel}:${lineOf(text, m.index!)} ${m[0].slice(0, 70)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('every file with a TextInput sets a font or uses the shared inputs', () => {
    const bad: string[] = [];
    for (const { rel, text } of files) {
      if (!/<TextInput(\s+[A-Za-z]|\s*\n|\s*\/)/.test(text)) continue;
      if (/fontFamily:\s*fonts\./.test(text)) continue;
      if (/from ['"][^'"]*\/(Field|FlowParts)['"]/.test(text)) continue;
      bad.push(rel);
    }
    expect(bad).toEqual([]);
  });
});
