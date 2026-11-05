// Phase 1 step 6, the shared part: the AI-text lint and the renderer for extraPages.svcCopy.
import { describe, expect, it } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import { aiSentenceProblems, candidateFromModel, checkEntryShape, lintEntry, lintParagraph, plainTextProblem, type SvcCopyEntry } from '../../lib/render/svcCopy';
import type { WebsiteData } from '../../types';

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });
const GOOD: SvcCopyEntry = {
  v: 1, aiGenerated: true, heading: 'What to expect from {service}',
  intro: 'Learn what the service involves before you decide. Tell your barber what you would like to change. Bring a photo of the style you have in mind.',
  sections: [
    { h: 'Before you arrive', p: 'Think about how you wear your hair. Wear loose clothes that are easy to move in.' },
    { h: 'During the visit', p: 'Speak up if you would like a change. Check that the plan matches what you asked for.' },
  ],
  faq: [{ q: 'What should you bring to the visit?', a: 'Bring a photo of the look you like. Ask your barber if you have a question.' }],
  metaTitle: 'What to know about {service}', metaDescription: 'Learn what a visit for {service} involves and how to prepare.',
};
const shop = (extra: Partial<WebsiteData> = {}, svcCopy?: unknown): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' },
  about: { heading: 'About', description: ['We cut hair.'], imageUrl: '' },
  services: [svc('Skin Fade', { description: 'A close fade with a straight razor finish around the ears and the neckline, booked as one visit.' }), svc('Scalp Massage')],
  gallery: [], hours: [{ day: 'Mon', open: '09:00', close: '17:00' }],
  contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  pages: { order: [], hidden: [] },
  extraPages: { on: ['faq'], serviceGuides: true, seed: 7, ...(svcCopy === undefined ? {} : { svcCopy: svcCopy as Record<string, unknown> }) },
  source: 'web-app',
  ...extra,
});
const BASE = { siteBaseUrl: 'https://fresh.example.com' };
const page = (d: WebsiteData, path = 'services/scalp-massage/index.html') => renderSiteBundle(d, BASE).pages.find((p) => p.path === path)?.html ?? '';
const sitemap = (d: WebsiteData) => renderSiteBundle(d, BASE).sitemap ?? '';

describe('sentence lint (R1 to R17, the AI rules and the default-deny layer)', () => {
  const ok = ['Tell your barber what you would like to change.', 'Ask about {service} before the visit.', 'Bring a photo of the style you have in mind.'];
  for (const s of ok) it(`accepts: ${s}`, () => expect(aiSentenceProblems(s, [])).toEqual([]));
  it('accepts a question as a question', () => expect(aiSentenceProblems('What should you bring to the visit?', [], 'question')).toEqual([]));
  const bad: [string, string][] = [
    ['We are licensed and insured.', 'R1'], ['Our team is licensed and insured.', 'R3'], ['The barber is insured and bonded.', 'A2'],
    ['Backed by 20 years of experience.', 'R6'], ['Our barbers have many years of experience.', 'A3'], ['This visit costs $40.', 'A5'],
    ['Satisfaction is guaranteed.', 'R5'], ['Comes with a lifetime warranty.', 'A4'], ['It will cure dandruff.', 'R10'],
    ['This is the best service around.', 'R2'], ['Our most popular service.', 'A8'], ['It is better than other shops.', 'A9'],
    ['Visit www.example.com for details.', 'plain'], ['Email info@example.com to book.', 'plain'], ['See <b>this</b> page.', 'plain'], ['Ask Tony about it.', 'R7'],
    ['I have done this for a long time.', 'A1'], ['Pour {shop} le rendez-vous.', 'token'], ['Call {phone} to book.', 'token'], ['Open late on weekends.', 'A10'],
    ['Hola, el masaje es calmante para la cabeza.', 'A15'], ['Ask about {place} before the visit.', 'token'],
  ];
  for (const [s, rule] of bad) it(`refuses (${rule}): ${s}`, () => expect(aiSentenceProblems(s, []).join('|'), s).toContain(rule));
  it('a vocabulary word is allowed only when the service title itself uses it', () => {
    expect(aiSentenceProblems('Tell your barber how short you want the fade.', []).join()).toContain('R8');
    expect(aiSentenceProblems('Tell your barber how short you want the fade.', ['fade'])).toEqual([]);
  });
  it('token rules: no article before {service}, not the subject of a verb, no pronoun in its sentence', () => {
    expect(aiSentenceProblems('Ask about a {service} today.', []).join()).toContain('R12');
    expect(aiSentenceProblems('{service} is a calm choice.', []).join()).toContain('R15');
    expect(aiSentenceProblems('Ask about {service} and plan for it.', []).join()).toContain('R17');
  });
});

describe('plain text', () => {
  for (const s of ['a<b', 'x > y', '`code`', 'a\nb', 'a\tb', ' lead', 'trail ', 'two  spaces', 'zero​width', 'bidi‮', 'soft­hyphen', 'a &amp; b', 'javascript:alert(1)', 'see http://x.co', 'back\\slash', 'a|b', 'tilde~'])
    it(`refuses ${JSON.stringify(s)}`, () => expect(plainTextProblem(s)).not.toBe(''));
  it('accepts ordinary prose', () => expect(plainTextProblem("Tell your barber what you'd like, then relax - it is simple.")).toBe(''));
});

describe('paragraphs and entries', () => {
  it('drops the failing sentence and a following sentence that opens with a pronoun', () => {
    const r = lintParagraph('Plan some extra time. Backed by 20 years of experience. It is simple and calm. Wear loose clothes.', []);
    expect(r.text).toBe('Plan some extra time. Wear loose clothes.');
    expect(r.kept).toBe(2); expect(r.written).toBe(4);
  });
  it('a clean entry survives untouched and linting is idempotent', () => {
    const a = lintEntry(GOOD, []);
    expect(a.entry).toEqual(GOOD);
    expect(lintEntry(a.entry!, []).entry).toEqual(a.entry);
  });
  it('too little survives -> null (no entry)', () => {
    const bad = { ...GOOD, intro: 'Our licensed team. Fully insured. Twenty years of experience.', sections: [{ h: 'Why us', p: 'We are the best. We guarantee it.' }], faq: [] };
    expect(lintEntry(bad, []).entry).toBeNull();
    const half = { ...GOOD, intro: 'A calm visit. Backed by 20 years of experience.', sections: [{ h: 'Before you arrive', p: 'Think about time. We are the best. Ours is better than others. It costs $40.' }], faq: [] };
    expect(lintEntry(half, []).entry).toBeNull(); // survival under half
  });
  it('a failing section heading drops the section; a failing meta is omitted', () => {
    const e = lintEntry({ ...GOOD, sections: [{ h: 'The best sessions', p: 'Think about time. Wear loose clothes.' }, ...GOOD.sections], metaTitle: 'The best massage', metaDescription: 'Costs $40 today.' }, []);
    expect(e.entry!.sections.map((s) => s.h)).toEqual(['Before you arrive', 'During the visit']);
    expect(e.entry!.metaTitle).toBeUndefined(); expect(e.entry!.metaDescription).toBeUndefined();
  });
});

describe('shape', () => {
  const mutate = (f: (o: any) => void) => { const o = JSON.parse(JSON.stringify(GOOD)); f(o); return checkEntryShape(o); };
  it('accepts the stored shape', () => expect(checkEntryShape(GOOD).ok).toBe(true));
  for (const [name, f] of [
    ['unknown key', (o: any) => { o.extra = 1; }], ['wrong version', (o: any) => { o.v = 2; }], ['aiGenerated not boolean', (o: any) => { o.aiGenerated = 'yes'; }],
    ['intro too long', (o: any) => { o.intro = 'a'.repeat(801); }], ['empty intro', (o: any) => { o.intro = ''; }], ['too many sections', (o: any) => { o.sections = Array(5).fill(o.sections[0]); }],
    ['section extra key', (o: any) => { o.sections[0].x = 1; }], ['faq answer not text', (o: any) => { o.faq[0].a = 5; }], ['meta title too long', (o: any) => { o.metaTitle = 'a'.repeat(61); }],
    ['array root', (o: any) => { o.sections = {}; }],
  ] as [string, (o: any) => void][]) it(`refuses: ${name}`, () => expect(mutate(f).ok).toBe(false));
  it('refuses non-objects', () => { for (const v of [null, 'x', 5, [], undefined]) expect(checkEntryShape(v).ok).toBe(false); });
  it('model output: empty meta strings count as omitted; missing or extra keys are refused', () => {
    const m = { heading: 'H', intro: GOOD.intro, sections: GOOD.sections, faq: GOOD.faq, metaTitle: '', metaDescription: '' };
    const r = candidateFromModel(m);
    expect(r.ok && r.entry.metaTitle).toBeFalsy();
    expect(candidateFromModel({ ...m, extra: 1 }).ok).toBe(false);
    const { faq, ...rest } = m;
    expect(candidateFromModel(rest).ok).toBe(false);
  });
});

describe('the renderer', () => {
  it('prints the text escaped, resolves {service} through the whitelist and is indexable', () => {
    const e = { ...GOOD, intro: GOOD.intro + ' Ask about {service} before the visit.' };
    const html = page(shop({}, { 'scalp massage': e }));
    expect(html).toContain('What to expect from Scalp Massage');
    expect(html).toContain('Ask about Scalp Massage before the visit.');
    expect(html).not.toContain('{service}');
    expect(html).not.toContain('noindex');
    expect(sitemap(shop({}, { 'scalp massage': e }))).toContain('/services/scalp-massage/');
    expect(html).toContain('Learn what a visit for Scalp Massage involves and how to prepare.'); // meta description
  });
  it('without an entry the page stays thin: noindex and out of the sitemap', () => {
    expect(page(shop())).toContain('noindex');
    expect(sitemap(shop())).not.toContain('/services/scalp-massage/');
  });
  it('a hostile stored entry is omitted whole or lint-dropped, never printed', () => {
    const forged = { ...GOOD, intro: '<script>alert(1)</script>. Licensed and insured since 1999. We guarantee the best result.', sections: [], faq: [] };
    const html = page(shop({}, { 'scalp massage': forged }));
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('guarantee');
    expect(html).toContain('noindex');
    for (const bad of [{ ...GOOD, v: 2 }, { ...GOOD, extra: 1 }, 'text', null, [], { ...GOOD, intro: 'x'.repeat(5000) }]) {
      const h = page(shop({}, { 'scalp massage': bad }));
      expect(h, JSON.stringify(bad).slice(0, 30)).toContain('noindex');
    }
  });
  it('stored model text is linted again at render: sentences only the AI rules catch are dropped', () => {
    const e = { ...GOOD, intro: 'Learn what the service involves. The barber is insured and bonded. Tell your barber what you prefer. The finest and smoothest feeling around. Plan some extra time. Ask your barber about other options.' };
    const html = page(shop({}, { 'scalp massage': e }));
    expect(html).toContain('Tell your barber what you prefer.');
    expect(html).not.toContain('insured'); expect(html).not.toContain('smoothest');
  });
  it('a sentence whose token has no usable value is dropped, not repaired', () => {
    const e = { ...GOOD, intro: 'Learn what the service involves. Ask about {service} before the visit. Wear loose clothes. Plan some extra time.' };
    const d = shop({}, { 'scalp massage': e });
    expect(page(d)).toContain('Ask about Scalp Massage before the visit.');
    const d2 = shop({ services: [svc('Skin Fade', { description: 'x'.repeat(100) }), svc('Scalp Massage')] }, { 'scalp massage': { ...e, intro: e.intro.replace('{service}', '{place}') } });
    expect(page(d2)).not.toContain('Ask about Brooklyn');
    expect(page(d2)).not.toContain('{place}');
    const d3 = shop({ area: '', contact: { address: '', email: '' } }, { 'scalp massage': { ...e, intro: e.intro.replace('{service}', '{place}') } });
    expect(page(d3)).not.toContain('{place}');
    expect(page(d3)).not.toContain('Ask about');
  });
  it('the barber\'s own edit (aiGenerated false) is printed escaped as written, not linted, no tokens', () => {
    const own = { ...GOOD, aiGenerated: false, intro: 'We are the best <b>team</b> with 20 years. {service}', metaDescription: undefined };
    delete (own as any).metaDescription;
    const html = page(shop({}, { 'scalp massage': own }));
    expect(html).toContain('We are the best &lt;b&gt;team&lt;/b&gt; with 20 years. {service}');
    expect(html).not.toContain('<b>team</b>');
    expect(html).not.toContain('noindex');
  });
  it('an entry for a removed service, or for a library-guide service, or on a site that does not qualify, is ignored', () => {
    expect(page(shop({ services: [svc('Skin Fade', { description: 'x'.repeat(100) })] }, { 'scalp massage': GOOD }), 'services/scalp-massage/index.html')).toBe('');
    expect(page(shop({}, { 'skin fade': GOOD }), 'services/skin-fade/index.html')).not.toContain('What to expect from Scalp Massage');
    for (const extra of [{ source: undefined }, { source: 'ios' }, { extraPages: undefined }] as Partial<WebsiteData>[]) {
      const d = shop(extra, { 'scalp massage': GOOD });
      if (extra.extraPages === undefined && 'extraPages' in extra) d.extraPages = undefined;
      expect(page(d)).not.toContain('What to expect from Scalp Massage');
    }
  });
  it('the same service listed twice: only the first owns the text', () => {
    const d = shop({ services: [svc('Scalp Massage'), svc('Scalp massage')] }, { 'scalp massage': GOOD });
    const b = renderSiteBundle(d, BASE).pages.filter((p) => p.html.includes('What to expect from Scalp Massage'));
    expect(b.length).toBe(1);
  });
  it('hiding the service guide section hides the text and its meta description', () => {
    const d = shop({ pageSections: { service: { hidden: ['guide'] } } }, { 'scalp massage': GOOD });
    const html = page(d);
    expect(html).not.toContain('What to expect from Scalp Massage');
    expect(html).not.toContain('Learn what a visit');
  });
  it('a site that never had svcCopy renders byte-identically with an empty svcCopy object', () => {
    const strip = (h: string) => h.replace(/published-at" content="\d+"/, '');
    const a = renderSiteBundle(shop(), BASE).pages.map((p) => strip(p.html));
    const b = renderSiteBundle(shop({}, {}), BASE).pages.map((p) => strip(p.html));
    expect(b).toEqual(a);
  });
});
