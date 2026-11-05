// The library is append-only (plan 2026-11-04, section 3): once a wording is published it never changes, so a page reads
// the same on every load and every publish. Every wording of every block (and every FAQ question and "how often" line)
// is hashed into tests/render/fixtures/copyLibrary.hashes.json.
//   - An existing hash that changed or vanished fails this test: add a NEW wording or a new block id instead.
//   - A wording not in the file yet fails too, until it is recorded: run `UPDATE_COPY_HASHES=append npx vitest run
//     tests/render/copyLibraryAppendOnly.test.ts`. That only ever ADDS entries, so the diff of the file is the review list.
//   - Before the first publish of the service-page blocks (keys under `service.`) they may still be reworded:
//     `UPDATE_COPY_HASHES=reset` rewrites ONLY the `service.` entries (resetServiceKeys); every guide and extra-page entry
//     stays as stored, so a published wording cannot be withdrawn this way. Remove `reset` once Phase 1 has merged.
//     Withdrawing a published wording is a decision for Opus (inaccurate or legal). Reset is refused when CI is set, and a
//     missing hashes file is a failure, not a file to be recreated.
//   - Each block also records a `.meta` entry: a hash of its `max` (truncation) and its `allow` list (which sentences survive
//     lint), because changing either changes published text without touching a sentence.
//   - It also freezes WHICH wording a site picks: tests/render/fixtures/wordingPicks.json holds (seed, key) -> wording index for
//     many keys, plus the guide each sample title matches and the service key of each title. A change to the hash, the
//     title key or the guide patterns would re-roll every published site, so it fails here. Same rule: only `append`.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXTRA_IDS, EXTRA_PAGES, GUIDES, GUIDE_IDS, SERVICE_ALT, SERVICE_VISIT, type Block } from '../../lib/render/copyLibrary';
import { guideIdForTitle, svcCopyKey, svcTitleKey, variantIndex } from '../../lib/render/guides';

const FILE = join(__dirname, 'fixtures/copyLibrary.hashes.json');
export const SERVICE_PREFIX = 'service.';
/** What `reset` writes: the stored file with only its `service.` entries replaced by the current ones. */
export function resetServiceKeys(stored: Record<string, string>, now: Record<string, string>): Record<string, string> {
  const kept = Object.fromEntries(Object.entries(stored).filter(([k]) => !k.startsWith(SERVICE_PREFIX)));
  const fresh = Object.fromEntries(Object.entries(now).filter(([k]) => k.startsWith(SERVICE_PREFIX)));
  return { ...kept, ...fresh };
}
const hash = (v: unknown): string => createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12);

function current(): Record<string, string> {
  const out: Record<string, string> = {};
  const block = (scope: string, b: Block): void => {
    b.variants.forEach((sentences, i) => { out[`${scope}.${b.id}#${i}`] = hash(sentences); });
    if (b.q) out[`${scope}.${b.id}.q`] = hash(b.q);
    out[`${scope}.${b.id}.meta`] = hash({ max: b.max, allow: b.allow ?? [], subject: b.subject ?? null, h: b.h ?? null, kind: b.kind });
  };
  for (const g of GUIDE_IDS) {
    out[`guide.${g}.allow`] = hash(GUIDES[g].allow);
    for (const b of GUIDES[g].blocks) block(`guide.${g}`, b);
    (GUIDES[g].interval ?? []).forEach((s, i) => { out[`guide.${g}.interval#${i}`] = hash(s); });
  }
  for (const k of EXTRA_IDS) { out[`${k}.allow`] = hash(EXTRA_PAGES[k].allow); for (const b of EXTRA_PAGES[k].blocks) block(k, b); }
  block('service', SERVICE_VISIT);
  for (const g of GUIDE_IDS) block('service', SERVICE_ALT[g]);
  return out;
}

describe('the library is append-only', () => {
  const now = current();
  const mode = process.env.UPDATE_COPY_HASHES;
  if (mode === 'reset' && !process.env.CI && existsSync(FILE)) writeFileSync(FILE, JSON.stringify(resetServiceKeys(JSON.parse(readFileSync(FILE, 'utf8')), now), null, 1) + '\n');
  else if (mode === 'append' && existsSync(FILE)) {
    const stored = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string>;
    writeFileSync(FILE, JSON.stringify({ ...now, ...stored }, null, 1) + '\n');
  }
  it('the hashes file exists (a missing file is never recreated by a plain run) and reset is refused in CI', () => {
    expect(existsSync(FILE), 'tests/render/fixtures/copyLibrary.hashes.json is missing: restore it from git').toBe(true);
    if (process.env.CI) expect(mode, 'UPDATE_COPY_HASHES=reset is not allowed in CI').not.toBe('reset');
  });
  const stored = (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}) as Record<string, string>;

  it('reset only ever replaces service. entries (a published guide or extra-page wording cannot be withdrawn by it)', () => {
    const stored = { 'guide.fade.what#0': 'old', 'faq.book#1': 'old', 'service.visit#0': 'old', 'service.gone#0': 'old' };
    const nowS = { 'guide.fade.what#0': 'NEW', 'faq.book#1': 'NEW', 'service.visit#0': 'new', 'service.added#0': 'new' };
    expect(resetServiceKeys(stored, nowS)).toEqual({ 'guide.fade.what#0': 'old', 'faq.book#1': 'old', 'service.visit#0': 'new', 'service.added#0': 'new' });
  });
  it('max and allow are part of what is frozen', () => {
    expect(Object.keys(now).filter((k) => k.endsWith('.meta')).length).toBeGreaterThan(20);
    expect(Object.keys(now).filter((k) => /^guide\.[a-z-]+\.allow$/.test(k)).length).toBe(GUIDE_IDS.length);
  });
  it('records a good number of wordings', () => { expect(Object.keys(stored).length).toBeGreaterThan(250); });
  it('no published wording changed', () => {
    const changed = Object.keys(stored).filter((k) => k in now && now[k] !== stored[k]);
    expect(changed, 'edited in place: add a new wording or a new block id instead').toEqual([]);
  });
  it('no published wording was removed', () => {
    const gone = Object.keys(stored).filter((k) => !(k in now));
    expect(gone, 'removed: withdrawing a wording needs Opus sign-off').toEqual([]);
  });
  it('every wording is recorded', () => {
    const unrecorded = Object.keys(now).filter((k) => !(k in stored));
    expect(unrecorded, 'new wording: run UPDATE_COPY_HASHES=append to record it').toEqual([]);
  });
});

// ── Which wording a site picks, and which guide a title gets ────────────────────────────────────
const PICKS = join(__dirname, 'fixtures/wordingPicks.json');
const SEEDS = [0, 1, 2, 7, 11, 42, 99, 12345, 2147483647, -5];
const KEYS = ['guide.fade.what', 'guide.taper.care', 'faq.book', 'first-visit.inChair', 'svc.skin fade.visit', 'svc.low fade.alt', 'svc.braids.visit', 'svc.the works.visit', 'svc.kids cut.alt'];
const TITLES = ['Skin Fade', 'Low Fade', 'Taper', 'Beard Trim', 'Kids Cut', "Kids' Cut", 'Hot Towel Shave', 'Haircut & Beard', 'Fade + Beard', 'Line Up', 'Line-Up', 'Edge Up', 'Hair Design', 'Color', 'Highlights', 'Facial', 'Braids', 'The Works', 'MVP Cut', 'Senior Haircut', 'Head Shave', 'Cut and Beard', '  Skin   FADE ', 'Haircut.'];
function currentPicks(): Record<string, number | string | null> {
  const out: Record<string, number | string | null> = {};
  for (const seed of SEEDS) for (const key of KEYS) out[`pick|${seed}|${key}`] = variantIndex({ extraPages: { on: [], serviceGuides: true, seed } }, key);
  for (const t of TITLES) {
    out[`guide|${t}`] = guideIdForTitle(t);
    out[`titleKey|${t}`] = svcTitleKey(t);
    out[`visitKey|${t}`] = svcCopyKey(t, 'visit');
  }
  return out;
}
describe('which wording a site picks is frozen (append only: no reset)', () => {
  const now = currentPicks();
  const mode = process.env.UPDATE_COPY_HASHES;
  if (mode === 'append' && existsSync(PICKS)) writeFileSync(PICKS, JSON.stringify({ ...now, ...JSON.parse(readFileSync(PICKS, 'utf8')) }, null, 1) + '\n');
  it('the picks file exists', () => { expect(existsSync(PICKS), 'tests/render/fixtures/wordingPicks.json is missing').toBe(true); });
  const stored = (existsSync(PICKS) ? JSON.parse(readFileSync(PICKS, 'utf8')) : {}) as Record<string, number | string | null>;
  it('every (seed, key) pick, guide match and service key is what it was when sites were first published', () => {
    expect(Object.keys(stored).length).toBeGreaterThan(100);
    const changed = Object.keys(stored).filter((k) => now[k] !== stored[k]).map((k) => `${k}: ${String(stored[k])} -> ${String(now[k])}`);
    expect(changed, 'variantIndex, the hash, svcTitleKey/svcCopyKey or a guide pattern changed: this re-rolls published sites').toEqual([]);
  });
  it('the picks use all three wordings', () => {
    expect(new Set(Object.entries(stored).filter(([k]) => k.startsWith('pick|')).map(([, v]) => v))).toEqual(new Set([0, 1, 2]));
  });
});
