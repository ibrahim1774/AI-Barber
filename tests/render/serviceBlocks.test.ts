// The service page blocks (Phase 1): `service visit` and `service alt` in the library and the strict rules R12 (article),
// R13 (token form), R14 (clean output) and R15 (agreement). Every sentence of every wording is linted; the blocks are then
// rendered on service pages and checked for gating (pages v2 AND web-created), per-service keys, overrides, escaping,
// awkward titles, free-text prices and clean text.
import { describe, expect, it } from 'vitest';
import { GUIDES, GUIDE_IDS, SERVICE_ALT, SERVICE_VISIT, type Block, type GuideId } from '../../lib/render/copyLibrary';
import { copyProblems, outputProblems, serviceWordsIn, strictProblems } from '../../lib/render/copyRules';
import {
  copyDefault, copyOverrides, isCopyKey, isDuration, isMoney, isStreetAddress, lenientEnv, resolveBlock, resolveSentence, segsText, serviceAltFor, serviceTextOn,
  svcCopyKey, svcTitleKey, visibleCopyKeys,
} from '../../lib/render/guides';
import { renderSiteBundle } from '../../lib/render/site';
import type { WebsiteData } from '../../types';

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });
const shop = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' },
  about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Skin Fade', { price: '$35', duration: '45 min' }), svc('Low Fade', { price: '$30', duration: '40 min' }), svc('Facial', { price: '$40' })],
  gallery: [], hours: [{ day: 'Mon', open: '09:00', close: '17:00' }, { day: 'Tue', open: '09:00', close: '17:00' }, { day: 'Sun', open: '', close: '', closed: true }],
  contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  pages: { order: [], hidden: [] },
  extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: 7 },
  source: 'web-app',
  ...extra,
});
const get = (d: WebsiteData, path: string, template: 'luxe' | 'prime' | 'euphoria' = 'luxe') => renderSiteBundle({ ...d, template }, { siteBaseUrl: 'https://fresh.example.com' }).pages.find((p) => p.path === path)?.html ?? '';
const main = (html: string) => /<main[\s\S]*?<\/main>/.exec(html)?.[0] ?? html;
const visibleText = (html: string) => main(html).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');
const subjectOf = (title: string, extra: Record<string, unknown> = {}) => ({ index: 0, title, price: '', duration: '', guide: null, ...extra });

const blocks: { where: string; block: Block; guide: GuideId | null }[] = [
  { where: 'service.visit', block: SERVICE_VISIT, guide: null },
  ...GUIDE_IDS.map((g) => ({ where: `service.alt.${g}`, block: SERVICE_ALT[g], guide: g as GuideId | null })),
];

describe('the service blocks in the library', () => {
  it('one visit block and one alt block per guide, each with three different wordings of at least one sentence', () => {
    expect(Object.keys(SERVICE_ALT).sort()).toEqual([...GUIDE_IDS].sort());
    for (const { where, block } of blocks) {
      expect(block.variants, where).toHaveLength(3);
      for (const v of block.variants) expect(v.length, where).toBeGreaterThan(0);
      expect(new Set(block.variants.map((v) => v.join(' '))).size, where).toBe(3);
    }
  });
  const rows = blocks.flatMap(({ where, block, guide }) => block.variants.flatMap((v, i) => v.map((text, j) => ({ where: `${where} wording ${i} sentence ${j}`, text, allow: guide ? GUIDES[guide].allow : [] }))));
  it(`every sentence passes R1 to R16 (strict): ${rows.length} sentences`, () => {
    expect(rows.length).toBeGreaterThan(70);
    const bad = rows.map((r) => ({ r, p: copyProblems(r.text, { allow: r.allow, strict: true }) })).filter((x) => x.p.length).map((x) => `${x.r.where}: "${x.r.text}" -> ${x.p.join('; ')}`);
    expect(bad).toEqual([]);
  });
  it('B0: the service name appears at most once in a wording of the visit block, and not at all in an alt block', () => {
    for (const v of SERVICE_VISIT.variants) expect(v.join(' ').split('{service}').length - 1, v.join(' ')).toBeLessThanOrEqual(1);
    for (const g of GUIDE_IDS) for (const v of SERVICE_ALT[g].variants) expect(v.join(' '), g).not.toContain('{service}');
  });
  it('B1: no {service} is the subject of a verb or follows an article, and the {a:...} token is gone', () => {
    for (const { where, block } of blocks) for (const v of block.variants) for (const s of v) {
      expect(s, where).not.toMatch(/\{a:/);
      expect(s, where).not.toMatch(/(?:^|[.?!]\s+)\{service\}\s+(?:is|are|has|have|was|puts|sits|appears|lists)\b/);
      expect(s, where).not.toMatch(/\b(?:a|an|the)\s+\{service\}/i);
    }
  });
  it('B3: no sentence of an alt block claims an order or a count of services ("second", "another", "one more")', () => {
    for (const g of GUIDE_IDS) for (const s of SERVICE_ALT[g].variants.flat()) expect(s, g).not.toMatch(/\b(?:second|third|another|one more|other|also|too)\b/i);
  });
  it('an alt block names only the services of its own kind, and repeats no sentence of that kind\'s guide', () => {
    for (const g of GUIDE_IDS) {
      const guideSentences = new Set(GUIDES[g].blocks.flatMap((b) => b.variants.flat()).map((s) => s.toLowerCase()));
      for (const s of SERVICE_ALT[g].variants.flat()) {
        expect(guideSentences.has(s.toLowerCase()), `${g}: "${s}"`).toBe(false);
        for (const w of serviceWordsIn(s)) expect(GUIDES[g].allow, `${g} names ${w}: "${s}"`).toContain(w);
      }
    }
  });
  it('the visit block names no service at all (it knows the service only through {service})', () => {
    for (const s of SERVICE_VISIT.variants.flat()) expect(serviceWordsIn(s), s).toEqual([]);
  });
  it('N8: the wordings of one block are three different texts: no sentence and no five-word run is shared between two wordings', () => {
    const shingles = (v: string[]): Set<string> => {
      const out = new Set<string>();
      for (const s of v) {
        const w = s.toLowerCase().replace(/\{[^}]*\}/g, ' tok ').replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
        for (let i = 0; i + 5 <= w.length; i++) out.add(w.slice(i, i + 5).join(' '));
      }
      return out;
    };
    for (const { where, block } of blocks) {
      const sets = block.variants.map(shingles);
      for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
        const shared = [...sets[a]].filter((x) => sets[b].has(x));
        expect(shared, `${where}: wordings ${a} and ${b}`).toEqual([]);
        const same = block.variants[a].filter((x) => block.variants[b].includes(x));
        expect(same, `${where}: wordings ${a} and ${b}`).toEqual([]);
      }
    }
  });
  it('S3: the three visit wordings do not open on the same fact, and no two share a price or time sentence shape', () => {
    const firsts = SERVICE_VISIT.variants.map((v) => v[0].replace(/\{[^}]*\}/g, 'x'));
    expect(new Set(firsts).size).toBe(3);
    const price = SERVICE_VISIT.variants.map((v) => v.find((s) => s.includes('{price}'))!.replace(/\{[^}]*\}/g, 'x'));
    expect(new Set(price).size).toBe(3);
  });
  it('K4: dropping any one token leaves a first sentence that stands on its own', () => {
    const DANGLING = /^(?:also|it|its|then|this service|the other)\b|\balso\b/i;
    const tokensOf = (s: string) => [...s.matchAll(/\{([A-Za-z]+)(?::([a-z-]+))?\}/g)].map((m) => (m[2] ? `${m[1]}:${m[2]}` : m[1]));
    let checked = 0;
    const bad: string[] = [];
    for (const { where, block } of blocks) for (const [i, v] of block.variants.entries()) {
      for (const t of new Set(v.flatMap(tokensOf))) {
        const left = v.filter((s) => !tokensOf(s).includes(t));
        if (!left.length) continue;
        checked++;
        if (DANGLING.test(left[0]) || left.slice(1).some((s) => / also /i.test(s))) bad.push(`${where} wording ${i} without {${t}}: "${left[0]}"`);
      }
    }
    expect(checked).toBeGreaterThan(10);
    // The visit block with {price}/{duration}/{address}/{link}/{phone} gone starts on the shop or the service, never on "This service".
    expect(bad.filter((b) => !/This service|this service/.test(b))).toEqual([]);
  });
});

describe('R12 to R16 (S5: the gaps the review found)', () => {
  const strict = (s: string) => copyProblems(s, { strict: true });
  it('R12: an article or "this" before {service} is refused in strict mode only (older wordings are frozen)', () => {
    for (const bad of ['You can book a {service} here.', 'Book an {service}.', 'Book a {svc:fade}.', 'Book the {service} here.', 'Book {a:service} here.', 'Book a {a:service}.']) expect(strict(bad).length, bad).toBeGreaterThan(0);
    expect(strictProblems('You can book a {service} here.').join()).toMatch(/R12/);
    expect(copyProblems('A {service} is listed at {price}.')).toEqual([]);
    expect(strict('A {service} is listed at {price}.').join()).toMatch(/R12/);
  });
  it('R13: a token is not glued to letters, and two tokens are not side by side (with or without a space)', () => {
    for (const bad of ['The {service}s are listed.', 'Pre{shop} cuts.', 'It costs {price} {duration}.', 'Book {price}{duration} today.', 'Book {service}{shop}.', 'Book {service}\n{shop}.']) expect(strictProblems(bad).join(), bad).toMatch(/R13/);
    expect(strictProblems('It costs {price}, and takes {duration}.')).toEqual([]);
    expect(strictProblems('Use the {link:book} link.')).toEqual([]);
  });
  it('R15: {service} is never the subject of a verb and is used once', () => {
    for (const bad of ['{service} is listed at {price}.', '{service} has a price.', 'Open now. {service} puts the hair first.', 'Come in, and {service} is ready.', '{service} and {service} are listed.']) expect(strictProblems(bad).join(), bad).toMatch(/R15/);
    for (const ok of ['The menu includes {service}.', 'Looking for {service}? Ask here.', 'Plan on {duration} for {service}.']) expect(strictProblems(ok), ok).toEqual([]);
  });
  it('R14: clean output, including repeated words and dash runs', () => {
    expect(outputProblems('Looking for Skin Fade? Fresh Cuts lists this service on the menu.')).toEqual([]);
    for (const bad of ['two  spaces', ' lead', 'trail ', 'a {b}', 'x undefined y', 'x null y', 'x NaN y', 'a , b', 'a ,. b', 'Fade..', 'Fade!!', '', 'a a Skin Fade', 'Fade - - now', 'Fade + & now']) expect(outputProblems(bad).length, JSON.stringify(bad)).toBeGreaterThan(0);
    expect(outputProblems('The address is 1 Main St., Brooklyn.')).toEqual([]);
  });
  it('praise, results, health and tattoo sentences are refused', () => {
    for (const bad of [
      '{shop} is the top barbershop around.', 'It is the cleanest cut you will get.', 'Highly recommended by locals.', 'This is recommended for everyone.', 'You will love the way it looks.', "You'll love it.",
      'A scalp massage helps hair grow faster.', 'The towel opens the pores and clears acne.', 'Gentle on the scalp and good for hair health.', 'It makes the scalp healthier.', 'This helps your hair grow.',
      '{service} also works over a tattoo.', 'Cover a Tattoo edge.', 'A tattooed arm is fine.',
    ]) expect(copyProblems(bad, { strict: true, allow: ['fade', 'beard', 'shave'] }).length, bad).toBeGreaterThan(0);
    for (const ok of ['Bring a photo if you have one.', 'Say how much to leave on top.', 'Ask the barber how the color will look as it grows out.']) expect(copyProblems(ok, { strict: true, allow: ['color'] }), ok).toEqual([]);
  });
  it('the token {a:service} no longer exists', () => {
    expect(copyProblems('Book {a:service} here.').join()).toMatch(/unknown/);
  });
});

describe('values: free-text prices, times and addresses (B2, S2)', () => {
  it.each(['$35', '35', '$35.00', '$35+', '$25-$30', '$25 - 30', '£20', '€15,50'].map((v) => [v]))('money: %s', (v) => {
    expect(isMoney(v === '35' ? '$35' : v)).toBe(true);
  });
  it.each(['Call for price', 'Free', 'From $30', 'Varies', 'TBD', '', '$', 'ask us', '$35 per hour', '30 min'])('not money: "%s"', (v) => { expect(isMoney(v)).toBe(false); });
  it.each(['30 min', '45 mins', '1 hour', '1.5 hours', '1h', '1h 30m', '30-45 min', '1 hr 30 min', '15 minutes', '90 min'])('duration: %s', (v) => { expect(isDuration(v)).toBe(true); });
  it.each(['30', 'Varies', 'Call', '', 'about an hour', 'min', '$30', '30 dollars', '1 hour or more'])('not a duration: "%s"', (v) => { expect(isDuration(v)).toBe(false); });
  it.each(['1 Main St, Brooklyn, NY 11201', '12 Main St.', '225 W 5th Ave, Suite 4', '12B Oak Road'])('street address: %s', (v) => { expect(isStreetAddress(v)).toBe(true); });
  it.each(['Mobile - I come to you', 'Houston, TX', 'PO Box 12, Houston', '', 'Brooklyn', 'We come to you - 24 hour', 'Mobile barber, 12 miles around'])('not a street address: "%s"', (v) => { expect(isStreetAddress(v)).toBe(false); });

  const env = lenientEnv(shop());
  const sentence = (text: string, subject: ReturnType<typeof subjectOf>) => resolveSentence(env, text, [], subject, true);
  it('a price or time that is not a real value drops its sentence; a real one is spliced', () => {
    for (const price of ['Call for price', 'Free', 'From $30', '']) expect(sentence('This service is listed at {price}.', subjectOf('Haircut', { price })), price).toBeNull();
    for (const duration of ['Varies', '30', '', 'Call']) expect(sentence('The listed time is {duration}.', subjectOf('Haircut', { duration })), duration).toBeNull();
    expect(segsText(sentence('This service is listed at {price}.', subjectOf('Haircut', { price: '30' }))!)).toBe('This service is listed at $30.');
    expect(segsText(sentence('The listed time is {duration}.', subjectOf('Haircut', { duration: '30 min' }))!)).toBe('The listed time is 30 min.');
  });
  it('a block with a free-text price and time says nothing about either (rendered, 3 designs)', () => {
    for (const price of ['Call for price', 'Free', 'From $30']) for (const duration of ['Varies', '30', 'Ask']) {
      const d = shop({ services: [svc('Beard Trim', { price, duration })] });
      for (const t of ['luxe', 'prime', 'euphoria'] as const) {
        const text = visibleText(get(d, 'services/beard-trim/index.html', t));
        const visit = text.slice(text.indexOf('Beard Trim', text.indexOf('About this service') < 0 ? 0 : 0));
        expect(visit).not.toMatch(/Call for price is|listed at (?:Call|Free|From)|time is (?:Varies|30|Ask)|price: (?:Call|Free|From)/);
        expect(text).not.toMatch(/(?:menu|listed)[^.]*\b(?:Call for price|Varies)\b/);
      }
    }
  });
  it('a city or a mobile "address" is not announced as the shop\'s location; a street address is', () => {
    for (const address of ['Mobile - I come to you', 'Houston, TX']) {
      const d = shop({ contact: { address, email: '' } });
      const text = visibleText(get(d, 'services/skin-fade/index.html'));
      expect(text, address).not.toContain(address);
      expect(text, address).not.toMatch(/The shop is at|find the shop at|Find the shop at/);
    }
    expect(visibleText(get(shop(), 'services/skin-fade/index.html'))).toContain('1 Main St');
  });
  it('S2: the visit text never says the Location page has a map', () => {
    for (const s of SERVICE_VISIT.variants.flat()) expect(s).not.toMatch(/\bmap\b/i);
  });
});

describe('rendering on service pages (pages v2 and web-created only)', () => {
  it('every service page of a web v2 site gets the visit block; the second fade gets its alt block in place of the guide', () => {
    const d = shop();
    const first = visibleText(get(d, 'services/skin-fade/index.html'));
    const second = visibleText(get(d, 'services/low-fade/index.html'));
    const third = visibleText(get(d, 'services/facial/index.html'));
    expect(first).toContain('About this service');
    expect(first).toContain('What it is');
    expect(first).toContain('1 Main St');
    expect(second).toContain('About this service');
    expect(second).not.toContain('What it is'); // the guide is used once per site
    expect(second).toContain('1 Main St');
    expect(third).not.toContain('About this service'); // no guide, no alt: only the visit block
    expect(third).toContain('1 Main St');
    expect(third).toMatch(/Facial/);
  });
  it('the alt block is the library text of the later service\'s kind, and the service list says which service has one', () => {
    const d = shop();
    const alt = resolveBlock(lenientEnv(d), svcCopyKey('Low Fade', 'alt'), null);
    expect(alt).not.toBeNull();
    expect(segsText(alt!.items[0])).not.toContain('Low Fade');
    expect([...serviceAltFor(d, [0, 1, 2])]).toEqual([[1, 'fade']]);
  });
  it('sites that are not pages v2 get none of it', () => {
    const plain = shop({ extraPages: undefined });
    const off = shop({ extraPages: { on: [], serviceGuides: false } });
    for (const d of [plain, off]) {
      expect(serviceTextOn(d)).toBe(false);
      for (const f of ['skin-fade', 'low-fade', 'facial']) {
        const t = visibleText(get(d, `services/${f}/index.html`));
        expect(t, f).not.toContain('1 Main St');
        expect(t, f).not.toMatch(/service menu|listed (?:at|as)|number for the shop|To book/);
      }
      expect(visibleCopyKeys(d, { key: 'services', child: { index: 1 } }, [0, 1, 2])).toEqual([]);
    }
  });
  it('data decides: no price, duration, address, phone or booking link, no sentence about it', () => {
    const d = shop({ services: [svc('Facial')], contact: { address: '', email: '' }, phone: '', bookingUrl: '' });
    const t = visibleText(get(d, 'services/facial/index.html'));
    expect(t).toMatch(/Fresh Cuts lists Facial on its service menu|Looking for Facial\? Fresh Cuts lists this service on the menu/);
    expect(t).not.toMatch(/listed at|price|call|number|address|directions|Go to/i);
  });
  it('hiding the guide section hides the blocks with it', () => {
    const d = shop({ pageSections: { service: { hidden: ['guide'] } } as never });
    expect(visibleText(get(d, 'services/low-fade/index.html'))).not.toContain('1 Main St');
    expect(visibleCopyKeys(d, { key: 'services', child: { index: 1 } }, [0, 1, 2])).toEqual([]);
  });
  it('the editor keys are per service and in the registry sense valid', () => {
    const d = shop();
    expect(visibleCopyKeys(d, { key: 'services', child: { index: 1 } }, [0, 1, 2])).toEqual(['svc.low fade.alt', 'svc.low fade.visit']);
    expect(visibleCopyKeys(d, { key: 'services', child: { index: 2 } }, [0, 1, 2])).toEqual(['svc.facial.visit']);
    for (const k of ['svc.low fade.alt', 'svc.low fade.visit', 'svc.facial.visit']) expect(isCopyKey(k), k).toBe(true);
    expect(copyDefault(d, 'svc.low fade.visit')).toContain('Low Fade');
    expect(copyDefault(d, 'svc.low fade.visit')).not.toContain('Skin Fade');
  });
  it('invalid service keys are not copy keys', () => {
    for (const k of ['svc.Low Fade.visit', 'svc..visit', 'svc.low fade.what', 'svc.facial.alt', 'svc.low  fade.visit', 'service.visit', `svc.${'x'.repeat(200)}.visit`]) expect(isCopyKey(k), k).toBe(false);
    expect(svcTitleKey('  Low   FADE ')).toBe('low fade');
  });
  it('the barber\'s own words for one service replace that page\'s block only, escaped and never linted', () => {
    const d = shop({ copy: { 'svc.low fade.visit': 'Come in <b>and</b> say hi. We are the best.', 'svc.Skin Fade.visit': 'ignored (not canonical)', 'svc.nothing.visit': 'ignored (no such service ok)' } });
    expect(copyOverrides(d).get('svc.low fade.visit')).toContain('say hi');
    expect(copyOverrides(d).has('svc.Skin Fade.visit')).toBe(false);
    const low = get(d, 'services/low-fade/index.html');
    expect(low).toContain('Come in &lt;b&gt;and&lt;/b&gt; say hi. We are the best.');
    expect(low).not.toContain('<b>and</b>');
    expect(main(low)).not.toContain('1 Main St');
    const skin = get(d, 'services/skin-fade/index.html');
    expect(skin).not.toContain('say hi');
    expect(visibleText(skin)).toContain('1 Main St');
  });
  it('at most 60 service overrides count', () => {
    const copy: Record<string, string> = {};
    for (let i = 0; i < 80; i++) copy[`svc.s${i}.visit`] = 'x';
    const d = shop({ copy, services: Array.from({ length: 80 }, (_, i) => svc(`S${i}`)) });
    expect([...copyOverrides(d).keys()].filter((k) => k.startsWith('svc.')).length).toBe(60);
  });
  it('the wording of a block follows the seed and the service, and never changes between renders', () => {
    const d = shop();
    const once = () => get(d, 'services/low-fade/index.html').replace(/published-at" content="\d+"/, '');
    expect(once()).toBe(once());
    const texts = new Set<string>();
    for (let seed = 0; seed < 12; seed++) texts.add(segsText(resolveBlock(lenientEnv({ ...d, extraPages: { on: [], serviceGuides: true, seed } }), svcCopyKey('Skin Fade', 'visit'), null)!.items[0]));
    expect(texts.size).toBe(3); // all three wordings are reachable
  });
});

describe('B0 and B1 over awkward titles (3 designs): the name once, and the grammar holds', () => {
  const TITLES = ['Braids', 'The Works', 'MVP Cut', 'Beard Trim', 'Fade + Beard', "Kids' Cut", 'Line-Up', 'Highlights', 'Skin Fades', 'Waxing', 'Eyebrows', 'X-Fade', '80s Fade', 'HD Line Up', 'U-Cut', 'Kids Cuts', 'Hot Towel Shave', 'Cut & Beard', 'haircut.', 'FADE', 'a Skin Fade'];
  const mentions = (text: string, title: string) => text.split(title).length - 1;
  it('the visit text names the service at most once, whatever the title, and reads as sentences', () => {
    for (const title of TITLES) for (const seed of [1, 2, 3, 4, 5, 6]) {
      const d = shop({ services: [svc(title, { price: '$20', duration: '30 min' })], extraPages: { on: [], serviceGuides: true, seed } });
      const b = resolveBlock(lenientEnv(d), svcCopyKey(title, 'visit'), null);
      expect(b, title).not.toBeNull();
      const text = segsText(b!.items[0]);
      const bare = title.replace(/[.!?,;:]+$/, '');
      expect(mentions(text, bare), `${title}: ${text}`).toBeLessThanOrEqual(1);
      expect(outputProblems(text.replace(/\bundefined\b/g, 'x')), `${title}: ${text}`).toEqual([]);
      expect(text, title).not.toMatch(/\b(?:an?|the) (?:Braids|The Works|MVP|Highlights|Skin Fades|Waxing|Eyebrows|Kids)/);
      // a sentence starts with a capital letter
      for (const sentence of text.split(/(?<=[.?!])\s+/)) expect(sentence, `${title}: ${text}`).toMatch(/^[A-Z0-9(]/);
    }
  });
  it('a whole rendered service page gains at most one mention of the service from the visit block, in 3 designs', () => {
    for (const title of TITLES.filter((t) => !/[.]$|^a /.test(t))) {
      const web = shop({ services: [svc(title, { price: '$20', duration: '30 min' }), svc(`${title} Two`, { price: '$25' })] });
      const { source: _s, ...rest } = web;
      void _s;
      for (const t of ['luxe', 'prime', 'euphoria'] as const) {
        const withText = renderSiteBundle({ ...web, template: t }, {}).pages;
        const without = renderSiteBundle({ ...(rest as WebsiteData), template: t }, {}).pages; // the same site made in the iOS app: no visit text
        for (const p of withText) {
          if (!p.path.startsWith('services/') || p.path === 'services/index.html') continue;
          const name = p.path.includes('two') ? `${title} Two` : title;
          const delta = visibleText(p.html).split(name).length - visibleText(without.find((x) => x.path === p.path)!.html).split(name).length;
          expect(delta, `${t} ${p.path}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
  it('S1: punctuation that ends a title never lands in the middle of a sentence; the sentence starts with a capital', () => {
    for (const title of ['haircut.', 'fade!', 'edge up?', 'beard, ', 'taper;']) for (const seed of [1, 2, 3, 4, 5, 6]) {
      const d = shop({ shopName: 'fresh cuts.', services: [svc(title, { price: '$20' })], extraPages: { on: [], serviceGuides: true, seed } });
      const b = resolveBlock(lenientEnv(d), svcCopyKey(title, 'visit'), null);
      const text = segsText(b!.items[0]);
      expect(text, `${title}: ${text}`).not.toMatch(/[.!?;,]\s+(?:is|has)\b/);
      expect(text, `${title}: ${text}`).not.toMatch(/\w[.!?;,],/);
      expect(outputProblems(text), `${title}: ${text}`).toEqual([]);
      for (const sentence of text.split(/(?<=[.?!])\s+/)) expect(sentence).toMatch(/^[A-Z0-9(]/);
    }
  });
});

describe('clean text and escaping over awkward titles (3 designs)', () => {
  const TITLES = ['Skin  Fade', 'Cut &  Beard.', 'undefined', 'null cut', "Boys' Cut", '<img src=x onerror=alert(1)> Fade', 'Fade, Taper', 'Fade.', 'Edge Up!', 'Eyebrow Cleanup', 'a a Fade', 'Fade - - Cut'];
  it('no doubled space, no stray punctuation, no braces, no "undefined" in what a block writes; markup stays inert', () => {
    for (const title of TITLES) {
      const d = shop({ services: [svc(title, { price: '$10', duration: '20 min' }), svc(`${title} Two`, { price: '$12' })], contact: { address: '12 Main St.', email: '' }, shopName: 'Fresh &  Cuts' });
      for (const t of ['luxe', 'prime', 'euphoria'] as const) {
        for (const k of [svcCopyKey(title, 'visit'), svcCopyKey(`${title} Two`, 'visit'), svcCopyKey(`${title} Two`, 'alt')]) {
          const b = resolveBlock(lenientEnv({ ...d, template: t }), k, null);
          if (!b) continue;
          for (const item of b.items) {
            const text = segsText(item);
            expect(outputProblems(text.replace(/\bundefined\b|\bnull\b/g, 'x'), { repeats: false }), `${t} ${title}: ${text}`).toEqual([]);
            expect(text).not.toMatch(/[{}]/);
          }
        }
        for (const p of renderSiteBundle({ ...d, template: t }, {}).pages) expect(p.html, `${t} ${title} ${p.path}`).not.toContain('<img src=x');
      }
    }
  });
  it('an address that ends in a full stop does not end its sentence with two', () => {
    const d = shop({ contact: { address: '12 Main St.', email: '' } });
    const t = visibleText(get(d, 'services/skin-fade/index.html'));
    expect(t).not.toContain('St..');
    expect(t).not.toContain('12 Main St'); // an address that ends in punctuation fails the whitelist: the sentence is omitted, not repaired
  });
});

describe('honesty over rendered service pages: 20 shops x 3 designs, with later services of a kind', () => {
  const BAN = /\b(premium|luxury|best|award|expert|world-class|state-of-the-art|unmatched|unrivaled|finest|top-rated|#1|guarantee|licensed|certified|since|walk-?ins?|parking|free|complimentary|satisfaction|perfect|years of|established|our team|we |our |tattoo|recommended)/i;
  const TITLES = ['Skin Fade', 'Low Fade', 'Haircut', 'Senior Haircut', 'Taper', 'Taper Fade', 'Line Up', 'Edge Up', 'Beard Trim', 'Beard Shape', 'Hot Towel Shave', 'Head Shave', 'Kids Cut', 'Junior Cut', 'Hair Design', 'Color', 'Grey Blending', 'Haircut & Beard', 'Cut and Beard', 'Facial'];
  const shops: WebsiteData[] = Array.from({ length: 20 }, (_, i) => shop({
    shopName: `Shop ${i}`, area: i % 3 === 0 ? '' : `Town${i}, TX`,
    services: TITLES.filter((_t, j) => (i + j) % 3 !== 0 || j < 2).slice(0, 12).map((t, j) => svc(t, { price: j % 2 ? 'Call for price' : `$${10 + j}`, duration: j % 3 ? 'Varies' : '30 min' })),
    phone: i % 4 === 0 ? '' : '(512) 555-0100', bookingUrl: i % 5 === 0 ? '' : '/book',
    contact: { address: i % 7 === 0 ? 'Mobile - I come to you' : `${i + 1} Main St`, email: '' },
    extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: i * 31 },
  }));
  it.each(['luxe', 'prime', 'euphoria'] as const)('%s: no banned word, no unclean text, no free-text price or time', (template) => {
    let withAlt = 0;
    for (const d of shops) {
      const alts = serviceAltFor(d, d.services.map((_s, i) => i));
      withAlt += alts.size;
      for (const p of renderSiteBundle({ ...d, template }, {}).pages) {
        if (!p.path.startsWith('services/') || p.path === 'services/index.html') continue;
        const text = visibleText(p.html);
        expect(text, `${d.shopName} ${p.path}`).not.toMatch(BAN);
        expect(text, `${d.shopName} ${p.path}`).not.toMatch(/undefined|\{|\}|\s,|\.\./);
        expect(text, `${d.shopName} ${p.path}`).not.toMatch(/(?:listed at|shows|Menu price:|time listed|Time on the menu:|Plan on|shop is at|shop at|Shop address:)\s+(?:Call for price|Varies|Mobile)/);
      }
    }
    expect(withAlt).toBeGreaterThan(10);
  });
});

describe('S8: only web-created sites get any of it', () => {
  it('without the web marker a pages-v2 site with service guides gets no visit text, no alt text and no editor keys', () => {
    const { source: _s, ...ios } = shop();
    void _s;
    for (const d of [ios as WebsiteData, shop({ source: 'ios' }), shop({ source: '' }), shop({ source: 'Web-App' })]) {
      expect(serviceTextOn(d)).toBe(false);
      expect([...serviceAltFor(d, [0, 1, 2])]).toEqual([]);
      expect(visibleCopyKeys(d, { key: 'services', child: { index: 1 } }, [0, 1, 2]).filter((k) => k.startsWith('svc.'))).toEqual([]);
      for (const f of ['skin-fade', 'low-fade', 'facial']) expect(visibleText(get(d, `services/${f}/index.html`)), f).not.toContain('1 Main St');
    }
  });
  it('with the marker it is on', () => { expect(serviceTextOn(shop())).toBe(true); });
});
