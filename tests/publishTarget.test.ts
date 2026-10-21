import { describe, it, expect } from 'vitest';
import { withUploadedImageUrls, SUBSCRIPTION_ENDED_MESSAGE } from '../services/publishTarget';
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
