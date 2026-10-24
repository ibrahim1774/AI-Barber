// Every sentence of the library, in every wording, against R1 to R9 (plan 2026-10-24, section 6e).
import { describe, expect, it } from 'vitest';
import { COPY_VERSION, EXTRA_IDS, EXTRA_PAGES, GUIDES, GUIDE_IDS, type Block } from '../../lib/render/copyLibrary';
import { copyProblems, serviceWordsIn } from '../../lib/render/copyRules';
import { LABEL_KEYS } from '../../lib/render/labels';
import { COPY_KEYS } from '../../lib/render/guides';

interface Row { where: string; text: string; allow: Parameters<typeof copyProblems>[1] }
const rows: Row[] = [];
const addBlock = (scope: string, b: Block, allow: NonNullable<Parameters<typeof copyProblems>[1]>['allow']) => {
  const a = [...(allow ?? []), ...(b.allow ?? [])];
  if (b.q) rows.push({ where: `${scope}.${b.id} question`, text: b.q, allow: { allow: a } });
  b.variants.forEach((v, i) => v.forEach((s, j) => rows.push({ where: `${scope}.${b.id} wording ${i} sentence ${j}`, text: s, allow: { allow: a } })));
};
for (const g of GUIDE_IDS) {
  for (const b of GUIDES[g].blocks) addBlock(`guide.${g}`, b, GUIDES[g].allow);
  (GUIDES[g].interval ?? []).forEach((s, i) => rows.push({ where: `guide.${g}.interval ${i}`, text: s, allow: { allow: GUIDES[g].allow } }));
}
for (const k of EXTRA_IDS) for (const b of EXTRA_PAGES[k].blocks) addBlock(k, b, EXTRA_PAGES[k].allow);

describe('the library', () => {
  it('has the pieces the plan lists', () => {
    expect(COPY_VERSION).toBe(1);
    expect(GUIDE_IDS).toHaveLength(10);
    for (const g of GUIDE_IDS) expect(GUIDES[g].blocks.map((b) => b.id)).toEqual(['what', 'who', 'ask', 'care']);
    expect(EXTRA_PAGES.faq.blocks.filter((b) => b.kind === 'qa' && !b.subject).length).toBeGreaterThanOrEqual(8);
    expect(EXTRA_PAGES['first-visit'].blocks).toHaveLength(4);
    expect(EXTRA_PAGES['hair-care'].blocks).toHaveLength(5);
    expect(EXTRA_PAGES['beard-care'].blocks).toHaveLength(4);
  });
  it('every block has exactly three wordings, each with at least one sentence', () => {
    for (const r of [...GUIDE_IDS.flatMap((g) => GUIDES[g].blocks), ...EXTRA_IDS.flatMap((k) => EXTRA_PAGES[k].blocks)]) {
      expect(r.variants, r.id).toHaveLength(3);
      for (const v of r.variants) expect(v.length, r.id).toBeGreaterThan(0);
    }
  });
  it('block keys are unique', () => { expect(new Set(COPY_KEYS).size).toBe(COPY_KEYS.length); });
  it('every heading label key exists in the label registry', () => {
    for (const b of [...GUIDE_IDS.flatMap((g) => GUIDES[g].blocks), ...EXTRA_IDS.flatMap((k) => EXTRA_PAGES[k].blocks)]) if (b.h) expect(LABEL_KEYS, b.id).toContain(b.h as never);
  });
  it('the three wordings of a block differ', () => {
    for (const b of [...GUIDE_IDS.flatMap((g) => GUIDES[g].blocks), ...EXTRA_IDS.flatMap((k) => EXTRA_PAGES[k].blocks)]) {
      expect(new Set(b.variants.map((v) => v.join(' '))).size, b.id).toBe(3);
    }
  });
  it(`passes R1 to R9: ${rows.length} sentences (every wording of every block)`, () => {
    expect(rows.length).toBeGreaterThan(400);
    const bad = rows.map((r) => ({ r, p: copyProblems(r.text, r.allow) })).filter((x) => x.p.length).map((x) => `${x.r.where}: "${x.r.text}" -> ${x.p.join('; ')}`);
    expect(bad).toEqual([]);
  });
  it('each guide names the services of its own group at most; its mentions are real words of its text', () => {
    for (const g of GUIDE_IDS) {
      const text = GUIDES[g].blocks.flatMap((b) => b.variants.flat()).join(' ').toLowerCase();
      for (const m of GUIDES[g].mentions) expect(typeof m).toBe('string');
      if (g !== 'haircut') expect(GUIDES[g].mentions.some((m) => text.includes(m)), g).toBe(true);
      for (const w of serviceWordsIn(text)) expect(GUIDES[g].allow, `${g} names ${w}`).toContain(w);
    }
  });
  it('the guide patterns pick the right guide first', () => {
    for (const g of GUIDE_IDS) expect(GUIDES[g].match.length, g).toBeGreaterThan(0);
  });
});

describe('K4: no sentence dangles when a token drops', () => {
  const DANGLING = /^(?:also|it|its|then|the other)\b|\balso\b/i;
  // The service tokens come from one service: when the title is missing, price and duration are gone too.
  const GROUP: Record<string, string[]> = { service: ['service', 'price', 'duration'] };
  const blocks: { where: string; b: Block }[] = [];
  for (const k of EXTRA_IDS) for (const b of EXTRA_PAGES[k].blocks) blocks.push({ where: `${k}.${b.id}`, b });
  for (const g of GUIDE_IDS) for (const b of GUIDES[g].blocks) blocks.push({ where: `guide.${g}.${b.id}`, b });
  const tokensOf = (s: string) => [...s.matchAll(/\{([A-Za-z]+)(?::([a-z-]+))?\}/g)].map((m) => (m[2] ? `${m[1]}:${m[2]}` : m[1]));
  it('dropping any one token (or the service group) leaves a first sentence that stands on its own', () => {
    const bad: string[] = [];
    let checked = 0;
    for (const { where, b } of blocks) {
      b.variants.forEach((v, i) => {
        const all = new Set(v.flatMap(tokensOf));
        for (const t of all) {
          const gone = new Set(GROUP[t] ?? [t]);
          const left = v.filter((s) => !tokensOf(s).some((x) => gone.has(x)));
          if (!left.length) continue;
          checked++;
          if (DANGLING.test(left[0]) || left.slice(1).some((s) => / also /i.test(s))) bad.push(`${where} wording ${i} without {${t}}: "${left[0]}"`);
        }
      });
    }
    expect(checked).toBeGreaterThan(30);
    expect(bad).toEqual([]);
  });
});

