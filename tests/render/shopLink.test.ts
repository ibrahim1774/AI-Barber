import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateHTMLWithPlaceholders } from '../../lib/render/luxe';
import { generatePrimeHTMLWithPlaceholders } from '../../lib/render/prime';
import { generateEuphoriaHTMLWithPlaceholders } from '../../lib/render/euphoria';
import type { WebsiteData } from '../../types';

const fixture = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts Barbershop',
  area: 'Austin, TX',
  phone: '(512) 555-0100',
  hero: { heading: 'Sharp cuts', tagline: 'Walk-ins welcome', imageUrl: 'https://example.com/hero.jpg' },
  about: { heading: 'About', description: ['Family owned.'], imageUrl: 'https://example.com/about.jpg' },
  services: [{ title: 'Haircut', subtitle: '$30', description: 'Classic cut', icon: 'scissors', imageUrl: 'https://example.com/s.jpg' }],
  gallery: [],
  contact: { address: '1 Main St, Austin, TX', email: 'hi@example.com' },
  ...extra,
});

const renderers: Record<string, (d: WebsiteData) => string> = {
  luxe: generateHTMLWithPlaceholders,
  prime: generatePrimeHTMLWithPlaceholders,
  euphoria: generateEuphoriaHTMLWithPlaceholders,
};

beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });

const SHOP = 'https://www.aibarber.org/shop/x';

describe.each(Object.keys(renderers))('%s shop link', (name) => {
  const render = renderers[name];

  it('is unchanged from main when shopUrl is absent', () => {
    expect(render(fixture())).toMatchSnapshot();
  });

  it('treats an empty shopUrl like an absent one', () => {
    expect(render(fixture({ shopUrl: '' }))).toBe(render(fixture()));
  });

  it('adds a nav link and a contact link when shopUrl is set', () => {
    const html = render(fixture({ shopUrl: SHOP }));
    expect(html).not.toBe(render(fixture()));
    const hrefs = html.split(`href="${SHOP}"`).length - 1;
    expect(hrefs).toBe(2);
    expect(html).toMatch(/>\s*Shop\s*</);
    expect(html).toContain('Shop online');
  });

  it('escapes a hostile shopUrl', () => {
    const html = render(fixture({ shopUrl: 'https://x.test/"><script>alert(1)</script>' }));
    expect(html).not.toContain('"><script>alert(1)');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});
