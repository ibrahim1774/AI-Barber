// Ibrahim 2026-11-05: no NEW FAQ content. Guide pages and the hub carry no FAQ page, section or Q&A block, and the guide library holds no question.
import { describe, expect, it } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import { GUIDE_HUB, GUIDE_LIBRARY } from '../../lib/render/guideLibrary';
import { GUIDE_PAGE_IDS } from '../../lib/render/guideIds';
import { GUIDE_COPY_KEYS } from '../../lib/render/guidePages';
import type { WebsiteData } from '../../types';

const svc = (title: string) => ({ title, subtitle: '', description: '', price: '$30', duration: '30 min', icon: 'scissors' as const, imageUrl: '' });
const site = (on: string[]): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: 'https://book.example.com/x', template: 'luxe',
  hero: { heading: 'H', tagline: '', imageUrl: '' }, about: { heading: 'A', description: [], imageUrl: '' },
  services: [svc('Haircut'), svc('Skin Fade'), svc('Beard Trim')], gallery: [], contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  hours: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => ({ day, open: '09:00', close: '17:00' })),
  pages: { order: [], hidden: [] }, extraPages: { on, serviceGuides: true, seed: 7 }, source: 'web-app',
} as WebsiteData);

describe('no new FAQ content from guides', () => {
  it('no guide library string is a question or mentions FAQ / frequently asked', () => {
    const all: string[] = [GUIDE_HUB.title, ...GUIDE_HUB.intro.flat(), ...GUIDE_HUB.servicesLine.flat()];
    for (const id of GUIDE_PAGE_IDS) { const g = GUIDE_LIBRARY[id]; all.push(g.title, g.blurb); for (const b of g.blocks) { if (b.h) all.push(b.h); all.push(...b.variants.flat()); } }
    for (const s of all) { expect(s, s).not.toContain('?'); expect(s, s).not.toMatch(/\bfaqs?\b|frequently asked|questions and answers/i); }
  });
  it('no guide copy key is a FAQ key', () => { for (const k of GUIDE_COPY_KEYS) expect(k).not.toMatch(/faq|question/i); });
  it('a site WITHOUT the existing FAQ page gets none from the guides: no faq path, no FAQ link, no question heading on any guide page', () => {
    const b = renderSiteBundle(site([]), { siteBaseUrl: 'https://fresh.example.com' });
    const guides = b.pages.filter((p) => p.path.startsWith('guides/'));
    expect(guides.length).toBeGreaterThan(0);
    expect(b.pages.map((p) => p.path)).not.toContain('faq/index.html');
    for (const g of guides) {
      expect(g.html, g.path).not.toMatch(/faq/i);
      expect(g.html, g.path).not.toMatch(/<h[1-6][^>]*>[^<]*\?<\/h[1-6]>/);
    }
  });
  it('with the existing FAQ page on, it is the same page as before and the guides still add none of their own', () => {
    const b = renderSiteBundle(site(['faq', 'first-visit']), { siteBaseUrl: 'https://fresh.example.com' });
    expect(b.pages.filter((p) => /faq/i.test(p.path))).toHaveLength(1);
    for (const g of b.pages.filter((p) => p.path.startsWith('guides/'))) expect(/<main[\s\S]*<\/main>/.exec(g.html)![0], g.path).not.toMatch(/faq/i);
  });
});
