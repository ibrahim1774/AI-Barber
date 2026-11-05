// Review 6d: library patterns match single words ("beard", "design", "cut"), so a product or non-service ("Beard Oil", "Henna Design") got a
// service's wording. On a WEB-created site such a title now resolves to NO guide (thin, noindex, no AI text). iOS and legacy output is unchanged.
// Pure rendering; no model, no network.
import { describe, expect, it } from 'vitest';
import { nonServiceTitle, libraryGuideOverruled } from '../../lib/render/familyKeywords';
import { beardServices, guideForTitle, guideIdForTitle, isBeardTitle, isHaircutTitle, libraryGuideFor, serviceGuideFor, titledServices } from '../../lib/render/guides';
import { renderSiteBundle } from '../../lib/render/site';
import { serviceFacts } from '../../lib/serviceCopy/facts';
import type { WebsiteData } from '../../types';

const site = (titles: string[], source: string | null = 'web-app'): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' }, about: { heading: 'About', description: ['We cut hair.'], imageUrl: '' },
  services: titles.map((title) => ({ title, subtitle: '', description: '', icon: 'scissors', imageUrl: '' })), gallery: [], hours: [{ day: 'Mon', open: '09:00', close: '17:00' }],
  contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' }, pages: { order: [], hidden: [] },
  extraPages: { on: ['faq', 'beard-care', 'hair-care'], serviceGuides: true, seed: 1 } as never, ...(source ? { source } : {}),
} as unknown as WebsiteData);

// Non-service titles. Each one MATCHES a library pattern today (the first column proves it), and must resolve to none on a web site.
const PRODUCTS: string[] = [
  'Beard Oil', 'Beard Balm', 'Beard Wash', 'Beard Shampoo', 'Beard Conditioner', 'Beard Wax', 'Beard Butter', 'Beard Serum', 'Beard Brush', 'Beard Comb', 'Beard Kit', 'Beard Grooming Kit', 'Beard Care Products', 'Beard Product',
  'Beard Cream', 'Beard Lotion', 'Beard Soap', 'Beard Powder', 'Beard Spray', 'Beard Gel', 'Beard Pomade', 'Beard Tonic', 'Beard Gift Card', 'Beard Gift Certificate', 'Beard Cologne',
  'Hair Cut Gift Card', 'Haircut Gift Card', 'Haircut Gift Certificate', 'Haircut E-Gift Card', 'Gift Card for a Haircut', 'Haircut Voucher', 'Fade Gift Card', 'Barber Cut Product', 'Cut Kit', 'Clipper Kit',
  'Henna Design', 'Henna Tattoo', 'Henna Beard Design', 'Tattoo Design', 'Temporary Tattoo Design', 'Hair Tattoo Design', 'Scalp Tattoo Design', 'Piercing Design', 'Hair Design Gift Card', 'Hair Design Kit',
  'Hair Wax', 'Hair Cut Wax', 'Hair Clay', 'Hair Spray', 'Hair Powder', 'Hair Shampoo', 'Hair Pomade', 'Haircut Pomade', 'Fade Pomade', 'Taper Brush', 'Fade Brush', 'Hair Color Kit', 'Color Kit', 'Hair Dye Kit', 'Hair Dye Product',
  'Kids Shampoo', 'Kids Products', 'Kids Gift Card', 'Razor Blades', 'Shaving Cream', 'Shave Kit', 'Shave Gift Card', 'Shaving Brush', 'Shave Soap', 'Aftershave', 'Pre-Shave Oil', 'Shave Oil', 'Shave Balm', 'Razor Gel',
  'Line Up Gift Card', 'Hair Color Gift Card', 'Highlights Gift Card', 'Fade Gift Voucher', 'Taper Gift Card', 'Beard Gift Set Product', 'Cut Merch', 'Barber Merchandise Cut', 'Fade Retail', 'Kids Cut Product', 'Boys Haircut Gift Card', 'Beard Fragrance', 'Beard Ink', 'Henna Beard Ink',
];
// Titles with a product noun AND a service word are services: unchanged.
const SERVICES_WITH_PRODUCT_WORD: [string, string][] = [
  ['Haircut and Beard Oil', 'cut-beard'], ['Beard Trim with Oil', 'beard-trim'], ['Beard Trim & Balm', 'beard-trim'], ['Haircut & Shampoo', 'haircut'], ['Cut and Wash', 'haircut'], ['Hot Towel Shave with Oil', 'shave'],
  ['Beard Wash & Trim', 'beard-trim'], ['Kids Haircut with Wax Style', 'kids-cut'], ['Fade with Gel', 'fade'], ['Beard Shape Up with Balm', 'line-up'], ['Gray Blending Gel Treatment', 'color'], ['Design with Wax', 'design'],
];
// Real services the exclusion must never touch.
const REAL: [string, string][] = [
  ['Haircut', 'haircut'], ['Skin Fade', 'fade'], ['Low Taper', 'taper'], ['Cut & Beard', 'cut-beard'], ['Beard Trim', 'beard-trim'], ['Beard Sculpt', 'beard-trim'], ['Hot Towel Shave', 'shave'], ['Head Shave', 'shave'], ['Kids Haircut', 'kids-cut'],
  ['Line Up', 'line-up'], ['Hair Color', 'color'], ['Highlights', 'color'], ['Hair Design', 'design'], ['Beard Dye', 'color'], ['Kids Beard Trim', 'beard-trim'], ['Buzz Cut', 'haircut'], ['Straight Razor Shave', 'shave'],
];
// Library matches whose OWN word does not mean what the guide says (web only): a beard bleach / tint / perm is not a beard trim.
const BEARD_ODDITIES = ['Beard Bleach', 'Beard Bleaching', 'Beard Tint', 'Beard Perm', 'Beard Relaxer', 'Beard Lightening', 'Beard Extensions', 'Beard Transplant', 'Beard Growth Treatment', 'Beard Restoration', 'Beard Filler'];
const DESIGN_ODDITIES = ['Nail Design', 'Nail Art Design', 'Brow Design', 'Eyebrow Design', 'Lash Design', 'Makeup Design', 'Logo Design', 'Web Design', 'Graphic Design', 'Interior Design'];

describe('products and non-services resolve to none on a web site', () => {
  for (const t of PRODUCTS) {
    it(`${JSON.stringify(t)}`, () => {
      expect(nonServiceTitle(t)).toBe(true);
      const d = site([t]);
      expect(libraryGuideFor(d, t)).toBeNull();
      expect(guideForTitle(d, t)).toBeNull();
      expect(titledServices(d)[0].guide).toBeNull();
      expect(serviceGuideFor(d, [0]).size).toBe(0);
      expect(isBeardTitle(t, d)).toBe(false);
      expect(isHaircutTitle(t, d)).toBe(false);
      expect(beardServices(d)).toEqual([]);
    });
  }
  it('at least 80 non-service titles, and at least 60 of them are ones the library pattern matches today (the quirk being closed)', () => {
    expect(PRODUCTS.length).toBeGreaterThanOrEqual(80);
    expect(PRODUCTS.filter((t) => guideIdForTitle(t) !== null).length).toBeGreaterThanOrEqual(60);
  });
});

describe('iOS and legacy sites are untouched (same library, byte-for-byte)', () => {
  for (const source of ['ios', null]) {
    it(`source ${String(source)}: every product title keeps the library guide`, () => {
      for (const t of [...PRODUCTS, ...BEARD_ODDITIES, ...DESIGN_ODDITIES]) {
        const d = site([t], source);
        expect(guideForTitle(d, t), t).toBe(guideIdForTitle(t));
        expect(libraryGuideFor(d, t), t).toBe(guideIdForTitle(t));
        expect(isBeardTitle(t, d), t).toBe(isBeardTitle(t));
        expect(isHaircutTitle(t, d), t).toBe(isHaircutTitle(t));
      }
    });
  }
  it('no argument = the library as before', () => { expect(isBeardTitle('Beard Oil')).toBe(true); expect(libraryGuideFor(undefined, 'Beard Oil')).toBe('beard-trim'); });
});

describe('services stay services', () => {
  for (const [t, g] of [...REAL, ...SERVICES_WITH_PRODUCT_WORD]) {
    it(`${JSON.stringify(t)} keeps ${g} on a web site`, () => {
      expect(nonServiceTitle(t)).toBe(false);
      expect(guideIdForTitle(t)).toBe(g);
      expect(guideForTitle(site([t]), t)).toBe(g);
      expect(libraryGuideOverruled(t, g as never)).toBe(false);
    });
  }
});

describe('library matches that a guide cannot be true for (web only)', () => {
  for (const t of BEARD_ODDITIES) it(`${t} -> none (not a beard trim)`, () => { expect(guideIdForTitle(t)).not.toBeNull(); expect(guideForTitle(site([t]), t)).toBeNull(); expect(guideForTitle(site([t], 'ios'), t)).toBe(guideIdForTitle(t)); });
  for (const t of DESIGN_ODDITIES) it(`${t} -> none (not a hair design)`, () => { expect(guideIdForTitle(t)).toBe('design'); expect(guideForTitle(site([t]), t)).toBeNull(); });
});

describe('the pages that follow the guide', () => {
  it('a shop whose only "beard" and "cut" titles are products gets no beard-care / hair-care page and no service page text for them', () => {
    const d = site(['Beard Oil', 'Henna Design', 'Haircut Gift Card']);
    const b = renderSiteBundle(d, { siteBaseUrl: 'https://fresh.example.com' });
    const html = b.pages.map((p) => p.html).join('\n');
    expect(html).not.toContain('A beard trim tidies');
    expect(html).not.toContain('A hair design is');
    expect(b.pages.map((p) => p.path)).not.toContain('beard-care/index.html');
    expect(b.pages.map((p) => p.path)).not.toContain('hair-care/index.html');
    for (const slug of ['beard-oil', 'henna-design', 'haircut-gift-card']) expect(b.sitemap ?? '').not.toContain(`/services/${slug}/`);
  });
  it('the same shop on iOS renders exactly as before the change (still the library wording)', () => {
    const b = renderSiteBundle(site(['Beard Oil'], 'ios'), { siteBaseUrl: 'https://fresh.example.com' });
    expect(b.pages.map((p) => p.path)).toContain('beard-care/index.html');
  });
});

describe('no model text is ever written for a non-service title', () => {
  it('serviceFacts refuses products, gift cards and tattoo-like titles (title_not_usable)', () => {
    for (const t of ['Beard Oil', 'Henna Design', 'Gift Card', 'Pomade', 'Product Purchase', 'Hair Spray', 'Tattoo Touch Up', 'Hair Clay', 'Beard Balm']) {
      const d = site([t]);
      const r = serviceFacts(d, t.toLowerCase());
      expect(r.ok, t).toBe(false);
    }
  });
  it('a real custom service is unaffected', () => {
    const d = site(['Hairline Cleanup']);
    expect(serviceFacts(d, 'hairline cleanup').ok).toBe(true);
  });
});

describe('a product word vetoes a family keyword too', () => {
  it('a keyword next to a retail noun never gets a family', async () => {
    const { familyCandidates } = await import('../../lib/render/familyKeywords');
    for (const t of ['Goatee Oil', 'Goatee Balm', 'Bleach Kit', 'Mohawk Pomade', 'Hairline Cream', 'Temple Spray', 'Bald Head Oil', 'Bald Head Gift Card', 'Ombre Shampoo', 'Balayage Kit', 'Freestyle Brush', 'Stencil Kit', 'Toddler Shampoo', 'Soul Patch Wax', 'Undercut Clay', 'Pompadour Powder', 'Mullet Comb']) expect(familyCandidates(t), t).toEqual([]);
    for (const t of ['Mohawk', 'Undercut', 'Toddler Mohawk', 'Hair Trim']) expect(familyCandidates(t).length, t).toBeGreaterThan(0);
  });
});
