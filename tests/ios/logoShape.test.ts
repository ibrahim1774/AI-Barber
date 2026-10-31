import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validationProblem, restoreImageUrls } from '../../lib/ios/siteShape.js';
import { buildImageUrlMap, toPendingSiteData } from '../../lib/ios/pendingData.js';
import type { WebsiteData } from '../../types.js';

const OK = 'https://storage.googleapis.com/bkt/ios-drafts/abc-123/logo/a.png';
const base = (logo?: unknown): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'x', phone: '1', hero: { heading: 'h', tagline: 't', imageUrl: '' }, about: { heading: 'a', description: ['d'], imageUrl: '' },
  services: [], gallery: [], contact: { address: 'a', email: '' }, ...(logo === undefined ? {} : { logo }),
} as unknown as WebsiteData);

let was: string | undefined;
beforeEach(() => { was = process.env.GCS_BUCKET_NAME; process.env.GCS_BUCKET_NAME = 'bkt'; });
afterEach(() => { if (was === undefined) delete process.env.GCS_BUCKET_NAME; else process.env.GCS_BUCKET_NAME = was; });

describe('site shape: logo (shared by app publish and admin saves)', () => {
  it('a good logo, or none, passes', () => {
    expect(validationProblem(base({ url: OK, w: 600, h: 200 }))).toBeNull();
    expect(validationProblem(base())).toBeNull();
  });
  it('a foreign URL, a non-png/jpeg or bad w/h is a problem', () => {
    for (const logo of [{ url: 'https://evil.example.com/a/logo/a.png', w: 5, h: 5 }, { url: OK.replace('.png', '.gif'), w: 5, h: 5 }, { url: OK, w: 'x', h: 5 }, { url: OK, w: 5, h: 99999 }, 'x', 5]) {
      expect(validationProblem(base(logo)), JSON.stringify(logo)).toMatch(/logo/);
    }
  });
});

describe('pending shape: logo', () => {
  it('a valid logo goes to the map and back; an invalid one never reaches the map, so the name shows', () => {
    const good = base({ url: OK, w: 600, h: 200 });
    const map = buildImageUrlMap(good);
    expect(map.logo).toBe(OK);
    const pending = toPendingSiteData(good, map);
    expect(pending.logo).toEqual({ url: 'uploaded', w: 600, h: 200 });
    expect(restoreImageUrls(pending, map).logo).toEqual({ url: OK, w: 600, h: 200 });

    const foreign = base({ url: 'https://evil.example.com/x/logo/a.png', w: 5, h: 5 });
    const m2 = buildImageUrlMap(foreign);
    expect('logo' in m2).toBe(false);
    expect(toPendingSiteData(foreign, m2).logo).toBeUndefined();
  });
});
