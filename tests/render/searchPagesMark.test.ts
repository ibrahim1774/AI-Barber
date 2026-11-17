// extraPages.searchPages (lib/pagesV2.ts searchPagesOn): the explicit opt-in that gives a site that is NOT web-made the web page rules.
//   1. A site with no mark and no source 'web-app' renders byte for byte as origin/main 82ab412c did (single page and multi page with FAQ).
//   2. A web-made site renders byte for byte as origin/main 82ab412c did.
//   3. An iOS-shaped site WITH the mark renders the same bundle as a web-made copy of the same data.
//   4. The mark alone decides: "made on iOS" never switches the rules on, and a mark without pages v2 does nothing.
// Layer 1 and 2 run against the baseline rebuilt from git (helpers/mainBaseline.ts) and against a stored copy of its output
// (fixtures/search-pages-main-baseline.json), written only from the baseline: REGEN_MAIN_FIXTURE=1 npx vitest run tests/render/searchPagesMark.test.ts
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as branchPublish from '../../lib/publishSite';
import * as branchSite from '../../lib/render/site';
import { hasPagesV2, isWebCreated, searchPagesOn } from '../../lib/pagesV2';
import { cleanExtraPages, faqRemoved } from '../../lib/render/pages';
import { redirectsApply } from '../../lib/siteRedirects';
import { toPendingSiteData, buildImageUrlMap } from '../../lib/ios/pendingData';
import { IOS_SITES } from './helpers/iosSites';
import { loadMainBaseline, mainBaselineAvailable } from './helpers/mainBaseline';

const FIXTURE_FILE = join(__dirname, 'fixtures/search-pages-main-baseline.json');
const BASE = { siteBaseUrl: 'https://fresh.example.com' };
const sha = (s: string): string => createHash('sha1').update(s).digest('hex');
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2031-06-01T12:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });

const single = (() => { const s: any = clone(IOS_SITES.rich); delete s.pages; delete s.extraPages; return s; })(); // pages v1 / one page
const marked = (s: any) => ({ ...clone(s), extraPages: { ...s.extraPages, searchPages: true } });
const web = (s: any) => ({ ...clone(s), source: 'web-app' });

/** Sites rendered with the BASELINE. `ios*` carry no mark and no source; `web*` are web-made. */
const NO_MARK: Record<string, any> = { 'ios-single': single, 'ios-multi-faq': IOS_SITES.rich, 'ios-multi-guides': IOS_SITES.guidesOnNoText, 'ios-sparse': IOS_SITES.sparse };
const WEB_MADE: Record<string, any> = { 'web-multi-faq': web(IOS_SITES.rich), 'web-multi-guides': web(IOS_SITES.guidesOnNoText), 'web-sparse': web(IOS_SITES.sparse), 'web-single': web(single) };
const ALL: Record<string, any> = { ...NO_MARK, ...WEB_MADE };
const TEMPLATES = ['luxe', 'prime', 'euphoria'] as const;

interface Mods { renderSiteBundle: typeof branchSite.renderSiteBundle; renderPendingBundle: typeof branchPublish.renderPendingBundle }
type Snap = { pages: Record<string, string>; sitemap: string | null; robots: string | null };
const bundle = (m: Mods, site: any, template: string, pending: boolean) => {
  const s = { ...clone(site), template };
  return pending ? m.renderPendingBundle({ siteData: toPendingSiteData(s, buildImageUrlMap(s)), imageUrlMap: {} }, BASE) : m.renderSiteBundle(s, BASE);
};
const strip = (h: string): string => h.replace(/published-at" content="\d+"/, '');
const snap = (m: Mods, site: any, template: string, pending: boolean): Snap => {
  const out = bundle(m, site, template, pending);
  return { pages: Object.fromEntries(out.pages.map((p: { path: string; html: string }) => [p.path, sha(strip(p.html))])), sitemap: out.sitemap == null ? null : sha(out.sitemap), robots: out.robots == null ? null : sha(out.robots) };
};
// 'web-sparse' (a web-made site with 2 services, no hours, no phone, no booking link) was BELOW 21 pages on origin/main (19) and gains guide pages
// from the 20+ pages change on purpose: it is compared with the baseline in tests/render/guideFloor21.test.ts (every non-guide file identical), not here.
const GAINS_GUIDES = new Set(['web-sparse']);
const keys = (): Array<[string, string, string, boolean]> => {
  const out: Array<[string, string, string, boolean]> = [];
  for (const name of Object.keys(ALL)) if (!GAINS_GUIDES.has(name)) for (const t of TEMPLATES) for (const pending of [false, true]) { if (pending && t !== 'luxe') continue; out.push([`${name}|${t}|${pending ? 'pending' : 'site'}`, name, t, pending]); }
  return out;
};
const branch: Mods = { renderSiteBundle: branchSite.renderSiteBundle, renderPendingBundle: branchPublish.renderPendingBundle };
const haveBaseline = mainBaselineAvailable();

if (process.env.REGEN_MAIN_FIXTURE === '1') {
  describe('REGEN', () => {
    it.skipIf(!haveBaseline)('write the fixture from the BASELINE renderer', async () => {
      expect(Object.keys(process.env).filter((k) => k.startsWith('UPDATE_'))).toEqual([]);
      const base = (await loadMainBaseline()) as unknown as Mods;
      const fixture: Record<string, Snap> = {};
      for (const [key, name, t, pending] of keys()) fixture[key] = snap(base, ALL[name], t, pending);
      writeFileSync(FIXTURE_FILE, JSON.stringify(fixture, null, 1) + '\n');
    });
  });
} else {
  describe('no mark, no web source: byte-identical to origin/main (82ab412c)', () => {
    it.skipIf(!haveBaseline)('the baseline really is the old renderer (it has no searchPagesOn)', async () => {
      const base = await loadMainBaseline();
      expect(base.renderSiteBundle).not.toBe(branchSite.renderSiteBundle);
      // Same data, mark added: the OLD renderer ignores the mark, the branch does not.
      const old = base.renderSiteBundle(marked(IOS_SITES.rich), BASE);
      expect(old.robots ?? null).toBeNull();
      expect(branchSite.renderSiteBundle(marked(IOS_SITES.rich), BASE).robots).not.toBeNull();
    });
    for (const [key, name, t, pending] of keys()) {
      it.skipIf(!haveBaseline)(`${key} (runtime baseline, full bundle)`, async () => {
        const base = (await loadMainBaseline()) as unknown as Mods;
        const a = bundle(base, ALL[name], t, pending);
        const b = bundle(branch, ALL[name], t, pending);
        expect(b.pages.map((p: any) => [p.path, strip(p.html)])).toEqual(a.pages.map((p: any) => [p.path, strip(p.html)]));
        expect(b.sitemap ?? null).toBe(a.sitemap ?? null);
        expect(b.robots ?? null).toBe(a.robots ?? null);
      });
    }
    const GOLDEN = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as Record<string, Snap>;
    it('the stored fixture covers every site', () => { expect(Object.keys(GOLDEN).sort()).toEqual(keys().map(([k]) => k).sort()); });
    for (const [key, name, t, pending] of keys()) it(`${key} (stored baseline)`, () => { expect(snap(branch, ALL[name], t, pending)).toEqual(GOLDEN[key]); });
    it('the redirect gate agrees with the baseline for every unmarked and web-made site', async () => {
      const base = await loadMainBaseline();
      for (const [name, s] of Object.entries(ALL)) {
        if (GAINS_GUIDES.has(name)) continue;
        const pages = branchSite.renderSiteBundle(clone(s), BASE).pages;
        expect(redirectsApply(s, pages), name).toBe(base.redirectsApply(s, pages));
      }
    });
  });
}

describe('a marked iOS site gets the same bundle as a web-made copy of the same data', () => {
  const marks = { 'multi-faq': IOS_SITES.rich, 'multi-guides': IOS_SITES.guidesOnNoText, sparse: IOS_SITES.sparse } as Record<string, any>;
  for (const [name, s] of Object.entries(marks)) for (const t of TEMPLATES) for (const pending of [false, true]) {
    it(`${name} ${t} ${pending ? 'pending' : 'site'}`, () => {
      const a = bundle(branch, web(s), t, pending);
      const b = bundle(branch, marked(s), t, pending);
      expect(b.pages.map((p: any) => [p.path, strip(p.html)])).toEqual(a.pages.map((p: any) => [p.path, strip(p.html)]));
      expect(b.sitemap).toBe(a.sitemap);
      expect(b.robots).toBe(a.robots);
      expect(b.robots).not.toBeNull();
    });
  }
  it('the page set and head tags are the web ones: FAQ gone, guides added, noindex on thin pages, JSON-LD on home', () => {
    const a = bundle(branch, IOS_SITES.rich, 'luxe', false);
    const b = bundle(branch, marked(IOS_SITES.rich), 'luxe', false);
    expect(a.pages.some((p: any) => p.path.startsWith('guides/'))).toBe(false);
    expect(b.pages.some((p: any) => p.path === 'guides/index.html')).toBe(true);
    expect(b.pages.some((p: any) => p.path.startsWith('faq'))).toBe(false);
    expect(b.pages.length).toBeGreaterThanOrEqual(21);
    expect(b.pages.find((p: any) => p.path === 'index.html')!.html).toContain('application/ld+json');
    expect(a.pages.find((p: any) => p.path === 'index.html')!.html).not.toContain('application/ld+json');
  });
  it('the mark does not print: marked and unmarked home pages differ only through the rules, not through a visible flag', () => {
    expect(JSON.stringify(bundle(branch, marked(IOS_SITES.sparse), 'luxe', false))).not.toContain('searchPages');
  });
});

describe('the predicate', () => {
  it('web-made or the explicit mark (with pages v2); nothing else', () => {
    expect(searchPagesOn({ source: 'web-app' })).toBe(true);
    expect(searchPagesOn({ source: 'web-app', extraPages: { on: [] } })).toBe(true);
    expect(searchPagesOn({ extraPages: { on: [], searchPages: true } })).toBe(true);
    expect(searchPagesOn({ extraPages: { on: [], serviceGuides: true } })).toBe(false);
    expect(searchPagesOn({ extraPages: { on: [], searchPages: false } })).toBe(false);
    expect(searchPagesOn({ extraPages: { on: [], searchPages: 'true' } })).toBe(false);
    expect(searchPagesOn({ extraPages: { on: [], searchPages: 1 } })).toBe(false);
    expect(searchPagesOn({ extraPages: [] as unknown })).toBe(false);
    expect(searchPagesOn({ extraPages: { searchPages: true }, source: 'ios' })).toBe(true);
    expect(searchPagesOn({ source: 'ios' })).toBe(false);
    expect(searchPagesOn({})).toBe(false);
    expect(searchPagesOn(null)).toBe(false);
    expect(searchPagesOn(undefined)).toBe(false);
  });
  it('a mark with no pages v2 (no extraPages object, or a single-page site) changes nothing', () => {
    const s: any = { ...clone(single), extraPages: undefined, searchPages: true };
    expect(searchPagesOn(s)).toBe(false);
    expect(JSON.stringify(branchSite.renderSiteBundle(s, BASE))).toBe(JSON.stringify(branchSite.renderSiteBundle(clone(single), BASE)));
  });
  it('a marked single-page site (no `pages`) still renders one page', () => {
    const s: any = { ...clone(single), extraPages: { on: [], searchPages: true } };
    expect(branchSite.renderSiteBundle(s, BASE).pages).toHaveLength(1);
  });
  it('isWebCreated is unchanged and the mark never makes a site "web-created"', () => {
    expect(isWebCreated({ extraPages: { searchPages: true } } as any)).toBe(false);
    expect(hasPagesV2({ extraPages: { searchPages: true } })).toBe(true);
    expect(faqRemoved({ extraPages: { on: ['faq'], searchPages: true } })).toBe(true);
    expect(faqRemoved({ extraPages: { on: ['faq'] } })).toBe(false);
  });
  it('cleanExtraPages keeps the mark only when it is exactly true, and adds nothing otherwise', () => {
    expect(cleanExtraPages({ on: ['faq'], searchPages: true })).toEqual({ on: ['faq'], serviceGuides: false, searchPages: true });
    expect(cleanExtraPages({ on: ['faq'], searchPages: 'yes' })).toEqual({ on: ['faq'], serviceGuides: false });
    expect(cleanExtraPages({ on: ['faq'] })).toEqual({ on: ['faq'], serviceGuides: false });
  });
  it('the mark survives the pending transform and the stored copy', () => {
    const s: any = marked(IOS_SITES.rich);
    expect(toPendingSiteData(s, buildImageUrlMap(s)).extraPages!.searchPages).toBe(true);
    const withImages = { ...s, extraPages: { ...s.extraPages, images: { 'hair-care': 'https://img.example/h.jpg' } } };
    expect(toPendingSiteData(withImages, buildImageUrlMap(withImages)).extraPages!.searchPages).toBe(true);
  });
});
