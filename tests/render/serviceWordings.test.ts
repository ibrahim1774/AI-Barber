// Re-review 12 (2026-11-04): the service-page visit wordings against hostile titles and awkward data. Table driven: every
// title x every wording x every address shape x price/time shape, rendered on the real service page (web-created, pages v2);
// the added text is the visit paragraph (the page minus the same page made in the iOS app). Grammar-safe, no banned claims.
import { describe, expect, it } from 'vitest';
import { SERVICE_VISIT } from '../../lib/render/copyLibrary';
import { outputProblems, strictProblems } from '../../lib/render/copyRules';
import { lenientEnv, resolveSentence, segsText, svcCopyKey } from '../../lib/render/guides';
import { renderSiteBundle } from '../../lib/render/site';
import type { WebsiteData } from '../../types';

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });
const mk = (title: string, o: { shop: string; address: string; price: string; duration: string; wording: number; phone: string; book: string }): WebsiteData => ({
  shopName: o.shop, area: 'Austin, TX', phone: o.phone, bookingUrl: o.book, template: 'luxe',
  hero: { heading: o.shop, tagline: '', imageUrl: '' }, about: { heading: 'About', description: ['We cut hair.'], imageUrl: '' },
  services: [svc(title, { price: o.price, duration: o.duration })], gallery: [],
  hours: [{ day: 'Mon', open: '09:00', close: '17:00' }], contact: { address: o.address, email: '' },
  pages: { order: [], hidden: [] },
  extraPages: { on: [], serviceGuides: true, seed: 1, pick: { [svcCopyKey(title, 'visit')]: o.wording } },
  source: 'web-app',
} as unknown as WebsiteData);
const mainText = (html: string) => (/<main[\s\S]*?<\/main>/.exec(html)?.[0] ?? html).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
const sentences = (t: string) => t.split(/(?<=[.?!])\s+/).filter(Boolean);
function added(d: WebsiteData): string[] {
  const { source: _s, ...ios } = d as WebsiteData & { source?: string };
  void _s;
  const page = (x: WebsiteData) => renderSiteBundle(x, { siteBaseUrl: 'https://fresh.example.com' }).pages.find((p) => p.path.startsWith('services/') && p.path !== 'services/index.html');
  const web = page(d), old = page(ios as WebsiteData);
  const paras = (html: string): string[] => [...(/<main[\s\S]*?<\/main>/.exec(html)?.[0] ?? html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => mainText(m[1]));
  const have = new Set(paras(old!.html));
  return paras(web!.html).filter((x) => !have.has(x)).flatMap(sentences);
}

const TITLES = ['Braids', 'The Works', 'MVP Cut', 'Beard Trim', 'Fade + Beard', "Kids' Cut", 'Line-Up', 'Skin Fade (Mid)', 'SKIN FADE', `${'Extra long service title '.repeat(3)}Fade`, 'low fade', 'Book now', '- Fade', '¿Corte?', 'Fade (', '"Fade'];
const ADDRESSES: Array<[string, boolean]> = [['12 Main St, Austin, TX', true], ['Mobile - I come to you', false], ['Austin, TX', false], ['', false]];
const VALUES: Array<[string, string, boolean]> = [['$35', '45 min', true], ['', '', false], ['Call for price', 'Varies', false]];
const SHOPS = ['Fresh Cuts', 'FRESH CUTS', 'fresh cuts'];
const BANNED = /\b(?:best|top|#1|number one|premier|award|guarantee[ds]?|cheap(?:est)?|affordable|lowest|trusted|famous|finest|great|amazing|perfect|expert|health(?:y|ier)?|heal|luxury|unbeatable|satisf)\w*/i;
const BAD_PHRASE = /\b(?:has it|lists it|have it|Go to)\b/;

describe('visit wordings over hostile titles and data shapes (table driven)', () => {
  let n = 0;
  for (const title of TITLES) for (const wording of [0, 1, 2]) for (const [address, street] of ADDRESSES) for (const [price, duration, real] of VALUES) {
    const shop = SHOPS[n++ % SHOPS.length];
    const label = JSON.stringify({ title, wording, address, price, duration, shop });
    it(label, () => {
      const phone = n % 2 ? '(512) 555-0100' : '';
      const book = n % 3 ? '/book' : '';
      const out = added(mk(title, { shop, address, price, duration, wording, phone, book }));
      const text = out.join(' ');
      const t = title.replace(/\s+/g, ' ').trim();
      if (real || street) expect(out.length, label).toBeGreaterThan(0);
      expect(text, label).not.toContain('fresh cuts'); // lower-case owner text is never re-cased: such a sentence is omitted
      for (const s of out) {
        expect(s, label).toMatch(/^[A-Z0-9]/);
        expect(s, label).toMatch(/[.?!]$/);
        expect(outputProblems(s, { repeats: false }), `${label}: ${s}`).toEqual([]);
        expect(s, label).not.toMatch(BANNED);
        expect(s, label).not.toMatch(BAD_PHRASE);
        expect(s, label).not.toMatch(/\bmap\b/i);
        expect(s, label).not.toMatch(/[¿¡]/);
      }
      if (t.toLowerCase() !== 'book now') {
        expect(text.toLowerCase().split(t.toLowerCase()).length - 1, `${label}: ${text}`).toBeLessThanOrEqual(1);
        expect(text, label).not.toMatch(/Book now(?! link)/);
      }
      if (!street) { expect(text, label).not.toMatch(/direction/i); if (address) expect(text, label).not.toContain(address); }
      if (!real) { expect(text, label).not.toMatch(/Call for price|Varies|Free/); }
      if (real) { expect(text, label).toContain('$35'); expect(text, label).toContain('45 min'); }
      if (street) { expect(text, label).toContain('12 Main St'); expect(text, label).toMatch(/direction/i); }
      expect(text, label).not.toMatch(/^[a-z]/);
    });
  }
});

describe('re-review 12 blocking items', () => {
  it('BL1: no pronoun points back at the service in any wording (plural titles: Braids, Highlights, Kids Cuts)', () => {
    for (const s of SERVICE_VISIT.variants.flat()) { expect(s).not.toMatch(/\{service\}[^.!?]*\b(?:it|they|them|these|those)\b/i); expect(s).not.toMatch(/\bhas it\b/); }
    for (const t of ['Braids', 'Highlights', 'Kids Cuts']) for (const w of [0, 1, 2]) expect(added(mk(t, { shop: 'Fresh Cuts', address: '1 Main St', price: '$20', duration: '30 min', wording: w, phone: '', book: '/book' })).join(' ')).not.toMatch(/\bhas it\b/);
  });
  it('BL2: the book link label is followed by "link", never read as a noun ("Go to Book now.")', () => {
    for (const s of SERVICE_VISIT.variants.flat().filter((x) => x.includes('{link:book}'))) expect(s).toMatch(/\{link:book\} link/);
    expect(strictProblems('Ready to book {service}? Go to {link:book}.').join()).toMatch(/R18/);
    expect(strictProblems('Ready to book {service}? Use the {link:book} link.')).toEqual([]);
  });
  it('BL3: a sentence about directions always carries {address} (so it drops for Mobile, a city, or no address)', () => {
    for (const s of SERVICE_VISIT.variants.flat().filter((x) => /direction/i.test(x))) expect(s).toContain('{address}');
    expect(strictProblems('Open the {link:location} page for directions.').join()).toMatch(/R16/);
    expect(strictProblems('The shop is at {address}, and the {link:location} page has directions.')).toEqual([]);
    for (const address of ['Mobile - I come to you', 'Houston, TX']) for (const w of [0, 1, 2]) {
      expect(added(mk('Skin Fade', { shop: 'Fresh Cuts', address, price: '$35', duration: '45 min', wording: w, phone: '', book: '/book' })).join(' '), `${address} ${w}`).not.toMatch(/direction/i);
    }
  });
});

describe('re-review 12 nits', () => {
  it('N-c: a service called like the shop drops the sentence that would say it twice', () => {
    const d = mk('Fresh Cuts', { shop: 'Fresh Cuts', address: '12 Main St', price: '$20', duration: '30 min', wording: 0, phone: '', book: '/book' });
    const text = added(d).join(' ');
    expect(text.split('Fresh Cuts').length - 1).toBeLessThanOrEqual(1);
    expect(resolveSentence(lenientEnv(d), '{shop} lists {service} on its service menu.', [], { index: 0, title: 'fresh cuts', price: '', duration: '', guide: null } as never, true)).toBeNull();
    expect(segsText(resolveSentence(lenientEnv(d), '{shop} lists {service} on its service menu.', [], { index: 0, title: 'Braids', price: '', duration: '', guide: null } as never, true)!)).toBe('Fresh Cuts lists Braids on its service menu.');
  });
  it('N-d: a title with a repeated word is no reason to drop a good sentence; a repeat in the library text still is', () => {
    const d = mk('Book Club Cut', { shop: 'Fresh Cuts', address: '12 Main St', price: '$20', duration: '30 min', wording: 1, phone: '', book: '/book' });
    expect(added(d).join(' ')).not.toContain('Ready to book Book Club Cut?'); // a value repeating the library word next to it drops the sentence (12d)
    expect(added(mk('Club Cut', { shop: 'Fresh Cuts', address: '12 Main St', price: '$20', duration: '30 min', wording: 1, phone: '', book: '/book' })).join(' ')).toContain('Ready to book Club Cut?');
    expect(outputProblems('Fade fade now.')).not.toEqual([]);
    expect(outputProblems('Fade fade now.', { repeats: false })).toEqual([]);
    for (const sentence of SERVICE_VISIT.variants.flat()) expect(outputProblems(sentence.replace(/\{[^}]*\}/g, 'Zed')), sentence).toEqual([]); // the library's own words repeat nothing
  });
  it('R17 refuses a pronoun after {service}, R16 directions without an address, R18 a bare book link', () => {
    expect(strictProblems('Looking for {service}? {shop} lists it on the menu.').join()).toMatch(/R17/); // across the question mark too
    expect(strictProblems('{shop} lists {service} and keeps it ready.').join()).toMatch(/R17/);
    expect(strictProblems('See the map and parking details.').join()).toMatch(/R16/);
    expect(strictProblems('Use {link:book}.').join()).toMatch(/R18/);
  });
});

// ── Re-review 12c/12d: helper for a single sentence ─────────────────────────────────────────────
const say = (sentence: string, o: { shop?: string; phone?: string; address?: string; title?: string; price?: string; duration?: string } = {}) => {
  const d = mk(o.title ?? 'Fade', { shop: o.shop ?? 'Fresh Cuts', address: o.address ?? '12 Main St', price: o.price ?? '$30', duration: o.duration ?? '30 min', wording: 0, phone: o.phone ?? '(512) 555-0100', book: '/book' });
  const r = resolveSentence(lenientEnv(d), sentence, [], { index: 0, title: o.title ?? 'Fade', price: o.price ?? '$30', duration: o.duration ?? '30 min', guide: null } as never, true);
  return r ? segsText(r) : null;
};

describe('SF-1 / N-1 / N-2', () => {
  it('SF-1: R17 catches the BL1 shape across a question mark, for every pronoun', () => {
    for (const s of ['Looking for {service}? {shop} has it on the menu.', 'Looking for {service}? It is on the menu.', '{service} is listed; they are popular.', 'Want {service}? Ask for them.', 'Try {service}. Those are fast.']) expect(strictProblems(s).join(), s).toMatch(/R17/);
    expect(strictProblems('Looking for {service}? {shop} lists this service on the menu.')).toEqual([]);
    expect(strictProblems('It is easy to find {shop}.')).toEqual([]);
    for (const s of SERVICE_VISIT.variants.flat()) expect(strictProblems(s).join(), s).not.toMatch(/R17/);
  });
  it('N-1: odd titles are omitted, never fixed up; a plain title prints exactly as typed', () => {
    for (const t of ['*New* Fade', '\u201cFade', "'Fade", 'Shave? Yes!', 'Fade.', '**Fade**', '\u2022Fade']) expect(say('Ready to book {service}?', { title: t }), t).toBeNull();
    expect(say('Ready to book {service}?', { title: 'Fade 2.0' })).toBe('Ready to book Fade 2.0?');
    expect(say('Ready to book {service}?', { title: "Kids' Cut" })).toBe("Ready to book Kids' Cut?");
  });
  it('N-2: R16 also covers reach / find us / route / navigate', () => {
    for (const s of ['The {link:location} page shows how to reach the shop.', 'Find us on the {link:location} page.', 'Navigate with the {link:location} page.']) expect(strictProblems(s).join(), s).toMatch(/R16/);
    expect(strictProblems('The shop is at {address}; find us on the {link:location} page.')).toEqual([]);
  });
});
