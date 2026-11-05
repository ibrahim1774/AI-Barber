// Mode A (a classifier chose a library guide family: the page prints the library's own reviewed wording) and the approval gate of
// Mode B (model text prints only with an approval). Everything here is pure rendering; no model, no network.
import { describe, expect, it } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import { buildPageSet } from '../../lib/render/pages';
import { aiPageFor, familyFor, guideForTitle, lenientEnv, serviceAltFor, serviceGuideFor, thinServiceIndexes, titledServices } from '../../lib/render/guides';
import { checkEntryShape, type SvcCopyEntry } from '../../lib/render/svcCopy';
import { svcCopySanitize } from '../../lib/serviceCopy/prune';
import { validateWebSnapshot } from '../../lib/webApp/publishFlow';
import { renderPendingBundle } from '../../lib/publishSite';
import { draftRef, siteRef, stampApproval } from '../../lib/serviceCopy/approval';
import type { WebsiteData } from '../../types';

const SECRET = 'test-signing-secret-0123456789abcdef';
const SLUG = 'fresh-cuts';
const DRAFT = 'draft-1';
const SOPTS = { secret: SECRET, userId: '10000000-0000-0000-0000-000000000001', refs: [draftRef(DRAFT), siteRef(SLUG)] };
const OWNER = '10000000-0000-0000-0000-000000000001';

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
/** Model text signed by the server for this service key and the test owner (what the approve endpoint returns). */
const signedFor = (mode: 'owner' | 'auto' = 'owner', key = 'scalp massage', user = OWNER, where: 'draft' | 'site' = 'draft'): SvcCopyEntry => stampApproval(SECRET, where === 'site' ? { userId: user, slug: SLUG } : { userId: user, draftId: DRAFT }, key, 'Barbershop', PROPOSAL, mode)!;
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
const shopA = (extraPages: Record<string, unknown> = {}, extra: Partial<WebsiteData> = {}): WebsiteData => shop(extraPages, { services: [svc('Skin Fade', { description: 'A close fade with a straight razor finish around the ears and the neckline, booked as one visit.' }), svc('Bald Head Polish')], ...extra });
const BASE = { siteBaseUrl: 'https://fresh.example.com' };
const NOINDEX = '<meta name="robots" content="noindex,follow">';
const all = (d: WebsiteData) => renderSiteBundle(d, BASE);
const htmlA = (d: WebsiteData, p = 'services/bald-head-polish/index.html') => all(d).pages.find((x) => x.path === p)?.html ?? '';
const html = (d: WebsiteData, p = 'services/scalp-massage/index.html') => all(d).pages.find((x) => x.path === p)?.html ?? '';
const everything = (d: WebsiteData) => { const b = all(d); return [b.sitemap, ...b.pages.map((p) => p.html)].join('\n'); };

describe('Mode A: a family chosen by the classifier', () => {
  it('without a family a custom service is thin (noindex, not in the sitemap)', () => {
    const d = shopA();
    expect(htmlA(d)).toContain(NOINDEX);
    expect(all(d).sitemap).not.toContain('/services/bald-head-polish/');
  });
  it('with a family the page prints the library guide of that family exactly as a built-in service of that kind does, and is indexable', () => {
    const d = shopA({ svcFamily: { 'bald head polish': 'shave' } });
    const built = htmlA(shopA({}, { services: [svc('Hot Shave'), svc('Bald Head Polish')] }), 'services/hot-shave/index.html');
    const page = htmlA(d);
    expect(page).not.toContain(NOINDEX);
    expect(all(d).sitemap).toContain('/services/bald-head-polish/');
    expect(page).toContain('About this service');
    // the guide wording is the library's: the first paragraph of the shave guide is on both pages
    const libText = (built.match(/<div class="ab-copy[^>]*>[\s\S]*?<\/p>/) ?? [''])[0].replace(/<[^>]+>/g, '').slice(0, 40);
    expect(libText.length).toBeGreaterThan(10);
    expect(page.replace(/<[^>]+>/g, '')).toContain(libText.replace(/Hot Shave/g, 'Bald Head Polish').slice(0, 25));
    // not a word of any model text anywhere
    expect(everything(d)).not.toContain(MARK);
  });
  it('is the same guide machinery: serviceGuideFor / serviceAltFor / thinServiceIndexes see the family (a second service of a kind gets the alt block)', () => {
    const d = shopA({ svcFamily: { 'bald head polish': 'shave', 'bald head buff': 'shave' } }, { services: [svc('Bald Head Polish'), svc('Bald Head Buff')] });
    expect(serviceGuideFor(d, [0, 1]).get(0)).toBe('shave');
    expect(serviceAltFor(d, [0, 1]).get(1)).toBe('shave');
    const thin = thinServiceIndexes(d, [0, 1]);
    expect(thin.has(0)).toBe(false); expect(thin.has(1)).toBe(true); // the alt block does not make a page indexable (B4)
    expect(titledServices(d).map((s) => s.guide)).toEqual(['shave', 'shave']);
  });
  it('NIT 1: the second service of a family gets the family\'s alt block (and stays thin), the first gets the guide', () => {
    const d = shopA({ svcFamily: { 'bald head polish': 'shave', 'bald head buff': 'shave' } }, { services: [svc('Bald Head Polish'), svc('Bald Head Buff')] });
    const page1 = htmlA(d, 'services/bald-head-polish/index.html'); const page2 = htmlA(d, 'services/bald-head-buff/index.html');
    expect(page1).toContain('About this service'); expect(page1).not.toContain(NOINDEX);
    expect(serviceAltFor(d, [0, 1]).get(1)).toBe('shave');
    expect(page2).toContain(NOINDEX);
    const dNoFam = shopA({}, { services: [svc('Bald Head Polish'), svc('Bald Head Buff')] });
    expect(htmlA(dNoFam, 'services/bald-head-buff/index.html')).not.toBe(page2); // the family changes the second page (its alt block); without it the page is bare
    expect(page2).toContain('Bald Head Buff');
  });
  it('is ignored unless every gate holds: web-created pages v2, guides on, a real guide id, a title the library does not match, no text of its own', () => {
    const fam = { svcFamily: { 'bald head polish': 'shave' } };
    expect(familyFor(shopA(fam), 'Bald Head Polish')).toBe('shave');
    expect(familyFor(shopA(fam, { source: 'ios' as never }), 'Bald Head Polish')).toBeNull();
    expect(familyFor(shopA({ ...fam, serviceGuides: false }), 'Bald Head Polish')).toBeNull();
    expect(familyFor(shopA({ svcFamily: { 'bald head polish': 'hair-loss-cure' } }), 'Bald Head Polish')).toBeNull();
    expect(familyFor(shopA({ svcFamily: { 'bald head polish': ['shave'] } as never }), 'Bald Head Polish')).toBeNull();
    expect(familyFor(shopA({ svcFamily: ['shave'] as never }), 'Bald Head Polish')).toBeNull();
    expect(familyFor(shopA({ svcFamily: { __proto__: 'shave' } as never }), '__proto__')).toBeNull();
    expect(guideForTitle(shopA({ svcFamily: { 'skin fade': 'shave' } }), 'Skin Fade')).toBe('fade'); // the library match wins
    expect(familyFor(shopA({ ...fam, svcCopy: { 'bald head polish': { ...PROPOSAL, aiGenerated: false, approval: undefined } } }), 'Bald Head Polish')).toBeNull(); // the barber's own text wins
    const legacy = shopA(fam, { source: undefined });
    expect(htmlA(legacy)).not.toContain('About this service');
  });
  it('iOS parity: a site that is not web-created renders byte-identical with or without a family or model text in its data', () => {
    for (const source of [undefined, 'ios'] as const) {
      const plain = renderSiteBundle(shopA({}, { source: source as never }), BASE);
      const noisy = renderSiteBundle(shopA({ svcFamily: { 'bald head polish': 'shave' }, svcCopy: { 'bald head polish': { ...PROPOSAL, approval: 'owner' } } }, { source: source as never }), BASE);
      expect(noisy.sitemap).toBe(plain.sitemap);
      const stamp = (h: string) => h.replace(/name="published-at" content="\d+"/, 'name="published-at"');
      expect(noisy.pages.map((p) => [p.path, stamp(p.html)])).toEqual(plain.pages.map((p) => [p.path, stamp(p.html)]));
    }
  });
  it('sanitize keeps a family only for a real custom service with a real guide id; drops the rest; never mutates', () => {
    const d = shopA({ svcFamily: { 'bald head polish': 'shave', 'skin fade': 'fade', 'removed': 'shave', 'x': 'nope' } });
    const out = svcCopySanitize(d, SOPTS);
    expect(out.siteData.extraPages!.svcFamily).toEqual({ 'bald head polish': 'shave' });
    expect(out.dropped.sort()).toEqual(['family:removed', 'family:skin fade', 'family:x']);
    expect((d.extraPages as any).svcFamily.removed).toBe('shave');
    const clean = shopA({ svcFamily: { 'bald head polish': 'shave' } });
    expect(svcCopySanitize(clean, SOPTS).siteData).toBe(clean);
    expect(svcCopySanitize(shopA({ svcFamily: 'x' as never }), SOPTS).siteData.extraPages).not.toHaveProperty('svcFamily');
    expect(svcCopySanitize(shopA({ svcFamily: { 'bald head polish': 'shave' }, svcCopy: { 'bald head polish': signedFor('owner', 'bald head polish') } }), SOPTS).siteData.extraPages).not.toHaveProperty('svcFamily'); // stale next to text
  });
  it('survives the publish snapshot (the server cleaning step) and still renders', () => {
    const r = validateWebSnapshot(shopA({ svcFamily: { 'bald head polish': 'shave' } }));
    expect((r.sd.extraPages as any).svcFamily).toEqual({ 'bald head polish': 'shave' });
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
  it('an entry with approval "auto" NEVER prints from the pure renderer (S1): only the server\'s deploy render turns a verified "auto" into printable text, and only while the flag is on', () => {
    expect(everything(withEntry({ ...PROPOSAL, approval: 'auto' }))).not.toContain(MARK);
    expect(everything(withEntry(signedFor('auto', 'scalp massage', OWNER, 'site')))).not.toContain(MARK);
    const d = withEntry(signedFor('auto', 'scalp massage', OWNER, 'site'));
    delete process.env.SERVICE_COPY_AUTO_PUBLISH;
    const off = renderPendingBundle({ siteData: d, imageUrlMap: {}, siteId: SLUG }, BASE);
    expect([off.sitemap, ...off.pages.map((p) => p.html)].join('\n')).not.toContain(MARK);
    process.env.SERVICE_COPY_AUTO_PUBLISH = '1';
    try {
      const on = renderPendingBundle({ siteData: d, imageUrlMap: {}, siteId: SLUG }, BASE);
      expect(on.pages.map((p) => p.html).join('\n')).toContain(MARK);
    } finally { delete process.env.SERVICE_COPY_AUTO_PUBLISH; }
  });
  it('approval values other than owner / auto, on human-edited text, or a forged shape never print', () => {
    for (const approval of ['yes', true, 1, 'OWNER', null, ['owner']]) expect(everything(withEntry({ ...PROPOSAL, approval })), String(approval)).not.toContain(MARK);
    expect(checkEntryShape({ ...PROPOSAL, aiGenerated: false, approval: 'owner' }).ok).toBe(false);
  });
  it('the barber\'s own words (aiGenerated false, no approval) still print as written', () => {
    expect(html(withEntry({ ...PROPOSAL, aiGenerated: false, intro: 'My own words about the massage.' }))).toContain('My own words about the massage.');
  });
  it('the server cleaning step (draft save and publish snapshot) drops a proposal; signed owner text stays; signed auto text stays only with the flag', () => {
    const prop = svcCopySanitize(shop({ svcCopy: { 'scalp massage': PROPOSAL } }), SOPTS);
    expect(prop.dropped).toEqual(['scalp massage']);
    expect(prop.siteData.extraPages).not.toHaveProperty('svcCopy');
    const owner = shop({ svcCopy: { 'scalp massage': signedFor('owner') } });
    expect(svcCopySanitize(owner, SOPTS).siteData).toBe(owner);
    const auto = shop({ svcCopy: { 'scalp massage': signedFor('auto') } });
    expect(svcCopySanitize(auto, SOPTS).dropped).toEqual(['scalp massage']);                               // flag off (default)
    expect(svcCopySanitize(auto, { ...SOPTS, autoPublish: false }).dropped).toEqual(['scalp massage']);
    expect(svcCopySanitize(auto, { ...SOPTS, autoPublish: true }).siteData).toBe(auto);
    const own = shop({ svcCopy: { 'scalp massage': { ...PROPOSAL, aiGenerated: false } } });
    expect(svcCopySanitize(own, SOPTS).siteData).toBe(own);
  });
  it('end to end through the publish snapshot with the flag OFF: a proposal and an "auto" entry never reach the render, sitemap or paths', () => {
    delete process.env.SERVICE_COPY_AUTO_PUBLISH;
    for (const e of [PROPOSAL, { ...PROPOSAL, approval: 'auto' }, signedFor('auto')]) {
      const r = validateWebSnapshot(shop({ svcCopy: { 'scalp massage': e } }));
      const b = renderSiteBundle(r.sd, BASE);
      expect([b.sitemap, ...b.pages.map((p) => p.html)].join('\n')).not.toContain(MARK);
      expect(b.sitemap).toBe(baseline.sitemap);
      expect(b.pages.map((p) => p.path).sort()).toEqual(baseline.pages.map((p) => p.path).sort());
      expect((r.sd.extraPages as any).svcCopy).toBeUndefined();
    }
  });
  it('with the flag ON a SIGNED "auto" entry survives the publish snapshot and prints on the deploy render; an unsigned one and a bare proposal do not', () => {
    process.env.SERVICE_COPY_AUTO_PUBLISH = '1';
    try {
      const r = validateWebSnapshot(shop({ svcCopy: { 'scalp massage': signedFor('auto', 'scalp massage', OWNER, 'site') } }));
      expect((r.sd.extraPages as any).svcCopy['scalp massage'].approval).toBe('auto');
      const out = renderPendingBundle({ siteData: r.pendingData, imageUrlMap: r.imageUrlMap, siteId: SLUG }, BASE);
      expect(out.pages.map((p) => p.html).join('\n')).toContain(MARK);
      for (const e of [PROPOSAL, { ...PROPOSAL, approval: 'auto' }]) {
        const x = validateWebSnapshot(shop({ svcCopy: { 'scalp massage': e } }));
        expect(everything(x.sd)).not.toContain(MARK);
      }
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
