import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withUploadedImageUrls, SUBSCRIPTION_ENDED_MESSAGE, checkoutProofFor, deployErrorMessage, rememberCheckoutProof } from '../services/publishTarget';
import type { WebsiteData } from '../types';

describe('withUploadedImageUrls', () => {
  it('substitutes uploaded URLs (hero, about, gallery, staff) and strips leftover data: URLs', () => {
    const data = {
      shopName: 'S',
      hero: { heading: 'H', imageUrl: 'data:image/jpeg;base64,AAA' },
      about: { heading: 'A', imageUrl: 'https://keep/about.jpg' },
      gallery: ['data:image/png;base64,BBB', 'https://keep/g1.jpg', ''],
      craftImages: ['data:image/png;base64,CCC'],
      services: [],
      staff: [{ name: 'Sam', photo: 'data:image/jpeg;base64,DDD' }],
    } as unknown as WebsiteData;
    const out = withUploadedImageUrls(data, { hero: 'https://gcs/hero.jpg', gallery0: 'https://gcs/g0.jpg', staff0: 'https://gcs/s0.jpg' });
    expect(out.hero.imageUrl).toBe('https://gcs/hero.jpg');
    expect(out.about.imageUrl).toBe('https://keep/about.jpg');
    expect(out.gallery).toEqual(['https://gcs/g0.jpg', 'https://keep/g1.jpg', '']);
    expect(out.craftImages).toEqual(['']);
    expect(out.staff).toEqual([{ name: 'Sam', photo: 'https://gcs/s0.jpg' }]);
    expect(JSON.stringify(out)).not.toContain('data:');
  });
  it('the 402 message is the one the brief specifies', () => {
    expect(SUBSCRIPTION_ENDED_MESSAGE).toBe("This site's subscription has ended. Open the AI Barber app to resubscribe and bring it back.");
  });
});

describe('checkout proof (first publish after paying, before an account exists)', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is returned only for the slug it was paid for', () => {
    rememberCheckoutProof('fresh-cuts', 'cs_live_abc');
    expect(checkoutProofFor('fresh-cuts')).toBe('cs_live_abc');
    expect(checkoutProofFor('other-shop')).toBeNull();
  });

  it('never throws without storage or with junk in it', () => {
    store.set('checkoutProof', '{not json');
    expect(checkoutProofFor('fresh-cuts')).toBeNull();
    vi.stubGlobal('localStorage', undefined);
    expect(checkoutProofFor('fresh-cuts')).toBeNull();
    expect(() => rememberCheckoutProof('a', 'b')).not.toThrow();
  });
});

describe('deployErrorMessage', () => {
  it('explains each refusal', () => {
    expect(deployErrorMessage(401, { error: 'sign-in-required' })).toMatch(/sign in/i);
    expect(deployErrorMessage(403, { error: 'not-authorized' })).toMatch(/different account/i);
    expect(deployErrorMessage(403, { error: 'checkout-not-valid' })).toMatch(/payment is safe/i);
    expect(deployErrorMessage(403, { error: 'new-site-needs-checkout' })).toMatch(/renamed your shop/i);
    expect(deployErrorMessage(429, {})).toMatch(/wait a minute/i);
    expect(deployErrorMessage(503, {})).toMatch(/temporarily unavailable/i);
    expect(deployErrorMessage(500, { error: 'Deployment failed' })).toBe('Deployment failed: Deployment failed');
  });
});
