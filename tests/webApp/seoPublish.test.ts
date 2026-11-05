// The publish snapshot check: a web publish refuses an invalid seo.* value before any write (Phase 1 step 4).
import { describe, expect, it } from 'vitest';
import { validateWebSnapshot } from '../../lib/webApp/publishFlow';

const site = (copy?: Record<string, unknown>) => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn', phone: '555-0100',
  hero: { heading: 'H', tagline: 'T', imageUrl: 'https://img.example/hero.jpg' },
  about: { heading: 'A', description: ['d'], imageUrl: '' },
  services: [{ title: 'Fade', name: 'Fade', price: '$30', imageUrl: '' }],
  gallery: [], craftImages: [], staff: [], contact: { address: '1 Main St', email: 'a@b.co' }, source: 'web-app',
  ...(copy ? { copy } : {}),
});

describe('validateWebSnapshot and seo.* copy keys', () => {
  it('accepts a snapshot with valid, empty or no seo keys', () => {
    expect(() => validateWebSnapshot(site(), () => [])).not.toThrow();
    expect(() => validateWebSnapshot(site({ 'seo.home.title': 'Fresh Cuts', 'seo.home.description': '' }), () => [])).not.toThrow();
  });
  it('ignores hostile and over-long values (they fall back to the default) and reports them, never refuses the publish', () => {
    for (const v of ['<script>alert(1)</script>', 'x'.repeat(10_000), 'a\nb', '💈 Cuts', 'ALL CAPS SHOUTING', '!!!!', 'ㅤㅤ', '1️⃣ Cuts']) {
      const r = validateWebSnapshot(site({ 'seo.home.title': v, 'seo.home.description': 'A fine description.' }), () => []);
      expect(r.seoFallbacks.map((p) => [p.page, p.field]), v.slice(0, 20)).toEqual([['home', 'title']]);
      expect((r.sd.copy as any)['seo.home.title']).toBeUndefined();
      expect((r.sd.copy as any)['seo.home.description']).toBe('A fine description.');
      expect((r.pendingData.copy as any)['seo.home.title']).toBeUndefined();
    }
    const r = validateWebSnapshot(site({ 'seo.faq.description': 'x'.repeat(161) }), () => []);
    expect(r.seoFallbacks).toMatchObject([{ page: 'faq', field: 'description', reason: 'too_long' }]);
  });
  it('a valid snapshot reports no fallbacks', () => {
    expect(validateWebSnapshot(site({ 'seo.home.title': 'Fresh Cuts' }), () => []).seoFallbacks).toEqual([]);
  });
  it('guide page texts: an invalid guides.* value is ignored and reported with the seo ones, a valid one reaches the pending data', () => {
    const r = validateWebSnapshot(site({ 'guides.hub.title': 'Read first', 'guides.face-shape.intro': '<b>x</b>', 'guides.zzz.title': 'x', 'seo.home.title': 'Fresh Cuts' }), () => []);
    expect(r.seoFallbacks.map((p) => [p.key, p.reason])).toEqual([['guides.face-shape.intro', 'markup'], ['guides.zzz.title', 'bad_key']]);
    expect(r.pendingData.copy).toEqual({ 'guides.hub.title': 'Read first', 'seo.home.title': 'Fresh Cuts' });
  });
  it('still refuses a structurally broken copy', () => {
    expect(() => validateWebSnapshot({ ...site(), copy: ['x'] }, () => [])).toThrow('invalid_snapshot');
  });
});
