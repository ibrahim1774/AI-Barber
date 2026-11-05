// Phase 1 step 5, runtime parity: with no redirects (every site that is not a web-created pages-v2 site) the deploy files and vercel.json of
// this branch are byte for byte what origin/main 08186dc produced, rebuilt from git at test time (render/helpers/iosBaseline.ts).
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { baselineAvailable, extractBaseline } from './render/helpers/iosBaseline';
import { buildSiteFiles } from '../lib/deploySite';
import { siteVercelConfig } from '../lib/siteSubpages';
import { renderPendingBundle } from '../lib/publishSite';
import { IOS_SITES } from './render/helpers/iosSites';

const haveBaseline = baselineAvailable();
const SPS = [null, { mode: 'full', shopSlug: 'fresh-cuts' }, { mode: 'manage-only' }] as const;
const page = (path: string) => ({ path, html: `<p>${path}</p>` });

describe('vercel.json and the deploy files equal 08186dc when there are no redirects', () => {
  it.skipIf(!haveBaseline)('siteVercelConfig: same bytes for every subpages mode and page count', async () => {
    const base = await import(/* @vite-ignore */ join(extractBaseline(), 'lib/siteSubpages.ts'));
    expect(base.siteVercelConfig).not.toBe(siteVercelConfig);
    for (const sp of SPS) for (const nestedPages of [false, true]) {
      const a = JSON.stringify(base.siteVercelConfig(sp, { nestedPages }));
      expect(JSON.stringify(siteVercelConfig(sp, { nestedPages })), `${sp?.mode} ${nestedPages}`).toBe(a);
      expect(JSON.stringify(siteVercelConfig(sp, { nestedPages, redirects: [] })), `${sp?.mode} ${nestedPages} []`).toBe(a);
      expect(JSON.stringify(siteVercelConfig(sp, { nestedPages, redirects: undefined }))).toBe(a);
    }
    expect(JSON.stringify(siteVercelConfig(null))).toBe(JSON.stringify(base.siteVercelConfig(null)));
  });
  it.skipIf(!haveBaseline)('buildSiteFiles: same files, same bytes, for the real rendered pages of the iOS sites', async () => {
    const base = await import(/* @vite-ignore */ join(extractBaseline(), 'lib/deploySite.ts'));
    for (const name of Object.keys(IOS_SITES)) {
      const out = renderPendingBundle({ siteData: JSON.parse(JSON.stringify(IOS_SITES[name])), imageUrlMap: {} }, { siteBaseUrl: 'https://fresh.example.com' });
      for (const sp of SPS) {
        const a = base.buildSiteFiles(out.pages, 'a{}', sp, { sitemap: out.sitemap, robots: out.robots });
        expect(buildSiteFiles(out.pages, 'a{}', sp, { sitemap: out.sitemap, robots: out.robots }), `${name} ${sp?.mode}`).toEqual(a);
        expect(buildSiteFiles(out.pages, 'a{}', sp, { sitemap: out.sitemap, robots: out.robots, redirects: [] }), `${name} ${sp?.mode} []`).toEqual(a);
      }
    }
    const small = [page('index.html'), page('about/index.html')];
    expect(buildSiteFiles(small, 'a{}', null, {})).toEqual(base.buildSiteFiles(small, 'a{}', null, {}));
    expect(buildSiteFiles([page('index.html')], undefined, null)).toEqual(base.buildSiteFiles([page('index.html')], undefined, null));
  });
  it('redirects reach only the vercel.json file of a multi-page deploy, and change nothing else', () => {
    const pages = [page('index.html'), page('about/index.html'), page('services/index.html')];
    const plain = buildSiteFiles(pages, 'a{}', null, { sitemap: '<urlset/>' });
    const withR = buildSiteFiles(pages, 'a{}', null, { sitemap: '<urlset/>', redirects: [{ from: '/services/old/', to: '/services/' }] });
    expect(withR.map((f) => f.file)).toEqual(plain.map((f) => f.file));
    const diff = withR.filter((f, i) => f.data !== plain[i].data).map((f) => f.file);
    expect(diff).toEqual(['vercel.json']);
    // a single page deploy ignores them
    expect(buildSiteFiles([page('index.html')], 'a{}', null, { redirects: [{ from: '/services/old/', to: '/services/' }] })).toEqual(buildSiteFiles([page('index.html')], 'a{}', null, {}));
  });
});
