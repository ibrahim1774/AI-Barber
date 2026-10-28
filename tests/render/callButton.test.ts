// No booking link: prime and euphoria never print a Book button or the "Book your next visit" strip. A phone makes the
// same slots an honest Call button (tel: link, Call label). With a booking link (own, or the built-in /book) nothing changes.
import { describe, expect, it } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import { visibleLabelKeys } from '../../lib/render/labels';
import type { WebsiteData } from '../../types';

const site = (template: string, multi: boolean, extra: Record<string, unknown> = {}): WebsiteData => ({
  shopName: 'Jax Barber', area: 'Brooklyn, NY', phone: '(512) 555-0100', template,
  hero: { heading: 'Hello', tagline: 'Tag', imageUrl: '' }, about: { heading: 'About', description: ['x'], imageUrl: '' },
  services: [{ title: 'Fade', subtitle: '', description: '', icon: 'scissors', imageUrl: '' }], gallery: [], contact: { address: '1 Main St', email: '' },
  ...(multi ? { pages: { order: [], hidden: [] } } : {}), ...extra,
} as unknown as WebsiteData);
const all = (d: WebsiteData) => renderSiteBundle(d, { siteBaseUrl: 'https://x.example.com' }).pages.map((p) => p.html).join('\n');
const anchorTexts = (html: string) => [...html.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map((m) => m[1].trim());

for (const template of ['prime', 'euphoria']) for (const multi of [false, true]) {
  describe(`${template} ${multi ? 'multi-page' : 'single page'}`, () => {
    it('no booking link: a Call button with a tel: link, no Book button, no booking strip', () => {
      const html = all(site(template, multi));
      const texts = anchorTexts(html);
      expect(texts.some((t) => /^call now$/i.test(t))).toBe(true);
      expect(texts.some((t) => /book/i.test(t))).toBe(false);
      expect(html).not.toContain('Take a Chair');
      expect(html).not.toContain('Ready for');
      expect(html).toMatch(/<a href="tel:[^"]+"[^>]*>Call Now<\/a>|<a [^>]*href="tel:[^"]+"[^>]*>Call now<\/a>/i);
    });
    it('no booking link and no phone: no button at all', () => {
      const texts = anchorTexts(all(site(template, multi, { phone: '' })));
      expect(texts.some((t) => /book|call now/i.test(t))).toBe(false);
    });
    it('own booking link: the Book button is unchanged', () => {
      const html = all(site(template, multi, { bookingUrl: 'https://booksy.com/x' }));
      expect(anchorTexts(html).some((t) => /^book/i.test(t))).toBe(true);
      expect(html).toContain('href="https://booksy.com/x"');
      expect(anchorTexts(html).some((t) => /^call now$/i.test(t))).toBe(false);
    });
    it('built-in /book: the Book button stays', () => {
      const html = all(site(template, multi, { bookingUrl: '/book' }));
      expect(anchorTexts(html).some((t) => /^book/i.test(t))).toBe(true);
    });
    it('the label registry lists the Call labels only without a booking link', () => {
      const nav = template === 'prime' ? 'primeNavCall' : 'euNavCall';
      const book = template === 'prime' ? 'primeNavBook' : 'euNavBook';
      const noLink = visibleLabelKeys(site(template, multi));
      expect(noLink).toContain(nav); expect(noLink).not.toContain(book);
      const link = visibleLabelKeys(site(template, multi, { bookingUrl: '/book' }));
      expect(link).toContain(book); expect(link).not.toContain(nav);
    });
  });
}
