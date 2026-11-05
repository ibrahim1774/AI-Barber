// The library is append-only (plan 2026-11-04, section 3): once a wording is published it never changes, so a page reads
// the same on every load and every publish. Every wording of every block (and every FAQ question and "how often" line)
// is hashed into tests/render/fixtures/copyLibrary.hashes.json.
//   - An existing hash that changed or vanished fails this test: add a NEW wording or a new block id instead.
//   - A wording not in the file yet fails too, until it is recorded: run `UPDATE_COPY_HASHES=append npx vitest run
//     tests/render/copyLibraryAppendOnly.test.ts`. That only ever ADDS entries, so the diff of the file is the review list.
//   - Before the first publish of a brand-new block it may still be reworded: `UPDATE_COPY_HASHES=reset` rewrites the file.
//     Never use reset for a wording that has been published; withdrawing one is a decision for Opus (inaccurate or legal).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXTRA_IDS, EXTRA_PAGES, GUIDES, GUIDE_IDS, SERVICE_ALT, SERVICE_VISIT, type Block } from '../../lib/render/copyLibrary';

const FILE = join(__dirname, 'fixtures/copyLibrary.hashes.json');
const hash = (v: unknown): string => createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12);

function current(): Record<string, string> {
  const out: Record<string, string> = {};
  const block = (scope: string, b: Block): void => {
    b.variants.forEach((sentences, i) => { out[`${scope}.${b.id}#${i}`] = hash(sentences); });
    if (b.q) out[`${scope}.${b.id}.q`] = hash(b.q);
  };
  for (const g of GUIDE_IDS) {
    for (const b of GUIDES[g].blocks) block(`guide.${g}`, b);
    (GUIDES[g].interval ?? []).forEach((s, i) => { out[`guide.${g}.interval#${i}`] = hash(s); });
  }
  for (const k of EXTRA_IDS) for (const b of EXTRA_PAGES[k].blocks) block(k, b);
  block('service', SERVICE_VISIT);
  for (const g of GUIDE_IDS) block('service', SERVICE_ALT[g]);
  return out;
}

describe('the library is append-only', () => {
  const now = current();
  const mode = process.env.UPDATE_COPY_HASHES;
  if (mode === 'reset' || !existsSync(FILE)) writeFileSync(FILE, JSON.stringify(now, null, 1) + '\n');
  else if (mode === 'append') {
    const stored = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string>;
    writeFileSync(FILE, JSON.stringify({ ...now, ...stored }, null, 1) + '\n');
  }
  const stored = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string>;

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
