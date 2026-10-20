import { generateContent } from '@/web/services/geminiService';
import type { WebsiteData } from '@/web/types';
import { renderSite, withImages, forRender } from '@/lib/render';

const inputs = { shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '555-0100' };

describe('vendored web modules', () => {
  test('generateContent builds a site for a shop name', async () => {
    const data = await generateContent(inputs);
    expect(data.shopName).toBe('Fresh Cuts');
    expect(data.services.length).toBeGreaterThan(0);
  });

  test('renderSite renders luxe and prime', async () => {
    const data = await generateContent(inputs);
    for (const template of ['luxe', 'prime'] as const) {
      const html = renderSite({ ...data, template });
      expect(html).toContain('Fresh Cuts');
      expect(html).toContain('name="published-at"');
    }
  });

  test('withImages leaves no placeholders when every slot has a URL', async () => {
    const base = await generateContent(inputs);
    const u = (k: string) => `https://cdn.example.com/${k}.jpg`;
    for (const template of ['luxe', 'prime', 'euphoria'] as const) {
      const data: WebsiteData = {
        ...base,
        template,
        hero: { ...base.hero, imageUrl: u('hero') },
        about: { ...base.about, imageUrl: u('about') },
        gallery: [0, 1, 2, 3, 4, 5].map((i) => u(`gallery${i}`)),
        craftImages: [0, 1, 2].map((i) => u(`craft${i}`)),
        staff: [0, 1].map((i) => ({ name: `S${i}`, role: 'Barber', photo: u(`staff${i}`) })) as WebsiteData['staff'],
      };
      const out = withImages(renderSite(forRender(data)), data);
      expect(out).not.toMatch(/\{\{[a-zA-Z0-9]+\}\}/);
      expect(out).toContain(u('hero'));
    }
  });
});
