// S8 (Ibrahim, 2026-11-04): iOS behaviour must not change. A site made in the iOS app has pages v2 (`extraPages`) but never
// `source: 'web-app'`; it must render byte for byte as origin/main (08186dc) did before the Phase 1 service-page work: same
// pages, same sitemap, no robots.txt, no noindex, no visit/alt text.
//
// Two layers:
//   1. RUNTIME (when the commit is in the clone): the baseline renderer is rebuilt from `git archive 08186dc` at test time
//      (helpers/iosBaseline.ts) and rendered next to this branch's renderer on the same sites. Nothing stored can drift.
//   2. FIXTURE (always): the same baseline output kept in fixtures/ios-unchanged.json, for shallow clones without the commit.
//      It is only ever written from the BASELINE: `REGEN_IOS_FIXTURE=1 npx vitest run tests/render/iosUnchanged.test.ts`,
//      then paste the printed digest into FIXTURE_DIGEST below. The test refuses to regenerate when any UPDATE_* variable
//      is set or when the baseline is missing, and a digest test fails when the file is edited by hand.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as branchSite from '../../lib/render/site';
import * as branchPublish from '../../lib/publishSite';
import * as branchPending from '../../lib/ios/pendingData';
import { IOS_SITES } from './helpers/iosSites';
import { baselineAvailable, loadBaseline } from './helpers/iosBaseline';

const FIXTURE_FILE = join(__dirname, 'fixtures/ios-unchanged.json');
const FIXTURE_DIGEST = '1bf0c61c23ef95c93e2e23bad03268e9b361a3bc';

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2031-06-01T12:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });

const sha = (s: string): string => createHash('sha1').update(s).digest('hex');
const strip = (h: string): string => h.replace(/published-at" content="\d+"/, '');
type Snap = { pages: Record<string, string>; sitemap: string | null; robots: unknown; noindex: boolean };
interface Mods { renderSiteBundle: typeof branchSite.renderSiteBundle; renderPendingBundle: typeof branchPublish.renderPendingBundle }
const TEMPLATES = ['luxe', 'prime', 'euphoria'] as const;
const BASES: Array<[string, Record<string, string>]> = [['nobase', {}], ['https://fresh.example.com', { siteBaseUrl: 'https://fresh.example.com' }], ['custom', { siteBaseUrl: 'https://fresh.example.com', customDomain: 'https://shop.example.org' }]];

function snap(m: Mods, name: string, template: (typeof TEMPLATES)[number], opts: Record<string, string>, pending: boolean): Snap {
  const site = JSON.parse(JSON.stringify({ ...IOS_SITES[name], template }));
  const out = pending ? m.renderPendingBundle({ siteData: site, imageUrlMap: {} }, opts) : m.renderSiteBundle(site, opts);
  return {
    pages: Object.fromEntries(out.pages.map((p: { path: string; html: string }) => [p.path, sha(strip(p.html))])),
    sitemap: out.sitemap == null ? null : sha(out.sitemap), robots: out.robots ?? null,
    noindex: out.pages.some((p: { html: string }) => p.html.includes('name="robots"')),
  };
}
const branch: Mods = { renderSiteBundle: branchSite.renderSiteBundle, renderPendingBundle: branchPublish.renderPendingBundle };
const keyOf = (name: string, t: string, b: string, pending: boolean) => `${name}|${t}|${b}|${pending ? 'pending' : 'site'}`;
const allKeys = (): Array<[string, string, (typeof TEMPLATES)[number], string, Record<string, string>, boolean]> => {
  const out: Array<[string, string, (typeof TEMPLATES)[number], string, Record<string, string>, boolean]> = [];
  for (const name of Object.keys(IOS_SITES)) for (const t of TEMPLATES) for (const [b, o] of BASES) for (const pending of [false, true]) {
    if (pending && t !== 'luxe') continue; // the publish path renders the same pages through renderSiteBundle; one template is enough
    out.push([keyOf(name, t, b, pending), name, t, b, o, pending]);
  }
  return out;
};

const regen = process.env.REGEN_IOS_FIXTURE === '1';
const haveBaseline = baselineAvailable();

describe('iOS-made sites render exactly as origin/main 08186dc did (runtime, rebuilt from git)', () => {
  it.skipIf(!haveBaseline)('the baseline really is the old renderer (no robots, no noindex, not the branch module)', async () => {
    const base = await loadBaseline();
    expect(base.renderSiteBundle).not.toBe(branchSite.renderSiteBundle);
    expect(base.renderSiteBundle({ ...IOS_SITES.rich, source: 'web-app' }, {}).robots ?? null).toBeNull(); // 08186dc has no web-origin gate at all
  });
  for (const [key, name, t, , o, pending] of allKeys()) {
    it.skipIf(!haveBaseline)(key, async () => {
      const base = await loadBaseline();
      const a = snap(base as unknown as Mods, name, t, o, pending);
      const b = snap(branch, name, t, o, pending);
      expect(b).toEqual(a);
      expect(b.robots).toBeNull();
      expect(b.noindex).toBe(false);
    });
  }
});

describe('iOS-made sites match the stored baseline fixture', () => {
  if (regen) {
    it.skipIf(!haveBaseline)('REGEN: write the fixture from the BASELINE renderer', async () => {
      const bad = Object.keys(process.env).filter((k) => k.startsWith('UPDATE_'));
      expect(bad, 'no UPDATE_* variable may be set while regenerating').toEqual([]);
      const base = await loadBaseline();
      const fixture: Record<string, Snap> = {};
      for (const [key, name, t, , o, pending] of allKeys()) fixture[key] = snap(base as unknown as Mods, name, t, o, pending);
      const text = JSON.stringify(fixture, null, 1) + '\n';
      writeFileSync(FIXTURE_FILE, text);
      console.log(`ios-unchanged.json digest: ${sha(text)}`);
    });
    return;
  }
  const text = readFileSync(FIXTURE_FILE, 'utf8');
  const GOLDEN = JSON.parse(text) as Record<string, Snap>;
  it('the fixture file is the one that was generated from 08186dc (digest)', () => { expect(sha(text)).toBe(FIXTURE_DIGEST); });
  it('the fixture covers every site, template, base and publish path', () => { expect(Object.keys(GOLDEN).sort()).toEqual(allKeys().map(([k]) => k).sort()); });
  for (const [key, name, t, , o, pending] of allKeys()) {
    it(key, () => {
      const b = snap(branch, name, t, o, pending);
      expect(b).toEqual(GOLDEN[key]);
    });
  }
});

describe('the gate itself', () => {
  it('the marker is the only gate: the same sites with source "web-app" do change', () => {
    for (const [name, site] of Object.entries(IOS_SITES)) {
      if (!site.extraPages?.serviceGuides) continue;
      if (!site.services.some((s) => /fade/i.test(s.title))) continue;
      const out = branchSite.renderSiteBundle({ ...site, source: 'web-app' }, { siteBaseUrl: 'https://fresh.example.com' });
      expect(out.robots, name).not.toBeNull();
    }
  });
  it('the marker the web app stamps survives the web publish path into the renderer (draft -> pending file shape -> renderPendingBundle)', () => {
    const draft = { ...IOS_SITES.rich, source: 'web-app' }; // api/web-app/draft.ts: { ...site_data, source: 'web-app' }
    const pending = branchPending.toPendingSiteData(draft, branchPending.buildImageUrlMap(draft));
    expect(pending.source).toBe('web-app');
    const out = branchPublish.renderPendingBundle({ siteData: JSON.parse(JSON.stringify(pending)), imageUrlMap: {} }, { siteBaseUrl: 'https://fresh.example.com' });
    expect(out.robots).not.toBeNull();
    expect(out.pages.some((p) => p.html.includes('name="robots"'))).toBe(true);
    expect(branchPending.toPendingSiteData(IOS_SITES.rich, branchPending.buildImageUrlMap(IOS_SITES.rich)).source).toBeUndefined();
  });
});
