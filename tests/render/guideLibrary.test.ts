// The guide library (Step 8): every sentence passes the three lint layers with no group skipped, an independent word oracle, a 180+ entry hostile
// corpus is refused, each deny group is proven load bearing by mutation, and the library is append-only (hash fixture).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE_HUB, GUIDE_LIBRARY, GUIDE_UI } from '../../lib/render/guideLibrary';
import { GUIDE_PAGE_IDS, isGuideFile, isGuideHref, isGuidePageId } from '../../lib/render/guideIds';
import { GUIDE_EXTRA_BANNED, guideSentenceProblems } from '../../lib/render/guideLint';
import { copyProblems, VOCAB_GROUPS } from '../../lib/render/copyRules';
import { DENY_GROUP_IDS, denyProblems, type DenyGroupId } from '../../lib/render/svcDeny';
import { HOSTILE } from './helpers/guideHostile';

interface Row { where: string; text: string; allow: typeof VOCAB_GROUPS; kind: 'sentence' | 'heading' }
const rows: Row[] = [];
for (const id of GUIDE_PAGE_IDS) {
  const g = GUIDE_LIBRARY[id];
  rows.push({ where: `${id} title`, text: g.title, allow: g.allow, kind: 'heading' }, { where: `${id} blurb`, text: g.blurb, allow: g.allow, kind: 'sentence' });
  for (const b of g.blocks) {
    if (b.h) rows.push({ where: `${id}.${b.id} heading`, text: b.h, allow: g.allow, kind: 'heading' });
    b.variants.forEach((v, i) => v.forEach((s, j) => rows.push({ where: `${id}.${b.id}[${i}][${j}]`, text: s, allow: g.allow, kind: 'sentence' })));
  }
}
rows.push({ where: 'hub title', text: GUIDE_HUB.title, allow: [], kind: 'heading' });
for (const [n, v] of [['hub intro', GUIDE_HUB.intro], ['hub line', GUIDE_HUB.servicesLine]] as const) v.forEach((w, i) => w.forEach((s, j) => rows.push({ where: `${n}[${i}][${j}]`, text: s, allow: [], kind: 'sentence' })));
for (const [k, v] of Object.entries(GUIDE_UI)) rows.push({ where: `ui ${k}`, text: v, allow: [], kind: 'heading' });
rows.push({ where: 'hub services link label', text: GUIDE_HUB.servicesLinkLabel, allow: [], kind: 'heading' });

describe('the guide library: shape', () => {
  it('has the 17 guides in the fixed order, 14 of them general', () => {
    expect(GUIDE_PAGE_IDS).toHaveLength(17);
    expect(Object.keys(GUIDE_LIBRARY)).toEqual([...GUIDE_PAGE_IDS]);
    expect(GUIDE_PAGE_IDS.filter((id) => !GUIDE_LIBRARY[id].when)).toHaveLength(14);
    expect(GUIDE_PAGE_IDS.filter((id) => GUIDE_LIBRARY[id].when).map((id) => GUIDE_LIBRARY[id].when).sort()).toEqual(['fade-or-taper', 'kids-cut', 'shave']);
  });
  it('every guide has intro, points and tip blocks with exactly three non-empty wordings', () => {
    for (const id of GUIDE_PAGE_IDS) {
      expect(GUIDE_LIBRARY[id].blocks.map((b) => b.id), id).toEqual(['intro', 'points', 'tip']);
      for (const b of GUIDE_LIBRARY[id].blocks) {
        expect(b.variants, `${id}.${b.id}`).toHaveLength(3);
        for (const v of b.variants) expect(v.length, `${id}.${b.id}`).toBeGreaterThan(0);
        expect(b.kind).toBe(b.id === 'points' ? 'list' : 'p');
      }
    }
  });
  it('the three wordings of a block are different from one another (structure, not synonym swaps)', () => {
    for (const id of GUIDE_PAGE_IDS) for (const b of GUIDE_LIBRARY[id].blocks) {
      const keys = b.variants.map((v) => v.join(' | '));
      expect(new Set(keys).size, `${id}.${b.id}`).toBe(3);
      // no two wordings share their first sentence
      expect(new Set(b.variants.map((v) => v[0])).size, `${id}.${b.id} first sentences`).toBe(3);
    }
  });
  it('titles and blurbs are unique; ids are real slugs and real file paths', () => {
    expect(new Set(GUIDE_PAGE_IDS.map((id) => GUIDE_LIBRARY[id].title)).size).toBe(17);
    expect(new Set(GUIDE_PAGE_IDS.map((id) => GUIDE_LIBRARY[id].blurb)).size).toBe(17);
    for (const id of GUIDE_PAGE_IDS) { expect(isGuidePageId(id)).toBe(true); expect(isGuideHref(`/guides/${id}/`)).toBe(true); expect(isGuideFile(`guides/${id}/index.html`)).toBe(true); }
    expect(isGuideHref('/guides/')).toBe(true);
    for (const bad of ['/guides', '/guides/x/', '/guides/../', '/guides/ask-for-the-cut', '/Guides/', '/guides/ask-for-the-cut/extra/', '/services/ask-for-the-cut/']) expect(isGuideHref(bad), bad).toBe(false);
  });
  it('the hairstyle list marks the style of every sentence', () => {
    const b = GUIDE_LIBRARY['hairstyle-ideas'].blocks[1];
    expect(b.styleOf).toBeDefined();
    b.variants.forEach((v, i) => expect(b.styleOf![i], `wording ${i}`).toHaveLength(v.length));
  });
  it('only the fade, kids and shave guides are conditional; the others can be offered to every barber site', () => {
    const general = GUIDE_PAGE_IDS.filter((id) => !GUIDE_LIBRARY[id].when);
    expect(general.length).toBeGreaterThanOrEqual(11); // 12 added pages = hub + 11 guides
  });
});

describe('the guide library: no owner text and no claims', () => {
  it('has no token, no digit, no brace and only ASCII in any string', () => {
    for (const r of rows) {
      expect(r.text, r.where).not.toMatch(/[{}]/);
      expect(r.text, r.where).not.toMatch(/\d/);
      expect(r.text, r.where).toMatch(/^[\x20-\x7e]+$/);
    }
  });
  it('every string passes copyProblems, the default-deny layer (no group skipped) and the product/trade layer', () => {
    expect(rows.length).toBeGreaterThan(450);
    for (const r of rows) expect(guideSentenceProblems(r.text, r.allow, r.kind), `${r.where}: ${r.text}`).toEqual([]);
  });
  it('every sentence also passes the deny layer on its own with an empty skip list and no allow beyond its guide', () => {
    for (const r of rows) expect(denyProblems(r.text, r.kind, { skip: [] }), r.where).toEqual([]);
  });
  // An oracle written for this test and independent of copyRules / svcDeny / guideLint.
  const ORACLE = /\b(?:we|our|ours|us|my|me|i|best|top|rated|award\w*|licen[cs]\w*|certif\w*|insur\w*|years?|since|guarantee\w*|promise\w*|free|cheap\w*|affordable|prices?|pricing|cost\w*|discount\w*|health\w*|cure\w*|heal\w*|grow\w*|growth|thicker|scalp|skin|tattoo\w*|brands?|products?|reviews?|customers?|clients?|book\w*|appointments?|walk-?ins?|parking|minutes?|hours?|weeks?|days?|months?|always|never|perfect\w*|expert\w*|professional\w*|premium|luxury|famous|trusted|popular|favou?rite|friendly|skilled|experienced|seasoned|master\w*|number|first-class|world-class|flawless|guaranteed|satisfaction|results?|clippers?|razors?|pomade|gel|wax|shop|salon|studio|phone|call|text|email|website|address|downtown|city|town|near|local)\b/i;
  // These few words appear only in a sense the oracle cannot tell apart: "first" in "A first haircut", "first visit" etc. are not in the list; "number" and "near" are.
  it('an independent word oracle finds no banned word in any sentence', () => {
    const hits: string[] = [];
    for (const r of rows) { const m = ORACLE.exec(r.text); if (m) hits.push(`${r.where}: ${m[0]} in "${r.text}"`); }
    expect(hits).toEqual([]);
  });
  it('no sentence is in the first person or addresses the shop', () => {
    for (const r of rows) expect(r.text, r.where).not.toMatch(/\b(?:we|our|us|i|my|me|the shop|this shop|our team)\b/i);
  });
});

describe('the footer link label', () => {
  it('is the one word "Guides" (a link label, not a sentence: the only check it cannot pass is the two-word minimum of a heading)', () => {
    expect(GUIDE_HUB.footerLabel).toBe('Guides');
    expect(guideSentenceProblems(GUIDE_HUB.footerLabel, [], 'heading')).toEqual(['D:structure: too short']);
    expect(denyProblems(GUIDE_HUB.footerLabel, 'heading', { skip: ['structure'] })).toEqual([]);
  });
});

describe('the hostile corpus', () => {
  it('has at least 150 entries and none is a duplicate', () => {
    expect(HOSTILE.length).toBeGreaterThanOrEqual(150);
    expect(new Set(HOSTILE).size).toBe(HOSTILE.length);
  });
  it('every hostile sentence is refused by the combined lint, even with every service word allowed', () => {
    for (const h of HOSTILE) expect(guideSentenceProblems(h, VOCAB_GROUPS).length, h).toBeGreaterThan(0);
  });
  it('no hostile sentence is also a library sentence', () => {
    const lib = new Set(rows.map((r) => r.text));
    for (const h of HOSTILE) expect(lib.has(h), h).toBe(false);
  });

  // Mutation proof: each deny group is load bearing. For a group G, some hostile sentence is refused by G alone (no copy rule, no other group), and
  // with G skipped it gets through the deny layer.
  const exclusive = (g: DenyGroupId): string[] => HOSTILE.filter((h) => {
    if (copyProblems(h, { allow: VOCAB_GROUPS }).length || GUIDE_EXTRA_BANNED.test(h)) return false;
    const groups = new Set(denyProblems(h, 'sentence').map((x) => x.split(':')[1]));
    return groups.size === 1 && groups.has(g);
  });
  const REQUIRED: DenyGroupId[] = ['charset', 'structure', 'shape', 'language', 'digits', 'voice', 'promise', 'health', 'credentials', 'superlative', 'time', 'outcome', 'business', 'people', 'names', 'spanish'];
  for (const g of REQUIRED) {
    it(`deny group "${g}" is load bearing: a hostile sentence only it refuses gets through when it is skipped`, () => {
      const only = exclusive(g);
      expect(only.length, g).toBeGreaterThan(0);
      for (const h of only) {
        expect(denyProblems(h, 'sentence').length).toBeGreaterThan(0);
        expect(denyProblems(h, 'sentence', { skip: [g] }), h).toEqual([]);
      }
    });
  }
  it('every deny group id the library relies on exists', () => { for (const g of REQUIRED) expect(DENY_GROUP_IDS).toContain(g); });

  it('the product/trade layer is load bearing: sentences that copyProblems and denyProblems both accept are refused only by it', () => {
    const only = HOSTILE.filter((h) => !copyProblems(h, { allow: VOCAB_GROUPS }).length && !denyProblems(h, 'sentence').length);
    expect(only.length).toBeGreaterThanOrEqual(6);
    for (const h of only) { expect(GUIDE_EXTRA_BANNED.test(h), h).toBe(true); expect(guideSentenceProblems(h, VOCAB_GROUPS).length).toBeGreaterThan(0); }
  });
  it('the copy rules are load bearing: sentences the deny layer accepts but copyProblems refuses exist', () => {
    const only = HOSTILE.filter((h) => !denyProblems(h, 'sentence').length && copyProblems(h, { allow: VOCAB_GROUPS }).length);
    // (the corpus is built so the deny layer catches nearly everything; a handful rely on R7 / R8)
    expect(only.length + HOSTILE.filter((h) => denyProblems(h, 'sentence').length).length).toBe(HOSTILE.length - HOSTILE.filter((h) => !denyProblems(h, 'sentence').length && !copyProblems(h, { allow: VOCAB_GROUPS }).length).length);
  });
});

describe('the guide library is append-only', () => {
  const FILE = join(__dirname, 'fixtures/guideLibrary.hashes.json');
  const hash = (v: unknown): string => createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12);
  const now: Record<string, string> = {};
  for (const id of GUIDE_PAGE_IDS) {
    const g = GUIDE_LIBRARY[id];
    now[`${id}.meta`] = hash({ title: g.title, blurb: g.blurb, when: g.when ?? null, allow: g.allow });
    for (const b of g.blocks) {
      b.variants.forEach((v, i) => { now[`${id}.${b.id}#${i}`] = hash(v); });
      now[`${id}.${b.id}.meta`] = hash({ h: b.h ?? null, kind: b.kind, max: b.max, styleOf: b.styleOf ?? null });
    }
  }
  now['hub.title'] = hash(GUIDE_HUB.title);
  GUIDE_HUB.intro.forEach((v, i) => { now[`hub.intro#${i}`] = hash(v); });
  GUIDE_HUB.servicesLine.forEach((v, i) => { now[`hub.line#${i}`] = hash(v); });
  now['hub.labels'] = hash([GUIDE_HUB.footerLabel, GUIDE_HUB.servicesLinkLabel, GUIDE_UI]);
  // `UPDATE_GUIDE_HASHES=append npx vitest run tests/render/guideLibrary.test.ts` only ever ADDS entries (a changed or removed wording still fails).
  if (process.env.UPDATE_GUIDE_HASHES === 'append' && !process.env.CI) {
    const stored = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string>) : {};
    writeFileSync(FILE, JSON.stringify({ ...now, ...stored }, null, 1) + '\n');
  }
  it('the hashes file exists', () => { expect(existsSync(FILE)).toBe(true); });
  const stored = (): Record<string, string> => JSON.parse(readFileSync(FILE, 'utf8'));
  it('no published wording changed or vanished (add a new wording or a new guide id instead)', () => {
    const s = stored();
    for (const [k, h] of Object.entries(s)) expect(now[k], `${k} changed or was removed`).toBe(h);
  });
  it('every wording is recorded', () => {
    const s = stored();
    const missing = Object.keys(now).filter((k) => !(k in s));
    expect(missing, 'run UPDATE_GUIDE_HASHES=append to record new entries').toEqual([]);
  });
});
