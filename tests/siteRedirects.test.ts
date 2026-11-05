// Phase 1 step 5: removed and renamed service pages (lib/siteRedirects.ts). Expected values are written by hand (an independent oracle), the
// invariants are checked on random publish histories, and hostile input is thrown at every entry point.
import { describe, expect, it } from 'vitest';
import {
  REDIRECT_CAP, REDIRECT_RESERVED, hrefOfFile, isPagePath, isRedirectTarget, isServicePath, movedMap, pagePathsOf, parsePublishedPaths,
  planPublishedPaths, redirectRules, redirectsApply, type PublishedPaths, type SiteRedirect,
} from '../lib/siteRedirects';
import { siteVercelConfig } from '../lib/siteSubpages';
import { SERVICE_PAGE_CAP, buildPageSet } from '../lib/render/pages';

const svc = (...slugs: string[]) => slugs.map((s) => `/services/${s}/`);
const BASE = ['/', '/about/', '/services/', '/contact/'];
const state = (slugs: string[], redirects: SiteRedirect[] = []): PublishedPaths => ({ v: 1, paths: [...BASE, ...svc(...slugs)].sort(), redirects });
const paths = (slugs: string[], extra: string[] = BASE) => [...extra, ...svc(...slugs)];
const R = (from: string, to: string): SiteRedirect => ({ from: `/services/${from}/`, to: to === '' ? '/services/' : `/services/${to}/` });

describe('a removed service redirects to /services/', () => {
  it('only the service that disappeared, to the group page', () => {
    const r = planPublishedPaths(state(['fade', 'beard-trim', 'kids-cut']), paths(['fade', 'kids-cut']));
    expect(r.redirects).toEqual([R('beard-trim', '')]);
    expect(r.paths).toEqual([...BASE, ...svc('fade', 'kids-cut')].sort());
  });
  it('several at once, in a stable (sorted) order', () => {
    const r = planPublishedPaths(state(['z-cut', 'a-cut', 'fade']), paths(['fade']));
    expect(r.redirects).toEqual([R('a-cut', ''), R('z-cut', '')]);
  });
  it('nothing disappeared: no redirect; a page that is not a service page is never redirected', () => {
    expect(planPublishedPaths(state(['fade']), paths(['fade'])).redirects).toEqual([]);
    const prev: PublishedPaths = { v: 1, paths: ['/', '/services/', '/contact/', '/team/sam/', '/gallery/'], redirects: [] };
    expect(planPublishedPaths(prev, ['/', '/services/']).redirects).toEqual([]);
  });
  it('a web site\'s old /faq/ goes to the hub when it is live, else to /services/, else a plain 404; it is never a chain', () => {
    const prev: PublishedPaths = { v: 1, paths: ['/', '/services/', '/faq/'], redirects: [] };
    expect(planPublishedPaths(prev, ['/', '/services/', '/guides/', '/guides/face-shape/']).redirects).toEqual([{ from: '/faq/', to: '/guides/' }]);
    expect(planPublishedPaths(prev, ['/', '/services/']).redirects).toEqual([{ from: '/faq/', to: '/services/' }]);
    expect(planPublishedPaths(prev, ['/', '/about/']).redirects).toEqual([]);
    // still published: no redirect; a stored one whose hub is gone is re-pointed at /services/; one whose source is live again is dropped
    expect(planPublishedPaths(prev, ['/', '/services/', '/faq/']).redirects).toEqual([]);
    const stored: PublishedPaths = { v: 1, paths: ['/', '/services/', '/guides/'], redirects: [{ from: '/faq/', to: '/guides/' }] };
    expect(planPublishedPaths(stored, ['/', '/services/']).redirects).toEqual([{ from: '/faq/', to: '/services/' }]);
    expect(planPublishedPaths(stored, ['/', '/services/', '/faq/', '/guides/']).redirects).toEqual([]);
    // only /faq/ -> hub or /services/ is valid
    expect(parsePublishedPaths({ v: 1, paths: [], redirects: [{ from: '/faq/', to: '/about/' }, { from: '/faq/', to: '/faq/' }, { from: '/faq/', to: '/guides/' }] })!.redirects).toEqual([{ from: '/faq/', to: '/guides/' }]);
  });
  it('no /services/ page any more (the group is hidden or empty): no redirect at all, a plain 404, and stored ones are dropped', () => {
    const prev = state(['fade', 'beard'], [R('old', '')]);
    const r = planPublishedPaths(prev, ['/', '/about/']);
    expect(r.redirects).toEqual([]);
  });
  it('no previous record (first tracked publish, or unreadable): nothing can be told to be gone', () => {
    expect(planPublishedPaths(null, paths(['fade'])).redirects).toEqual([]);
    expect(planPublishedPaths(null, paths(['fade'])).paths).toEqual([...BASE, ...svc('fade')].sort());
  });
});

describe('a renamed service redirects to its new page', () => {
  const moved = new Map([['fade', 'skin-fade']]);
  it('when the owner data maps old slug -> new slug and the new page is live and new', () => {
    const r = planPublishedPaths(state(['fade', 'beard']), paths(['skin-fade', 'beard']), moved);
    expect(r.redirects).toEqual([R('fade', 'skin-fade')]);
  });
  it('without that mapping the rename is a removal (/services/): never guessed from position or order', () => {
    expect(planPublishedPaths(state(['fade', 'beard']), paths(['skin-fade', 'beard'])).redirects).toEqual([R('fade', '')]);
  });
  it('never to an unrelated page: a target that is not live, or that already existed, falls back to /services/', () => {
    expect(planPublishedPaths(state(['fade', 'beard']), paths(['beard']), moved).redirects).toEqual([R('fade', '')]); // skin-fade is not live
    expect(planPublishedPaths(state(['fade', 'beard']), paths(['beard']), new Map([['fade', 'beard']])).redirects).toEqual([R('fade', '')]); // beard was already there
  });
  it('two renames between publishes (a -> b -> c) go straight to c', () => {
    const r = planPublishedPaths(state(['a', 'x']), paths(['c', 'x']), new Map([['a', 'b'], ['b', 'c']]));
    expect(r.redirects).toEqual([R('a', 'c')]);
  });
  it('a loop in the mapping (a -> b -> a) cannot produce one', () => {
    const r = planPublishedPaths(state(['a', 'x']), paths(['x']), new Map([['a', 'b'], ['b', 'a']]));
    expect(r.redirects).toEqual([R('a', '')]);
  });
});

describe('re-adding a service removes its redirect', () => {
  it('a redirect whose source is live again is dropped', () => {
    const prev = state(['fade'], [R('beard', ''), R('kids', '')]);
    const r = planPublishedPaths(prev, paths(['fade', 'beard']));
    expect(r.redirects).toEqual([R('kids', '')]);
  });
  it('remove, re-add, remove again: one redirect each time, never a stale one', () => {
    let s: PublishedPaths = state(['fade', 'beard']);
    s = planPublishedPaths(s, paths(['fade']));
    expect(s.redirects).toEqual([R('beard', '')]);
    s = planPublishedPaths(s, paths(['fade', 'beard']));
    expect(s.redirects).toEqual([]);
    s = planPublishedPaths(s, paths(['fade']));
    expect(s.redirects).toEqual([R('beard', '')]);
  });
  it('rename a -> b, then rename back b -> a: a is live, b redirects to a, a has no redirect', () => {
    let s = planPublishedPaths(state(['a', 'x']), paths(['b', 'x']), new Map([['a', 'b']]));
    expect(s.redirects).toEqual([R('a', 'b')]);
    s = planPublishedPaths(s, paths(['a', 'x']), new Map([['a', 'b'], ['b', 'a']]));
    expect(s.redirects).toEqual([R('b', 'a')]);
  });
});

describe('remove then rename, and rename chains: never a chain', () => {
  it('A removed, later B renamed to C: both stay, each one hop', () => {
    let s = planPublishedPaths(state(['a', 'b', 'x']), paths(['b', 'x']));
    expect(s.redirects).toEqual([R('a', '')]);
    s = planPublishedPaths(s, paths(['c', 'x']), new Map([['b', 'c']]));
    expect(s.redirects).toEqual([R('a', ''), R('b', 'c')]);
  });
  it('A renamed to B, later B renamed to C: A is pointed at C, not at B', () => {
    let s = planPublishedPaths(state(['a', 'x']), paths(['b', 'x']), new Map([['a', 'b']]));
    expect(s.redirects).toEqual([R('a', 'b')]);
    s = planPublishedPaths(s, paths(['c', 'x']), new Map([['a', 'b'], ['b', 'c']]));
    expect(s.redirects).toEqual([R('a', 'c'), R('b', 'c')]);
  });
  it('A renamed to B, then B removed: A and B both go to /services/', () => {
    let s = planPublishedPaths(state(['a', 'x']), paths(['b', 'x']), new Map([['a', 'b']]));
    s = planPublishedPaths(s, paths(['x']), new Map([['a', 'b']]));
    expect(s.redirects).toEqual([R('a', ''), R('b', '')]);
  });
  it('a stored redirect whose target vanished with no way to follow it falls back to /services/; with no group page it is dropped', () => {
    const prev = state(['x'], [R('a', 'gone')]);
    expect(planPublishedPaths(prev, paths(['x'])).redirects).toEqual([R('a', '')]);
    expect(planPublishedPaths(prev, ['/', '/about/']).redirects).toEqual([]);
  });
});

describe('the reserved-path guard', () => {
  const RESERVED = ['book', 'shop', 'api', '_ab', 'assets', 'app', 'edit', 'admin', 'manage', 'stripe-return', 'learn-clips', 'sitemap.xml', 'robots.txt', 'ab-site.json', 'vercel.json', 'index.html', 'styles.css'];
  it('no reserved word is a page path or a redirect end, as a top segment', () => {
    for (const w of RESERVED) {
      expect(REDIRECT_RESERVED.has(w), w).toBe(true);
      expect(isPagePath(`/${w}/`), w).toBe(false);
      expect(isServicePath(`/${w}/`), w).toBe(false);
      expect(isRedirectTarget(`/${w}/`), w).toBe(false);
      expect(isPagePath(`/${w}/x/`), `${w}/x`).toBe(false);
      expect(hrefOfFile(`${w}/index.html`), w).toBeNull();
    }
  });
  it('a service named like a reserved word is an ordinary page UNDER /services/ (it can never be /book): it may be redirected', () => {
    for (const w of ['book', 'shop', 'api', 'app', 'edit', 'admin', 'assets']) {
      expect(isServicePath(`/services/${w}/`), w).toBe(true);
      const r = planPublishedPaths(state([w, 'x']), paths(['x']));
      expect(r.redirects, w).toEqual([R(w, '')]);
    }
  });
  it('stored state and rules naming a reserved or unsafe path are omitted, never repaired', () => {
    const bad = ['/book/', '/shop/', '/api/x/', '/_ab/assets/a.js', '/sitemap.xml', '/robots.txt', '/stripe-return/', '/learn-clips/', '/admin/', '/app/', '/edit/', '/assets/', '/services/', '/'];
    const raw = { v: 1, paths: ['/', '/services/', ...bad.filter((b) => b.endsWith('/') && b !== '/' && b !== '/services/')], redirects: [
      ...bad.map((b) => ({ from: b, to: '/services/' })), ...bad.filter((b) => b !== '/services/').map((b) => ({ from: '/services/a/', to: b })),
      { from: '/services/ok/', to: '/services/' },
    ] };
    const p = parsePublishedPaths(raw)!;
    expect(p.paths).toEqual(['/', '/services/']);
    expect(p.redirects).toEqual([{ from: '/services/ok/', to: '/services/' }]);
    expect(redirectRules(raw.redirects as SiteRedirect[]).map((x) => x.source)).toEqual(['/services/ok', '/services/ok/', '/services/ok/index.html']);
  });
  it('the owner moved map cannot name a reserved or unsafe slug', () => {
    const hostile: Record<string, unknown> = {
      '/book': 'x', x: '/book', 'a/b': 'c', a: 'b/c', '..': 'x', x2: '..', 'https://evil.com': 'x', x3: 'https://evil.com', '//evil.com': 'x', x4: '//evil.com/',
      'a?b': 'c', a5: 'b?c=1', 'a#b': 'c', 'a%2e': 'c', a6: '%2e%2e', 'A': 'b', a7: 'B', 'a b': 'c', a8: 'b c', '': 'x', x9: '', 'a:b': 'c', 'a*': 'c', 'a(.*)': 'c',
      '__proto__': 'x', constructor: 'x', same: 'same', n: 5, o: { x: 1 }, ['k'.repeat(61)]: 'x', x10: 'v'.repeat(61), 'a\nb': 'c', x11: 'c\r\nLocation: https://evil.com',
    };
    const m = movedMap({ extraPages: { moved: hostile } });
    expect([...m.entries()]).toEqual([['constructor', 'x']]); // 'constructor' is a legal slug and harmless as a Map key
    const prev = state(['x', 'y']);
    for (const bad of Object.keys(hostile)) {
      const r = planPublishedPaths(prev, paths(['y']), movedMap({ extraPages: { moved: { x: hostile[bad], [bad]: 'y' } } }));
      expect(r.redirects, JSON.stringify(bad)).toEqual([R('x', '')]);
    }
  });
  it('not an object, or an array, or inherited: no mapping', () => {
    for (const ep of [undefined, null, 5, 'x', [], { moved: null }, { moved: 'a' }, { moved: ['a', 'b'] }, Object.create({ moved: { a: 'b' } })]) expect(movedMap({ extraPages: ep }).size, JSON.stringify(ep)).toBe(0);
    expect(movedMap(null).size).toBe(0);
  });
  it('the mapping is read up to 200 entries', () => {
    const moved: Record<string, string> = {};
    for (let i = 0; i < 500; i++) moved[`s${i}`] = `t${i}`;
    expect(movedMap({ extraPages: { moved } }).size).toBe(200);
  });
});

describe('no open redirects: every source and destination is a clean relative /services/ path', () => {
  const HOSTILE = [
    'https://evil.com/', '//evil.com/', '/\\evil.com', '/services/../book/', '/services/./a/', '/services/a/../../x/', '/services//a/', '/services/a', '/services/a/b/',
    '/services/a?x=1', '/services/a/#f', '/services/%2e%2e/', '/services/a%2fb/', '/services/:id/', '/services/(.*)/', '/services/*/', '/services/a b/', '/services/A/',
    '/services/⁣x⁣/', '/services/a\n/', '/services/ä/', '/services/' + 'a'.repeat(61) + '/', 'javascript:alert(1)', '', ' /services/a/', null, 5, {}, [],
  ];
  it('rules are made only from valid pairs', () => {
    for (const h of HOSTILE) {
      expect(redirectRules([{ from: h as any, to: '/services/' }]), JSON.stringify(h)).toEqual([]);
      expect(redirectRules([{ from: '/services/a/', to: h as any }]), JSON.stringify(h)).toEqual([]);
      expect(parsePublishedPaths({ v: 1, paths: [h], redirects: [{ from: h, to: h }] })).toEqual({ v: 1, paths: [], redirects: [] });
    }
    expect(redirectRules([{ from: '/services/a/', to: '/services/a/' }])).toEqual([]);
    expect(redirectRules(null)).toEqual([]);
    expect(redirectRules('x' as any)).toEqual([]);
  });
  it('every emitted rule matches the one allowed shape', () => {
    const rules = redirectRules([R('a', ''), R('b-c', 'd-e')]);
    expect(rules).toEqual([
      { source: '/services/a', destination: '/services/', permanent: true }, { source: '/services/a/', destination: '/services/', permanent: true }, { source: '/services/a/index.html', destination: '/services/', permanent: true },
      { source: '/services/b-c', destination: '/services/d-e/', permanent: true }, { source: '/services/b-c/', destination: '/services/d-e/', permanent: true }, { source: '/services/b-c/index.html', destination: '/services/d-e/', permanent: true },
    ]);
    for (const r of rules) { expect(r.source).toMatch(/^\/services\/[a-z0-9]+(-[a-z0-9]+)*(\/|\/index\.html)?$/); expect(r.destination).toMatch(/^\/services\/([a-z0-9]+(-[a-z0-9]+)*\/)?$/); }
  });
  it('a tampered stored record cannot smuggle anything into the plan', () => {
    const tampered = parsePublishedPaths({ v: 1, paths: ['/', '/services/', '/services/x/', 'https://evil.com/'], redirects: [{ from: '/services/a/', to: 'https://evil.com/' }, { from: 'https://evil.com/', to: '/services/' }, { from: '/services/b/', to: '/services/' }] })!;
    const r = planPublishedPaths(tampered, ['/', '/services/']);
    expect(r.redirects).toEqual([R('b', ''), R('x', '')]);
  });
  it('not a v1 record: ignored', () => {
    for (const raw of [null, undefined, 5, 'x', [], {}, { v: 2, paths: [] }, { paths: ['/'] }]) expect(parsePublishedPaths(raw), JSON.stringify(raw)).toBeNull();
  });
});

describe('the cap', () => {
  it('beyond REDIRECT_CAP the oldest are dropped, the newest stay', () => {
    const old: SiteRedirect[] = Array.from({ length: REDIRECT_CAP }, (_, i) => R(`old-${i}`, ''));
    const gone = ['n-1', 'n-2', 'n-3', 'n-4', 'n-5'];
    const r = planPublishedPaths(state(['x', ...gone], old), paths(['x']));
    expect(r.redirects).toHaveLength(REDIRECT_CAP);
    expect(r.redirects.slice(-5)).toEqual(gone.map((g) => R(g, '')));
    expect(r.redirects[0]).toEqual(R('old-5', ''));
    expect(r.redirects.map((x) => x.from)).not.toContain('/services/old-0/');
  });
  it('a stored record longer than the cap is cut on read, oldest first', () => {
    const redirects = Array.from({ length: REDIRECT_CAP + 30 }, (_, i) => R(`o-${i}`, ''));
    const p = parsePublishedPaths({ v: 1, paths: ['/'], redirects })!;
    expect(p.redirects).toHaveLength(REDIRECT_CAP);
    expect(p.redirects[0]).toEqual(R('o-30', ''));
  });
  it('the rules never exceed three per redirect', () => {
    const list = Array.from({ length: 500 }, (_, i) => R(`o-${i}`, ''));
    expect(redirectRules(list)).toHaveLength(REDIRECT_CAP * 3);
  });
});

describe('republishing is idempotent', () => {
  it('the same paths again give the same record and the same vercel.json', () => {
    const s1 = planPublishedPaths(state(['fade', 'beard']), paths(['fade']));
    const s2 = planPublishedPaths(s1, paths(['fade']));
    const s3 = planPublishedPaths(s2, paths(['fade']));
    expect(s2).toEqual(s1); expect(s3).toEqual(s1);
    const cfg = (s: PublishedPaths) => JSON.stringify(siteVercelConfig(null, { nestedPages: true, redirects: s.redirects }));
    expect(cfg(s2)).toBe(cfg(s1));
  });
  it('a lost write is healed: planning again from the older record gives the same redirects as the lost one', () => {
    const older = state(['fade', 'beard', 'kids']);
    const lost = planPublishedPaths(older, paths(['fade', 'kids']));
    const again = planPublishedPaths(older, paths(['fade']));
    expect(lost.redirects).toEqual([R('beard', '')]);
    expect(again.redirects).toEqual([R('beard', ''), R('kids', '')]); // it also covers what disappeared after the lost write
  });
});

// A model of many publishes: 40 random histories of 60 steps each over a pool of 16 service slugs and random rename hints.
describe('invariants over random publish histories', () => {
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  it('a source is never live, a target always is, no chains, no duplicates, no self-redirects, within the cap, re-added slugs have none', () => {
    const pool = Array.from({ length: 16 }, (_, i) => `s${i}`);
    for (let seed = 1; seed <= 40; seed++) {
      const rand = rng(seed);
      let st: PublishedPaths | null = null;
      for (let step = 0; step < 60; step++) {
        const live = pool.filter(() => rand() < 0.5).slice(0, SERVICE_PAGE_CAP);
        const moved = new Map<string, string>();
        for (let k = 0; k < 4; k++) if (rand() < 0.5) moved.set(pool[Math.floor(rand() * 16)], pool[Math.floor(rand() * 16)]);
        const keepGroup = rand() < 0.9;
        const now = [...(keepGroup ? ['/', '/services/'] : ['/']), ...svc(...(keepGroup ? live : []))];
        st = planPublishedPaths(st, now, moved);
        const liveSet = new Set(st.paths);
        const froms = new Set<string>();
        for (const r of st.redirects) {
          const tag = `seed ${seed} step ${step} ${r.from}->${r.to}`;
          expect(liveSet.has(r.from), tag + ' source live').toBe(false);
          expect(liveSet.has(r.to), tag + ' target not live').toBe(true);
          expect(r.from, tag).not.toBe(r.to);
          expect(froms.has(r.from), tag + ' duplicate').toBe(false);
          froms.add(r.from);
          expect(isServicePath(r.from) && isRedirectTarget(r.to), tag).toBe(true);
        }
        for (const r of st.redirects) expect(froms.has(r.to), `chain ${r.from}->${r.to}`).toBe(false);
        expect(st.redirects.length).toBeLessThanOrEqual(REDIRECT_CAP);
        for (const p of st.paths) expect(froms.has(p), 'live path with a redirect: ' + p).toBe(false);
      }
    }
  });
});

describe('the vercel.json format', () => {
  const list = [R('fade', 'skin-fade'), R('beard', '')];
  it('redirects sit next to headers (and rewrites), 308 via permanent, three rules per page, only on a multi-page deploy', () => {
    const cfg = siteVercelConfig({ mode: 'full', shopSlug: 'fresh' }, { nestedPages: true, redirects: list });
    expect(cfg.redirects).toEqual([
      { source: '/services/fade', destination: '/services/skin-fade/', permanent: true }, { source: '/services/fade/', destination: '/services/skin-fade/', permanent: true }, { source: '/services/fade/index.html', destination: '/services/skin-fade/', permanent: true },
      { source: '/services/beard', destination: '/services/', permanent: true }, { source: '/services/beard/', destination: '/services/', permanent: true }, { source: '/services/beard/index.html', destination: '/services/', permanent: true },
    ]);
    expect(Object.keys(cfg)).toEqual(['headers', 'rewrites', 'redirects']);
    expect(Object.keys(siteVercelConfig(null, { nestedPages: true, redirects: list }))).toEqual(['headers', 'redirects']);
    expect(siteVercelConfig(null, { redirects: list }).redirects).toBeUndefined(); // a single-page deploy never carries them
    // a JSON round trip is the same thing Vercel reads
    expect(JSON.parse(JSON.stringify(cfg)).redirects).toHaveLength(6);
  });
  it('none, an empty list or only invalid entries: the key is absent and the config is byte-identical to the one without the option', () => {
    for (const sp of [null, { mode: 'full', shopSlug: 'fresh' } as const, { mode: 'manage-only' } as const]) {
      for (const nested of [false, true]) {
        const plain = JSON.stringify(siteVercelConfig(sp, { nestedPages: nested }));
        expect(JSON.stringify(siteVercelConfig(sp, { nestedPages: nested, redirects: [] }))).toBe(plain);
        expect(JSON.stringify(siteVercelConfig(sp, { nestedPages: nested, redirects: [{ from: 'https://x.com', to: '//y' }] }))).toBe(plain);
        expect(JSON.stringify(siteVercelConfig(sp, { nestedPages: nested, redirects: undefined }))).toBe(plain);
      }
    }
    expect(JSON.stringify(siteVercelConfig(null))).toBe(JSON.stringify({ headers: siteVercelConfig(null).headers }));
  });
});

describe('page files and the gate', () => {
  it('file paths map to hrefs, anything else is skipped', () => {
    expect(pagePathsOf([{ path: 'index.html', html: '' }, { path: 'services/fade/index.html', html: '' }, { path: 'about/index.html', html: '' }, { path: 'book/index.html', html: '' }, { path: 'x/y/z/index.html', html: '' }, { path: 'styles.css', html: '' }, { path: '../a/index.html', html: '' }]))
      .toEqual(['/', '/about/', '/services/fade/']);
  });
  it('only a web-created pages-v2 multi-page site is tracked', () => {
    const two = [{ path: 'index.html', html: '' }, { path: 'about/index.html', html: '' }];
    const d = { pages: { order: [], hidden: [] }, extraPages: { on: [] }, source: 'web-app' };
    expect(redirectsApply(d, two)).toBe(true);
    expect(redirectsApply({ ...d, source: undefined }, two)).toBe(false); // iOS-made
    expect(redirectsApply({ ...d, source: 'ios' }, two)).toBe(false);
    expect(redirectsApply({ ...d, extraPages: undefined }, two)).toBe(false); // pages v1
    expect(redirectsApply({ ...d, extraPages: [] }, two)).toBe(false);
    expect(redirectsApply({ ...d, pages: undefined }, two)).toBe(false); // single page
    expect(redirectsApply(d, two.slice(0, 1))).toBe(false);
  });
});

describe('with the real page set: the 12 service page cap and hostile titles', () => {
  const site = (titles: string[]): any => ({
    shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '555', pages: { order: [], hidden: [] }, extraPages: { on: [], serviceGuides: true }, source: 'web-app',
    hero: { heading: 'H', tagline: '', imageUrl: '' }, about: { heading: 'A', description: ['x'], imageUrl: '' }, gallery: [], craftImages: [], staff: [],
    contact: { address: '1 Main St', email: '' }, hours: [{ day: 'Mon', open: '9', close: '5' }],
    services: titles.map((t) => ({ title: t, subtitle: '', description: 'A service.', icon: 'scissors', imageUrl: '' })),
  });
  const pathsOf = (titles: string[]) => buildPageSet(site(titles), {}).files.map((f) => f.href);
  it('the cap is still 12; the 13th service has no page and no path', () => {
    expect(SERVICE_PAGE_CAP).toBe(12);
    const titles = Array.from({ length: 13 }, (_, i) => `Service ${i + 1}`);
    const p = pathsOf(titles).filter(isServicePath);
    expect(p).toHaveLength(12);
    expect(p).not.toContain('/services/service-13/');
  });
  it('removing the 3rd of 13: it redirects to /services/ and the 13th (which now gets a page) is not what it points at', () => {
    const titles = Array.from({ length: 13 }, (_, i) => `Service ${i + 1}`);
    const before = planPublishedPaths(null, pathsOf(titles));
    const after = planPublishedPaths(before, pathsOf(titles.filter((_, i) => i !== 2)));
    expect(after.paths).toContain('/services/service-13/');
    expect(after.redirects).toEqual([R('service-3', '')]);
  });
  it('hostile, reserved-looking and non-Latin titles give clean slugs, and a removal redirects with a valid rule', () => {
    const titles = ['../../etc/passwd', '<script>alert(1)</script>', 'a/b?c=d#e', '💈💈', 'Book', 'API', '_ab', 'sitemap.xml', 'https://evil.com', 'x'.repeat(200), 'Fade & Taper', 'الحلاقة'];
    const p = pathsOf(titles).filter(isServicePath);
    expect(p).toHaveLength(titles.length);
    for (const h of pathsOf(titles)) expect(isPagePath(h), h).toBe(true);
    const before = planPublishedPaths(null, pathsOf(titles));
    const after = planPublishedPaths(before, pathsOf(titles.slice(0, 1)));
    expect(after.redirects).toHaveLength(titles.length - 1);
    const rules = redirectRules(after.redirects);
    expect(rules).toHaveLength(3 * (titles.length - 1));
    for (const r of rules) expect(r.source).toMatch(/^\/services\/[a-z0-9]+(-[a-z0-9]+)*(\/|\/index\.html)?$/);
  });
  it('the sitemap-facing path set of the new publish never contains a redirected page', () => {
    const before = planPublishedPaths(null, pathsOf(['Fade', 'Beard Trim', 'Kids Cut']));
    const after = planPublishedPaths(before, pathsOf(['Fade', 'Kids Cut']));
    expect(after.redirects.map((r) => r.from)).toEqual(['/services/beard-trim/']);
    expect(after.paths).not.toContain('/services/beard-trim/');
  });
});
