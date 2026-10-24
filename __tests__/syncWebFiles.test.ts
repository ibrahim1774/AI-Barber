// The vendored renderer must be complete: every file sync-web.sh lists exists, and every relative import inside
// them lands on another listed file (a new server module that is not listed would break the Metro bundle).
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'scripts/sync-web.sh'), 'utf8');
const FILES = (script.match(/FILES=\(([\s\S]*?)\n\)/)?.[1] ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
const web = path.join(root, 'src/web');

test('the list names the pages v2 modules', () => {
  for (const f of ['lib/render/copyLibrary.ts', 'lib/render/copyRules.ts', 'lib/render/guides.ts', 'lib/render/heroes.ts', 'lib/render/sections.ts', 'lib/pagesV2.ts']) {
    expect(FILES).toContain(f);
  }
});

test('every listed file is vendored and every relative import resolves inside the list', () => {
  const listed = new Set(FILES.map((f) => f.replace(/\.ts$/, '')));
  for (const f of FILES) {
    const file = path.join(web, f);
    expect(fs.existsSync(file)).toBe(true);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from ['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])).replace(/\.(ts|js)$/, '');
      expect(listed.has(target)).toBe(true);
    }
  }
});
