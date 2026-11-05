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
  it('refuses hostile and over-long values with invalid_snapshot', () => {
    for (const v of ['<script>alert(1)</script>', 'x'.repeat(10_000), 'a\nb', '💈 Cuts', 'ALL CAPS SHOUTING', '!!!!']) {
      expect(() => validateWebSnapshot(site({ 'seo.home.title': v }), () => []), v.slice(0, 20)).toThrow('invalid_snapshot');
    }
    expect(() => validateWebSnapshot(site({ 'seo.faq.description': 'x'.repeat(161) }), () => [])).toThrow('invalid_snapshot');
  });
});
