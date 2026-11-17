// "Every site reaches 20+ pages" (2026-11-16): the guide fill can now reach the floor of 21 for every site that has search pages on
// (web-made, or an iOS site with extraPages.searchPages = true). Counts here are the rendered files (guides are files) plus proxied /book and /shop.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import { buildPageSet } from '../../lib/render/pages';
import { GUIDE_ADDED_CAP, PAGE_FLOOR, countPages, guideEligible, guideSettings, hasBeardService, planGuides, resolveGuide } from '../../lib/render/guidePages';
import { GUIDE_PAGE_IDS } from '../../lib/render/guideIds';
import { GUIDE_LIBRARY } from '../../lib/render/guideLibrary';
import { guideSentenceProblems } from '../../lib/render/guideLint';
import { copyProblems } from '../../lib/render/copyRules';
import { loadMainBaseline, mainBaselineAvailable } from './helpers/mainBaseline';
import { IOS_SITES } from './helpers/iosSites';
import type { WebsiteData } from '../../types';

const BASE = { siteBaseUrl: 'https://fresh.example.com' };
const TITLES = ['Haircut', 'Skin Fade', 'Beard Trim', 'Kids Haircut', 'Line Up', 'Hot Towel Shave', 'Taper', 'Buzz Cut', 'Mohawk', 'Designs', 'Cut and Beard', 'Mullet'];
const svc = (title: string) => ({ title, subtitle: '', description: '', price: '$30', duration: '30 min', icon: 'scissors' as const, imageUrl: '' });
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => ({ day, open: '09:00', close: '17:00' }));
interface Opt { hours: boolean; phone: boolean; addr: boolean; city: boolean }
const FULL: Opt = { hours: true, phone: true, addr: true, city: true };
const site = (n: number, o: Opt, kind: 'web' | 'ios-marked' | 'ios-unmarked', extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: o.city ? 'Brooklyn, NY' : '', phone: o.phone ? '(512) 555-0100' : '', bookingUrl: '', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' }, about: { heading: 'About', description: [], imageUrl: '' },
  services: TITLES.slice(0, n).map(svc), gallery: [], hours: o.hours ? WEEK : [], contact: { address: o.addr ? '1 Main St, Brooklyn, NY 11201' : '', email: '' },
  pages: { order: [], hidden: [] },
  extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7, ...(kind === 'ios-marked' ? { searchPages: true } : {}) },
  ...(kind === 'web' ? { source: 'web-app' } : {}), ...extra,
} as WebsiteData);
const proxied = (d: WebsiteData) => (d.bookingUrl === '/book' ? 1 : 0) + (d.shopUrl === '/shop' ? 1 : 0);
const render = (d: WebsiteData, t: 'luxe' | 'prime' | 'euphoria' = 'luxe') => renderSiteBundle({ ...d, template: t }, BASE);
const total = (d: WebsiteData, t: 'luxe' | 'prime' | 'euphoria' = 'luxe') => render(d, t).pages.length + proxied(d);
const strip = (h: string): string => h.replace(/published-at" content="\d+"/, '');
const SERVICES = [0, 1, 2, 3, 5, 12];
const COMBOS: Opt[] = [];
for (const hours of [true, false]) for (const phone of [true, false]) for (const addr of [true, false]) for (const city of [true, false]) COMBOS.push({ hours, phone, addr, city });
const label = (o: Opt) => `h${+o.hours} p${+o.phone} a${+o.addr} c${+o.city}`;
/** The one case below 21: nothing but Home (no service, hours, phone, e-mail, address or booking link). It has no file page, so the guide gate stays closed. */
const homeOnly = (n: number, o: Opt) => n === 0 && !o.hours && !o.phone && !o.addr;

describe('every site with search pages on reaches 21 pages', () => {
  it('constants: cap = floor - 2, and the library holds the worst case (hub + 18 guides) plus a margin of 1 general guide (the beard-trim guide is not general: it needs a beard service)', () => {
    expect(PAGE_FLOOR).toBe(21);
    expect(GUIDE_ADDED_CAP).toBe(19);
    const general = GUIDE_PAGE_IDS.filter((id) => !GUIDE_LIBRARY[id].when);
    expect(general.length).toBeGreaterThanOrEqual(GUIDE_ADDED_CAP - 1 + 1);
  });
  for (const kind of ['web', 'ios-marked'] as const) for (const n of SERVICES) for (const o of COMBOS) {
    it(`${kind}, ${n} services, ${label(o)}: ${homeOnly(n, o) ? '1 page (Home only, out of scope)' : 'at least 21 pages, exactly 21 here'}`, () => {
      const d = site(n, o, kind);
      const t = total(d);
      if (homeOnly(n, o)) { expect(countPages(d)).toBe(1); expect(t).toBe(1); return; }
      expect(t).toBeGreaterThanOrEqual(21);
      expect(t).toBe(21);
    });
  }
  it('the worst case that can pass the gate (Home and Contact only) has 2 real pages and needs hub + 18 guides, with 1 eligible guide to spare (no beard service, so no beard-trim guide)', () => {
    const d = site(0, { hours: false, phone: true, addr: false, city: false }, 'web');
    expect(countPages(d)).toBe(2);
    const plan = planGuides(d, buildPageSet(d))!;
    expect(plan.added).toBe(19);
    expect(plan.shown).toHaveLength(18);
    expect(GUIDE_PAGE_IDS.filter((id) => !GUIDE_LIBRARY[id].when).length - plan.shown.length).toBeGreaterThanOrEqual(1);
    expect(plan.shown).not.toContain('beard-trim-prep');
  });
  it('all three designs reach 21 in the worst cases', () => {
    for (const t of ['luxe', 'prime', 'euphoria'] as const) for (const n of [0, 1, 2]) for (const o of [FULL, { ...FULL, hours: false, addr: false, phone: false, city: false }, { hours: false, phone: true, addr: false, city: false }]) {
      const d = site(n, o, 'ios-marked');
      if (homeOnly(n, o)) continue;
      expect(total(d, t), `${t} ${n} ${label(o)}`).toBe(21);
    }
  });
  it('a site with 21 or more real pages gets no guide at all, and one that needs a single page gets the hub and one guide (22, as before)', () => {
    const big = site(12, FULL, 'web', { bookingUrl: '/book', shopUrl: '/shop', about: { heading: 'About', description: ['We cut hair on this corner.'], imageUrl: '' } });
    expect(countPages(big)).toBe(21);
    expect(render(big).pages.filter((p) => p.path.startsWith('guides/'))).toEqual([]);
    const need1 = { ...big, about: { heading: 'About', description: [], imageUrl: '' } } as WebsiteData;
    expect(countPages(need1)).toBe(20);
    expect(render(need1).pages.filter((p) => p.path.startsWith('guides/'))).toHaveLength(2);
  });
  it('an unmarked iOS site is still not given guides at all (the gate is unchanged)', () => {
    for (const n of SERVICES) expect(render(site(n, FULL, 'ios-unmarked')).pages.some((p) => p.path.startsWith('guides/'))).toBe(false);
  });
});

describe('the guide pages of one site never repeat', () => {
  const sites: [string, WebsiteData][] = [
    ['0 services, contact only', site(0, { hours: false, phone: true, addr: false, city: false }, 'web')],
    ['0 services, full data', site(0, FULL, 'ios-marked')],
    ['2 services, no city', site(2, { ...FULL, city: false }, 'web')],
    ['12 services', site(12, FULL, 'ios-marked')],
  ];
  for (const seed of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) for (const [name, d] of sites) {
    it(`${name}, seed ${seed}: no two guide pages share a title, a slug or a first paragraph (and each is a real page)`, () => {
      const pages = render({ ...d, extraPages: { ...d.extraPages!, seed } } as WebsiteData).pages.filter((p) => p.path.startsWith('guides/') && p.path !== 'guides/index.html');
      expect(pages.length).toBeGreaterThan(0);
      const titles = pages.map((p) => /<h1 class="ab-h1">([\s\S]*?)<\/h1>/.exec(p.html)![1]);
      const firsts = pages.map((p) => /<div class="ab-copy ab-prose"><p>([\s\S]*?)<\/p>/.exec(p.html)![1]);
      expect(new Set(titles).size).toBe(pages.length);
      expect(new Set(pages.map((p) => p.path)).size).toBe(pages.length);
      expect(new Set(firsts).size).toBe(pages.length);
      for (const f of firsts) expect(f.length).toBeGreaterThan(20);
    });
  }
  it('in the whole library no two guides share a title, a blurb or an intro wording (so no pick can make two pages open the same way)', () => {
    const ids = [...GUIDE_PAGE_IDS];
    expect(new Set(ids.map((i) => GUIDE_LIBRARY[i].title)).size).toBe(ids.length);
    expect(new Set(ids.map((i) => GUIDE_LIBRARY[i].blurb)).size).toBe(ids.length);
    const firsts = ids.flatMap((i) => GUIDE_LIBRARY[i].blocks[0].variants.map((v) => v.join(' ')));
    expect(new Set(firsts).size).toBe(firsts.length);
    const lead = ids.flatMap((i) => GUIDE_LIBRARY[i].blocks[0].variants.map((v) => v[0]));
    expect(new Set(lead).size).toBe(lead.length);
  });
});

describe('the new topics', () => {
  const NEW = GUIDE_PAGE_IDS.slice(17);
  it('are the six appended ids (the beard-trim one only where a beard service exists, the rest offered to every barber site), with no token and no place', () => {
    expect([...NEW]).toEqual(['beard-trim-prep', 'event-haircut', 'wavy-and-curly', 'long-hair-shape', 'after-a-long-break', 'active-routine']);
    for (const id of NEW) {
      const g = GUIDE_LIBRARY[id];
      expect(g.when, id).toBe(id === 'beard-trim-prep' ? 'beard-service' : undefined);
      const all = [g.title, g.blurb, ...g.blocks.flatMap((b) => [b.h ?? '', ...b.variants.flat()])].join(' ');
      expect(all, id).not.toMatch(/[{}\d]|[!]|[–—]/);
      expect(all, id).not.toMatch(/\b(?:city|town|near|nearby|parking|walk-?ins?|pay|cash|card|price|hours|open|award|years?|best|brand|product)\b/i);
    }
  });
  for (const t of ['luxe', 'prime', 'euphoria'] as const) for (const city of [true, false]) for (const v of [0, 1, 2]) {
    it(`${t}, ${city ? 'with' : 'without'} a city, wording ${v}: every sentence passes the lint and prints in full (nothing is dropped at render time)`, () => {
      const pick: Record<string, number> = {};
      for (const id of NEW) for (const b of ['intro', 'points', 'tip']) pick[`guides.${id}.${b}`] = v;
      // The stored selection puts the six new ids first, so all six are in the plan (the stored selection names the beard-trim guide, so it is honoured without a beard service).
      const d = site(0, { hours: false, phone: true, addr: false, city }, 'web', { extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 3, pick, guidesSel: [...NEW] } as WebsiteData['extraPages'] });
      const out = render(d, t);
      const names = new Set(planGuides(d, buildPageSet(d))!.shown);
      for (const id of NEW) {
        expect(names.has(id), id).toBe(true);
        const g = GUIDE_LIBRARY[id];
        const view = resolveGuide(d, id);
        expect(view.intro.join(' ')).toBe(g.blocks[0].variants[v].join(' '));
        expect(view.points).toEqual(g.blocks[1].variants[v]);
        expect(view.tip.join(' ')).toBe(g.blocks[2].variants[v].join(' '));
        for (const s of [...view.intro, ...view.points, ...view.tip]) { expect(guideSentenceProblems(s, g.allow), s).toEqual([]); expect(copyProblems(s, { allow: g.allow }), s).toEqual([]); }
        const page = out.pages.find((p) => p.path === `guides/${id}/index.html`)!;
        expect(page.html).toContain('<meta name="robots" content="noindex,follow">');
        for (const s of view.points) expect(page.html).toContain(s.replace(/'/g, '&#39;'));
        expect(out.sitemap ?? '').not.toContain(`/guides/${id}/`);
      }
    });
  }
  it('a page reads the same with and without a city (the library has no place token)', () => {
    const a = render(site(0, { hours: false, phone: true, addr: false, city: true }, 'web')).pages.filter((p) => p.path.startsWith('guides/'));
    const b = render(site(0, { hours: false, phone: true, addr: false, city: false }, 'web')).pages.filter((p) => p.path.startsWith('guides/'));
    expect(a.map((p) => p.path)).toEqual(b.map((p) => p.path));
    const body = (h: string) => /<section class="ab-sec">([\s\S]*?)<\/section>/.exec(h)![1];
    a.forEach((p, i) => { expect(body(p.html)).toBe(body(b[i].html)); expect(body(p.html).includes('Brooklyn')).toBe(false); });
  });
  it('no guide is indexable: every guide page and the hub carry noindex, and none is in the sitemap or the JSON-LD', () => {
    const out = render(site(0, { hours: false, phone: true, addr: false, city: true }, 'ios-marked'));
    const guides = out.pages.filter((p) => p.path.startsWith('guides/'));
    expect(guides).toHaveLength(19);
    for (const p of guides) { expect(p.html).toContain('noindex'); expect(p.html).not.toContain('application/ld+json'); }
    expect(out.sitemap ?? '').not.toContain('/guides/');
  });
});

describe('web-made sites that were below 21 gain pages; the ones already at 21 do not change', () => {
  const haveBaseline = mainBaselineAvailable();
  // [services, profile] -> pages BEFORE (origin/main 82ab412c, measured with that renderer) and AFTER (21). Profiles: full = hours + phone + address + city;
  // contact = phone only; bare = hours only (no phone, no address); none = nothing but a phone-less, address-less, hours-less shop (Home only).
  const BEFORE: Record<string, number[]> = {
    'full (hours, phone, address)': [17, 19, 20, 21, 21, 21],
    'phone only, no hours or address': [14, 16, 17, 18, 20, 21],
    'hours only, no phone or address': [14, 16, 17, 18, 20, 21],
    'address only': [15, 17, 18, 19, 21, 21],
  };
  const PROFILE: Record<string, Opt> = {
    'full (hours, phone, address)': FULL,
    'phone only, no hours or address': { hours: false, phone: true, addr: false, city: false },
    'hours only, no phone or address': { hours: true, phone: false, addr: false, city: true },
    'address only': { hours: false, phone: false, addr: true, city: false },
  };
  for (const [name, before] of Object.entries(BEFORE)) {
    it(`pinned counts for 0/1/2/3/5/12 services, ${name}: after = 21 everywhere`, () => {
      expect(SERVICES.map((n) => total(site(n, PROFILE[name], 'web')))).toEqual([21, 21, 21, 21, 21, 21]);
      expect(before.every((x) => x <= 21)).toBe(true);
    });
    it.skipIf(!haveBaseline)(`${name}: the baseline renderer really gave ${before.join(' ')} before`, async () => {
      const base = await loadMainBaseline();
      expect(SERVICES.map((n) => { const d = site(n, PROFILE[name], 'web'); return base.renderSiteBundle(d, BASE).pages.length + proxied(d); })).toEqual(before);
    });
  }
  it.skipIf(!haveBaseline)('a site that reached 21 on origin/main renders byte for byte as it did (all designs), for the marked iOS and web-made shapes alike', async () => {
    const base = await loadMainBaseline();
    let same = 0;
    for (const kind of ['web', 'ios-marked'] as const) for (const n of SERVICES) for (const o of COMBOS) for (const t of ['luxe', 'prime', 'euphoria'] as const) {
      const d = site(n, o, kind);
      const old = base.renderSiteBundle({ ...d, template: t }, BASE);
      if (old.pages.length + proxied(d) < 21) continue;
      const now = render(d, t);
      expect(now.pages.map((p) => [p.path, strip(p.html)]), `${kind} ${n} ${label(o)} ${t}`).toEqual(old.pages.map((p) => [p.path, strip(p.html)]));
      expect(now.sitemap ?? null).toBe(old.sitemap ?? null);
      expect(now.robots ?? null).toBe(old.robots ?? null);
      same++;
    }
    expect(same).toBeGreaterThan(50);
  });
  it.skipIf(!haveBaseline)('a site that was below 21 keeps every non-guide file byte for byte, its first guides are the same ones, and only guide files are added', async () => {
    const base = await loadMainBaseline();
    for (const n of [0, 1, 2, 3, 5]) for (const o of COMBOS) {
      const d = site(n, o, 'web');
      const old = base.renderSiteBundle(d, BASE);
      if (old.pages.length + proxied(d) >= 21 || homeOnly(n, o)) continue;
      const now = render(d);
      const nonGuide = (b: { pages: { path: string; html: string }[] }) => b.pages.filter((p) => !p.path.startsWith('guides/')).map((p) => [p.path, strip(p.html)]);
      expect(nonGuide(now), `${n} ${label(o)}`).toEqual(nonGuide(old));
      const oldIds = old.pages.filter((p) => p.path.startsWith('guides/') && p.path !== 'guides/index.html').map((p) => p.path);
      const nowIds = now.pages.filter((p) => p.path.startsWith('guides/') && p.path !== 'guides/index.html').map((p) => p.path);
      expect(nowIds.slice(0, oldIds.length)).toEqual(oldIds);
      for (const p of oldIds) expect(strip(now.pages.find((x) => x.path === p)!.html).includes('noindex')).toBe(true);
      expect(nowIds.length).toBeGreaterThanOrEqual(oldIds.length);
    }
  });
  it.skipIf(!haveBaseline)('the stored fixture sites: the web-made sparse one (19 before) gains guides, every other web and iOS fixture site is unchanged in count', async () => {
    const base = await loadMainBaseline();
    const web = (s: any) => ({ ...JSON.parse(JSON.stringify(s)), source: 'web-app' });
    const rows = { 'web-sparse': web(IOS_SITES.sparse), 'web-rich': web(IOS_SITES.rich), 'web-guides': web(IOS_SITES.guidesOnNoText) };
    const counts = Object.fromEntries(Object.entries(rows).map(([k, s]) => [k, [base.renderSiteBundle(s, BASE).pages.length, renderSiteBundle(s, BASE).pages.length]]));
    expect(counts['web-sparse'][0]).toBe(19);
    expect(counts['web-sparse'][1]).toBe(21);
    expect(counts['web-rich'][1]).toBe(counts['web-rich'][0]);
    expect(counts['web-guides'][1]).toBe(counts['web-guides'][0]);
  });
});

describe('saved guide settings keep working', () => {
  const zero = (extra: Record<string, unknown> = {}) => site(0, { hours: false, phone: true, addr: false, city: false }, 'web', { extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7, ...extra } as WebsiteData['extraPages'] });
  it('the first 17 ids are exactly the published ones in the published order; new ids only follow them', () => {
    const published = createHash('sha1').update(JSON.stringify(GUIDE_PAGE_IDS.slice(0, 17))).digest('hex');
    expect(published).toBe(createHash('sha1').update(JSON.stringify(['ask-for-the-cut', 'hairstyle-ideas', 'fade-and-taper', 'barber-matters', 'gap-between-haircuts', 'prepare-your-visit', 'child-first-haircut', 'face-shape', 'hair-types', 'hair-care-basics', 'beard-care-basics', 'shave-guide', 'barber-words', 'choosing-a-length', 'styling-basics', 'between-visits', 'new-barber'])).digest('hex'));
  });
  it('a site that needed 11 guides or fewer before gets the same guides in the same order (the new ids come last)', () => {
    const d = site(3, FULL, 'web');
    const plan = planGuides(d, buildPageSet(d))!;
    expect(plan.shown).toEqual(GUIDE_PAGE_IDS.filter((id) => plan.shown.includes(id)));
    expect(plan.shown.every((id) => GUIDE_PAGE_IDS.indexOf(id) < 17)).toBe(true);
  });
  it('a stored selection stays first, in its order; new guides follow and never push a chosen guide out', () => {
    const sel = ['new-barber', 'face-shape', 'between-visits'];
    const d = zero({ guidesSel: sel });
    const plan = planGuides(d, buildPageSet(d))!;
    expect(plan.slots.slice(0, 3)).toEqual(sel);
    expect(plan.slots).toHaveLength(18);
    expect(new Set(plan.slots).size).toBe(18);
  });
  it('hidden guides stay hidden and keep their slot (they are NOT replaced by the new ones): hiding k guides leaves 21 - k pages', () => {
    const hid = ['ask-for-the-cut', 'face-shape', 'hair-types'];
    const d = zero({ guidesHidden: hid });
    const plan = planGuides(d, buildPageSet(d))!;
    expect(plan.slots).toHaveLength(18);
    expect(plan.shown).toHaveLength(15);
    expect(plan.shown.some((id) => hid.includes(id))).toBe(false);
    expect(total(d)).toBe(21 - hid.length);
    // hiding the NEW ids, or every id, behaves the same way
    const hidNew = zero({ guidesHidden: [...GUIDE_PAGE_IDS.slice(17)] });
    expect(planGuides(hidNew, buildPageSet(hidNew))!.shown.some((id) => GUIDE_PAGE_IDS.slice(17).includes(id))).toBe(false);
    const hidAll = zero({ guidesHidden: [...GUIDE_PAGE_IDS] });
    expect(planGuides(hidAll, buildPageSet(hidAll))).toBeNull();
    expect(total(hidAll)).toBe(2);
  });
  it('guidesOff still switches the feature off, and an unknown stored id is ignored', () => {
    expect(planGuides(zero({ guidesOff: true }), buildPageSet(zero({ guidesOff: true })))).toBeNull();
    const junk = guideSettings({ extraPages: { on: [], guidesSel: ['nope', 'active-routine', 'event-haircut'], guidesHidden: ['x'] } } as unknown as WebsiteData);
    expect(junk.sel).toEqual(['active-routine', 'event-haircut']);
    expect([...junk.hidden]).toEqual([]);
  });
  it('resolveGuide still returns a full view for every id, old and new', () => {
    for (const id of GUIDE_PAGE_IDS) { const v = resolveGuide({ extraPages: { on: [], seed: 5 } } as WebsiteData, id); expect(v.id).toBe(id); expect(v.title).toBe(GUIDE_LIBRARY[id].title); expect(v.intro.length).toBeGreaterThan(0); expect(v.points.length).toBeGreaterThan(0); expect(v.tip.length).toBeGreaterThan(0); }
  });
  it('the owner can still edit the words of a new guide (the copy key budget covers every guide)', () => {
    const d = zero({});
    const copy: Record<string, string> = {};
    for (const id of GUIDE_PAGE_IDS) copy[`guides.${id}.title`] = `Own title ${id.replace(/-/g, ' ')}`;
    const v = resolveGuide({ ...d, copy } as WebsiteData, 'active-routine');
    expect(v.title).toBe('Own title active routine');
  });
});

describe('hidden guides stay hidden after the library grew', () => {
  const zero = (extra: Record<string, unknown> = {}, n = 0) => site(n, n === 0 ? { hours: false, phone: true, addr: false, city: false } : FULL, 'web', { extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7, ...extra } as WebsiteData['extraPages'] });
  const OLD = GUIDE_PAGE_IDS.slice(0, 17);
  // What an owner was offered before 2026-11-16: the first 11 eligible of the first 17 ids (a site with no fade, kids or shave service: 14 are eligible).
  const offeredBefore = (d: WebsiteData): string[] => {
    const set = buildPageSet(d);
    return OLD.filter((id) => guideEligible(d, id, undefined, set)).slice(0, 11);
  };
  it('an owner who hid every guide that was offered before gets no guide pages and no hub', () => {
    const base = zero();
    const hid = offeredBefore(base);
    expect(hid).toHaveLength(11);
    const d = zero({ guidesHidden: hid });
    expect(planGuides(d, buildPageSet(d))).toBeNull();
    expect(render(d).pages.some((p) => p.path.startsWith('guides/'))).toBe(false);
    expect(total(d)).toBe(countPages(d));
  });
  it('the same holds when the owner hid all 17 old ids, and for a site that needs fewer pages', () => {
    const d = zero({ guidesHidden: [...OLD] });
    expect(planGuides(d, buildPageSet(d))).toBeNull();
    const d3 = zero({}, 3);
    const hid = offeredBefore(d3);
    expect(hid.length).toBeGreaterThan(0);
    const h3 = zero({ guidesHidden: hid }, 3);
    expect(planGuides(h3, buildPageSet(h3))).toBeNull();
    expect(total(h3)).toBe(countPages(h3));
  });
  it('an owner who hid only some of them keeps today\'s behaviour: the slots are filled to 21 and the hidden ones stay out', () => {
    const base = zero();
    const hid = offeredBefore(base).slice(0, 10);
    const d = zero({ guidesHidden: hid });
    const plan = planGuides(d, buildPageSet(d))!;
    expect(plan).not.toBeNull();
    expect(plan.slots).toHaveLength(18);
    expect(plan.shown).toHaveLength(18 - 10);
    expect(plan.shown.some((id) => hid.includes(id))).toBe(false);
    expect(total(d)).toBe(21 - 10);
  });
  it('hiding only the new guides, or nothing, is not "hid everything"; a site without saved settings is filled to 21', () => {
    const hidNew = zero({ guidesHidden: [...GUIDE_PAGE_IDS.slice(17)] });
    expect(planGuides(hidNew, buildPageSet(hidNew))).not.toBeNull();
    expect(total(zero({ guidesHidden: [] }))).toBe(21);
    expect(total(zero())).toBe(21);
    const noExtra = site(0, { hours: false, phone: true, addr: false, city: false }, 'web', { extraPages: { on: [], seed: 7 } as WebsiteData['extraPages'] });
    expect(total(noExtra)).toBe(21);
  });
});

describe('the beard-trim guide only where a beard service exists', () => {
  const only = (titles: string[], extra: Record<string, unknown> = {}): WebsiteData => site(0, { hours: false, phone: true, addr: false, city: false }, 'web', { services: titles.map(svc), extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7, ...extra } as WebsiteData['extraPages'] });
  it('hasBeardService matches beard, shave, razor, goatee, moustache and mustache in a service name, in any case', () => {
    for (const t of ['Beard Trim', 'HOT TOWEL SHAVE', 'Straight Razor', 'Goatee shape', 'Moustache trim', 'Mustache Trim', 'Haircut and Beard', 'Head shaving']) expect(hasBeardService({ services: [svc(t)] } as WebsiteData), t).toBe(true);
    for (const t of ['Haircut', 'Skin Fade', 'Kids Haircut', 'Line Up', 'Buzz Cut', 'Designs']) expect(hasBeardService({ services: [svc(t)] } as WebsiteData), t).toBe(false);
    expect(hasBeardService({ services: [] } as unknown as WebsiteData)).toBe(false);
  });
  it('a site with no beard service is never given the guide, and still reaches 21 pages', () => {
    for (const titles of [[], ['Haircut'], ['Haircut', 'Skin Fade']]) {
      const d = only(titles);
      const plan = planGuides(d, buildPageSet(d))!;
      expect(plan.shown, titles.join()).not.toContain('beard-trim-prep');
      expect(total(d), titles.join()).toBe(21);
    }
    const worst = only([]);
    expect(planGuides(worst, buildPageSet(worst))!.shown).toHaveLength(18);
  });
  it('a site with a beard service gets it, still at 21 pages', () => {
    const d = only(['Haircut', 'Beard Trim']);
    const plan = planGuides(d, buildPageSet(d))!;
    expect(plan.slots).toContain('beard-trim-prep');
    expect(total(d)).toBe(21);
    expect(render(d).pages.some((p) => p.path === 'guides/beard-trim-prep/index.html')).toBe(true);
  });
  it('a guide the owner chose in the saved selection is honoured even without a beard service', () => {
    const d = only(['Haircut'], { guidesSel: ['beard-trim-prep'] });
    const plan = planGuides(d, buildPageSet(d))!;
    expect(plan.slots[0]).toBe('beard-trim-prep');
    expect(total(d)).toBe(21);
  });
});
