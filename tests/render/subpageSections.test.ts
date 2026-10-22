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
  services: [
    { title: 'Fade', subtitle: '', description: 'Classic', icon: 'scissors', imageUrl: '', price: '30' },
    { title: 'Beard <b>trim</b>', subtitle: '', description: '', icon: 'razor', imageUrl: '' },
    { title: 'Kids cut', subtitle: '', description: '', icon: 'scissors', imageUrl: '', price: '$20' },
    { title: 'Shave', subtitle: '', description: '', icon: 'razor', imageUrl: '', price: '40' },
  ],
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

const section = (html: string, id: string): string => {
  const start = html.indexOf(`<section id="${id}"`);
  if (start < 0) return '';
  return html.slice(start, html.indexOf('</section>', start) + '</section>'.length);
};

describe.each(Object.keys(renderers))('%s with the site /book page', (name) => {
  const render = renderers[name];

  it('Book buttons go to /book in the same tab', () => {
    const html = render(fixture({ bookingUrl: '/book' }));
    const links = html.match(/<a href="\/book"[^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const a of links) expect(a).not.toContain('target="_blank"');
  });

  it('shows the Book online strip with up to 3 services, escaped, prices only when set', () => {
    const strip = section(render(fixture({ bookingUrl: '/book' })), 'book-online');
    expect(strip).toContain('Book online');
    expect(strip).toContain('Fade');
    expect(strip).toContain('$30');
    expect(strip).toContain('Kids cut');
    expect(strip).toContain('$20');
    expect(strip).not.toContain('Shave');
    expect(strip).toContain('Beard &lt;b&gt;trim&lt;/b&gt;');
    expect(strip).not.toContain('<b>trim');
    expect(strip).toContain('href="/book"');
  });

  it('with no services the strip is the heading and the Book button (no empty list)', () => {
    const strip = section(render(fixture({ bookingUrl: '/book', services: [] })), 'book-online');
    expect(strip).toContain('Book online');
    expect(strip).toContain('href="/book"');
    expect(strip).not.toContain('<ul');
  });

  it('no strip for an external booking link, an old aibarber.org link, or none', () => {
    for (const bookingUrl of ['https://booksy.com/x', 'https://www.aibarber.org/book/fresh', undefined]) {
      expect(render(fixture({ bookingUrl }))).not.toContain('id="book-online"');
    }
  });

  it('external booking links still open in a new tab', () => {
    const html = render(fixture({ bookingUrl: 'https://booksy.com/x' }));
    expect(html).toMatch(/<a href="https:\/\/booksy\.com\/x"[^>]*target="_blank"/);
  });
});

describe.each(Object.keys(renderers))('%s with the site /shop page', (name) => {
  const render = renderers[name];

  it('the Shop links go to /shop', () => {
    const html = render(fixture({ shopUrl: '/shop' }));
    expect((html.match(/href="\/shop"/g) ?? []).length).toBeGreaterThanOrEqual(3); // nav, contact, See all
  });

  it('renders the Shop preview hidden, with no server-rendered products and the loader script', () => {
    const html = render(fixture({ shopUrl: '/shop' }));
    const sec = section(html, 'shop-preview');
    expect(sec).toMatch(/^<section id="shop-preview"[^>]*\bhidden\b/);
    expect(sec).toContain('>Shop</h2>');
    expect(sec).toContain('See all');
    expect(sec).not.toContain('ab-sp-card"');
    expect(html).toContain("getElementById('shop-preview')");
  });

  it('no preview for an absolute shop link or none', () => {
    for (const shopUrl of ['https://www.aibarber.org/shop/fresh', undefined]) {
      const html = render(fixture({ shopUrl }));
      expect(html).not.toContain('id="shop-preview"');
      expect(html).not.toContain("getElementById('shop-preview')");
    }
  });
});

describe.each(Object.keys(renderers))('%s without the site pages', (name) => {
  it('adds no new section', () => {
    const html = renderers[name](fixture());
    expect(html).not.toContain('book-online');
    expect(html).not.toContain('shop-preview');
  });
});
