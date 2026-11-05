// S8 (Ibrahim, 2026-11-04): iOS behaviour must not change. A site made in the iOS app has pages v2 (`extraPages`) but never
// `source: 'web-app'`; it must render byte for byte as origin/main (08186dc) did before the Phase 1 service-page work: same
// pages, same sitemap, no robots.txt, no noindex, no visit/alt text. The fixture holds a hash of every page that main rendered.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import { renderPendingBundle } from '../../lib/publishSite';
import { buildImageUrlMap, toPendingSiteData } from '../../lib/ios/pendingData';
import { IOS_SITES } from './helpers/iosSites';

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2031-06-01T12:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });

const sha = (s: string): string => createHash('sha1').update(s).digest('hex');
const GOLDEN = JSON.parse(readFileSync(join(__dirname, 'fixtures/ios-unchanged.json'), 'utf8')) as Record<string, { pages: Record<string, string>; sitemap: string | null }>;

describe('iOS-made sites render exactly as origin/main 08186dc did', () => {
  for (const [name, site] of Object.entries(IOS_SITES)) for (const template of ['luxe', 'prime', 'euphoria'] as const) for (const base of [null, 'https://fresh.example.com']) {
    const key = `${name}|${template}|${base ?? 'nobase'}`;
    it(key, () => {
      const out = renderSiteBundle({ ...site, template }, base ? { siteBaseUrl: base } : {});
      expect(Object.keys(out.pages.reduce((a, p) => ({ ...a, [p.path]: 1 }), {}))).toEqual(Object.keys(GOLDEN[key].pages));
      for (const p of out.pages) expect(sha(p.html.replace(/published-at" content="\d+"/, '')), `${key} ${p.path}`).toBe(GOLDEN[key].pages[p.path]);
      expect(out.sitemap === null ? null : sha(out.sitemap)).toBe(GOLDEN[key].sitemap);
      expect(out.robots).toBeNull();
      expect(out.pages.some((p) => p.html.includes('name="robots"'))).toBe(false);
    });
  }
  it('the same holds through the publish path (renderPendingBundle)', () => {
    for (const [name, site] of Object.entries(IOS_SITES)) {
      const out = renderPendingBundle({ siteData: site, imageUrlMap: {} }, { siteBaseUrl: 'https://fresh.example.com' });
      const key = `${name}|luxe|https://fresh.example.com`;
      for (const p of out.pages) expect(sha(p.html.replace(/published-at" content="\d+"/, '')), `${key} ${p.path}`).toBe(GOLDEN[key].pages[p.path]);
      expect(out.robots).toBeNull();
    }
  });
  it('the marker is the only gate: the same sites with source "web-app" do change', () => {
    for (const [name, site] of Object.entries(IOS_SITES)) {
      if (!site.extraPages?.serviceGuides) continue;
      const out = renderSiteBundle({ ...site, source: 'web-app' }, { siteBaseUrl: 'https://fresh.example.com' });
      const changed = out.pages.filter((p) => sha(p.html.replace(/published-at" content="\d+"/, '')) !== GOLDEN[`${name}|luxe|https://fresh.example.com`].pages[p.path]);
      expect(changed.length, name).toBeGreaterThan(0);
      expect(out.robots, name).not.toBeNull();
    }
  });
  it('the marker the web app stamps survives the web publish path into the renderer (draft -> pending file shape -> renderPendingBundle)', () => {
    const draft = { ...IOS_SITES.rich, source: 'web-app' }; // api/web-app/draft.ts: { ...site_data, source: 'web-app' }
    const pending = toPendingSiteData(draft, buildImageUrlMap(draft));
    expect(pending.source).toBe('web-app');
    const out = renderPendingBundle({ siteData: JSON.parse(JSON.stringify(pending)), imageUrlMap: {} }, { siteBaseUrl: 'https://fresh.example.com' });
    expect(out.robots).not.toBeNull();
    expect(out.pages.some((p) => p.html.includes('name="robots"'))).toBe(true);
    // and an iOS draft (no marker) keeps none
    expect(toPendingSiteData(IOS_SITES.rich, buildImageUrlMap(IOS_SITES.rich)).source).toBeUndefined();
  });
});
