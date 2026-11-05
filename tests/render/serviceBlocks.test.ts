// The service page blocks (Phase 1, step 1): `service visit` and `service alt` in the library, the {a:service} token, and
// the strict rules R12 (article), R13 (token form) and R14 (clean output). Every sentence of every wording is linted;
// the blocks are then rendered on service pages and checked for gating, per-service keys, overrides, escaping and clean text.
import { describe, expect, it } from 'vitest';
import { GUIDES, GUIDE_IDS, SERVICE_ALT, SERVICE_VISIT, type Block, type GuideId } from '../../lib/render/copyLibrary';
import { copyProblems, outputProblems, serviceWordsIn, strictProblems } from '../../lib/render/copyRules';
import {
  articleFor, copyDefault, copyOverrides, isCopyKey, lenientEnv, resolveBlock, resolveSentence, segsText, serviceAltFor, serviceTextOn,
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
  ...extra,
});
const get = (d: WebsiteData, path: string, template: 'luxe' | 'prime' | 'euphoria' = 'luxe') => renderSiteBundle({ ...d, template }, { siteBaseUrl: 'https://fresh.example.com' }).pages.find((p) => p.path === path)?.html ?? '';
const main = (html: string) => /<main[\s\S]*?<\/main>/.exec(html)?.[0] ?? html;
const visibleText = (html: string) => main(html).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');

interface Row { where: string; text: string; allow: GuideId[] | VocabAllow }
type VocabAllow = Parameters<typeof copyProblems>[1] extends infer O ? (O extends { allow?: infer A } ? A : never) : never;
const blocks: { where: string; block: Block; guide: GuideId | null }[] = [
  { where: 'service.visit', block: SERVICE_VISIT, guide: null },
  ...GUIDE_IDS.map((g) => ({ where: `service.alt.${g}`, block: SERVICE_ALT[g], guide: g as GuideId | null })),
];
void ({} as Row);

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
  it(`every sentence passes R1 to R14 (strict): ${rows.length} sentences`, () => {
    expect(rows.length).toBeGreaterThan(100);
    const bad = rows.map((r) => ({ r, p: copyProblems(r.text, { allow: r.allow, strict: true }) })).filter((x) => x.p.length).map((x) => `${x.r.where}: "${x.r.text}" -> ${x.p.join('; ')}`);
    expect(bad).toEqual([]);
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
  it('the alt block of a kind reads right for the services of that kind: its first sentence names the kind through {service}, once per wording', () => {
    for (const g of GUIDE_IDS) for (const v of SERVICE_ALT[g].variants) expect(v[0], g).toMatch(/\{service\}/);
  });
  it('K4: dropping any one token (or the service group) leaves a first sentence that stands on its own', () => {
    const DANGLING = /^(?:also|it|its|then|the other)\b|\balso\b/i;
    const GROUP: Record<string, string[]> = { service: ['service', 'price', 'duration', 'a:service'] };
    const tokensOf = (s: string) => [...s.matchAll(/\{([A-Za-z]+)(?::([a-z-]+))?\}/g)].map((m) => (m[2] ? `${m[1]}:${m[2]}` : m[1]));
    let checked = 0;
    const bad: string[] = [];
    for (const { where, block } of blocks) for (const [i, v] of block.variants.entries()) {
      for (const t of new Set(v.flatMap(tokensOf))) {
        const gone = new Set(GROUP[t] ?? [t]);
        const left = v.filter((s) => !tokensOf(s).some((x) => gone.has(x)));
        if (!left.length) continue;
        checked++;
        if (DANGLING.test(left[0]) || left.slice(1).some((s) => / also /i.test(s))) bad.push(`${where} wording ${i} without {${t}}: "${left[0]}"`);
      }
    }
    expect(checked).toBeGreaterThan(40);
    expect(bad).toEqual([]);
  });
});

describe('R12 to R14', () => {
  it('R12: "a {service}" and "an {service}" are refused in strict mode only (older wordings are frozen)', () => {
    expect(strictProblems('You can book a {service} here.').join()).toMatch(/R12/);
    expect(strictProblems('Book an {service}.').join()).toMatch(/R12/);
    expect(strictProblems('Book a {svc:fade}.').join()).toMatch(/R12/);
    expect(strictProblems('Book {a:service} here.')).toEqual([]);
    expect(copyProblems('A {service} is listed at {price}.')).toEqual([]);
    expect(copyProblems('A {service} is listed at {price}.', { strict: true }).join()).toMatch(/R12/);
  });
  it('R13: a token is not glued to letters, and two tokens are not side by side', () => {
    expect(strictProblems('The {service}s are listed.').join()).toMatch(/R13/);
    expect(strictProblems('Pre{shop} cuts.').join()).toMatch(/R13/);
    expect(strictProblems('It costs {price} {duration}.').join()).toMatch(/R13/);
    expect(strictProblems('It costs {price}, and takes {duration}.')).toEqual([]);
    expect(strictProblems('Use the {link:book} link.')).toEqual([]);
  });
  it('R14: clean output', () => {
    expect(outputProblems('Skin Fade is listed at $35.')).toEqual([]);
    for (const bad of ['two  spaces', ' lead', 'trail ', 'a {b}', 'x undefined y', 'x null y', 'x NaN y', 'a , b', 'a ,. b', 'Fade..', 'Fade!!', '']) expect(outputProblems(bad).length, JSON.stringify(bad)).toBeGreaterThan(0);
    expect(outputProblems('The address is 1 Main St., Brooklyn.')).toEqual([]);
  });
  it('the token {a:service} is known; other {a:...} are not', () => {
    expect(copyProblems('Book {a:service} here.')).toEqual([]);
    expect(copyProblems('Book {a:shop} here.').join()).toMatch(/unknown/);
  });
});

describe('{a:service}', () => {
  it.each([
    ['Skin Fade', 'a'], ['Eyebrow Cleanup', 'an'], ['Uniform Trim', 'a'], ['Hour Cut', 'an'], ['Edge Up', 'an'], ['8 Minute Cut', 'an'], ['5 Minute Cut', 'a'],
    ['Under Cut', 'an'], ['Unit Trim', 'a'], ['"Quoted" Cut', 'a'], ['', 'a'],
  ])('%s -> %s', (title, art) => { expect(articleFor(title)).toBe(art); });
  const d = shop();
  const env = lenientEnv(d);
  it('writes the article and the title together, and drops the sentence with no title', () => {
    const subject = { index: 0, title: 'Eyebrow Cleanup', price: '$10', duration: '', guide: null };
    expect(segsText(resolveSentence(env, 'To book {a:service}, use the {link:book} link.', [], subject, true)!)).toBe('To book an Eyebrow Cleanup, use the Book now link.');
    expect(resolveSentence(env, 'To book {a:service}, use the {link:book} link.', [], null, true)).toBeNull();
  });
});

describe('rendering on service pages (pages v2 only)', () => {
  it('every service page of a v2 site gets the visit block; the second fade gets its alt block in place of the guide', () => {
    const d = shop();
    const first = visibleText(get(d, 'services/skin-fade/index.html'));
    const second = visibleText(get(d, 'services/low-fade/index.html'));
    const third = visibleText(get(d, 'services/facial/index.html'));
    expect(first).toContain('About this service');
    expect(first).toContain('What it is');
    expect(first).toContain('1 Main St');
    expect(second).toContain('About this service');
    expect(second).not.toContain('What it is'); // the guide is used once per site
    expect(second).toContain('Low Fade');
    expect(second).toContain('1 Main St');
    expect(third).not.toContain('About this service'); // no guide, no alt: only the visit block
    expect(third).toContain('1 Main St');
    expect(third).toMatch(/Facial/);
  });
  it('the alt block is the library text of the second service\'s kind', () => {
    const d = shop();
    const alt = resolveBlock(lenientEnv(d), svcCopyKey('Low Fade', 'alt'), null);
    expect(alt).not.toBeNull();
    expect(segsText(alt!.items[0])).toContain('Low Fade');
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
        expect(t, f).not.toMatch(/service menu|service list|listed (?:at|as)|number for the shop|To book/);
      }
      expect(visibleCopyKeys(d, { key: 'services', child: { index: 1 } }, [0, 1, 2])).toEqual([]);
    }
  });
  it('data decides: no price, duration, address, phone or booking link, no sentence about it', () => {
    const d = shop({ services: [svc('Facial')], contact: { address: '', email: '' }, phone: '', bookingUrl: '' });
    const t = visibleText(get(d, 'services/facial/index.html'));
    expect(t).toMatch(/Facial is available at Fresh Cuts|You can book a Facial at Fresh Cuts|At Fresh Cuts, Facial is on the service menu/);
    expect(t).not.toMatch(/listed|call|number|address|directions|link/i);
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
    expect(get(d, 'services/low-fade/index.html').replace(/published-at" content="\d+"/, '')).toBe(get(d, 'services/low-fade/index.html').replace(/published-at" content="\d+"/, ''));
    const texts = new Set<string>();
    for (let seed = 0; seed < 12; seed++) texts.add(segsText(resolveBlock(lenientEnv({ ...d, extraPages: { on: [], serviceGuides: true, seed } }), svcCopyKey('Skin Fade', 'visit'), null)!.items[0]));
    expect(texts.size).toBe(3); // all three wordings are reachable
  });
});

describe('clean text and escaping over awkward titles (3 designs)', () => {
  const TITLES = ['Skin  Fade', 'Cut &  Beard.', 'undefined', 'null cut', "Boys' Cut", '<img src=x onerror=alert(1)> Fade', 'Fade, Taper', 'Fade.', 'Edge Up!', 'Eyebrow Cleanup'];
  it('no doubled space, no stray punctuation, no braces, no "undefined" in what a block writes; markup stays inert', () => {
    for (const title of TITLES) {
      const d = shop({ services: [svc(title, { price: '$10', duration: '20 min' }), svc(`${title} Two`, { price: '$12' })], contact: { address: '12 Main St.', email: '' }, shopName: 'Fresh &  Cuts' });
      for (const t of ['luxe', 'prime', 'euphoria'] as const) {
        for (const k of [svcCopyKey(title, 'visit'), svcCopyKey(`${title} Two`, 'visit'), svcCopyKey(`${title} Two`, 'alt')]) {
          const b = resolveBlock(lenientEnv({ ...d, template: t }), k, null);
          if (!b) continue;
          for (const item of b.items) {
            const text = segsText(item);
            // sentences are joined by single spaces; the check is on every sentence that survived
            expect(outputProblems(text.replace(/\bundefined\b|\bnull\b/g, 'x')), `${t} ${title}: ${text}`).toEqual([]);
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
    expect(t).toContain('12 Main St');
    expect(t).not.toContain('St..');
  });
});

describe('honesty over rendered service pages: 20 shops x 3 designs, with second services of a kind', () => {
  const BAN = /\b(premium|luxury|best|award|expert|world-class|state-of-the-art|unmatched|unrivaled|finest|top-rated|#1|guarantee|licensed|certified|since|walk-?ins?|parking|free|complimentary|satisfaction|perfect|years of|established|our team|we |our )/i;
  const TITLES = ['Skin Fade', 'Low Fade', 'Haircut', 'Senior Haircut', 'Taper', 'Taper Fade', 'Line Up', 'Edge Up', 'Beard Trim', 'Beard Shape', 'Hot Towel Shave', 'Head Shave', 'Kids Cut', 'Junior Cut', 'Hair Design', 'Color', 'Grey Blending', 'Haircut & Beard', 'Cut and Beard', 'Facial'];
  const shops: WebsiteData[] = Array.from({ length: 20 }, (_, i) => shop({
    shopName: `Shop ${i}`, area: i % 3 === 0 ? '' : `Town${i}, TX`,
    services: TITLES.filter((_t, j) => (i + j) % 3 !== 0 || j < 2).slice(0, 12).map((t, j) => svc(t, { price: j % 2 ? '' : `$${10 + j}`, duration: j % 3 ? '' : '30 min' })),
    phone: i % 4 === 0 ? '' : '(512) 555-0100', bookingUrl: i % 5 === 0 ? '' : '/book',
    contact: { address: i % 7 === 0 ? '' : `${i} Main St`, email: '' },
    extraPages: { on: ['faq', 'first-visit'], serviceGuides: true, seed: i * 31 },
  }));
  it.each(['luxe', 'prime', 'euphoria'] as const)('%s: no banned word, no unclean text', (template) => {
    let alts = 0;
    for (const d of shops) {
      for (const p of renderSiteBundle({ ...d, template }, {}).pages) {
        if (!p.path.startsWith('services/') || p.path === 'services/index.html') continue;
        const text = visibleText(p.html);
        expect(text, `${d.shopName} ${p.path}`).not.toMatch(BAN);
        expect(text, `${d.shopName} ${p.path}`).not.toMatch(/undefined|\{|\}|\s,|\.\./);
        if (/ is (?:another|a second|one more)|its own|separate|own entry|own line|listed separately|a service of its own/.test(text)) alts++;
      }
    }
    expect(alts).toBeGreaterThan(10);
  });
});
