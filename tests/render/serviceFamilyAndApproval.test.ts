// Mode A (a classifier chose a library guide family: the page prints the library's own reviewed wording) and the approval gate of
// Mode B (model text prints only with an approval). Everything here is pure rendering; no model, no network.
import { describe, expect, it } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import { buildPageSet } from '../../lib/render/pages';
import { aiPageFor, familyFor, guideForTitle, lenientEnv, serviceAltFor, serviceGuideFor, thinServiceIndexes, titledServices } from '../../lib/render/guides';
import { checkEntryShape, type SvcCopyEntry } from '../../lib/render/svcCopy';
import { svcCopySanitize } from '../../lib/serviceCopy/prune';
import { validateWebSnapshot } from '../../lib/webApp/publishFlow';
import type { WebsiteData } from '../../types';

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });
const PROPOSAL: SvcCopyEntry = {
  v: 1, aiGenerated: true, heading: 'What to expect from {service}',
  intro: 'Learn what the service involves before you decide. Tell your barber what you would like to change. Bring a photo of the style you have in mind.',
  sections: [
    { h: 'Before you arrive', p: 'Think about how you wear your hair. Wear loose clothes that are easy to move in.' },
    { h: 'During the visit', p: 'Speak up if you would like a change. Check that the plan matches what you asked for.' },
  ],
  faq: [{ q: 'What should you bring to the visit?', a: 'Bring a photo of the look you like. Ask your barber if you have a question.' }],
  metaTitle: 'What to know about {service}', metaDescription: 'Learn what a visit for {service} involves and how to prepare.',
};
const MARK = 'Learn what the service involves before you decide';
const shop = (extraPages: Record<string, unknown> = {}, extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' },
  about: { heading: 'About', description: ['We cut hair.'], imageUrl: '' },
  services: [svc('Skin Fade', { description: 'A close fade with a straight razor finish around the ears and the neckline, booked as one visit.' }), svc('Scalp Massage')],
  gallery: [], hours: [{ day: 'Mon', open: '09:00', close: '17:00' }],
  contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  pages: { order: [], hidden: [] },
  extraPages: { on: ['faq'], serviceGuides: true, seed: 7, ...extraPages } as never,
  source: 'web-app',
  ...extra,
});
const BASE = { siteBaseUrl: 'https://fresh.example.com' };
const NOINDEX = '<meta name="robots" content="noindex,follow">';
const all = (d: WebsiteData) => renderSiteBundle(d, BASE);
const html = (d: WebsiteData, p = 'services/scalp-massage/index.html') => all(d).pages.find((x) => x.path === p)?.html ?? '';
const everything = (d: WebsiteData) => { const b = all(d); return [b.sitemap, ...b.pages.map((p) => p.html)].join('\n'); };

describe('Mode A: a family chosen by the classifier', () => {
  it('without a family a custom service is thin (noindex, not in the sitemap)', () => {
    const d = shop();
    expect(html(d)).toContain(NOINDEX);
    expect(all(d).sitemap).not.toContain('/services/scalp-massage/');
  });
  it('with a family the page prints the library guide of that family exactly as a built-in service of that kind does, and is indexable', () => {
    const d = shop({ svcFamily: { 'scalp massage': 'shave' } });
    const built = html(shop({}, { services: [svc('Hot Shave'), svc('Scalp Massage')] }), 'services/hot-shave/index.html');
    const page = html(d);
    expect(page).not.toContain(NOINDEX);
    expect(all(d).sitemap).toContain('/services/scalp-massage/');
    expect(page).toContain('About this service');
    // the guide wording is the library's: the first paragraph of the shave guide is on both pages
    const libText = (built.match(/<div class="ab-copy[^>]*>[\s\S]*?<\/p>/) ?? [''])[0].replace(/<[^>]+>/g, '').slice(0, 40);
    expect(libText.length).toBeGreaterThan(10);
    expect(page.replace(/<[^>]+>/g, '')).toContain(libText.replace(/Hot Shave/g, 'Scalp Massage').slice(0, 25));
    // not a word of any model text anywhere
    expect(everything(d)).not.toContain(MARK);
  });
  it('is the same guide machinery: serviceGuideFor / serviceAltFor / thinServiceIndexes see the family (a second service of a kind gets the alt block)', () => {
    const d = shop({ svcFamily: { 'scalp massage': 'shave', 'neck ritual': 'shave' } }, { services: [svc('Scalp Massage'), svc('Neck Ritual')] });
    expect(serviceGuideFor(d, [0, 1]).get(0)).toBe('shave');
    expect(serviceAltFor(d, [0, 1]).get(1)).toBe('shave');
    const thin = thinServiceIndexes(d, [0, 1]);
    expect(thin.has(0)).toBe(false); expect(thin.has(1)).toBe(true); // the alt block does not make a page indexable (B4)
    expect(titledServices(d).map((s) => s.guide)).toEqual(['shave', 'shave']);
  });
  it('is ignored unless every gate holds: web-created pages v2, guides on, a real guide id, a title the library does not match, no text of its own', () => {
    const fam = { svcFamily: { 'scalp massage': 'shave' } };
    expect(familyFor(shop(fam), 'Scalp Massage')).toBe('shave');
    expect(familyFor(shop(fam, { source: 'ios' as never }), 'Scalp Massage')).toBeNull();
    expect(familyFor(shop({ ...fam, serviceGuides: false }), 'Scalp Massage')).toBeNull();
    expect(familyFor(shop({ svcFamily: { 'scalp massage': 'hair-loss-cure' } }), 'Scalp Massage')).toBeNull();
    expect(familyFor(shop({ svcFamily: { 'scalp massage': ['shave'] } as never }), 'Scalp Massage')).toBeNull();
    expect(familyFor(shop({ svcFamily: ['shave'] as never }), 'Scalp Massage')).toBeNull();
    expect(familyFor(shop({ svcFamily: { __proto__: 'shave' } as never }), '__proto__')).toBeNull();
    expect(guideForTitle(shop({ svcFamily: { 'skin fade': 'shave' } }), 'Skin Fade')).toBe('fade'); // the library match wins
    expect(familyFor(shop({ ...fam, svcCopy: { 'scalp massage': { ...PROPOSAL, aiGenerated: false, approval: undefined } } }), 'Scalp Massage')).toBeNull(); // the barber's own text wins
    const legacy = shop(fam, { source: undefined });
    expect(html(legacy)).not.toContain('About this service');
  });
  it('iOS parity: a site that is not web-created renders byte-identical with or without a family or model text in its data', () => {
    for (const source of [undefined, 'ios'] as const) {
      const plain = renderSiteBundle(shop({}, { source: source as never }), BASE);
      const noisy = renderSiteBundle(shop({ svcFamily: { 'scalp massage': 'shave' }, svcCopy: { 'scalp massage': { ...PROPOSAL, approval: 'owner' } } }, { source: source as never }), BASE);
      expect(noisy.sitemap).toBe(plain.sitemap);
      const stamp = (h: string) => h.replace(/name="published-at" content="\d+"/, 'name="published-at"');
      expect(noisy.pages.map((p) => [p.path, stamp(p.html)])).toEqual(plain.pages.map((p) => [p.path, stamp(p.html)]));
    }
  });
  it('sanitize keeps a family only for a real custom service with a real guide id; drops the rest; never mutates', () => {
    const d = shop({ svcFamily: { 'scalp massage': 'shave', 'skin fade': 'fade', 'removed': 'shave', 'x': 'nope' } });
    const out = svcCopySanitize(d);
    expect(out.siteData.extraPages!.svcFamily).toEqual({ 'scalp massage': 'shave' });
    expect(out.dropped.sort()).toEqual(['family:removed', 'family:skin fade', 'family:x']);
    expect((d.extraPages as any).svcFamily.removed).toBe('shave');
    const clean = shop({ svcFamily: { 'scalp massage': 'shave' } });
    expect(svcCopySanitize(clean).siteData).toBe(clean);
    expect(svcCopySanitize(shop({ svcFamily: 'x' as never })).siteData.extraPages).not.toHaveProperty('svcFamily');
    expect(svcCopySanitize(shop({ svcFamily: { 'scalp massage': 'shave' }, svcCopy: { 'scalp massage': { ...PROPOSAL, approval: 'owner' } } })).siteData.extraPages).not.toHaveProperty('svcFamily'); // stale next to text
  });
  it('survives the publish snapshot (the server cleaning step) and still renders', () => {
    const r = validateWebSnapshot(shop({ svcFamily: { 'scalp massage': 'shave' } }));
    expect((r.sd.extraPages as any).svcFamily).toEqual({ 'scalp massage': 'shave' });
  });
});

describe('Mode B: model text prints only with an approval; a proposal never renders, indexes or reaches the sitemap, JSON-LD or the path list', () => {
  const withEntry = (e: object) => shop({ svcCopy: { 'scalp massage': e } });
  const baseline = all(shop());
  it('an approved entry (owner) prints and is indexable', () => {
    const d = withEntry({ ...PROPOSAL, approval: 'owner' });
    expect(html(d)).toContain(MARK);
    expect(html(d)).not.toContain(NOINDEX);
    expect(all(d).sitemap).toContain('/services/scalp-massage/');
  });
  it('an unapproved entry (a proposal) prints nothing: the page is exactly the thin page', () => {
    const d = withEntry(PROPOSAL);
    const b = all(d);
    expect(everything(d)).not.toContain(MARK);
    expect(everything(d)).not.toContain('What to expect from Scalp Massage');
    expect(everything(d)).not.toContain('What to know about Scalp Massage');
    expect(html(d)).toContain(NOINDEX);
    expect(b.sitemap).toBe(baseline.sitemap);
    expect(b.pages.map((p) => p.path).sort()).toEqual(baseline.pages.map((p) => p.path).sort()); // same path/redirect set
    const ld = (h: string) => (h.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) ?? []).join('');
    expect(b.pages.map((p) => ld(p.html)).join('')).toBe(baseline.pages.map((p) => ld(p.html)).join(''));
    expect(aiPageFor(lenientEnv(d), titledServices(d).find((s) => s.title === 'Scalp Massage')!)).toBeNull();
    expect([...thinServiceIndexes(d, buildPageSet(d).services.map((c) => c.index))]).toContain(1);
  });
  it('an entry with approval "auto" prints (the server only ever stamps it while the flag is on; the server steps drop it when it is off)', () => {
    expect(html(withEntry({ ...PROPOSAL, approval: 'auto' }))).toContain(MARK);
  });
  it('approval values other than owner / auto, on human-edited text, or a forged shape never print', () => {
    for (const approval of ['yes', true, 1, 'OWNER', null, ['owner']]) expect(everything(withEntry({ ...PROPOSAL, approval })), String(approval)).not.toContain(MARK);
    expect(checkEntryShape({ ...PROPOSAL, aiGenerated: false, approval: 'owner' }).ok).toBe(false);
  });
  it('the barber\'s own words (aiGenerated false, no approval) still print as written', () => {
    expect(html(withEntry({ ...PROPOSAL, aiGenerated: false, intro: 'My own words about the massage.' }))).toContain('My own words about the massage.');
  });
  it('the server cleaning step (draft save and publish snapshot) drops a proposal; owner text stays; auto text stays only with the flag', () => {
    const prop = svcCopySanitize(shop({ svcCopy: { 'scalp massage': PROPOSAL } }));
    expect(prop.dropped).toEqual(['scalp massage']);
    expect(prop.siteData.extraPages).not.toHaveProperty('svcCopy');
    const owner = shop({ svcCopy: { 'scalp massage': { ...PROPOSAL, approval: 'owner' } } });
    expect(svcCopySanitize(owner).siteData).toBe(owner);
    const auto = shop({ svcCopy: { 'scalp massage': { ...PROPOSAL, approval: 'auto' } } });
    expect(svcCopySanitize(auto).dropped).toEqual(['scalp massage']);                               // flag off (default)
    expect(svcCopySanitize(auto, { autoPublish: false }).dropped).toEqual(['scalp massage']);
    expect(svcCopySanitize(auto, { autoPublish: true }).siteData).toBe(auto);
    const own = shop({ svcCopy: { 'scalp massage': { ...PROPOSAL, aiGenerated: false } } });
    expect(svcCopySanitize(own).siteData).toBe(own);
  });
  it('end to end through the publish snapshot with the flag OFF: a proposal and an "auto" entry never reach the render, sitemap or paths', () => {
    delete process.env.SERVICE_COPY_AUTO_PUBLISH;
    for (const e of [PROPOSAL, { ...PROPOSAL, approval: 'auto' }]) {
      const r = validateWebSnapshot(shop({ svcCopy: { 'scalp massage': e } }));
      const b = renderSiteBundle(r.sd, BASE);
      expect([b.sitemap, ...b.pages.map((p) => p.html)].join('\n')).not.toContain(MARK);
      expect(b.sitemap).toBe(baseline.sitemap);
      expect(b.pages.map((p) => p.path).sort()).toEqual(baseline.pages.map((p) => p.path).sort());
      expect((r.sd.extraPages as any).svcCopy).toBeUndefined();
    }
  });
  it('with the flag ON the same "auto" entry survives the publish snapshot and prints; a bare proposal still does not', () => {
    process.env.SERVICE_COPY_AUTO_PUBLISH = '1';
    try {
      const r = validateWebSnapshot(shop({ svcCopy: { 'scalp massage': { ...PROPOSAL, approval: 'auto' } } }));
      expect(everything(r.sd)).toContain(MARK);
      const p = validateWebSnapshot(shop({ svcCopy: { 'scalp massage': PROPOSAL } }));
      expect(everything(p.sd)).not.toContain(MARK);
    } finally { delete process.env.SERVICE_COPY_AUTO_PUBLISH; }
  });
  it('flag semantics: only the exact string "1" turns it on', async () => {
    const { serviceCopyAutoPublish } = await import('../../lib/serviceCopy/flags');
    for (const v of [undefined, '', '0', 'true', 'yes', ' 1', '1 ', 'on']) expect(serviceCopyAutoPublish({ SERVICE_COPY_AUTO_PUBLISH: v }), String(v)).toBe(false);
    expect(serviceCopyAutoPublish({ SERVICE_COPY_AUTO_PUBLISH: '1' })).toBe(true);
    expect(serviceCopyAutoPublish({})).toBe(false);
  });
  it('S3: a stored heading or question that only the deny layer catches is not printed at render time, even when every sentence is clean', () => {
    // 'Spotless towels' and 'Will this reduce shedding?' pass the library rules (copyRules) and fail the deny layer (svcDeny), so only the render-time line lint stops them.
    const d = withEntry({ ...PROPOSAL, approval: 'owner', heading: 'Spotless towels', sections: [{ h: 'Spotless towels', p: PROPOSAL.sections[0].p }, PROPOSAL.sections[1]], faq: [{ q: 'Will this reduce shedding?', a: 'Bring a photo of the look you like. Ask your barber if you have a question.' }, PROPOSAL.faq[0]] });
    const h = html(d);
    expect(h).toContain(MARK); // the clean text still prints
    expect(h).toContain('What should you bring to the visit?'); // and the clean question
    expect(h).not.toContain('Spotless towels');
    expect(h).not.toContain('reduce shedding');
    // and the plain claims are stopped too
    const e = html(withEntry({ ...PROPOSAL, approval: 'owner', heading: 'Licensed best barber in town', faq: [{ q: 'Will this cure hair loss?', a: PROPOSAL.faq[0].a }, PROPOSAL.faq[0]] }));
    expect(e).not.toContain('Licensed best barber'); expect(e).not.toContain('cure hair loss');
  });
});
