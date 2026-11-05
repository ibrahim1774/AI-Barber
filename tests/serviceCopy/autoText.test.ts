// Ibrahim, 2026-11-05: no "Write it for me", no approval step. A service the library has no pattern for gets page text AUTOMATICALLY, and only
// from the library's own reviewed wording (closed all-token vocabulary, guides.ts). No model, no network, no plan prompt is involved.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import { guideForTitle, NO_FAMILY, serviceAltFor, serviceGuideFor, thinServiceIndexes } from '../../lib/render/guides';
import { svcCopySanitize } from '../../lib/serviceCopy/prune';
import { serviceCopyWriteMode } from '../../lib/serviceCopy/flags';
import { liveDeps } from '../../lib/serviceCopy/handler';
import { rig, scriptedModel, site, TEST_SECRET, U1 } from './helpers';

let net: ReturnType<typeof vi.fn>;
beforeEach(() => { net = vi.fn(async () => { throw new Error('network is blocked in tests'); }); vi.stubGlobal('fetch', net); });
afterEach(() => { expect(net).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });
const shop = (titles: string[], extraPages: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): any => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' }, about: { heading: 'About', description: ['We cut hair.'], imageUrl: '' },
  services: titles.map((t) => svc(t)), gallery: [], hours: [{ day: 'Mon', open: '09:00', close: '17:00' }],
  contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' }, pages: { order: [], hidden: [] },
  extraPages: { on: ['faq'], serviceGuides: true, seed: 7, ...extraPages }, source: 'web-app', ...extra,
});
const bundle = (d: any) => renderSiteBundle(d, { siteBaseUrl: 'https://fresh.example.com' });
const page = (d: any, slug: string) => (bundle(d).pages.find((p) => p.path === `services/${slug}/index.html`)?.html ?? '').replace(/<meta name="published-at"[^>]*>/, '');
const NOINDEX = '<meta name="robots" content="noindex,follow">';

describe('automatic page text from the closed vocabulary (no model, no click)', () => {
  it('a custom title made only of reviewed words shows the library wording of its family but stays NOT indexable: noindex, no sitemap entry, no JSON-LD (ruling 2026-11-05)', () => {
    const d = shop(['Mohawk']);
    expect(guideForTitle(d, 'Mohawk')).toBe('haircut');
    expect(page(d, 'mohawk')).toContain('About this service');
    expect(page(d, 'mohawk')).toContain(NOINDEX);
    expect(bundle(d).sitemap).not.toContain('/services/mohawk/');
    expect(thinServiceIndexes(d, [0]).has(0)).toBe(true);
    const ld = (bundle(d).pages[0].html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) ?? []).join('\n');
    expect(ld).not.toContain('/services/mohawk');
    // LIVE IMPACT parity pin: the search output (robots, sitemap, JSON-LD) is the one of a Mohawk page with no standard text at all, i.e. same as a page with no standard text (the branch's thin rule; origin/main has none, so on live web sites thin service pages become noindex on their next publish)
    const bare = shop(['Mohawk'], { svcFamily: { mohawk: 'none' } });
    expect(bundle(bare).sitemap).toBe(bundle(d).sitemap);
    expect(bundle(bare).pages[0].html.match(/ld\+json[\s\S]*?<\/script>/g)).toEqual(bundle(d).pages[0].html.match(/ld\+json[\s\S]*?<\/script>/g));
    expect(page(bare, 'mohawk')).toContain(NOINDEX);
    expect(page(d, 'mohawk')).not.toMatch(/"@type":\s*"Service"/);
    expect(page(d, 'mohawk')).not.toContain('application/ld+json');
  });
  it('the owner\'s OWN text makes the custom service indexable (existing thin rules): a long description, or text typed for the service', () => {
    const long = { description: 'A tall mohawk with the sides cut short and the centre left long, styled with a little product and finished at the neckline.' };
    const d = shop(['Mohawk']); (d.services[0] as any).description = long.description;
    expect(page(d, 'mohawk')).not.toContain(NOINDEX);
    expect(bundle(d).sitemap).toContain('/services/mohawk/');
    const own = { v: 1, aiGenerated: false, intro: 'A mohawk is cut with the sides short. Tell us how tall you want the middle. Bring a photo.', sections: [{ h: 'Care', p: 'Ask how to style it at home. Use a little product.' }] };
    const o = shop(['Mohawk'], { svcCopy: { mohawk: own } });
    expect(page(o, 'mohawk')).not.toContain(NOINDEX);
    expect(bundle(o).sitemap).toContain('/services/mohawk/');
  });
  it('a library-matched service (Haircut) stays indexable as now, wherever an automatic Mohawk sits: Mohawk is noindex, Haircut keeps the guide, indexable and in the sitemap', () => {
    for (const order of [['Mohawk', 'Haircut'], ['Haircut', 'Mohawk']]) {
      const d = shop(order);
      expect(page(d, 'haircut'), order.join()).not.toContain(NOINDEX);
      expect(page(d, 'haircut'), order.join()).toContain('About this service');
      expect(bundle(d).sitemap, order.join()).toContain('/services/haircut/');
      expect(page(d, 'mohawk'), order.join()).toContain(NOINDEX);
      expect(bundle(d).sitemap, order.join()).not.toContain('/services/mohawk/');
      expect(serviceAltFor(d, [0, 1]).get(order.indexOf('Mohawk')), order.join()).toBe('haircut');
      expect(serviceGuideFor(d, [0, 1]).get(order.indexOf('Haircut')), order.join()).toBe('haircut');
    }
  });
  it('a title with an unknown word, a title with no family and a vetoed title stay thin and noindex: the neutral stub only', () => {
    for (const [t, slug] of [['Mohawk Zorbo', 'mohawk-zorbo'], ['Scalp Massage', 'scalp-massage'], ['Haircut Gift Card', 'haircut-gift-card'], ['Haircut Membership', 'haircut-membership']] as const) {
      const d = shop([t]);
      expect(guideForTitle(d, t), t).toBeNull();
      expect(page(d, slug), t).toContain(NOINDEX);
      expect(page(d, slug), t).not.toContain('About this service');
      expect(bundle(d).sitemap, t).not.toContain(`/services/${slug}/`);
    }
  });
  it('the barber\'s choice beats the automatic type: none is thin and noindex; another allowed type prints that type', () => {
    expect(guideForTitle(shop(['Mohawk'], { svcFamily: { mohawk: NO_FAMILY } }), 'Mohawk')).toBeNull();
    expect(page(shop(['Mohawk'], { svcFamily: { mohawk: 'none' } }), 'mohawk')).toContain(NOINDEX);
    expect(guideForTitle(shop(['Mohawk'], { svcFamily: { mohawk: 'fade' } }), 'Mohawk')).toBe('haircut'); // 'fade' is not allowed by the title's keywords: never another family's wording; counts as not chosen (automatic)
  });
  it('own text wins over both the automatic type and a stored type: the library text never prints beside it', () => {
    const own = { v: 1, aiGenerated: false, intro: 'A mohawk is cut with the sides short. Tell us how tall you want the middle. Bring a photo.', sections: [{ h: 'Care', p: 'Ask how to style it at home. Use a little product.' }] };
    for (const fam of [{}, { svcFamily: { mohawk: 'haircut' } }]) {
      const d = shop(['Mohawk'], { ...fam, svcCopy: { mohawk: own } });
      expect(guideForTitle(d, 'Mohawk')).toBeNull();
      expect(page(d, 'mohawk')).toContain('sides short');
    }
  });
  it('iOS, legacy and single-page sites are untouched: no automatic type off the web-created pages-v2 gate', () => {
    expect(guideForTitle(shop(['Mohawk'], {}, { source: 'ios' }), 'Mohawk')).toBeNull(); // the library pattern as on main: Mohawk is not a library title
    expect(guideForTitle(shop(['Mohawk'], { serviceGuides: false }), 'Mohawk')).toBeNull();
    expect(guideForTitle(shop(['Mohawk'], { serviceGuides: false }), 'Haircut')).toBe('haircut');
  });
});

describe('the barber\'s "none" is kept by every server step', () => {
  const OPTS = { secret: TEST_SECRET, userId: U1, refs: [] as string[] };
  it('kept for a custom service; dropped for a library title, an unknown key, or a service that has text of its own', () => {
    const ok = shop(['Mohawk'], { svcFamily: { mohawk: 'none' } });
    expect(svcCopySanitize(ok, OPTS).siteData).toBe(ok);
    const lib = shop(['Haircut'], { svcFamily: { haircut: 'none' } });
    expect((svcCopySanitize(lib, OPTS).siteData.extraPages as any).svcFamily).toBeUndefined();
    const gone = shop(['Mohawk'], { svcFamily: { other: 'none' } });
    expect((svcCopySanitize(gone, OPTS).siteData.extraPages as any).svcFamily).toBeUndefined();
    const withText = shop(['Mohawk'], { svcFamily: { mohawk: 'none' }, svcCopy: { mohawk: { v: 1, aiGenerated: false, intro: 'x y z. a b c. d e f.', sections: [] } } });
    expect((svcCopySanitize(withText, OPTS).siteData.extraPages as any).svcFamily).toBeUndefined();
    const junk = shop(['Mohawk'], { svcFamily: { mohawk: 'None ' } });
    expect((svcCopySanitize(junk, OPTS).siteData.extraPages as any).svcFamily).toBeUndefined();
  });
});

describe('Mode B (a model writing page text) is dormant: off by default, unreachable', () => {
  it('SERVICE_COPY_WRITE_MODE is on only for the exact string 1', () => {
    for (const v of [undefined, '', '0', 'true', 'on', ' 1', '1\n', 'yes']) expect(serviceCopyWriteMode({ SERVICE_COPY_WRITE_MODE: v }), String(v)).toBe(false);
    expect(serviceCopyWriteMode({ SERVICE_COPY_WRITE_MODE: '1' })).toBe(true);
    delete process.env.SERVICE_COPY_WRITE_MODE;
    expect(liveDeps().writeMode()).toBe(false);
  });
  it('with the flag off, write and approve answer 404 first of all: no sign-in check, no store access, no model call', async () => {
    for (const mode of ['write', 'approve']) {
      const model = scriptedModel();
      const r = rig({ writeMode: false, model });
      const res = await r.call({ titleKey: 'scalp massage', mode }, { auth: null, raw: true });
      expect([res.code, res.body], mode).toEqual([404, { error: 'not_found' }]);
      expect(model.calls.length + model.checks.length).toBe(0);
      expect(r.store.rows.size).toBe(0);
      const signedIn = await r.call({ titleKey: 'scalp massage', mode }, { raw: true });
      expect(signedIn.code, mode).toBe(404);
      expect(model.calls.length + model.checks.length).toBe(0);
    }
  });
  it('with the flag on (tests only) the old behaviour is still there', async () => {
    const r = rig({ writeMode: true });
    expect((await r.call({ titleKey: 'scalp massage', mode: 'write' }, { raw: true })).code).toBe(200);
  });
});

describe('which library-matched service of one family takes the guide (closest title, not list order)', () => {
  const orders = [['Mohawk Cut', 'Haircut'], ['Haircut', 'Mohawk Cut']];
  it('Haircut takes the haircut guide, is indexable and in the sitemap; Mohawk Cut gets the alt block only and stays noindex, in both orders', () => {
    for (const order of orders) {
      const d = shop(order);
      const h = order.indexOf('Haircut'); const m = order.indexOf('Mohawk Cut');
      expect(serviceGuideFor(d, [0, 1]).get(h), order.join()).toBe('haircut');
      expect(serviceGuideFor(d, [0, 1]).has(m), order.join()).toBe(false);
      expect(serviceAltFor(d, [0, 1]).get(m), order.join()).toBe('haircut');
      expect(thinServiceIndexes(d, [0, 1]).has(h), order.join()).toBe(false);
      expect(thinServiceIndexes(d, [0, 1]).has(m), order.join()).toBe(true);
      expect(page(d, 'haircut'), order.join()).not.toContain(NOINDEX);
      expect(page(d, 'haircut'), order.join()).toContain('About this service');
      expect(bundle(d).sitemap, order.join()).toContain('/services/haircut/');
      expect(page(d, 'mohawk-cut'), order.join()).toContain(NOINDEX);
      expect(page(d, 'mohawk-cut'), order.join()).not.toContain(page(d, 'haircut').match(/<h2[^>]*>About this service<\/h2>(<div class="ab-copy ab-prose"><p>[^<]*)/)?.[1] ?? 'NOMATCH'); // not the guide text itself
      expect(bundle(d).sitemap, order.join()).not.toContain('/services/mohawk-cut/');
    }
  });
  it('the same holds with Mohawk, Fade, Beard Trim, Scalp Massage around them', () => {
    const d = shop(['Mohawk Cut', 'Haircut', 'Fade', 'Beard Trim', 'Scalp Massage']);
    expect(serviceGuideFor(d, [0, 1, 2, 3, 4]).get(1)).toBe('haircut');
    expect(serviceGuideFor(d, [0, 1, 2, 3, 4]).has(0)).toBe(false);
    expect(bundle(d).sitemap).toContain('/services/haircut/');
  });
  it('a looser title never beats an exact one of any family; equal titles keep the barber order; an owner-written Mohawk Cut is indexable with its own text', () => {
    expect(serviceGuideFor(shop(['Skin Fade', 'Fade']), [0, 1]).get(1)).toBe('fade');
    expect(serviceGuideFor(shop(["Men's Haircut", 'Haircut']), [0, 1]).get(0)).toBe('haircut');
    expect(serviceGuideFor(shop(['Mohawk Cut', 'Undercut']), [0, 1]).get(0)).toBe('haircut');
    const d = shop(['Mohawk Cut', 'Haircut']); (d.services[0] as any).description = 'x'.repeat(90);
    expect(thinServiceIndexes(d, [0, 1]).has(0)).toBe(false);
    expect(thinServiceIndexes(d, [0, 1]).has(1)).toBe(false);
  });
  it('legacy and iOS sites keep main behaviour: first library title in list order takes the guide', () => {
    for (const extra of [{ source: 'ios' }, { source: undefined }]) {
      const d = shop(['Mohawk Cut', 'Haircut'], {}, extra as any);
      expect(serviceGuideFor(d, [0, 1]).get(0)).toBe('haircut');
      expect(serviceGuideFor(d, [0, 1]).has(1)).toBe(false);
    }
  });
});
