// Phase 1 step 4: the renderer uses a valid owner title / description (seo.* copy keys) and otherwise the generated default;
// defaults are unique per page; a site that does not qualify (iOS-made, single page, pages v1) is byte-identical with or without the keys.
import { describe, expect, it } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import { renderPendingBundle } from '../../lib/publishSite';
import { toPendingSiteData } from '../../lib/ios/pendingData';
import { restoreImageUrls } from '../../lib/ios/siteShape';
import { seoDuplicates, seoKey, seoSvcKey } from '../../lib/render/seoText';
import { IOS_SITES } from './helpers/iosSites';
import type { WebsiteData } from '../../types';

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });
const LONG = 'A close fade with a straight razor finish around the ears and the neckline, booked as one visit.';
const shop = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' },
  about: { heading: 'About', description: ['We cut hair.'], imageUrl: '' },
  services: [svc('Skin Fade', { description: LONG, price: '$35' }), svc('Beard Trim', { description: LONG }), svc('Kids Cut')],
  gallery: [], hours: [{ day: 'Mon', open: '09:00', close: '17:00' }],
  contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  pages: { order: [], hidden: [] },
  extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7 },
  source: 'web-app',
  ...extra,
});
const BASE = { siteBaseUrl: 'https://fresh.example.com' };
const TEMPLATES = ['luxe', 'prime', 'euphoria'] as const;
const bundle = (d: WebsiteData, t: (typeof TEMPLATES)[number] = 'luxe') => renderSiteBundle({ ...d, template: t }, BASE);
const file = (b: ReturnType<typeof bundle>, path: string) => b.pages.find((p) => p.path === path)?.html ?? '';
const strip = (h: string) => h.replace(/published-at" content="\d+"/, '');
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const heads = (h: string) => ({
  title: decode(/<title>([^<]*)<\/title>/.exec(h)?.[1] ?? '#none'),
  description: decode(/<meta name="description" content="([^"]*)"/.exec(h)?.[1] ?? '#none'),
  ogTitle: /<meta property="og:title" content="([^"]*)"/.exec(h)?.[1] === undefined ? '#none' : decode(/<meta property="og:title" content="([^"]*)"/.exec(h)![1]),
  ogDescription: /<meta property="og:description" content="([^"]*)"/.exec(h)?.[1] === undefined ? '#none' : decode(/<meta property="og:description" content="([^"]*)"/.exec(h)![1]),
});
const withCopy = (copy: Record<string, string>, extra: Partial<WebsiteData> = {}) => shop({ copy, ...extra });

describe('a valid override replaces the generated title and description', () => {
  for (const t of TEMPLATES) {
    it(`${t}: Services page (title, description, og:title, og:description)`, () => {
      const d = withCopy({ [seoKey('services', 'title')]: 'Haircuts & Fades in Brooklyn', [seoKey('services', 'description')]: "See what we offer: fades, beard trims and kids' cuts." });
      const h = heads(file(bundle(d, t), 'services/index.html'));
      expect(h).toEqual({ title: 'Haircuts & Fades in Brooklyn', description: "See what we offer: fades, beard trims and kids' cuts.", ogTitle: 'Haircuts & Fades in Brooklyn', ogDescription: "See what we offer: fades, beard trims and kids' cuts." });
    });
    it(`${t}: Home page gets the override in title, description and og tags`, () => {
      const base = heads(file(bundle(shop(), t), 'index.html'));
      expect(base.ogTitle).toBe('#none'); // the design prints no og tags by default
      const d = withCopy({ [seoKey('home', 'title')]: 'Fresh Cuts | Brooklyn Barbershop', [seoKey('home', 'description')]: 'Walk-ins welcome. Fades and beard trims in Brooklyn.' });
      const h = heads(file(bundle(d, t), 'index.html'));
      expect(h).toEqual({ title: 'Fresh Cuts | Brooklyn Barbershop', description: 'Walk-ins welcome. Fades and beard trims in Brooklyn.', ogTitle: 'Fresh Cuts | Brooklyn Barbershop', ogDescription: 'Walk-ins welcome. Fades and beard trims in Brooklyn.' });
      expect((file(bundle(d, t), 'index.html').match(/<title>/g) ?? []).length).toBe(1);
    });
  }
  it('Home: only the title overridden keeps the default description; only the description keeps the default title', () => {
    const base = heads(file(bundle(shop()), 'index.html'));
    const a = heads(file(bundle(withCopy({ [seoKey('home', 'title')]: 'My Own Title' })), 'index.html'));
    expect(a.title).toBe('My Own Title'); expect(a.description).toBe(base.description); expect(a.ogDescription).toBe(base.description);
    const b = heads(file(bundle(withCopy({ [seoKey('home', 'description')]: 'My own description here.' })), 'index.html'));
    expect(b.title).toBe(base.title); expect(b.description).toBe('My own description here.'); expect(b.ogTitle).toBe(base.title);
  });
  it('a service page uses seo.svc.<titleKey>; the other service pages are unaffected', () => {
    const own = [svc('Skin Fade', { description: LONG }), svc('Beard Trim', { description: `${LONG} Trimmed and lined.` }), svc('Kids Cut')];
    const d = withCopy({ [seoSvcKey('Skin Fade', 'title')]: 'Skin Fade Brooklyn', [seoSvcKey('Skin Fade', 'description')]: 'A skin fade, booked online.' }, { services: own });
    const b = bundle(d);
    const fade = heads(file(b, 'services/skin-fade/index.html'));
    expect(fade.title).toBe('Skin Fade Brooklyn'); expect(fade.description).toBe('A skin fade, booked online.'); expect(fade.ogTitle).toBe('Skin Fade Brooklyn');
    const plain = bundle(shop({ services: own }));
    expect(heads(file(b, 'services/beard-trim/index.html'))).toEqual(heads(file(plain, 'services/beard-trim/index.html')));
  });
  it('the key is matched on the lower-case, single-spaced title; the first service with a title owns it', () => {
    const d = withCopy({ 'seo.svc.skin fade.title': 'The Skin Fade' }, { services: [svc('SKIN  Fade', { description: LONG }), svc('skin fade', { description: LONG })] });
    const b = bundle(d);
    const titles = b.seo.filter((e) => e.id.startsWith('services:')).map((e) => e.title);
    expect(titles.filter((t) => t === 'The Skin Fade')).toHaveLength(1);
    expect(b.seo.find((e) => e.id.startsWith('services:'))!.title).toBe('The Skin Fade');
  });
  it('a thin (noindex) page may carry an override; noindex, the sitemap and robots.txt are unchanged by overrides', () => {
    const thin = { services: [svc('Skin Fade', { description: LONG }), svc('Facial')] };
    const base = bundle(shop(thin));
    const d = withCopy({ [seoSvcKey('Facial', 'title')]: 'Facials Brooklyn', [seoKey('services', 'title')]: 'Services', [seoKey('home', 'title')]: 'Home title' }, thin);
    const b = bundle(d);
    expect(heads(file(b, 'services/facial/index.html')).title).toBe('Facials Brooklyn');
    expect(file(b, 'services/facial/index.html')).toContain('<meta name="robots" content="noindex,follow">');
    expect(b.sitemap).toBe(base.sitemap);
    expect(b.robots).toBe(base.robots);
    expect(b.pages.map((p) => p.path)).toEqual(base.pages.map((p) => p.path));
  });
  it('overrides are HTML-escaped on output (attribute and text positions)', () => {
    const d = withCopy({ [seoKey('services', 'title')]: `Kids' "Cuts" & Fades`, [seoKey('services', 'description')]: `Tom's "best" fades & beards.` });
    const html = file(bundle(d), 'services/index.html');
    expect(html).toContain('<title>Kids&#39; &quot;Cuts&quot; &amp; Fades</title>');
    expect(html).toContain('<meta name="description" content="Tom&#39;s &quot;best&quot; fades &amp; beards.">');
    expect(html).toContain('<meta property="og:title" content="Kids&#39; &quot;Cuts&quot; &amp; Fades">');
    expect(heads(html).title).toBe(`Kids' "Cuts" & Fades`);
    const home = file(bundle(withCopy({ [seoKey('home', 'title')]: `Tom's "A" & B` })), 'index.html');
    expect(home).toContain('<title>Tom&#39;s &quot;A&quot; &amp; B</title>');
    const homeD = file(bundle(withCopy({ [seoKey('home', 'description')]: `Tom's "A" & B cuts.` })), 'index.html');
    expect(homeD).toContain('<meta name="description" content="Tom&#39;s &quot;A&quot; &amp; B cuts.">');
    expect(homeD).toContain('<meta property="og:description" content="Tom&#39;s &quot;A&quot; &amp; B cuts.">');
  });
  it('a `$` in an override is kept literally (no replacement-pattern surprises)', () => {
    const home = file(bundle(withCopy({ [seoKey('home', 'title')]: "Cuts from $5 $& $1 $'" })), 'index.html');
    expect(heads(home).title).toBe("Cuts from $5 $& $1 $'");
  });
});

describe('an invalid override is ignored: the generated default is printed, never a repaired version', () => {
  const HOSTILE: Array<[string, string]> = [
    ['script', '<script>alert(1)</script>'], ['markup', 'Fades <b>by Sam</b>'], ['newline', 'Fresh\nCuts'], ['emoji', 'Fresh Cuts 💈'],
    ['RTL override', 'Fresh‮Cuts'], ['10k', 'x'.repeat(10_000)], ['punctuation', '!!! ??? ---'], ['shouting', 'BEST BARBER IN TOWN'], ['161 chars', 'x'.repeat(161)], ['entity', 'Fades &amp; Sam'],
    ['Hangul filler', 'ㅤㅤ'], ['halfwidth filler', 'ﾠﾠ'], ['zero width', '\u200B\u200B\u200B'], ['braille blank', 'ab⠀⠀⠀'], ['keycap', 'Call 1️⃣ now'],
    ['variation selector', 'Fade\uFE0F cuts'], ['tag chars', 'Fade\u{E0041}\u{E0042} cuts'], ['zalgo', 'Ab' + '\u0300\u0301\u0302\u0303'.repeat(10)],
  ];
  for (const [name, bad] of HOSTILE) {
    it(`${name}: services page, service page and home keep their defaults`, () => {
      const plain = bundle(shop());
      const d = withCopy({
        [seoKey('services', 'title')]: bad, [seoKey('services', 'description')]: bad,
        [seoSvcKey('Skin Fade', 'title')]: bad, [seoSvcKey('Skin Fade', 'description')]: bad,
        [seoKey('home', 'title')]: bad, [seoKey('home', 'description')]: bad,
      });
      const b = bundle(d);
      for (const p of ['index.html', 'services/index.html', 'services/skin-fade/index.html']) {
        expect(heads(file(b, p)), p).toEqual(heads(file(plain, p)));
        expect(strip(file(b, p)), p).toBe(strip(file(plain, p)));
      }
      expect(b.pages.map((x) => x.html).join('')).not.toContain('<script>alert');
    });
  }
  it('a valid title with an invalid description uses the title and the default description', () => {
    const plain = heads(file(bundle(shop()), 'services/index.html'));
    const h = heads(file(bundle(withCopy({ [seoKey('services', 'title')]: 'Our Services', [seoKey('services', 'description')]: '<i>x</i>' })), 'services/index.html'));
    expect(h.title).toBe('Our Services'); expect(h.description).toBe(plain.description);
  });
  it('a non-string value, an unknown key and a prototype-ish key are ignored', () => {
    const plain = bundle(shop());
    const d = withCopy({ [seoKey('services', 'title')]: 5 as never, 'seo.nope.title': 'Nope', 'seo.__proto__.title': 'Nope', 'seo.svc..title': 'Nope' });
    const b = bundle(d);
    expect(b.pages.map((p) => strip(p.html))).toEqual(plain.pages.map((p) => strip(p.html)));
  });
});

describe('sites that do not qualify are byte-identical with or without the keys', () => {
  const KEYS = { [seoKey('home', 'title')]: 'Hello title', [seoKey('home', 'description')]: 'Hello description here.', [seoKey('services', 'title')]: 'Svc title', [seoSvcKey('Skin Fade', 'title')]: 'Fade title', [seoKey('faq', 'description')]: 'Faq description here.' };
  const same = (a: WebsiteData, label: string) => {
    for (const t of TEMPLATES) for (const opts of [{}, BASE]) {
      const x = renderSiteBundle({ ...a, template: t }, opts);
      const y = renderSiteBundle({ ...a, template: t, copy: { ...(a.copy ?? {}), ...KEYS } }, opts);
      expect(y.pages.map((p) => [p.path, strip(p.html)]), `${label} ${t}`).toEqual(x.pages.map((p) => [p.path, strip(p.html)]));
      expect(y.sitemap).toBe(x.sitemap); expect(y.robots).toBe(x.robots);
    }
  };
  it('iOS-made sites (pages v2, no source: web-app)', () => { for (const [name, s] of Object.entries(IOS_SITES)) same(s, name); });
  it('a web-created site with no extraPages (pages v1), multi-page', () => { same(shop({ extraPages: undefined, pages: { order: [], hidden: [] } }), 'v1'); });
  it('a web-created single-page site', () => {
    const d = shop({ pages: { order: [], hidden: ['about', 'services', 'team', 'gallery', 'reviews', 'hours', 'location', 'contact', 'book', 'shop', 'faq', 'first-visit', 'hair-care', 'beard-care'] as never } });
    same(d, 'single');
  });
  it('a qualifying site with no seo keys renders its home exactly as the design wrote it (no og tags added)', () => {
    const h = file(bundle(shop()), 'index.html');
    expect(h).not.toContain('property="og:title"');
  });
  it('the bundle reports no seo entries for a site that does not qualify', () => {
    expect(renderSiteBundle({ ...IOS_SITES.rich }, BASE).seo).toEqual([]);
  });
});

describe('generated defaults are unique per page', () => {
  const dupes = (d: WebsiteData, t: (typeof TEMPLATES)[number]) => seoDuplicates(bundle(d, t).seo);
  const cases: Array<[string, WebsiteData]> = [
    ['plain shop', shop()],
    ['two services with one title', shop({ services: [svc('Fade', { description: LONG }), svc('Fade', { description: LONG }), svc('Fade', { description: LONG })] })],
    ['two barbers with one name', shop({ staff: [{ name: 'Sam', role: 'Barber', bio: '', photo: '' }, { name: 'Sam', role: 'Barber', bio: '', photo: '' }] as never })],
    ['no place', shop({ area: '', contact: { address: '', email: '' } })],
  ];
  for (const t of TEMPLATES) for (const [name, d] of cases) {
    it(`${t}: ${name}: no two pages share a title or a description`, () => {
      expect(dupes(d, t)).toEqual({ titles: [], descriptions: [] });
    });
  }
  it('a colliding default description gets its page name in front; a still-colliding one gets (2)', () => {
    const b = bundle(shop());
    expect(b.seo.find((e) => e.id === 'services:kids-cut')!.description).toMatch(/^Kids Cut: /);
    const twin = bundle(shop({ services: [svc('Fade', { description: LONG }), svc('Fade', { description: LONG })] }));
    const fades = twin.seo.filter((e) => e.id.startsWith('services:'));
    expect(fades.map((e) => e.title)).toEqual(['Fade in Brooklyn, NY · Fresh Cuts', 'Fade in Brooklyn, NY · Fresh Cuts (2)']);
    expect(fades.map((e) => e.description)).toEqual([LONG, `Fade: ${LONG}`]);
    const triple = bundle(shop({ services: [svc('Fade', { description: LONG }), svc('Fade', { description: LONG }), svc('Fade', { description: LONG })] })).seo.filter((e) => e.id.startsWith('services:'));
    expect(triple[2].description).toBe(`${LONG} (2)`);
  });
  it('the page count and paths are unchanged by the uniqueness rule', () => {
    const b = bundle(shop());
    expect(b.seo.length).toBe(b.pages.length);
  });
  it('two owner overrides that match are reported (and printed as written)', () => {
    const d = withCopy({ [seoKey('services', 'title')]: 'Fresh Cuts Barber', [seoKey('faq', 'title')]: 'fresh  cuts barber' });
    const b = bundle(d);
    expect(seoDuplicates(b.seo).titles).toEqual([['services', 'faq']]);
    expect(heads(file(b, 'faq/index.html')).title).toBe('fresh cuts barber');
    expect(heads(file(b, 'services/index.html')).title).toBe('Fresh Cuts Barber');
  });
  it('an override equal to another page default is reported, the default is moved aside', () => {
    const base = bundle(shop());
    const faq = base.seo.find((e) => e.id === 'faq')!;
    const d = withCopy({ [seoKey('services', 'title')]: faq.title });
    const b = bundle(d);
    expect(heads(file(b, 'services/index.html')).title).toBe(faq.title);
    expect(b.seo.find((e) => e.id === 'faq')!.title).not.toBe(faq.title); // the later default gets "(2)" instead of colliding
    expect(seoDuplicates(b.seo).titles).toEqual([]);
  });
});

describe('old drafts, old apps and regenerate keep the keys', () => {
  const KEYS = { [seoKey('home', 'title')]: 'Kept title', [seoSvcKey('Skin Fade', 'description')]: 'Kept description for the fade page.' };
  it('a draft with no seo keys renders; adding keys later changes only the targeted heads', () => {
    const old = shop();
    const next = { ...old, copy: KEYS };
    const a = bundle(old); const b = bundle(next);
    expect(heads(file(b, 'index.html')).title).toBe('Kept title');
    expect(heads(file(b, 'services/skin-fade/index.html')).description).toBe('Kept description for the fade page.');
    expect(strip(file(a, 'about/index.html'))).toBe(strip(file(b, 'about/index.html')));
  });
  it('the pending shape (toPendingSiteData, restoreImageUrls, JSON) keeps copy.seo keys', () => {
    const d = withCopy({ ...KEYS, 'faq.book': 'Our own FAQ sentence about booking.' });
    const pending = toPendingSiteData(d, {});
    expect(pending.copy).toEqual(d.copy);
    expect(restoreImageUrls(pending, {}).copy).toEqual(d.copy);
    expect(JSON.parse(JSON.stringify(restoreImageUrls(pending, {}))).copy).toEqual(d.copy);
    const out = renderPendingBundle({ siteData: pending, imageUrlMap: {} }, BASE);
    expect(heads(out.pages.find((p) => p.path === 'index.html')!.html).title).toBe('Kept title');
  });
  it('an older app re-saves a draft with unknown fields, keeping copy untouched: the keys survive', () => {
    const d = withCopy(KEYS);
    const resaved = { ...JSON.parse(JSON.stringify(d)), someFutureField: 1, source: 'web-app' } as WebsiteData;
    expect(resaved.copy).toEqual(KEYS);
    expect(heads(file(bundle(resaved), 'index.html')).title).toBe('Kept title');
  });
  it('regenerate (client keptPageChoices keeps `copy` whole) leaves the override in force over a fresh site', () => {
    const before = withCopy(KEYS);
    const regenerated = shop({ shopName: 'Fresh Cuts', area: 'Queens, NY', services: before.services });
    const after = { ...regenerated, ...(before.copy ? { copy: before.copy } : {}) };
    expect(heads(file(bundle(after), 'index.html')).title).toBe('Kept title');
    expect(heads(file(bundle(after), 'services/skin-fade/index.html')).description).toBe('Kept description for the fade page.');
  });
  it('copy overrides for library blocks and seo keys do not use each other\'s budget', () => {
    const copy: Record<string, string> = { ...KEYS };
    for (let i = 0; i < 20; i++) copy[`svc.filler ${i}.visit`] = 'x'.repeat(50);
    expect(heads(file(bundle(withCopy(copy)), 'index.html')).title).toBe('Kept title');
  });
});

describe('editor markers never leak into the seo list', () => {
  it('bundle.seo and the duplicate decision ignore U+2063 markers in a default', () => {
    const marked = bundle(shop({ shopName: 'Fresh⁣ Cuts' }));
    for (const e of marked.seo) { expect(e.title).not.toContain('⁣'); expect(e.description).not.toContain('⁣'); }
  });
});
