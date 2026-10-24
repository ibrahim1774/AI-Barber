// guides.ts and the pages it feeds (plan 2026-10-24, section 6e): matching, wordings, overrides, token drop,
// escaping, "only listed services are named", and the honesty fuzz over rendered pages.
import { describe, expect, it } from 'vitest';
import { GUIDES, GUIDE_IDS, type GuideId } from '../../lib/render/copyLibrary';
import {
  COPY_KEYS, copyDefault, copyOverrides, faqDataQuestions, guideIdForTitle, isBeardTitle, isHaircutTitle, lenientEnv, resolveBlock, resolveSentence,
  serviceGuideFor, variantIndex, visibleCopyKeys, beardServices, segsText,
} from '../../lib/render/guides';
import { renderSiteBundle } from '../../lib/render/site';
import { extraPageRows } from '../../lib/render/pages';
import type { WebsiteData } from '../../types';

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });
const shop = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' },
  about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Skin Fade', { price: '$35', duration: '45 min' }), svc('Beard Trim', { price: '$15' }), svc('Kids Cut', { price: '$20' })],
  gallery: [], hours: [{ day: 'Mon', open: '09:00', close: '17:00' }, { day: 'Tue', open: '09:00', close: '17:00' }, { day: 'Sun', open: '', close: '', closed: true }],
  contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  pages: { order: [], hidden: [] },
  extraPages: { on: ['faq', 'first-visit', 'hair-care', 'beard-care'], serviceGuides: true, seed: 7 },
  ...extra,
});
const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ');
const main = (html: string) => /<main[\s\S]*?<\/main>/.exec(html)?.[0] ?? html;
const get = (d: WebsiteData, path: string, template: 'luxe' | 'prime' | 'euphoria' = 'luxe') => renderSiteBundle({ ...d, template }, { siteBaseUrl: 'https://fresh.example.com' }).pages.find((p) => p.path === path)?.html ?? '';

describe('matching a service to a guide', () => {
  it.each<[string, GuideId | null]>([
    ['Haircut & Beard', 'cut-beard'], ['Cut and Beard', 'cut-beard'],
    ['Skin Fade', 'fade'], ['Low Fade', 'fade'], ['Taper', 'taper'], ['Taper Fade', 'fade'],
    ['Line Up', 'line-up'], ['Shape-Up', 'line-up'], ['Edge up', 'line-up'], ['Beard Line Up', 'line-up'],
    ['Beard Trim', 'beard-trim'], ['Beard Shape', 'beard-trim'],
    ['Hot Towel Shave', 'shave'], ['Straight Razor', 'shave'], ['Head Shave', 'shave'],
    ['Kids Cut', 'kids-cut'], ["Boys' Haircut", 'kids-cut'], ['Junior Cut', 'kids-cut'],
    ['Hair Design', 'design'], ['Color', 'color'], ['Colour', 'color'], ['Grey Blending', 'color'], ['Highlights', 'color'],
    ['Haircut', 'haircut'], ['Clipper Cut', 'haircut'], ['Scissor Cut', 'haircut'],
    ['Facial', null], ['', null],
  ])('%s -> %s', (title, guide) => { expect(guideIdForTitle(title)).toBe(guide); });
  it('haircut-type and beard-type', () => {
    expect(isHaircutTitle('Skin Fade')).toBe(true);
    expect(isHaircutTitle('Hot Towel Shave')).toBe(false);
    expect(isBeardTitle('Hot Towel Shave')).toBe(true);
    expect(isBeardTitle('Haircut & Beard')).toBe(true);
    expect(isBeardTitle('Skin Fade')).toBe(false);
  });
  it('a guide is used once per site: the first service of its kind gets it', () => {
    const d = shop({ services: [svc('Skin Fade'), svc('Low Fade'), svc('Taper'), svc('Mid Fade')] });
    expect([...serviceGuideFor(d, [0, 1, 2, 3])]).toEqual([[0, 'fade'], [2, 'taper']]);
    expect([...serviceGuideFor({ ...d, extraPages: { on: [], serviceGuides: false } }, [0, 1, 2, 3])]).toEqual([]);
    expect([...serviceGuideFor({ ...d, extraPages: undefined }, [0, 1, 2, 3])]).toEqual([]);
  });
});

describe('choosing a wording', () => {
  it('no seed -> 0; a seed gives a stable 0 to 2; a pick wins; bad picks are ignored', () => {
    expect(variantIndex({}, 'faq.book')).toBe(0);
    expect(variantIndex({ extraPages: { on: [] } }, 'faq.book')).toBe(0);
    const a = variantIndex({ extraPages: { on: [], seed: 7 } }, 'guide.fade.what');
    expect(a).toBe(variantIndex({ extraPages: { on: [], seed: 7 } }, 'guide.fade.what'));
    const seen = new Set(COPY_KEYS.map((k) => variantIndex({ extraPages: { on: [], seed: 7 } }, k)));
    expect([...seen].sort()).toEqual([0, 1, 2]);
    expect(variantIndex({ extraPages: { on: [], seed: 7, pick: { 'guide.fade.what': 2 } } }, 'guide.fade.what')).toBe(2);
    expect(variantIndex({ extraPages: { on: [], seed: 7, pick: { 'guide.fade.what': 5 } } }, 'guide.fade.what')).toBe(a);
  });
  it('the preview and the deploy agree: the same data renders the same bytes', () => {
    const d = shop();
    const stamp = (h: string) => h.replace(/published-at" content="\d+"/, '');
    expect(stamp(get(d, 'services/skin-fade/index.html'))).toBe(stamp(get(d, 'services/skin-fade/index.html')));
  });
  it('try other wording changes the text and nothing else', () => {
    const d = shop({ extraPages: { on: [], serviceGuides: true, seed: 7, pick: { 'guide.fade.what': 0 } } });
    const e = shop({ extraPages: { on: [], serviceGuides: true, seed: 7, pick: { 'guide.fade.what': 1 } } });
    expect(copyDefault(d, 'guide.fade.what')).not.toBe(copyDefault(e, 'guide.fade.what'));
    expect(get(d, 'services/skin-fade/index.html')).toContain(copyDefault(d, 'guide.fade.what').split('.')[0].replace(/'/g, '&#39;').replace(/’/g, '’'));
  });
});

describe('tokens: only the barber\'s data, a sentence with no value is dropped', () => {
  const env = lenientEnv(shop());
  it('resolves service, price, duration, shop and place', () => {
    const segs = resolveSentence({ ...env, place: 'Brooklyn, NY' }, 'The {service} is listed at {price} for {duration} in {place}, {shop}.', [], { index: 0, title: 'Skin Fade', price: '35', duration: '45 min', guide: 'fade' })!;
    expect(segs.map((s) => (s.t === 'text' ? s.s : s.label)).join('')).toBe('The Skin Fade is listed at $35 for 45 min in Brooklyn, NY, Fresh Cuts.');
  });
  it('a missing price, place, phone or hours drops the sentence', () => {
    const subject = { index: 0, title: 'Skin Fade', price: '', duration: '', guide: 'fade' as const };
    expect(resolveSentence(env, 'It is {price}.', [], subject)).toBeNull();
    expect(resolveSentence(env, 'In {place}.', [], subject)).toBeNull();
    expect(resolveSentence(lenientEnv(shop({ phone: 'call us' })), 'Call {phone}.', [], null)).toBeNull();
    expect(resolveSentence(lenientEnv(shop({ hours: [] })), 'Open {openDays} days.', [], null)).toBeNull();
  });
  it('{svc:x} names the barber\'s own service, or drops the sentence', () => {
    const d = shop();
    const ok = resolveSentence(lenientEnv(d, { serviceHref: (i) => `/services/s${i}/` }), 'Pair it with {svc:fade}.', [], null)!;
    expect(ok.some((s) => s.t === 'link' && s.label === 'Skin Fade' && s.href === '/services/s0/')).toBe(true);
    expect(resolveSentence(lenientEnv(d), 'Pair it with {svc:shave}.', [], null)).toBeNull();
  });
  it('a sentence that breaks a rule is dropped at render time even if it is in the library', () => {
    expect(resolveSentence(env, 'Our best fade in town.', ['fade'], null)).toBeNull();
  });
  it('tokens resolve in one pass: a service called {shop} prints literally', () => {
    const d = shop({ services: [svc('{shop}', { price: '$5' }), svc('Skin Fade', { price: '$35' })] });
    const html = get(d, 'first-visit/index.html');
    expect(html).toContain('{shop}');
    expect(html).not.toContain('Fresh Cuts</a>');
  });
  it('no brace or "undefined" ever reaches a page', () => {
    for (const d of [shop(), shop({ phone: '', hours: [], bookingUrl: '' }), shop({ services: [svc('Haircut')] })]) {
      const r = renderSiteBundle(d, {});
      for (const p of r.pages.filter((x) => /faq|first-visit|hair-care|beard-care|services/.test(x.path))) {
        const t = visible(p.html);
        expect(t, p.path).not.toMatch(/[{}]|undefined|NaN/);
      }
    }
  });
});

describe('the barber\'s own words (copy overrides)', () => {
  it('replace the suggested text, are escaped and never expanded', () => {
    const d = shop({ copy: { 'guide.fade.what': 'My <b>text</b> & {shop} {link:book}' } });
    const html = get(d, 'services/skin-fade/index.html');
    expect(html).toContain('My &lt;b&gt;text&lt;/b&gt; &amp; {shop} {link:book}');
    expect(html).not.toContain('<b>text</b>');
  });
  it('unknown keys are ignored, values are capped by the block, the total is capped', () => {
    const d = shop({ copy: { 'guide.nope.what': 'x', 'guide.fade.nope': 'x', __proto__: 'x', 'guide.fade.what': 'a'.repeat(5000) } as never });
    const o = copyOverrides(d);
    expect([...o.keys()]).toEqual(['guide.fade.what']);
    expect(o.get('guide.fade.what')!.length).toBe(600);
    const big: Record<string, string> = {};
    for (const k of COPY_KEYS) big[k] = 'z'.repeat(600);
    expect(Array.from(copyOverrides(shop({ copy: big })).values()).join('').length).toBeLessThanOrEqual(40000);
  });
  it('an empty override means "reset to suggested"', () => {
    const d = shop({ copy: { 'guide.fade.what': '   ' } });
    expect(copyOverrides(d).size).toBe(0);
    expect(main(get(d, 'services/skin-fade/index.html'))).toContain('ab-copy');
  });
  it('list blocks split on lines, paragraphs on blank lines', () => {
    const d = shop({ copy: { 'first-visit.before': 'one\ntwo', 'hair-care.wash': 'p1\n\np2' } });
    expect(get(d, 'first-visit/index.html')).toContain('<li>one</li><li>two</li>');
    expect(get(d, 'hair-care/index.html')).toContain('<p>p1</p><p>p2</p>');
  });
  it('copyDefault and visibleCopyKeys serve the editor', () => {
    const d = shop();
    expect(copyDefault(d, 'guide.fade.what')).toMatch(/fade/i);
    expect(copyDefault(d, 'nope')).toBe('');
    expect(visibleCopyKeys(d, { key: 'services', child: { index: 0 } }, [0, 1, 2])).toEqual(['guide.fade.what', 'guide.fade.who', 'guide.fade.ask', 'guide.fade.care']);
    expect(visibleCopyKeys(d, { key: 'services', child: { index: 1 } }, [0, 1, 2]).every((k) => k.startsWith('guide.beard-trim.'))).toBe(true);
    expect(visibleCopyKeys(d, { key: 'faq' }).length).toBeGreaterThan(8);
    expect(visibleCopyKeys(d, { key: 'about' })).toEqual([]);
  });
});

describe('suppression and gates', () => {
  it('service guides need extraPages.serviceGuides', () => {
    expect(main(get(shop({ extraPages: { on: [], serviceGuides: false } }), 'services/skin-fade/index.html'))).not.toContain('ab-copy');
    expect(main(get(shop(), 'services/skin-fade/index.html'))).toContain('About this service');
  });
  it('a service with no matching guide gets its real-data page and no guide block', () => {
    const d = shop({ services: [svc('Facial', { price: '$40' })] });
    const html = get(d, 'services/facial/index.html');
    expect(html).toContain('Facial');
    expect(html).not.toContain('About this service');
  });
  it('FAQ counts the questions its data answers', () => {
    expect(faqDataQuestions(shop())).toBeGreaterThanOrEqual(5);
    expect(faqDataQuestions(shop({ phone: '', bookingUrl: '', hours: [], services: [svc('Skin Fade')] }))).toBe(1);
    expect(resolveBlock(lenientEnv(shop({ services: [svc('Skin Fade')] })), 'faq.kids')).toBeNull();
  });
  it('the Hair care how-often lines and Beard care services are the listed services, linked', () => {
    const d = shop();
    const hc = main(get(d, 'hair-care/index.html'));
    expect(hc).toMatch(/<a href="\/services\/skin-fade\/">Skin Fade<\/a>: /);
    expect(hc).toMatch(/<a href="\/services\/kids-cut\/">Kids Cut<\/a>: /);
    expect(hc).not.toContain('Beard Trim</a>:');
    const bc = main(get(d, 'beard-care/index.html'));
    expect(bc).toContain('<a href="/services/beard-trim/">Beard Trim</a>');
    expect(bc).not.toContain('Skin Fade');
  });
  it('link tokens are real anchors into the site, never escaped text', () => {
    const html = get(shop(), 'faq/index.html');
    expect(html).toMatch(/<a href="\/book">Book now<\/a>/);
    expect(html).toMatch(/<a href="\/location\/">Location<\/a>/);
    expect(html).not.toContain('&lt;a href');
  });
  it('a hidden Hours or Location page removes its link sentences', () => {
    const html = get(shop({ pages: { order: [], hidden: ['hours', 'location'] } }), 'faq/index.html');
    expect(html).not.toContain('href="/hours/"');
    expect(html).not.toContain('href="/location/"');
    expect(visible(html)).toMatch(/at 1 Main St|address is 1 Main St/);
  });
});

describe('XSS through data the copy touches', () => {
  const evil = '"><script>alert(1)</script>';
  it('shop, service titles, address, phone, policy and place are escaped in every guide page', () => {
    const d = shop({
      shopName: `Fresh ${evil}`, phone: `(512) 555-0100 ${evil}`, contact: { address: `1 Main ${evil}`, email: '' },
      services: [svc(`Skin Fade ${evil}`, { price: `$35${evil}`, duration: `45${evil}` }), svc(`Kids Cut ${evil}`, { price: '$20' }), svc(`Haircut & Beard ${evil}`)],
      policy: { title: 't', body: `Cancel early ${evil}` },
      labels: { pgPlace: evil } as never,
    });
    for (const t of ['luxe', 'prime', 'euphoria'] as const) {
      for (const p of renderSiteBundle({ ...d, template: t }, {}).pages) expect(p.html, `${t} ${p.path}`).not.toContain('<script>alert');
    }
  });
});

describe('only listed services are named (plan 6e)', () => {
  // Shops that list one service of every other guide. Some services legitimately bring their own words: a shave or a
  // beard service brings the Beard care page ("beard"), a cut-and-beard service the word beard.
  const TITLE: Record<GuideId, string> = {
    'cut-beard': 'Haircut & Beard', fade: 'Skin Fade', taper: 'Taper', 'line-up': 'Line Up', 'beard-trim': 'Beard Trim', shave: 'Hot Towel Shave',
    'kids-cut': 'Kids Cut', design: 'Hair Design', color: 'Color', haircut: 'Haircut',
  };
  const BRINGS: Partial<Record<GuideId, GuideId[]>> = { 'beard-trim': ['cut-beard', 'shave'] };
  for (const g of GUIDE_IDS.filter((x) => x !== 'haircut')) {
    it(`${g}: no page names it when the shop does not list it`, () => {
      const others = GUIDE_IDS.filter((x) => x !== g && !(BRINGS[g] ?? []).includes(x));
      const services = others.map((x) => svc(TITLE[x], { price: '$10', duration: '30 min' }));
      for (const template of ['luxe', 'prime', 'euphoria'] as const) {
        const r = renderSiteBundle({ ...shop({ services, bookingUrl: '/book' }), template }, {});
        expect(r.pages.length).toBeGreaterThan(8);
        for (const p of r.pages) {
          if (p.path === 'index.html') continue;
          const text = visible(p.html).toLowerCase();
          for (const m of GUIDES[g].mentions) {
            // a service the shop lists may itself carry the word (its own title); the library copy may not
            const hit = text.includes(m) && !services.some((s) => s.title.toLowerCase().includes(m));
            expect(hit, `${template} ${p.path} names "${m}"`).toBe(false);
          }
        }
      }
    });
  }
});

describe('honesty over rendered pages: 20 shops x 3 designs', () => {
  const BAN = /\b(premium|luxury|best|award|expert|world-class|state-of-the-art|unmatched|unrivaled|finest|top-rated|#1|guarantee|licensed|certified|since|walk-?ins?|parking|free|complimentary|satisfaction|perfect|years of|established|our team|we |our )/i;
  const TITLES = ['Skin Fade', 'Haircut', 'Taper', 'Line Up', 'Beard Trim', 'Hot Towel Shave', 'Kids Cut', 'Hair Design', 'Color', 'Haircut & Beard', 'Low Fade', 'Buzz Cut'];
  const shops: WebsiteData[] = Array.from({ length: 20 }, (_, i) => shop({
    shopName: `Shop ${i}`, area: i % 3 === 0 ? '' : `Town${i}, TX`,
    services: TITLES.filter((_t, j) => (i + j) % 3 !== 0 || j === 0).map((t, j) => svc(t, { price: j % 2 ? '' : `$${10 + j}`, duration: j % 3 ? '' : '30 min' })),
    phone: i % 4 === 0 ? '' : '(512) 555-0100', bookingUrl: i % 5 === 0 ? '' : '/book',
    hours: i % 6 === 0 ? [] : [{ day: 'Mon', open: '09:00', close: '17:00' }],
    extraPages: { on: ['faq', 'first-visit', 'hair-care', 'beard-care'], serviceGuides: true, seed: i * 31 },
  }));
  it.each(['luxe', 'prime', 'euphoria'] as const)('%s: no banned word on any page the library writes', (template) => {
    for (const d of shops) {
      for (const p of renderSiteBundle({ ...d, template }, {}).pages) {
        if (!/^(faq|first-visit|hair-care|beard-care)\//.test(p.path) && !p.path.startsWith('services/')) continue;
        const main = /<main[\s\S]*?<\/main>/.exec(p.html)?.[0] ?? p.html;
        expect(visible(main), `${d.shopName} ${p.path}`).not.toMatch(BAN);
      }
    }
  });
  it('every page of every shop has a unique title and every internal link is a file', () => {
    for (const d of shops) {
      const r = renderSiteBundle(d, {});
      const files = new Set(r.pages.map((p) => p.path));
      const titles = r.pages.map((p) => /<title>([\s\S]*?)<\/title>/.exec(p.html)?.[1]);
      expect(new Set(titles).size, d.shopName).toBe(titles.length);
      for (const p of r.pages) for (const m of p.html.matchAll(/href="(\/[^"#?]*)"/g)) {
        if (m[1] === '/book' || m[1] === '/styles.css') continue;
        expect(files.has(m[1] === '/' ? 'index.html' : `${m[1].slice(1)}index.html`), `${d.shopName} ${p.path} -> ${m[1]}`).toBe(true);
      }
    }
  });
});

// ── Phase B review fixes (K1 to K4, M3, M5, M10) ────────────────────────────────────────────────
describe('K1: service titles that must not borrow the wrong guide', () => {
  it.each<[string, GuideId | null]>([
    ['Fade + eyebrows combo', 'fade'], ['Kids combo', 'kids-cut'], ['Junior barber cut', 'haircut'],
    ['Eyebrow trim', null], ['Mustache trim', null], ['Neck trim', null],
    ['Beard dye', 'color'], ['Beard color', 'color'], ['Grey beard blending', 'color'],
    ['Beard shave', 'shave'], ['Hot Towel Facial', null], ['Razor part', 'design'],
    ['Shave & haircut', 'haircut'], ['Fade and beard trim', 'cut-beard'], ['Fade & beard', 'cut-beard'],
    ['Haircut & Beard', 'cut-beard'], ['Cut and Beard', 'cut-beard'], ['Hair Cut with a Beard', 'cut-beard'], ['Gentleman Combo', null],
    ['Skin Fade', 'fade'], ['Beard Trim', 'beard-trim'], ['Beard Shape', 'beard-trim'], ['Hot Towel Shave', 'shave'], ['Head Shave', 'shave'],
    ['Kids Cut', 'kids-cut'], ['Junior Cut', 'kids-cut'], ['Juniors', 'kids-cut'], ['Haircut', 'haircut'], ['Buzz Cut', 'haircut'], ['Clipper Cut', 'haircut'],
    ['Beard Line Up', 'line-up'], ['Hair Design', 'design'], ['Highlights', 'color'],
  ])('%s -> %s', (title, guide) => { expect(guideIdForTitle(title)).toBe(guide); });
  it('a wrong match no longer uses up a guide for the real service below it', () => {
    const d = shop({ services: [svc('Eyebrow trim'), svc('Neck trim'), svc('Haircut')] });
    expect([...serviceGuideFor(d, [0, 1, 2])]).toEqual([[2, 'haircut']]);
  });
});

describe('K2: {openDays} counts distinct open days', () => {
  const week = (over: Record<string, Partial<{ open: string; close: string; closed: boolean }>> = {}) =>
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => ({ day, open: '09:00', close: '17:00', ...(over[day] ?? {}) }));
  const answer = (hours: WebsiteData['hours'], v: 0 | 1 | 2) => {
    const d = shop({ hours, extraPages: { on: [], seed: 1, pick: { 'faq.hours': v } } });
    const b = resolveBlock(lenientEnv(d), 'faq.hours');
    return b ? b.items.map((it) => it.map((s) => (s.t === 'text' ? s.s : s.label)).join('')).join(' ') : null;
  };
  it.each([0, 1, 2] as const)('wording %i: six open days, one closed', (v) => {
    expect(answer(week({ Sun: { closed: true } }), v)).toMatch(/\b6\b/);
  });
  it.each([0, 1, 2] as const)('wording %i: one open day reads as 1 of the seven days, never "1 days"', (v) => {
    const closed = { Mon: { closed: true }, Tue: { closed: true }, Wed: { closed: true }, Thu: { closed: true }, Fri: { closed: true }, Sat: { closed: true } };
    const t = answer(week(closed), v)!;
    expect(t).toMatch(/\b1\b/);
    expect(t).toMatch(/seven days/);
    expect(t).not.toMatch(/1 days/);
  });
  it('split shifts count a day once', () => {
    const hours = [...week({ Sun: { closed: true } }), { day: 'Mon', open: '18:00', close: '20:00' }];
    expect(answer(hours, 0)).toMatch(/\b6\b/);
  });
  it('fewer than seven distinct days, an unknown day, an empty open day, or no open day: no count is stated', () => {
    expect(answer(week().slice(0, 5), 0)).toBeNull();
    expect(answer([...week().slice(0, 6), { day: 'Sunday?', open: '09:00', close: '17:00' }], 0)).toBeNull();
    expect(answer(week({ Tue: { open: '', close: '' } }), 0)).toBeNull();
    expect(answer(week(Object.fromEntries(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => [x, { closed: true }]))), 0)).toBeNull();
  });
  it('full day names count', () => {
    const hours = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => ({ day, open: '09:00', close: '17:00' }));
    expect(answer(hours, 0)).toMatch(/\b7\b/);
  });
});

describe('K3: Beard care counts real beard services only', () => {
  const eligible = (titles: string[]) => extraPageRows(shop({ services: titles.map((t) => svc(t)), extraPages: { on: ['beard-care'] } })).find((r) => r.key === 'beard-care')!.eligible;
  it('line-ups and head shaves do not switch it on', () => {
    expect(eligible(['Haircut', 'Line up'])).toBe(false);
    expect(eligible(['Haircut', 'Head shave'])).toBe(false);
    expect(eligible(['Haircut', 'Hot towel head shave'])).toBe(false);
  });
  it('real beard services do', () => {
    expect(eligible(['Beard Trim'])).toBe(true);
    expect(eligible(['Haircut & Beard'])).toBe(true);
    expect(eligible(['Hot Towel Shave'])).toBe(true);
  });
  it('the "Beard services" list holds beard services only', () => {
    const d = shop({ services: [svc('Haircut'), svc('Line up', { price: '$10' }), svc('Head shave', { price: '$25' }), svc('Beard Trim', { price: '$15' }), svc('Hot Towel Shave', { price: '$30' })] });
    expect(beardServices(d).map((s) => s.title)).toEqual(['Beard Trim', 'Hot Towel Shave']);
    expect(isBeardTitle('Line up')).toBe(false);
    expect(isBeardTitle('Head shave')).toBe(false);
  });
});

describe('M10: the first-visit floor matches its tokens', () => {
  const fv = (extra: Partial<WebsiteData>) => extraPageRows(shop({ bookingUrl: '', phone: '(512) 555-0100', contact: { address: '', email: '' }, hours: [], extraPages: { on: ['first-visit'] }, ...extra })).find((r) => r.key === 'first-visit')!.eligible;
  it('a phone needs digits; hours need an open day', () => {
    expect(fv({ phone: 'call us', hours: [{ day: 'Mon', open: '09:00', close: '17:00' }] })).toBe(false);
    expect(fv({ hours: [{ day: 'Mon', open: '', close: '', closed: true }] })).toBe(false);
    expect(fv({ hours: [{ day: 'Mon', open: '09:00', close: '17:00' }] })).toBe(true);
    expect(fv({ contact: { address: '1 Main St', email: '' } })).toBe(true);
  });
});

describe('M5: {policy} is cut at a sentence boundary', () => {
  it('a long policy ends on a full sentence', () => {
    const body = Array.from({ length: 40 }, (_, i) => `Rule number ${i} applies here.`).join(' ');
    const b = resolveBlock(lenientEnv(shop({ policy: { title: 'P', body } })), 'faq.policy')!;
    const t = segsText(b.items[0]);
    expect(t.length).toBeLessThanOrEqual(600);
    expect(/applies here\.$/.test(t)).toBe(true);
  });
  it('a short policy is printed whole', () => {
    const b = resolveBlock(lenientEnv(shop({ policy: { title: 'P', body: 'Cancel a day early.' } })), 'faq.policy')!;
    expect(segsText(b.items[0])).toContain('Cancel a day early.');
  });
});

describe('M3: tel links in Location and Contact use digits and + only', () => {
  it('an extension or bracket does not reach the href', () => {
    const d = shop({ phone: '(512) 555-0100 ext. 4', extraPages: { on: [], serviceGuides: false } });
    for (const p of renderSiteBundle({ ...d, template: 'luxe' }, {}).pages.filter((x) => /^(location|contact)\//.test(x.path))) {
      const hrefs = [.../<main[\s\S]*?<\/main>/.exec(p.html)![0].matchAll(/href="(tel:[^"]*)"/g)].map((m) => m[1]);
      expect(hrefs.length, p.path).toBeGreaterThan(0);
      for (const h of hrefs) expect(h, p.path).toMatch(/^tel:\+?\d+$/);
    }
  });
});
