// The "Book online" strip's heading and button are label-registry entries (bookStripHeading, bookStripButton).
import { describe, expect, it } from 'vitest';
import { generateHTMLWithPlaceholders } from '../../lib/render/luxe';
import { generatePrimeHTMLWithPlaceholders } from '../../lib/render/prime';
import { generateEuphoriaHTMLWithPlaceholders } from '../../lib/render/euphoria';
import { LABELS, clampLabel, visibleLabelKeys } from '../../lib/render/labels';
import type { TemplateId, WebsiteData } from '../../types';

const render: Record<TemplateId, (d: WebsiteData) => string> = {
  luxe: generateHTMLWithPlaceholders,
  prime: generatePrimeHTMLWithPlaceholders,
  euphoria: generateEuphoriaHTMLWithPlaceholders,
};
const TEMPLATES: TemplateId[] = ['luxe', 'prime', 'euphoria'];

const site = (template: TemplateId, extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Jacks Barbershop',
  area: 'Austin, TX',
  phone: '(512) 555-0142',
  template,
  hero: { heading: 'Sharp cuts', tagline: 'Walk-ins welcome', imageUrl: 'https://x.test/h.jpg' },
  about: { heading: 'About us', description: ['One'], imageUrl: 'https://x.test/a.jpg' },
  services: [{ title: 'Cut', subtitle: '', price: '30', description: 'd', icon: 'scissors', imageUrl: '' }],
  gallery: [], contact: { address: '1 Main St, Austin, TX', email: 'hi@example.com' },
  bookingUrl: '/book',
  ...extra,
});
const strip = (html: string) => html.match(/<section id="book-online".*?<\/section>/s)?.[0] ?? '';

describe('book strip labels', () => {
  it.each(TEMPLATES)('%s: no override prints Book online / Book as before', (tpl) => {
    const s = strip(render[tpl](site(tpl)));
    expect(s).toMatch(/>Book online<\/h2>/);
    expect(s).toMatch(/href="\/book"[^>]*>Book<\/a><\/div><\/section>$/);
  });

  it.each(TEMPLATES)('%s: an override replaces both, escaped', (tpl) => {
    const labels = { bookStripHeading: 'Reserve <script>alert(1)</script>', bookStripButton: 'Go "now"' };
    const html = render[tpl](site(tpl, { labels }));
    const s = strip(html);
    expect(s).toContain('Reserve &lt;script&gt;alert(1)&lt;/script&gt;</h2>');
    expect(s).toContain('>Go &quot;now&quot;</a>');
    expect(s).not.toContain('<script>alert(1)');
  });

  it('are in the registry only when the booking is the site /book page', () => {
    for (const tpl of TEMPLATES) {
      expect(visibleLabelKeys(site(tpl))).toEqual(expect.arrayContaining(['bookStripHeading', 'bookStripButton']));
      for (const bookingUrl of ['https://booksy.com/x', undefined]) {
        const keys = visibleLabelKeys(site(tpl, { bookingUrl }));
        expect(keys).not.toContain('bookStripHeading');
        expect(keys).not.toContain('bookStripButton');
      }
    }
  });

  it('enforce their length limits', () => {
    expect(LABELS.bookStripHeading.max).toBe(40);
    expect(LABELS.bookStripButton.max).toBe(24);
    expect(Array.from(clampLabel('x'.repeat(80), LABELS.bookStripHeading.max)).length).toBe(40);
    expect(Array.from(clampLabel('y'.repeat(80), LABELS.bookStripButton.max)).length).toBe(24);
    const s = strip(render.luxe(site('luxe', { labels: { bookStripButton: 'y'.repeat(80) } })));
    expect(s).toContain(`>${'y'.repeat(24)}</a>`);
    expect(s).not.toContain('y'.repeat(25));
  });
});
