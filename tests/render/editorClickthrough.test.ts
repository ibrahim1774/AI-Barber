// Fixes from the 2026-10-22 browser click-through of the three web editors.
// Source checks: vitest runs in node and can't render the React editors.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const EDITORS = ['components/GeneratedWebsite.tsx', 'components/PrimeWebsite.tsx', 'components/EuphoriaWebsite.tsx'];

describe.each(EDITORS)('%s', (f) => {
  const src = read(f);

  it('Remove acts on mousedown (a pending blur commit cannot swallow the first click), keyboard still works', () => {
    expect(src).toContain('onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); removeService(i); }');
    expect(src).toContain('onClick: (e: React.MouseEvent) => { if (e.detail === 0) removeService(i); }');
    expect(src).toContain('{...removeHandlers(i)}');
    expect(src).not.toMatch(/onClick=\{\(\) => removeService\(i\)\}/);
  });

  it('"Add price" / "Add description" are real placeholders, not editable text', () => {
    expect(src).toContain('placeholder="Add price"');
    expect(src).toContain('placeholder="Add description"');
    expect(src).not.toMatch(/text=\{[^}]*\|\| 'Add description'\}/);
    expect(src).not.toMatch(/: 'Add price'\}/);
    expect(src).toMatch(/data-placeholder/);
    expect(src).toContain('<style>{EDITOR_PLACEHOLDER_CSS}</style>');
    expect(src).toContain('[data-placeholder]:empty::before{content:attr(data-placeholder)');
  });

  it('empty phone / area show "Add phone" / "Add area" and no dead tel: link', () => {
    expect(src).toContain('placeholder="Add phone"');
    expect(src).toContain('placeholder="Add area"');
    expect(src).toMatch(/\/\\d\/\.test\(siteData\.phone \|\| ''\) \? `tel:/);
    expect(src).not.toMatch(/href=\{`tel:\$\{formattedPhone\}`\}/);
  });
});

it('Luxe hero drops "Call Now:" when there is no phone to call', () => {
  expect(read('components/GeneratedWebsite.tsx')).toContain("{callHref ? 'Call Now: ' : ''}");
});
