// Step 3: JSON-LD for web-created pages-v2 multi-page sites. LocalBusiness on Home/Location/Contact; Service + BreadcrumbList
// on each indexable service page; nothing that the page does not show (no ratings, reviews, FAQ, price ranges).
import { describe, expect, it } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import { businessTypeOf, cleanName, geoOf, jsonLdString, minutesOf, offerOf, openingHours, ownPhotoUrl, parseAddress } from '../../lib/render/jsonLd';
import { RICH_SITE } from './helpers/richSite';
import { IOS_SITES } from './helpers/iosSites';
import { DEMO_GALLERY_STOCK } from '../../lib/stockImages';
import type { WebsiteData } from '../../types';

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });
const LONG = 'A close fade with a straight razor finish around the ears and the neckline, booked as one visit.';
const BASE = { siteBaseUrl: 'https://fresh.example.com' };
const LD = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
const blocks = (html: string): string[] => [...html.matchAll(LD)].map((m) => m[1]);
const bundle = (d: WebsiteData, t: 'luxe' | 'prime' | 'euphoria' = 'luxe', opts: Record<string, unknown> = BASE) => renderSiteBundle({ ...d, template: t }, opts);
/** path -> parsed JSON-LD (pages without any are left out). */
function ldOf(b: ReturnType<typeof bundle>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const p of b.pages) { const bs = blocks(p.html); if (bs.length) { expect(bs, p.path).toHaveLength(1); out[p.path] = JSON.parse(bs[0]); } }
  return out;
}
const walk = (v: unknown, f: (k: string, val: unknown) => void): void => {
  if (Array.isArray(v)) v.forEach((x) => walk(x, f));
  else if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) { f(k, val); walk(val, f); }
};

// Fixture 1: a sparse shop, six services, one barber-less profile, no reviews.
const sparse = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Austin, TX', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe', niche: 'barber',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' },
  about: { heading: 'About', description: [], imageUrl: '' },
  services: [
    svc('Skin Fade', { price: '$35', description: LONG }), svc('Taper', { price: '30', description: LONG }), svc('Beard Trim', { price: '$15-$25', description: LONG }),
    svc('Kids Cut', { price: 'from $20', description: LONG }), svc('Line Up', { description: LONG }), svc('Facial'),
  ],
  gallery: [], hours: [{ day: 'Mon', open: '09:00', close: '17:00' }, { day: 'Sun', open: '', close: '', closed: true }],
  contact: { address: '12 Main St, Austin, TX 78701', email: '' },
  pages: { order: [], hidden: [] },
  extraPages: { on: ['faq'], serviceGuides: true, seed: 3 },
  source: 'web-app',
  ...extra,
});
// Fixture 2: the rich shop (reviews, a rating, a team, a gallery, a hero photo).
const rich = (): WebsiteData => ({ ...RICH_SITE, source: 'web-app', niche: 'barber', hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: 'https://img.example.com/hero.jpg' } } as WebsiteData);
// Fixture 3: a mobile barber, no street address, no phone hours.
const mobile = (): WebsiteData => sparse({
  shopName: 'Tony Cuts Mobile', area: 'Austin, TX', contact: { address: 'Mobile - I come to you', email: '' }, hours: [],
  services: [svc('House Call Cut', { price: '$60', description: LONG })],
});
const FIXTURES: Record<string, () => WebsiteData> = { sparse: () => sparse(), rich, mobile };

describe('what each page type carries', () => {
  it('Home, Location and Contact carry one LocalBusiness node with the same @id', () => {
    const ld = ldOf(bundle(rich()));
    const biz = ['index.html', 'location/index.html', 'contact/index.html'].map((p) => ld[p]);
    for (const n of biz) {
      expect(n).toMatchObject({ '@context': 'https://schema.org', '@type': 'HairSalon', '@id': 'https://fresh.example.com/#business', name: 'Fresh Cuts', url: 'https://fresh.example.com/', telephone: '(512) 555-0100' });
      expect(n.address).toEqual({ '@type': 'PostalAddress', streetAddress: '1 Main St', addressLocality: 'Brooklyn', addressRegion: 'NY', postalCode: '11201' });
      expect(n.openingHoursSpecification).toEqual([
        { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Monday', opens: '09:00', closes: '17:00' },
        { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Tuesday', opens: '09:00', closes: '17:00' },
        { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Wednesday', opens: '09:00', closes: '17:00' },
      ]);
      expect(n.image[0]).toBe('https://img.example.com/hero.jpg');
    }
    expect(biz[1]).toEqual(biz[0]);
    expect(biz[2]).toEqual(biz[0]);
  });
  it('every other page type carries nothing', () => {
    const ld = ldOf(bundle(rich()));
    for (const p of ['about', 'services', 'team', 'team/sam-fade', 'gallery', 'reviews', 'hours', 'faq', 'first-visit', 'hair-care', 'beard-care']) expect(ld[`${p}/index.html`], p).toBeUndefined();
  });
  it('a service page carries a Service (provider @id, real place, real price) and a BreadcrumbList', () => {
    const ld = ldOf(bundle(rich()))['services/skin-fade/index.html'];
    expect(ld['@context']).toBe('https://schema.org');
    const [service, crumbs] = ld['@graph'];
    expect(service).toEqual({
      '@type': 'Service', '@id': 'https://fresh.example.com/services/skin-fade/#service', name: 'Skin Fade', url: 'https://fresh.example.com/services/skin-fade/',
      provider: { '@type': 'HairSalon', '@id': 'https://fresh.example.com/#business', name: 'Fresh Cuts', url: 'https://fresh.example.com/' },
      areaServed: 'Brooklyn, NY', offers: { '@type': 'Offer', price: '35', priceCurrency: 'USD' },
    });
    expect(crumbs).toEqual({
      '@type': 'BreadcrumbList', '@id': 'https://fresh.example.com/services/skin-fade/#breadcrumb',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://fresh.example.com/' },
        { '@type': 'ListItem', position: 2, name: 'Services', item: 'https://fresh.example.com/services/' },
        { '@type': 'ListItem', position: 3, name: 'Skin Fade', item: 'https://fresh.example.com/services/skin-fade/' },
      ],
    });
  });
  it('offers appear only for one real numeric price: a range, "from", "25+", no price or a zero price give none', () => {
    const ld = ldOf(bundle(sparse()));
    expect(ld['services/skin-fade/index.html']['@graph'][0].offers).toEqual({ '@type': 'Offer', price: '35', priceCurrency: 'USD' });
    expect(ld['services/taper/index.html']['@graph'][0].offers).toEqual({ '@type': 'Offer', price: '30', priceCurrency: 'USD' });
    for (const p of ['beard-trim', 'kids-cut', 'line-up']) expect(ld[`services/${p}/index.html`]['@graph'][0], p).not.toHaveProperty('offers');
    for (const v of ['$25-$40', '$25+', 'from $20', 'Free', '', '$0', '0', '~$30', '25 <b>']) expect(offerOf(v, true), v).toBeNull();
    expect(offerOf('$25.50', true)).toEqual({ '@type': 'Offer', price: '25.50', priceCurrency: 'USD' });
    expect(offerOf('£30', false)).toEqual({ '@type': 'Offer', price: '30', priceCurrency: 'GBP' });
    expect(offerOf('€30', false)).toEqual({ '@type': 'Offer', price: '30', priceCurrency: 'EUR' });
    expect(offerOf('250 MXN', false)).toEqual({ '@type': 'Offer', price: '250', priceCurrency: 'MXN' });
    expect(offerOf('$30', false), 'a "$" is USD only when the shop is known to be in the US').toBeNull();
  });
  it('all three designs emit it', () => {
    for (const t of ['luxe', 'prime', 'euphoria'] as const) {
      const ld = ldOf(bundle(rich(), t));
      expect(Object.keys(ld), t).toContain('index.html');
      expect(ld['index.html']['@type']).toBe('HairSalon');
      expect(ld['services/skin-fade/index.html']['@graph']).toHaveLength(2);
    }
  });
  it('the business type follows the niche', () => {
    expect(businessTypeOf({ niche: 'barber' })).toBe('HairSalon');
    expect(businessTypeOf({})).toBe('HairSalon');
    expect(businessTypeOf({ niche: 'hair' })).toBe('HairSalon');
    expect(businessTypeOf({ niche: 'nails' })).toBe('NailSalon');
    for (const n of ['lashes', 'skin', 'massage', 'pet']) expect(businessTypeOf({ niche: n }), n).toBe('LocalBusiness');
    expect(ldOf(bundle({ ...rich(), niche: 'nails' } as WebsiteData))['index.html']['@type']).toBe('NailSalon');
    expect(ldOf(bundle({ ...rich(), niche: 'lashes' } as WebsiteData))['index.html']['@type']).toBe('LocalBusiness');
  });
});

describe('thin pages and indexability', () => {
  it('a thin (noindex) service page carries no JSON-LD; every page that has it is indexable', () => {
    const b = bundle(sparse());
    const ld = ldOf(b);
    expect(ld['services/facial/index.html']).toBeUndefined();
    for (const p of b.pages) if (p.html.includes('content="noindex,follow"')) expect(blocks(p.html), p.path).toEqual([]);
    expect(ld['services/skin-fade/index.html']).toBeDefined();
  });
  it('nothing without a public base (every @id would be relative)', () => {
    expect(ldOf(bundle(sparse(), 'luxe', {}))).toEqual({});
  });
});

describe('absent when the data is missing or not valid', () => {
  it('a mobile barber with no street address has no address, no hours; the rest is there', () => {
    const n = ldOf(bundle(mobile()))['index.html'];
    expect(n.name).toBe('Tony Cuts Mobile');
    expect(n.telephone).toBe('(512) 555-0100');
    for (const k of ['address', 'openingHoursSpecification', 'geo', 'image']) expect(n, k).not.toHaveProperty(k);
  });
  it('no phone, no hours, no photo: only name, url and id', () => {
    const n = ldOf(bundle(sparse({ phone: '', hours: [], contact: { address: '', email: '' } })))['index.html'];
    expect(Object.keys(n).sort()).toEqual(['@context', '@id', '@type', 'name', 'url']);
  });
  it('a phone with words, a city-only address and sample photos are left out', () => {
    const n = ldOf(bundle(sparse({ phone: 'Call or text 512-555-0100', contact: { address: 'Austin, TX', email: '' } })))['index.html'];
    expect(n).not.toHaveProperty('telephone');
    expect(n).not.toHaveProperty('address');
    expect(ownPhotoUrl(DEMO_GALLERY_STOCK[0]), 'a sample photo is never the shop\'s image').toBeNull();
    expect(ownPhotoUrl('https://x.example.com/own.jpg')).toBe('https://x.example.com/own.jpg');
    expect(ownPhotoUrl('http://x.example.com/a.jpg')).toBeNull();
    expect(ownPhotoUrl('javascript:alert(1)')).toBeNull();
    expect(ownPhotoUrl('has-image')).toBeNull();
    expect(ownPhotoUrl('https://x.example.com/a b.jpg')).toBeNull();
    expect(ownPhotoUrl('https://x.example.com/a.jpg"><script>')).toBeNull();
  });
  it('a sample hero photo is never listed as the shop image', () => {
    const d = sparse({ hero: { heading: 'x', tagline: '', imageUrl: DEMO_GALLERY_STOCK[0] } });
    expect(ldOf(bundle(d))['index.html']).not.toHaveProperty('image');
  });
  it('a shop with no usable name gets no business node and no service nodes', () => {
    const ld = ldOf(bundle(sparse({ shopName: '💈' })));
    expect(ld['index.html']).toBeUndefined();
    expect(ld['services/skin-fade/index.html']).toBeUndefined();
  });
  it('areaServed only when the shop has a real place', () => {
    const ld = ldOf(bundle(sparse({ area: '' })));
    expect(ld['services/skin-fade/index.html']['@graph'][0]).not.toHaveProperty('areaServed');
    expect(ldOf(bundle(sparse()))['services/skin-fade/index.html']['@graph'][0].areaServed).toBe('Austin, TX');
  });
  it('parseAddress', () => {
    expect(parseAddress('12 Main St, Austin, TX 78701, USA')).toEqual({ node: { '@type': 'PostalAddress', streetAddress: '12 Main St', addressLocality: 'Austin', addressRegion: 'TX', postalCode: '78701', addressCountry: 'US' }, us: true });
    expect(parseAddress('12 Main St, Austin')?.node).toEqual({ '@type': 'PostalAddress', streetAddress: '12 Main St, Austin' });
    expect(parseAddress('Suite 4, 12 Main St, Austin, TX')?.node.streetAddress).toBe('Suite 4, 12 Main St');
    expect(parseAddress('12 Main St., Austin, TX 78701')?.node.streetAddress).toBe('12 Main St.');
    expect(parseAddress('100 King St W, Toronto, ON, Canada')?.node).toMatchObject({ addressLocality: 'Toronto', addressRegion: 'ON', addressCountry: 'CA' });
    for (const v of ['Austin, TX', 'Mobile - I come to you', '', '<b>12 Main St</b>', '12 Main St\nAustin', null, 5, 'PO Box 12 Main']) expect(parseAddress(v), String(v)).toBeNull();
  });
  it('openingHours and minutesOf', () => {
    expect(minutesOf('09:00')).toBe(540);
    expect(minutesOf('9')).toBe(540);
    expect(minutesOf('5:30 PM')).toBe(1050);
    expect(minutesOf('12 AM')).toBe(0);
    for (const v of ['25:00', '9:75', 'By appointment', '', null, '13 PM']) expect(minutesOf(v), String(v)).toBeNull();
    expect(openingHours([
      { day: 'Mon', open: '09:00', close: '17:00' }, { day: 'Monday', open: '09:00', close: '17:00' }, { day: 'Tue', open: '09:00', close: '17:00', closed: true },
      { day: 'Wed', open: '17:00', close: '09:00' }, { day: 'Funday', open: '9', close: '5' }, { day: 'Thu', open: 'x', close: 'y' }, { day: 'Fri', open: '9am', close: '5pm' }, null,
    ])).toEqual([
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Monday', opens: '09:00', closes: '17:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Friday', opens: '09:00', closes: '17:00' },
    ]);
    expect(openingHours('nope')).toEqual([]);
  });
  it('geo only from real, valid coordinates (the site model has none today)', () => {
    expect(geoOf({})).toBeNull();
    expect(geoOf({ geo: { lat: 30.2672, lng: -97.7431 } })).toEqual({ '@type': 'GeoCoordinates', latitude: 30.2672, longitude: -97.7431 });
    for (const g of [{ lat: 0, lng: 0 }, { lat: 91, lng: 0 }, { lat: 1, lng: 181 }, { lat: NaN, lng: 1 }, { lat: '30', lng: '-97' }, { lat: 30.123456789, lng: 1 }]) expect(geoOf({ geo: g }), JSON.stringify(g)).toBeNull();
    expect(ldOf(bundle({ ...sparse(), geo: { lat: 30.2672, lng: -97.7431 } } as WebsiteData))['index.html'].geo).toBeDefined();
    expect(ldOf(bundle(sparse()))['index.html']).not.toHaveProperty('geo');
  });
  it('cleanName', () => {
    expect(cleanName('  Fresh   Cuts ')).toBe('Fresh Cuts');
    for (const v of ['', '   ', '💈', 'A\nB', 'x'.repeat(121), null, 5]) expect(cleanName(v), String(v)).toBeNull();
  });
});

describe('never anything the page does not show', () => {
  it('no rating, review, offer range, FAQ or price range markup in any fixture, on any page', () => {
    for (const [name, make] of Object.entries(FIXTURES)) {
      for (const t of ['luxe', 'prime', 'euphoria'] as const) {
        const b = bundle(make(), t);
        for (const p of b.pages) {
          const text = blocks(p.html).join('\n');
          expect(text, `${name} ${t} ${p.path}`).not.toMatch(/aggregateRating|ratingValue|reviewCount|"review"|Review|AggregateOffer|FAQPage|Question|priceRange|sameAs|hasMap|makesOffer/);
        }
        walk(ldOf(b), (k) => expect(['aggregateRating', 'review', 'reviews', 'priceRange', 'sameAs'], k).not.toContain(k));
      }
    }
  });
  it('the rich shop really has reviews and a rating to leave out', () => {
    expect(rich().reviews!.length).toBeGreaterThan(0);
    expect(rich().aggregateRating).toBeDefined();
    expect(bundle(rich()).pages.some((p) => p.html.includes('Best fade in the borough'))).toBe(true);
  });
  it('every @id and url is absolute on the site base, and the service provider @id is the business @id', () => {
    const ld = ldOf(bundle(rich()));
    walk(ld, (k, v) => { if (['@id', 'url', 'item'].includes(k)) expect(String(v), k).toMatch(/^https:\/\/fresh\.example\.com\//); });
    const home = ld['index.html']['@id'];
    for (const [path, n] of Object.entries(ld)) if (path.startsWith('services/')) expect(n['@graph'][0].provider['@id'], path).toBe(home);
  });
});

describe('escaping', () => {
  const HOSTILE = [
    '</script><script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'A & B <b>x</b>', 'line\u2028sep\u2029para', '"quoted" \\ back', '<!-- --><script', "']]></script>",
  ];
  it('no value can close the script tag or start markup; the value still round-trips through JSON.parse', () => {
    for (const evil of HOSTILE) {
      const d = sparse({
        shopName: `Cuts ${evil}`, area: `Austin ${evil}, TX`, phone: `5125550100`,
        contact: { address: `12 Main St ${evil}, Austin, TX`, email: '' },
        services: [svc(`Fade ${evil}`, { price: '$35', description: LONG })],
      });
      for (const t of ['luxe', 'prime', 'euphoria'] as const) {
        const b = bundle(d, t);
        for (const p of b.pages) {
          for (const raw of blocks(p.html)) {
            expect(raw, `${t} ${p.path} ${evil}`).not.toMatch(/[<>&\u2028\u2029]/);
            expect(raw.toLowerCase()).not.toContain('</script');
            JSON.parse(raw);
          }
          // The script element is intact: exactly the ld+json blocks we expect, none opened by the payload.
          expect((p.html.match(/<script type="application\/ld\+json">/g) ?? []).length, p.path).toBe(blocks(p.html).length);
        }
        const home = JSON.parse(blocks(b.pages[0].html)[0] ?? 'null');
        if (home) expect(typeof home.name).toBe('string');
      }
    }
  });
  it('jsonLdString escapes < > & U+2028 U+2029 and round-trips', () => {
    const v = { a: '</script> & <b> \u2028 \u2029 "q"' };
    const s = jsonLdString(v);
    expect(s).not.toMatch(/[<>&\u2028\u2029]/);
    expect(s).toContain('\\u003c/script\\u003e');
    expect(JSON.parse(s)).toEqual(v);
  });
  it('a hostile shop name renders as plain data in the business node', () => {
    const d = sparse({ shopName: 'Cuts </script><script>alert(1)</script>' });
    const name = ldOf(bundle(d))['index.html'].name;
    expect(name).toBe('Cuts </script><script>alert(1)</script>');
  });
  it('the editor markers never reach the JSON', () => {
    const ld = ldOf(bundle(sparse({ shopName: '\u2063shopName\u2063Fresh Cuts\u2063/\u2063' })));
    expect(ld['index.html'].name).toBe('Fresh Cuts');
  });
});

describe('determinism', () => {
  it('two renders give the same JSON-LD on every page', () => {
    for (const make of Object.values(FIXTURES)) {
      const a = ldOf(bundle(make()));
      const b = ldOf(bundle(make()));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
  it('keys are in a fixed order (the same data in another property order gives the same bytes)', () => {
    const d = sparse();
    const flipped = { ...d, contact: { email: '', address: d.contact.address }, hero: { imageUrl: '', tagline: '', heading: 'Fresh Cuts' } } as WebsiteData;
    expect(JSON.stringify(ldOf(bundle(flipped)))).toBe(JSON.stringify(ldOf(bundle(d))));
  });
});

describe('gating: only web-created pages-v2 multi-page sites', () => {
  const none = (b: ReturnType<typeof bundle>): void => { for (const p of b.pages) expect(p.html, p.path).not.toContain('ld+json'); };
  it('a site made in the iOS app (no source) carries none', () => { const { source: _s, ...d } = sparse(); none(bundle(d as WebsiteData)); });
  it('a site with another source carries none', () => none(bundle(sparse({ source: 'ios' }))));
  it('a multi-page site from before pages v2 (no extraPages) carries none', () => { const { extraPages: _e, ...d } = sparse(); none(bundle(d as WebsiteData)); });
  it('a single-page site (no pages model) carries none', () => { const { pages: _p, ...d } = sparse(); none(bundle(d as WebsiteData)); });
  it('every iOS-made fixture site carries none, in every design and base', () => {
    for (const site of Object.values(IOS_SITES)) for (const t of ['luxe', 'prime', 'euphoria'] as const) {
      none(renderSiteBundle(JSON.parse(JSON.stringify({ ...site, template: t })), BASE));
      none(renderSiteBundle(JSON.parse(JSON.stringify({ ...site, template: t })), { siteBaseUrl: 'https://fresh.example.com', customDomain: 'https://shop.example.org' }));
    }
  });
});

describe('golden JSON-LD for three fixtures', () => {
  for (const [name, make] of Object.entries(FIXTURES)) {
    it(name, () => { expect(ldOf(bundle(make()))).toMatchSnapshot(); });
  }
});
