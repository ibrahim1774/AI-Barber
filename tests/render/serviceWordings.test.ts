// Re-review 12 (2026-11-04): the service-page visit wordings against hostile titles and awkward data. Table driven: every
// title x every wording x every address shape x price/time shape, rendered on the real service page (web-created, pages v2);
// the added text is the visit paragraph (the page minus the same page made in the iOS app). Grammar-safe, no banned claims.
import { describe, expect, it } from 'vitest';
import { SERVICE_VISIT } from '../../lib/render/copyLibrary';
import { outputProblems, strictProblems } from '../../lib/render/copyRules';
import { isDuration, isMoney, lenientEnv, resolveSentence, segsText, svcCopyKey, tidyLabel, tidyValue } from '../../lib/render/guides';
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
      const t = tidyValue(title);
      expect(out.length, label).toBeGreaterThan(0);
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
  it('N-a: leading symbols, an inverted mark and unbalanced brackets or quotes are tidied', () => {
    expect(tidyValue('- Fade')).toBe('Fade');
    expect(tidyValue('+ & Fade')).toBe('Fade');
    expect(tidyValue('¿Corte?')).toBe('Corte');
    expect(tidyValue('¡Fade!')).toBe('Fade');
    expect(tidyValue('Fade (')).toBe('Fade');
    expect(tidyValue('Skin Fade (Mid)')).toBe('Skin Fade (Mid)');
    expect(tidyValue('"Fade')).toBe('Fade');
    expect(tidyValue('"Fade"')).toBe('"Fade"');
    expect(tidyValue('Fade [Mid')).toBe('Fade Mid');
    expect(tidyValue('  haircut.  ')).toBe('haircut');
  });
  it('N-c: a service called like the shop drops the sentence that would say it twice', () => {
    const d = mk('Fresh Cuts', { shop: 'Fresh Cuts', address: '12 Main St', price: '$20', duration: '30 min', wording: 0, phone: '', book: '/book' });
    const text = added(d).join(' ');
    expect(text.split('Fresh Cuts').length - 1).toBeLessThanOrEqual(1);
    expect(resolveSentence(lenientEnv(d), '{shop} lists {service} on its service menu.', [], { index: 0, title: 'fresh cuts', price: '', duration: '', guide: null } as never, true)).toBeNull();
    expect(segsText(resolveSentence(lenientEnv(d), '{shop} lists {service} on its service menu.', [], { index: 0, title: 'Braids', price: '', duration: '', guide: null } as never, true)!)).toBe('Fresh Cuts lists Braids on its service menu.');
  });
  it('N-d: a title with a repeated word is no reason to drop a good sentence; a repeat in the library text still is', () => {
    const d = mk('Book Club Cut', { shop: 'Fresh Cuts', address: '12 Main St', price: '$20', duration: '30 min', wording: 1, phone: '', book: '/book' });
    expect(added(d).join(' ')).toContain('Ready to book Book Club Cut?');
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

// ── Re-review 12c ───────────────────────────────────────────────────────────────────────────────
const sv = (title: string) => ({ index: 0, title, price: '', duration: '', guide: null }) as never;
const say = (sentence: string, o: { shop?: string; phone?: string; address?: string; title?: string; price?: string; duration?: string } = {}) => {
  const d = mk(o.title ?? 'Fade', { shop: o.shop ?? 'Fresh Cuts', address: o.address ?? '12 Main St', price: o.price ?? '$30', duration: o.duration ?? '30 min', wording: 0, phone: o.phone ?? '(512) 555-0100', book: '/book' });
  const r = resolveSentence(lenientEnv(d), sentence, [], { index: 0, title: o.title ?? 'Fade', price: o.price ?? '$30', duration: o.duration ?? '30 min', guide: null } as never, true);
  return r ? segsText(r) : null;
};

describe('BL-A: meaningful leading symbols stay (table)', () => {
  const keep: Array<[string, string]> = [
    ['+44 20 7946 0958', '+44 20 7946 0958'], ['+1 (512) 555-0100', '+1 (512) 555-0100'], ['+52 55 1234 5678', '+52 55 1234 5678'],
    ['#1 Cut', '#1 Cut'], ['#1 Barbers', '#1 Barbers'], ['~$30', '~$30'], ['$25+', '$25+'], ['+$25', '+$25'], ['~30 min', '~30 min'], ['#4 Oak Ave, Austin', '#4 Oak Ave, Austin'],
  ];
  const clean: Array<[string, string]> = [
    ['- Fade', 'Fade'], ['+ Beard', 'Beard'], ['+ & Fade', 'Fade'], ['-Fade', 'Fade'], ['*New* Fade', 'New Fade'], ['¿Corte?', 'Corte'], ['  Fade!!  ', 'Fade'],
    ['\u201cFade', 'Fade'], ['\u201cFade\u201d', '\u201cFade\u201d'], ["'Fade", 'Fade'], ["Kids' Cut", "Kids' Cut"], ['Call us!!!', 'Call us'], ['', ''], ['   ', ''],
  ];
  for (const [i, o] of keep) it(`keeps ${JSON.stringify(i)}`, () => expect(tidyValue(i)).toBe(o));
  for (const [i, o] of clean) it(`tidies ${JSON.stringify(i)}`, () => expect(tidyValue(i)).toBe(o));
  it('approximate and signed prices and times do not pass as exact', () => {
    for (const v of ['~$30', '+$25', '~30 min', '+30 min']) expect(isMoney(tidyValue(v)) || isDuration(tidyValue(v)), v).toBe(false);
    expect(isMoney(tidyValue('$25+'))).toBe(true);
    expect(say('The listed price is {price}.', { price: '~$30' })).toBeNull();
    expect(say('The listed time is {duration}.', { duration: '~30 min' })).toBeNull();
    expect(say('The listed price is {price}.', { price: '$25+' })).toBe('The listed price is $25+.');
  });
  it('phone, shop, title and address print unchanged in a sentence', () => {
    expect(say('Call {phone} to book.', { phone: '+44 20 7946 0958' })).toBe('Call +44 20 7946 0958 to book.');
    expect(say('Call {phone} to book.', { phone: '+1 (512) 555-0100' })).toBe('Call +1 (512) 555-0100 to book.');
    expect(say('{shop} lists {service} on its menu.', { shop: '#1 Barbers', title: 'Fade' })).toBe('#1 Barbers lists Fade on its menu.');
    expect(say('Ready to book {service}?', { title: '#1 Cut' })).toBe('Ready to book #1 Cut?');
    expect(say('The shop is at {address}.', { address: '#4 Oak Ave, Austin' })).toBe('The shop is at #4 Oak Ave, Austin.');
  });
  it('full render: a +44 phone and a #1 shop keep their signs on the page', () => {
    const d = mk('Fade', { shop: '#1 Barbers', address: '12 Main St, Austin, TX', price: '$30', duration: '30 min', wording: 0, phone: '+44 20 7946 0958', book: '/book' });
    const text = added(d).join(' ');
    expect(text).not.toMatch(/(?<![+#\w])44 20/);
    expect(text).not.toMatch(/(?<![#\w])1 Barbers/);
  });
});

describe('BL-B: link labels in sentences are tidied (table)', () => {
  const cases: Array<[string, string, string]> = [
    ['Book Now!', 'Book now', 'Book Now'], ['BOOK NOW', 'Book now', 'Book now'], ['book now', 'Book now', 'Book now'], ['', 'Book now', 'Book now'], ['  ', 'Book now', 'Book now'],
    ['Call us!!!', 'Book now', 'Call us'], ['Book now.', 'Book now', 'Book now'], ['Where Are We?', 'Location', 'Where Are We'],
    ['Book Now \u2192', 'Book now', 'Book Now'], ['!!!', 'Book now', 'Book now'], ['https://x.com/book', 'Book now', 'Book now'], ['bOOK nOW', 'Book now', 'Book now'],
    ['Book a Fade', 'Book now', 'Book a Fade'], ['FAQ', 'Book now', 'FAQ'], ['Reserve your spot at our shop today now', 'Book now', 'Book now'], ['Book. Now', 'Book now', 'Book now'],
  ];
  for (const [raw, fb, want] of cases) it(`${JSON.stringify(raw)} -> ${JSON.stringify(want)}`, () => expect(tidyLabel(raw, fb)).toBe(want));

  const labels = ['Book Now!', 'BOOK NOW', 'book now', '', '  ', 'Call us!!!', 'Book now.', 'Where Are We?', 'Location.', '!!!'];
  for (const label of labels) for (const wording of [0, 1, 2]) for (const tpl of ['luxe', 'prime']) {
    it(`full render ${JSON.stringify(label)} wording ${wording} ${tpl}`, () => {
      const d = mk('Fade', { shop: 'Fresh Cuts', address: '12 Main St, Austin, TX', price: '$30', duration: '30 min', wording, phone: '(512) 555-0100', book: '/book' });
      (d as unknown as Record<string, unknown>).template = tpl;
      (d as unknown as Record<string, unknown>).labels = { pgBookCta: label, pgNavLocation: label };
      const out = added(d);
      for (const s of out) {
        expect(s).not.toMatch(/[.!?]\s+(?:link|page)\b/);
        expect(s).not.toMatch(/[!?][^.!?]*\b(?:link|page)\b/);
        expect(outputProblems(s, { repeats: false }), s).toEqual([]);
        expect(s).toMatch(/[.?!]$/);
      }
    });
  }
  it('the sentence label is tidied but the button keeps the barber text', () => {
    const d = mk('Fade', { shop: 'Fresh Cuts', address: '12 Main St, Austin, TX', price: '$30', duration: '30 min', wording: 1, phone: '', book: '/book' });
    (d as unknown as Record<string, unknown>).labels = { pgBookCta: 'Book Now!' };
    expect(added(d).join(' ')).toContain('Use the Book Now link.');
  });
});

describe('SF-1 / N-1 / N-2', () => {
  it('SF-1: R17 catches the BL1 shape across a question mark, for every pronoun', () => {
    for (const s of ['Looking for {service}? {shop} has it on the menu.', 'Looking for {service}? It is on the menu.', '{service} is listed; they are popular.', 'Want {service}? Ask for them.', 'Try {service}. Those are fast.']) expect(strictProblems(s).join(), s).toMatch(/R17/);
    expect(strictProblems('Looking for {service}? {shop} lists this service on the menu.')).toEqual([]);
    expect(strictProblems('It is easy to find {shop}.')).toEqual([]);
    for (const s of SERVICE_VISIT.variants.flat()) expect(strictProblems(s).join(), s).not.toMatch(/R17/);
  });
  it('N-1: stray asterisks, curly quotes, apostrophes; an inner sentence end drops the sentence', () => {
    expect(tidyValue('*New* Fade')).toBe('New Fade');
    expect(tidyValue('\u201cFade')).toBe('Fade');
    expect(tidyValue("'Fade")).toBe('Fade');
    expect(say('Ready to book {service}?', { title: 'Shave? Yes!' })).toBeNull();
    expect(say('Ready to book {service}?', { title: 'Fade 2.0' })).toBe('Ready to book Fade 2.0?');
    expect(say('Ready to book {service}?', { title: 'Fade.' })).toBe('Ready to book Fade?');
  });
  it('N-2: R16 also covers reach / find us / route / navigate', () => {
    for (const s of ['The {link:location} page shows how to reach the shop.', 'Find us on the {link:location} page.', 'Navigate with the {link:location} page.']) expect(strictProblems(s).join(), s).toMatch(/R16/);
    expect(strictProblems('The shop is at {address}; find us on the {link:location} page.')).toEqual([]);
  });
});
