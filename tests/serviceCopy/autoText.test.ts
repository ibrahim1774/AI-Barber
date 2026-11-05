// Ibrahim, 2026-11-05: no "Write it for me", no approval step. A service the library has no pattern for gets page text AUTOMATICALLY, and only
// from the library's own reviewed wording (closed all-token vocabulary, guides.ts). No model, no network, no plan prompt is involved.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import { guideForTitle, NO_FAMILY, serviceAltFor, serviceGuideFor } from '../../lib/render/guides';
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
  it('a custom title made only of reviewed words gets the library wording of its family, indexable and in the sitemap', () => {
    const d = shop(['Mohawk']);
    expect(guideForTitle(d, 'Mohawk')).toBe('haircut');
    expect(page(d, 'mohawk')).toContain('About this service');
    expect(page(d, 'mohawk')).not.toContain(NOINDEX);
    expect(bundle(d).sitemap).toContain('/services/mohawk/');
  });
  it('an automatic Mohawk listed BEFORE Haircut never takes the haircut guide: Haircut stays indexable and in the sitemap, Mohawk gets the alt block', () => {
    for (const order of [['Mohawk', 'Haircut'], ['Haircut', 'Mohawk']]) {
      const d = shop(order);
      expect(page(d, 'haircut'), order.join()).not.toContain(NOINDEX);
      expect(page(d, 'haircut'), order.join()).toContain('About this service');
      expect(bundle(d).sitemap, order.join()).toContain('/services/haircut/');
      expect(serviceAltFor(d, [0, 1]).get(order.indexOf('Mohawk')), order.join()).toBe('haircut');
      expect(serviceGuideFor(d, [0, 1]).get(order.indexOf('Haircut')), order.join()).toBe('haircut');
    }
    expect(page(shop(['Mohawk', 'Haircut']), 'mohawk')).toContain(NOINDEX); // alt block only: thin, as the second of a kind
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
