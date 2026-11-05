// Review 6g: on a web-created pages-v2 site with service guides ON, the guide of every service title, the FAQ subject and the price / time
// attribution come ONLY from the closed all-token vocabulary (familyKeywords.ts structuralGuide); web-created sites have no FAQ at all. This file is
//   1. the MATRIX: >= 300 titles through the REAL renderer (renderSiteBundle), each with its exact expected guide (or none), page robots and FAQ;
//   2. the SENTENCE-TRUTH table: for every guide, every title the vocabulary can build satisfies a per-guide truth predicate;
//   3. the vocabulary audit and property tests (an unknown word anywhere makes a title none);
//   4. PARITY: everything outside the gate is exactly origin/main 08186dc (guides off, iOS, legacy).
// Pure rendering, no model, no network.
import { describe, expect, it } from 'vitest';
import { GUIDES, SERVICE_ALT } from '../../lib/render/copyLibrary';
import { GUIDE_IDS, type GuideId } from '../../lib/render/copyRules';
import { FAMILY_VETO, FAMILY_VOCAB, familyCandidates, nonServiceTitle, structuralGuide } from '../../lib/render/familyKeywords';
import { blockText, guideForTitle, guideIdForTitle, lenientEnv, resolveBlock, svcTitleKey } from '../../lib/render/guides';
import { renderSiteBundle } from '../../lib/render/site';
import { baselineAvailable, loadBaseline } from './helpers/iosBaseline';
import type { WebsiteData } from '../../types';

// ── The matrix ─────────────────────────────────────────────────────────────────────────────────────
const P = (g: GuideId, ...titles: string[]): [string, GuideId][] => titles.map((t) => [t, g]);
const N = (...titles: string[]): [string, null][] => titles.map((t) => [t, null]);

/** Realistic barber titles: each must keep a TRUE guide, so the feature stays useful. */
const POSITIVE: [string, GuideId][] = [
  ...P('haircut', 'Haircut', "Men's Haircut", 'Mens Haircut', 'Adult Haircut', 'Regular Haircut', 'Classic Haircut', 'Standard Haircut', 'Senior Haircut', "Women's Haircut", 'Ladies Haircut', 'Haircuts', 'Hair Cut', 'Cut',
    'Buzz Cut', 'Crew Cut', 'Scissor Cut', 'Clipper Cut', 'Short Haircut', 'Long Haircut', 'Haircut for Men', "Gentlemen's Haircut", 'Layered Haircut', 'Textured Haircut', 'Pompadour Cut', 'Mohawk', 'Mullet', 'Undercut', 'Caesar',
    'Faux Hawk', 'Flat Top', 'High and Tight', 'Hair Trim', 'Basic Haircut', "Women's Hair Trim", 'Crew Cut for Men',
    // 6h (review 6g S1): common realistic titles
    'Haircut (Men)', 'Haircut (Long Hair)', 'Adult Haircut (13+)', 'Senior Haircut (65+)', 'Military Cut', 'Executive Cut', 'Gents Haircut', "Gent's Cut", 'Under Cut', 'Tapered Haircut', 'Tapered Cut', 'Curly Cut', 'Curly Haircut', 'Afro Cut',
    'Afro Haircut', 'Teen Haircut', 'Youth Haircut', 'Student Haircut', 'Students Haircut', 'Senior Citizen Haircut', 'Veteran Haircut', 'Military Haircut', 'Haircut Only', 'Cut Only', "Men's Haircuts", 'Hair Cuts'),
  ...P('kids-cut', 'Kids Haircut', 'Kids Cut', "Kid's Haircut", "Kids' Haircut", "Children's Haircut", 'Childrens Haircut', 'Children Haircut', 'Child Haircut', "Child's Haircut", 'Boys Haircut', "Boy's Haircut", 'Boys Cut', 'Girls Haircut',
    'Junior Haircut', 'Juniors Haircut', 'Toddler Haircut', 'Toddler Mohawk', 'Toddler Hair Trim', 'Kids Fade', 'Boys Taper', 'Kids Buzz Cut', 'Kids Mohawk', 'Kids Hair Cut', 'Haircut for Kids', 'Haircut for Children', 'Kids Crew Cut', 'Kids Undercut',
    'Kids Haircut (Under 12)', 'Kids Haircut 12 & Under', 'Kids Haircut (Ages 5-12)', 'Little Kids Cut', 'Kids Trim', 'Toddler Trim', 'Childs Haircut'),
  ...P('fade', 'Fade', 'Fades', 'Skin Fade', 'Low Fade', 'Mid Fade', 'High Fade', 'Drop Fade', 'Burst Fade', 'Temple Fade', 'Bald Fade', 'Taper Fade', 'Shadow Fade', "Men's Fade", 'Fade Haircut', 'Fade Cut', 'Low Skin Fade', 'High Skin Fade',
    'Mid Skin Fade', 'Classic Fade', 'Fade for Men', 'Low Taper Fade', 'Mid Taper Fade', 'High Taper Fade', 'Haircut Fade', 'Mohawk Fade', 'Burst Fade Mohawk'),
  ...P('taper', 'Taper', 'Low Taper', 'Mid Taper', 'High Taper', 'Classic Taper', "Men's Taper", 'Taper Haircut', 'Taper Cut', 'Short Taper', 'Regular Taper', 'Taper Mohawk'),
  ...P('line-up', 'Line Up', 'Line-Up', 'Lineup', 'Line Ups', 'Shape Up', 'Shape-Up', 'Shapeup', 'Edge Up', 'Edge-Up', 'Edgeup', "Men's Line Up", 'Basic Line Up', 'Classic Lineup', 'Line Up for Men', 'Regular Shape Up', 'Razor Line Up', 'Line Up with Razor', 'Hairline Line Up'),
  ...P('beard-trim', 'Beard Trim', 'Beard Trims', 'Beard Shaping', 'Beard Shape', 'Beard Sculpt', 'Beard Sculpting', 'Beard Cut', "Men's Beard Trim", 'Full Beard Trim', 'Short Beard Trim', 'Classic Beard Trim', 'Beard Trim for Men', 'Standard Beard Trim', 'Beard Cleanup', 'Beard Clean Up', 'Beard Line Up', 'Beard Lineup', 'Beard Shape Up', 'Beard Edge Up'),
  ...P('shave', 'Shave', 'Shaves', 'Shaving', 'Hot Towel Shave', 'Straight Razor Shave', 'Razor Shave', 'Wet Shave', 'Traditional Shave', 'Head Shave', "Men's Shave", 'Classic Shave', 'Hot Shave', 'Beard Shave', 'Classic Hot Towel Shave', 'Head Shave for Men', 'Face Shave', 'Clean Shave', 'Royal Shave', 'Luxury Shave', 'Shave and Hot Towel', 'Shave & Hot Towel'),
  ...P('design', 'Hair Design', 'Hair Designs', 'Hair Art', 'Haircut Design', 'Haircut Designs', 'Cut Design', 'Custom Hair Design', 'Simple Hair Design', "Men's Hair Design", 'Design', 'Designs', 'Freestyle Design', 'Hard Part', 'Razor Part'),
  ...P('cut-beard', 'Haircut & Beard', 'Haircut and Beard', 'Haircut + Beard', 'Haircut with Beard', 'Haircut & Beard Trim', 'Haircut and Beard Trim', 'Cut & Beard', 'Cut and Beard Trim', 'Fade & Beard', 'Fade and Beard Trim', 'Fade + Beard',
    'Taper & Beard', 'Taper and Beard', "Men's Haircut & Beard Trim", 'Beard & Haircut', 'Beard Trim & Haircut', 'Beard and Fade', 'Beard Trim + Fade', 'Haircut and a Beard', 'Mohawk & Beard', 'Skin Fade & Beard Trim', 'Low Taper + Beard Trim',
    'Buzz Cut & Beard', 'Haircut & Beard Shaping', 'Haircut & Beard Sculpt', 'Cut + Beard',
    // 6h NIT 1: a joiner inside a core ("high AND tight") is not a second joiner
    'High and Tight & Beard', 'Beard & High and Tight', 'High & Tight and Beard Trim', 'Beard Trim with High and Tight', 'High and Tight + Beard'),
];

/** Hostile, odd and out-of-scope titles from every review report (6c to 6f): none. */
const NEGATIVE: [string, null][] = [
  // combos of families without a true combo rule
  ...N('Haircut & Shave', 'Haircut + Shave', 'Haircut and Hot Towel', 'Haircut & Wash', 'Haircut + Shampoo', 'Haircut & Style', 'Haircut + Facial', 'Haircut & Massage', 'Haircut and Hair Wash and Hot Towel', 'Fade & Shave', 'Fade + Design',
    'Fade and Line Up', 'Taper + Line Up', 'Fade with Color', 'Fade + Highlights', 'Fade and Facial', 'Haircut Package', 'Haircut Combo', 'Haircut + Photo', 'Haircut & Line Up', 'Haircut + Design', 'Haircut and Shave and Beard',
    'Beard & Shave', 'Beard Trim & Shave', 'Beard Trim & Line Up', 'Kids Haircut & Beard', 'Line Up & Beard Trim', 'Haircut & Fade', 'Fade & Taper', 'Shave & Line Up', 'Hot Towel Shave & Haircut', 'Haircut Beard', 'Haircut/Beard Combo',
    'Haircut & Beard & Shave', 'Low Fade Line Up', 'Haircut and Haircut', 'Fade + Line Up + Beard', 'Skin Fade & Design', 'Kids Fade & Line Up', 'Haircut & Beard Oil', 'Beard Trim with Oil', 'Haircut & Beard Dye'),
  // more than one haircut, memberships, packages, passes, subscriptions, vouchers, gifts, fees
  ...N('Two Haircuts', 'Haircut for Two', 'Haircut x2', 'Couples Haircut', 'Family Haircut', 'Group Haircut', 'Father and Son Cut', 'Dad & Son Haircut', 'Haircut Deposit', 'Haircut Membership', 'Haircut Subscription', 'Monthly Haircut Plan',
    'Unlimited Haircuts', 'Haircut Consultation', 'Haircut Lesson', 'Haircut Pass', 'Haircut Voucher', 'Haircut Gift Card', 'Haircut Gift', 'Haircut Credit', 'Haircut Punch Card', 'Haircut Class', 'Haircut Course', 'Haircut Fee', 'Haircut Tip',
    '10 Haircuts', 'Haircut Bundle', 'Haircut Special', 'VIP Haircut', 'Premium Haircut', 'Deluxe Haircut', 'Luxury Haircut', 'Executive Haircut', 'Fade Membership', 'Beard Trim Membership', 'Shave Package', 'Line Up Pass', 'Kids Haircut Package',
    'Kids Haircut Membership', 'Monthly Membership', 'Annual Pass', 'Gift Card', 'Gift Certificate', 'Voucher', 'Deposit', 'Booking Fee', 'Package Deal', 'Loyalty Card', 'Subscription'),
  // wrong subject: partial cuts, animals, other body parts, ages the kids guide is not for
  ...N('Eyelash Cut', 'Teenager Haircut', 'Cat Haircut', 'Puppy Cut', 'Puppy Haircut', 'Dog Haircut', 'Dog Cut', 'Pet Haircut', 'Nail Cut', 'Wig Cut', 'Extension Cut', 'Bang Cut', 'Fringe Cut', 'Sideburn Cut',
    'Bang Trim', 'Bangs Trim', 'Fringe Trim', 'Neck Trim', 'Eyebrow Cut', 'Mustache Trim', 'Moustache Trim', 'Goatee Trim', 'Nose Trim', 'Ear Trim', 'Beard Fade', 'Kids Beard Trim', 'Infant Haircut', 'Baby Haircut',
    "Baby's First Haircut", 'Infant Hair Trim', 'Babies First Haircut', 'Pompadour', 'Classic Pompadour', 'First Haircut', 'Parent and Child Haircut', 'Mommy and Me Haircut', 'Short Back and Sides'),
  // color: no color guide on a web site (nothing guarantees dye, toner or a method)
  ...N('Bleach', 'Balayage', 'Frosted Tips', 'Hair Bleach', 'Bleach Blonde', 'Platinum Blonde', 'Highlights', 'Hair Color', 'Hair Colour', 'Hair Dye', 'Gray Blending', 'Beard Dye', 'Color Consultation', 'Hair Color Consultation', 'Color Contacts',
    'Toner', 'Ombre', 'Ombre Lips', 'Blonde', 'Root Touch Up', 'Full Color', 'Color', 'Gray Coverage'),
  // other services and the words that burned us
  ...N('Hairline Unit', 'Hairline Cleanup', 'Scalp Massage', 'Hot Towel Facial', 'Hot Towel', 'Eyebrow Threading', 'Shave Cream', 'Beard Oil', 'Henna Design', 'Gel Manicure', 'Eyelash Lift', 'Temple Fade Removal', 'Undercut Design Stencil',
    'Kids Party Package', 'Kids Cornrows', 'Kids Locs', 'Kids Braids', 'Braids', 'Locs', 'Twists', 'Perm', 'Relaxer', 'Keratin Treatment', 'Blowout', 'Wash and Style', 'Shampoo', 'Scalp Treatment', 'Beard Balm', 'Beard Wash', 'Beard Bleach',
    'Beard Tint', 'Nail Design', 'Logo Design', 'Web Design', 'Interior Design', 'Graphic Design', 'Brow Design', 'Tattoo Design', 'Waxing', 'Facial', 'Massage', 'Manicure', 'Pedicure', 'Mask', 'Hair Treatment', 'Hair Transplant', 'Styling'),
  // retail goods, repairs and other trades the old contains-matching called a haircut
  ...N('Clippers', 'Hair Clippers', 'Scissors', 'Scissor Set', 'Clipper Set', 'Clipper Repair', 'Clipper Sharpening', 'Scissor Sharpening', 'Clipper Rental', 'Lawn Cut', 'Grass Cut', 'Tree Cut', 'Key Cut', 'Glass Cut', 'Diamond Cut', 'Steak Cut',
    'Fabric Cut', 'Cut Flowers', 'Paper Cut Art', 'Cut and Sew', 'Cut Crease Makeup', 'Crew Cut Socks', 'Crew Neck Tee', 'Buzz Lightyear Party', 'Taper Candles', 'Taper Candle Holder', 'Fade Cream', 'Fade Brush', 'Razor Blades', 'Shaving Cream',
    'Shave Kit', 'Straight Razor', 'Razor', 'Trimmer', 'Hot Towel Warmer', 'Pomade', 'Hair Spray', 'Hair Wax', 'T-Shirt', 'Merch', 'Barber Cape', 'Cut Kit', 'Fade Pomade', 'Beard Kit'),
  // not letters: digits, symbols, emoji, look-alike letters, connectors alone, over-long titles
  ...N('Haircut 2', '2 Haircuts', 'Haircut $20', '30 Min Haircut', 'Haircut #1', 'Haircut ✂️', 'Haіrcut', 'Skin Fadе', '&', '+', 'And', 'For', 'The Haircut', 'A Haircut', 'Haircut for', 'and Haircut', 'Haircut and', 'Haircut &', '& Haircut',
    "Men's Classic Regular Standard Basic Haircut For Adult Men", 'Haircut - Beard', 'Haircut (Beard)', 'Haircut!', 'Haircut?',
    // 6h: a qualifier is only an age or a plain descriptor; a bare number, a count or a pack is not
    'Haircut (2)', 'Haircut (2 people)', 'Haircut (10 pack)', 'Haircut 2 Beard', 'Haircut Under 12 Beard', 'Kids Haircut (Beard)', 'Haircut (Under 12) Beard', 'Haircut (Under 12) (Under 5)', 'Haircut (Dog)'),
  // 6h: the carved-out "face" (Face Shave) and the bare "design" must not let another trade or product in
  ...N('Shave Face', 'Face Mask', 'Face Wash', 'Face Waxing', 'Facial Shave', 'Face Haircut', 'Logo Design Haircut', 'Haircut with Design', 'Fade with Design', 'Kids Haircut & Design', 'Part', 'Pet Design', 'Design Package', 'Design Membership',
    'Hard Part Membership', 'Beard Cleanup Kit', 'Royal Haircut', 'Line Up & Beard', 'Teen Beard Trim', 'Kids Line Up', 'Shave and Hot Towel Package', 'Under Cut Clippers'),
];
const MATRIX: [string, GuideId | null][] = [...POSITIVE, ...NEGATIVE];
// ── Rendering helpers (the real renderer) ──────────────────────────────────────────────────────────
type Svc = { title: string; price?: string; duration?: string };
const siteWith = (services: Svc[], opts: { source?: string | null; guides?: boolean; family?: Record<string, GuideId> } = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' }, about: { heading: 'About', description: ['We cut hair.'], imageUrl: '' },
  services: services.map((s) => ({ subtitle: '', description: '', icon: 'scissors', imageUrl: '', ...s })), gallery: [], hours: [{ day: 'Mon', open: '09:00', close: '17:00' }],
  contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' }, pages: { order: [], hidden: [] },
  extraPages: { on: ['faq', 'hair-care', 'beard-care'], serviceGuides: opts.guides ?? true, seed: 1, ...(opts.family ? { svcFamily: opts.family } : {}) } as never,
  ...(opts.source === null ? {} : { source: opts.source ?? 'web-app' }),
} as unknown as WebsiteData);
/** A family choice stored for every title (the worst case: whatever the classifier or owner picked must not smuggle a guide in). */
const familyFor = (titles: string[], g: GuideId): Record<string, GuideId> => Object.fromEntries(titles.map((t) => [svcTitleKey(t), g]));
const decode = (h: string): string => h.replace(/<style[^]*?<\/style>/g, ' ').replace(/<script[^]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
const norm = (s: string): string => s.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const render = (d: WebsiteData) => renderSiteBundle(d, { siteBaseUrl: 'https://fresh.example.com' });

// Sentences that belong to exactly one guide (a sentence like "A photo helps." is shared and cannot identify a guide).
const guideSentences = (g: GuideId): string[] => {
  const def = GUIDES[g];
  return [...(def.interval ?? []), ...def.blocks.flatMap((b) => b.variants.flat())].map(norm).filter((s) => !s.includes('{'));
};
const UNIQUE: Record<string, string[]> = {};
for (const g of GUIDE_IDS) {
  const others = new Set(GUIDE_IDS.filter((x) => x !== g).flatMap((x) => guideSentences(x)));
  UNIQUE[g] = guideSentences(g).filter((s) => !others.has(s));
}
const guidesOnPage = (text: string): GuideId[] => GUIDE_IDS.filter((g) => UNIQUE[g].some((s) => text.includes(s)));

const serviceHtml = (b: ReturnType<typeof render>): string => b.pages.filter((p) => /^services\/[^/]+\/index\.html$/.test(p.path)).map((p) => p.html).join('\n');
const faqBlock = (d: WebsiteData, id: 'price' | 'length' | 'kids'): string | null => { const r = resolveBlock(lenientEnv(d, { ignoreCopy: true }), `faq.${id}`); return r ? blockText(r) : null; };

describe('the matrix has the size and shape the review asked for', () => {
  it('>= 300 titles, every title once, realistic positives for every guide but color, hostile titles from all review reports', () => {
    expect(MATRIX.length).toBeGreaterThanOrEqual(300);
    const keys = MATRIX.map(([t]) => t);
    expect(new Set(keys).size).toBe(keys.length);
    for (const g of GUIDE_IDS) if (g !== 'color') expect(POSITIVE.filter(([, x]) => x === g).length, g).toBeGreaterThanOrEqual(9);
    expect(POSITIVE.some(([, g]) => g === ('color' as GuideId))).toBe(false);
  });
});

describe('MATRIX through the real renderer: every title gets exactly the expected guide (or none)', () => {
  for (const [title, expected] of MATRIX) {
    it(`${JSON.stringify(title)} -> ${expected ?? 'none'}`, () => {
      // Worst case: the classifier / owner "chose" a family for the title (haircut for a null title, the expected one otherwise).
      const fam = familyFor([title], expected ?? 'haircut');
      const d = siteWith([{ title, price: '$10', duration: '20 min' }], { family: fam });
      expect(structuralGuide(title), 'structuralGuide').toBe(expected);
      expect(guideForTitle(d, title), 'guideForTitle').toBe(expected);
      const b = render(d);
      const html = serviceHtml(b);
      const shown = guidesOnPage(decode(html));
      if (expected) {
        expect(shown, 'guide sentences on the service page').toEqual([expected]);
        // Ruling 2026-11-05: the guide of a title the library pattern matches stands the page up as indexable; the automatic guide of a custom
        // title (Mohawk) is shown but the page stays noindex and out of the sitemap, as it is live today.
        if (guideIdForTitle(title) !== null) {
          expect(html).not.toContain('name="robots" content="noindex');
          expect(b.sitemap ?? '').toContain('/services/');
        } else {
          expect(html).toContain('name="robots" content="noindex');
          expect(b.sitemap ?? '').not.toMatch(/\/services\/[^/<]+\//);
        }
      } else {
        expect(shown, 'no guide sentence on the page').toEqual([]);
        expect(html).toContain('name="robots" content="noindex');
      }
    });
  }
});

describe('web-created gated sites have no FAQ at all (guides on AND off), whatever the title', () => {
  it('for every matrix title: faq.price / faq.length / faq.kids are null, no faq/index.html and no /faq/ href, even with extraPages.on including faq', () => {
    for (const [title, expected] of MATRIX) for (const guides of [true, false]) {
      const d = siteWith([{ title, price: '$10', duration: '20 min' }, { title: 'Haircut', price: '$35', duration: '30 min' }, { title: 'Kids Haircut', price: '$20' }], { guides, family: familyFor([title], expected ?? 'haircut') });
      expect((d.extraPages as unknown as { on: string[] }).on).toContain('faq');
      for (const id of ['price', 'length', 'kids'] as const) expect(faqBlock(d, id), `${title} ${guides} ${id}`).toBeNull();
      const b = render(d);
      expect(b.pages.map((p) => p.path), `${title} ${guides}`).not.toContain('faq/index.html');
      for (const p of b.pages) expect(p.html.includes('/faq/'), `${title} ${guides} ${p.path} has a /faq/ href`).toBe(false);
    }
  });
});

describe('every hostile title stays none with ANY family stored for it, on the page and on the hair/beard-care pages', () => {
  it('stored family of every guide id for every negative title: still no guide', () => {
    for (const [title] of NEGATIVE) for (const g of GUIDE_IDS) {
      const d = siteWith([{ title, price: '$10' }], { family: familyFor([title], g) });
      expect(guideForTitle(d, title), `${title} / ${g}`).toBeNull();
    }
  });
  it('a site whose only titles are hostile gets no beard-care / hair-care page and no guide text anywhere', () => {
    const titles = NEGATIVE.map(([t]) => t).filter((t) => t.trim() && !/^[&+]$/.test(t)).slice(0, 40);
    const b = render(siteWith(titles.map((t) => ({ title: t, price: '$10' }))));
    const text = b.pages.map((p) => decode(p.html)).join('\n');
    expect(guidesOnPage(text)).toEqual([]);
    expect(b.pages.map((p) => p.path)).not.toContain('beard-care/index.html');
    expect(b.pages.map((p) => p.path)).not.toContain('hair-care/index.html');
  });
});

describe('the second service of a kind: its alt text follows the closed-vocabulary guide, never the library pattern\'s', () => {
  it('Childrens Haircut (library pattern: haircut; vocabulary: kids-cut) listed after Kids Haircut gets the kids alt text and no haircut text', () => {
    const t = ['Kids Haircut', 'Childrens Haircut'];
    const b = render(siteWith(t.map((title) => ({ title, price: '$10' })), { family: familyFor(['Childrens Haircut'], 'kids-cut') }));
    const page = decode(b.pages.find((p) => /^services\/children/.test(p.path))?.html ?? '');
    expect(page.length).toBeGreaterThan(100);
    const sent = (g: GuideId): string[] => SERVICE_ALT[g].variants.flat().map(norm).filter((x) => !x.includes('{'));
    const others = new Set(sent('kids-cut'));
    const onlyHaircut = sent('haircut').filter((x) => !others.has(x));
    expect(onlyHaircut.length).toBeGreaterThan(0);
    for (const x of onlyHaircut) expect(page.includes(x), x).toBe(false);
    expect(sent('kids-cut').some((x) => page.includes(x))).toBe(true);
  });
});

// ── 2. Sentence truth ──────────────────────────────────────────────────────────────────────────────
// Every sentence of a guide is reached by every title the guide is assigned to. This table is the truth predicate per guide: a title that
// reaches the guide must satisfy it. It is checked on the matrix AND on every title the vocabulary can build (1 to 3 tokens).
const BAD_FOR_ALL = /\b(?:dye\w*|bleach\w*|toner|toning|lighten\w*|colou?r\w*|highlight\w*|perm\w*|relax\w*|wax\w*|facial\w*|massage\w*|wash\w*|shampoo\w*|style|styling|membership|package|pass|subscription|voucher|gift|card|deposit|fee|dog|cat|pet|puppy|nail\w*|wig\w*|lash\w*|brow\w*|bangs?|fringe|sideburns?|neck|nape|clippers|scissors|kit|oil|balm|pomade|infant|baby|babies)\b/i;
const CUTWORD = '(?:hair\\s?cuts?|cuts?|hair trims?|mohawks?|faux\\s?hawks?|mullets?|flat\\s?tops?|caesars?|undercuts?|high (?:and|&) tight|buzz\\s?cuts?|crew\\s?cuts?)';
const TRUTH: Record<string, { says: string; test: (t: string) => boolean }> = {
  haircut: { says: 'A haircut shortens/shapes hair with clippers or scissors; suits anyone', test: (t) => new RegExp(`\\b${CUTWORD}\\b`, 'i').test(t) && !/\b(?:fades?|tapers?|beard|shav\w*|razor|line|edge|shape|design|art|kids?|child\w*|boys?|girls?|juniors?|toddlers?|towel)\b/i.test(t) },
  'kids-cut': { says: 'A haircut made for a child', test: (t) => /\b(?:kids?|child\w*|boys?|girls?|juniors?|toddlers?)\b/i.test(t) && new RegExp(`\\b(?:${CUTWORD}|fades?|tapers?|trims?)\\b`, 'i').test(t) && !/\b(?:beard|shav\w*|razor|design|line|edge|shape)\b/i.test(t) },
  fade: { says: 'A fade blends short hair into longer hair', test: (t) => /\bfades?\b/i.test(t) && !/\b(?:beard|shav\w*|razor|design|line|edge|shape|kids?|child\w*|boys?|girls?|juniors?|toddlers?)\b/i.test(t) },
  taper: { says: 'A taper makes the hair gradually shorter toward the neckline', test: (t) => /\btapers?\b/i.test(t) && !/\b(?:fades?|beard|shav\w*|razor|design|line|edge|shape|kids?|child\w*|boys?|girls?|juniors?|toddlers?)\b/i.test(t) },
  'line-up': { says: 'A line-up sharpens the hairline, temples and neckline', test: (t) => /\b(?:line|shape|edge)[\s-]?ups?\b/i.test(t) && !/\b(?:beard|fades?|tapers?|cuts?|shav\w*)\b/i.test(t) },
  'beard-trim': { says: 'A beard trim tidies the length and outline of the beard (trim, shape, sculpt, cut, clean up, line up)', test: (t) => /\bbeard (?:trims?|shap\w+|sculpt\w*|cuts?|clean ?ups?|line ?ups?|edge ?ups?)\b/i.test(t) && !/\b(?:hair\s?cuts?|fades?|tapers?|shav\w*|razor)\b/i.test(t) },
  shave: { says: 'A razor shave removes hair close to the skin with warm towels', test: (t) => /\bshav(?:e|es|ing)\b/i.test(t) && !/\b(?:hair\s?cuts?|cuts?|trim\w*|fades?|tapers?|line|edge|design)\b/i.test(t) },
  design: { says: 'A hair design is a pattern or line cut into short hair (a design, a hard part)', test: (t) => /\b(?:hair (?:designs?|art)|(?:hair\s?cut|cut) designs?|designs?|(?:hard|razor) parts?)\b/i.test(t) },
  'cut-beard': { says: 'The haircut and the beard are done together in one visit', test: (t) => /\bbeard\b/i.test(t) && new RegExp(`\\b(?:${CUTWORD}|fades?|tapers?)\\b`, 'i').test(t) && !/\b(?:shav\w*|razor|line|edge|shape up|design|kids?|child\w*)\b/i.test(t) },
};
const SENTENCE_COUNT: Record<string, number> = Object.fromEntries(GUIDE_IDS.map((g) => [g, guideSentences(g).length]));

describe('SENTENCE-TRUTH: every guide sentence is true for every title that can reach it', () => {
  it('the guides that can be assigned on a web site are exactly the nine with a truth row; there is no color guide', () => {
    expect(Object.keys(TRUTH).sort()).toEqual(['beard-trim', 'cut-beard', 'design', 'fade', 'haircut', 'kids-cut', 'line-up', 'shave', 'taper']);
    const reachable = new Set<string>([...Object.keys(FAMILY_VOCAB), 'cut-beard']);
    expect([...reachable].sort()).toEqual(Object.keys(TRUTH).sort());
    expect((FAMILY_VOCAB as Record<string, unknown>).color).toBeUndefined();
  });
  it('the number of sentences of each reachable guide is pinned: a new or edited sentence must be re-audited against its row first', () => {
    const pinned = { 'cut-beard': 25, fade: 27, taper: 27, 'line-up': 24, 'beard-trim': 23, shave: 23, 'kids-cut': 26, design: 23, haircut: 27 };
    for (const g of Object.keys(TRUTH)) expect(SENTENCE_COUNT[g], `${g}: ${TRUTH[g].says}`).toBe((pinned as Record<string, number>)[g]);
  });
  it('no sentence of a reachable guide claims a technique or product the vocabulary does not guarantee (dye, bleach, toner, wax ...)', () => {
    const CLAIM = /\b(?:dye\w*|bleach\w*|toner|toning|lighten\w*|foils?|perm\w*|relax\w*|chemical\w*|wax\w*|gel|spray)\b/i;
    for (const g of Object.keys(TRUTH)) for (const s of guideSentences(g as GuideId)) expect(CLAIM.test(s), `${g}: ${s}`).toBe(false);
  });
  it('every matrix title that reaches a guide satisfies that guide\'s truth row and no bad word', () => {
    for (const [t, g] of POSITIVE) { expect(TRUTH[g].test(t), `${t} -> ${g}`).toBe(true); expect(BAD_FOR_ALL.test(t), t).toBe(false); }
  });
  it('EXHAUSTIVE: every title of 1 to 3 vocabulary words that reaches a guide satisfies the truth row (reached > 3000)', () => {
    const words = new Set<string>();
    for (const v of Object.values(FAMILY_VOCAB)) for (const p of [...v!.cores, ...(v!.needs ?? []), ...v!.mods]) for (const w of p.split(' ')) words.add(w);
    for (const w of ['beard', 'and', '&', '+', 'with', 'a']) words.add(w);
    const w = [...words];
    const reachedBy: Record<string, number> = {};
    let reached = 0;
    const check = (t: string): void => {
      const g = structuralGuide(t);
      if (!g) return;
      reached++; reachedBy[g] = (reachedBy[g] ?? 0) + 1;
      expect(TRUTH[g].test(t), `${t} -> ${g}`).toBe(true);
      expect(BAD_FOR_ALL.test(t), t).toBe(false);
    };
    for (const a of w) { check(a); for (const b of w) { check(`${a} ${b}`); for (const c of w) check(`${a} ${b} ${c}`); } }
    expect(reached).toBeGreaterThan(3000);
    for (const g of Object.keys(TRUTH)) expect(reachedBy[g] ?? 0, g).toBeGreaterThan(5);
  });
});

// ── 3. Vocabulary audit and properties ─────────────────────────────────────────────────────────────
const ALL_WORDS = ((): Set<string> => {
  const s = new Set<string>();
  for (const v of Object.values(FAMILY_VOCAB)) for (const p of [...v!.cores, ...(v!.needs ?? []), ...v!.mods]) for (const w of p.split(' ')) s.add(w);
  return s;
})();

describe('the vocabulary is closed and reviewed', () => {
  it('has exactly eight guides with a vocabulary (cut-beard is a rule over two of them); no color, no vocabulary for anything else', () => {
    expect(Object.keys(FAMILY_VOCAB).sort()).toEqual(['beard-trim', 'design', 'fade', 'haircut', 'kids-cut', 'line-up', 'shave', 'taper']);
  });
  it('no vocabulary word is vetoed (the veto is an independent second layer) and none is a product / membership / gift word', () => {
    for (const w of ALL_WORDS) {
      // "face" is the one reviewed carve-out (6h): vetoed everywhere except directly before "shave" ("Face Shave"); see the next test
      if (w !== 'face') expect(FAMILY_VETO.test(w), w).toBe(false);
      expect(nonServiceTitle(w), w).toBe(false);
      expect(/^(?:membership|package|pass|subscription|voucher|gift|card|deposit|fee|dog|cat|pet|puppy|nail|wig|lash|brow|bang|bangs|fringe|sideburn|neck|nape|clippers|scissors|kit|oil|balm|color|colour|dye|bleach|infant|baby)s?$/.test(w), w).toBe(false);
    }
  });
  it('"face" is vetoed everywhere except directly before "shave" (Face Shave); every other face word and the reverse order stay none', () => {
    expect(FAMILY_VETO.test('face shave')).toBe(false);
    for (const t of ['face', 'face mask', 'face wash', 'face wax', 'facial', 'shave face', 'face and neck', 'face lift']) expect(FAMILY_VETO.test(t), t).toBe(true);
    for (const t of ['Face Mask', 'Face Wash', 'Shave Face', 'Facial Shave', 'Face Waxing', 'Face Haircut']) expect(structuralGuide(t), t).toBeNull();
  });
  it('cores are disjoint between guides, lower-case and single-spaced', () => {
    const seen = new Map<string, string>();
    for (const [g, v] of Object.entries(FAMILY_VOCAB)) for (const c of v!.cores) {
      expect(c, c).toBe(c.toLowerCase().replace(/\s+/g, ' ').trim());
      expect(seen.has(c) ? `${c} in ${seen.get(c)} and ${g}` : 'ok').toBe('ok');
      seen.set(c, g);
    }
  });
  it('a modifier of one guide is the core word of another only where reviewed (a title of two cores is none, not a guess)', () => {
    const coreWords = new Map<string, string[]>();
    for (const [g, v] of Object.entries(FAMILY_VOCAB)) for (const c of v!.cores) if (!c.includes(' ')) { const a = coreWords.get(c) ?? []; a.push(g); coreWords.set(c, a); }
    const allowed = new Set(['fade:taper', 'fade:haircut', 'fade:cut', 'taper:haircut', 'taper:cut', 'fade:mohawk', 'taper:mohawk']);
    for (const [g, v] of Object.entries(FAMILY_VOCAB)) for (const m of v!.mods) if (coreWords.has(m) && !coreWords.get(m)!.includes(g)) expect(allowed.has(`${g}:${m}`), `${g} mod ${m} is a core of ${coreWords.get(m)}`).toBe(true);
  });
  it('a risky word is in no vocabulary, and a matrix title exercises each of them (adding one changes a matrix row)', () => {
    for (const risky of ['dog', 'bang', 'nail', 'membership', 'package', 'infant', 'color', 'wig', 'kit', 'clippers', 'oil', 'deposit']) {
      expect(ALL_WORDS.has(risky), risky).toBe(false);
      expect(NEGATIVE.some(([t]) => new RegExp(`\\b${risky}s?\\b`, 'i').test(t)), `${risky} is exercised by a matrix title`).toBe(true);
    }
  });
});

describe('PROPERTY: one unknown word anywhere makes a title none', () => {
  const UNKNOWN = ['dog', 'cat', 'pet', 'bang', 'fringe', 'nail', 'wig', 'lash', 'brow', 'wax', 'color', 'dye', 'bleach', 'membership', 'package', 'pass', 'subscription', 'voucher', 'gift', 'card', 'deposit', 'fee', 'lesson', 'class', 'kit',
    'clippers', 'scissors', 'oil', 'balm', 'shampoo', 'wash', 'style', 'massage', 'facial', 'youth', 'teen', 'infant', 'baby', 'two', 'family', 'couples', 'premium', 'deluxe', 'vip', 'special', 'combo', 'bundle', 'unlimited', 'monthly', 'plan',
    'lawn', 'grass', 'tree', 'key', 'glass', 'diamond', 'steak', 'fabric', 'paper', 'sew', 'socks', 'tee', 'party', 'repair', 'sharpening', 'rental', 'neck', 'nape', 'sideburn', 'eyebrow', 'mustache', 'goatee'].filter((w) => !ALL_WORDS.has(w));
  it('inserting any one unknown word at every position of every positive title gives none (> 20000 checks)', () => {
    let n = 0;
    for (const [t] of POSITIVE) {
      const toks = t.split(/\s+/);
      for (const u of UNKNOWN) for (let i = 0; i <= toks.length; i++) {
        const mutated = [...toks.slice(0, i), u, ...toks.slice(i)].join(' ');
        expect(structuralGuide(mutated), mutated).toBeNull(); n++;
      }
    }
    expect(n).toBeGreaterThan(20000);
  });
  it('putting an unknown word before or after every core phrase of every guide gives none', () => {
    for (const v of Object.values(FAMILY_VOCAB)) for (const c of v!.cores) for (const u of UNKNOWN) { expect(structuralGuide(`${c} ${u}`), `${c} ${u}`).toBeNull(); expect(structuralGuide(`${u} ${c}`), `${u} ${c}`).toBeNull(); }
  });
  it('a combo of two guides is none unless it is the cut-beard rule (every ordered pair of one core each, joined by and / & / + / with)', () => {
    const one: Record<string, string> = { haircut: 'haircut', 'kids-cut': 'kids haircut', fade: 'skin fade', taper: 'low taper', 'line-up': 'line up', 'beard-trim': 'beard trim', shave: 'hot towel shave', design: 'hair design' };
    for (const a of Object.keys(one)) for (const b of Object.keys(one)) {
      if (a === b) continue;
      for (const j of ['and', '&', '+', 'with']) {
        const g = structuralGuide(`${one[a]} ${j} ${one[b]}`);
        const trueCombo = (['haircut', 'fade', 'taper'].includes(a) && b === 'beard-trim') || (a === 'beard-trim' && ['haircut', 'fade', 'taper'].includes(b));
        expect(g, `${one[a]} ${j} ${one[b]}`).toBe(trueCombo ? 'cut-beard' : null);
      }
    }
  });
  it('digits, symbols, other scripts and invisible markers do not slip through; case, accents and curly apostrophes are folded', () => {
    for (const t of ['Haircut 1', 'Haircut​', 'Hаircut', 'Haircut™', 'Haircut@', 'Haircut.5']) expect(structuralGuide(t), t).toBeNull();
    expect(structuralGuide('MEN’S HAIRCUT')).toBe('haircut');
    expect(structuralGuide('Séniór Haircut')).toBe('haircut');
    expect(structuralGuide('  skin   fade ')).toBe('fade');
    expect(structuralGuide('x'.repeat(5000))).toBeNull();
    expect(structuralGuide(undefined)).toBeNull(); expect(structuralGuide(42)).toBeNull(); expect(structuralGuide({})).toBeNull();
  });
  it('familyCandidates is the same closed matcher: at most one guide, never for a none title', () => {
    for (const [t, g] of MATRIX) expect(familyCandidates(t), t).toEqual(g ? [g] : []);
  });
});

// ── 4. Parity: everything outside the gate is exactly origin/main 08186dc (web has no FAQ) ───────────
describe('PARITY: web-created sites with service guides OFF keep main\'s guides; iOS and legacy sites keep main\'s guides and FAQ exactly', () => {
  const CONFIGS: Array<[string, { source: string | null; guides: boolean }]> = [['web guides off', { source: 'web-app', guides: false }], ['ios guides on', { source: 'ios', guides: true }], ['ios guides off', { source: 'ios', guides: false }], ['legacy guides on', { source: null, guides: true }]];
  for (const [label, cfg] of CONFIGS) {
    it(`${label}: the guide of every matrix title is the library pattern's, and the FAQ ${cfg.source === 'web-app' ? 'is gone' : 'follows main\'s rule'}`, () => {
      const PT = new Set(['fade', 'taper', 'haircut']);
      for (const [t] of MATRIX) {
        const d = siteWith([{ title: t, price: '$10', duration: '20 min' }, { title: 'Haircut', price: '$35', duration: '30 min' }], { ...cfg, family: familyFor([t], 'haircut') });
        expect(guideForTitle(d, t), t).toBe(guideIdForTitle(t));
        const price = faqBlock(d, 'price');
        if (cfg.source === 'web-app') { expect(price, t).toBeNull(); continue; }
        // main's rule: the first service whose library guide is fade / taper / haircut and that has a price
        const svc = [{ t, price: '$10' }, { t: 'Haircut', price: '$35' }];
        const hit = svc.find((s) => { const g = guideIdForTitle(s.t); return !!g && PT.has(g) && s.price; });
        if (hit) { expect(price, t).toContain(hit.price); expect(price).toContain(hit.t); } else expect(price, t).toBeNull();
      }
    });
  }
  it.skipIf(!baselineAvailable())('iOS: faq, hair care, beard care, services, service pages render byte-identically to origin/main 08186dc; web guides OFF: the same pages minus the guides line, Guides link and FAQ entries, and no faq page', async () => {
    const base = await loadBaseline();
    const body = (h: string): string => (/<body[^>]*>([^]*)<\/body>/.exec(h)?.[1] ?? h).replace(/<script[^>]*>[^]*?<\/script>/g, '').replace(/published-at" content="\d+"/, '');
    const PAGES = /^(?:faq|hair-care|beard-care|services)\//;
    const FAQ_LI = '<li><a href="/faq/">FAQ</a></li>';
    let compared = 0;
    for (const [t] of MATRIX) {
      for (const cfg of [{ source: 'web-app', guides: false }, { source: 'ios', guides: true }]) {
        const web = cfg.source === 'web-app';
        const d = siteWith([{ title: t, price: '$10', duration: '20 min' }, { title: 'Haircut', price: '$35', duration: '30 min' }, { title: 'Kids Haircut', price: '$20' }], cfg);
        const a = (base as unknown as { renderSiteBundle: typeof renderSiteBundle }).renderSiteBundle(JSON.parse(JSON.stringify(d)), { siteBaseUrl: 'https://fresh.example.com' });
        const b = render(d);
        if (web) { expect(b.pages.map((x) => x.path), `${t} web has no faq page`).not.toContain('faq/index.html'); for (const x of b.pages) expect(x.html.includes('/faq/'), `${t} ${x.path} web /faq/ href`).toBe(false); }
        for (const p of a.pages.filter((x: { path: string }) => PAGES.test(x.path))) {
          if (web && p.path === 'faq/index.html') continue; // removed on web by decision
          const q = b.pages.find((x) => x.path === p.path);
          expect(q, `${t} ${cfg.source} ${p.path} exists`).toBeDefined();
          // A web-created site also gets guide pages: ONE line on the Services page and a footer `Guides` link. Those exact strings are removed from
          // the web output before comparing, and must be there (literal check). The baseline's FAQ menu/footer entries are removed on web only. iOS is untouched.
          let html = q!.html, baseHtml = p.html;
          if (web) {
            const line = /<p class="ab-muted" data-guides-line>[^<]*<a href="\/guides\/">Hair and grooming guides<\/a><\/p>/;
            expect(html.includes('<li><a href="/guides/">Guides</a></li>'), `${t} footer link`).toBe(true);
            expect(line.test(html) ? p.path === 'services/index.html' : p.path !== 'services/index.html', `${t} ${p.path} services line only on Services`).toBe(true);
            html = html.replace(line, '').replace('<li><a href="/guides/">Guides</a></li>', '');
            baseHtml = baseHtml.split(FAQ_LI).join('').replace(/<li class="ab-more-flat"><a href="\/faq\/">FAQ<\/a><\/li>/g, '');
          } else expect(html.includes('/guides/'), `${t} ios has no guide link`).toBe(false);
          expect(body(html), `${t} ${cfg.source} ${p.path}`).toBe(body(baseHtml)); compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });
});

// ── 5. Review 6g follow-ups (6h) ───────────────────────────────────────────────────────────────────
describe('6h NIT 1: a joiner inside a core ("high AND tight") is not a second joiner (mutant "exactly one joiner token" is killed)', () => {
  it('High and Tight combos with a beard are cut-beard in either order; two real joiners are still none', () => {
    for (const t of ['High and Tight & Beard', 'Beard & High and Tight', 'High & Tight and Beard Trim', 'Beard Trim with High and Tight', 'High and Tight + Beard']) expect(structuralGuide(t), t).toBe('cut-beard');
    for (const t of ['High and Tight', 'High and Tight & Shave', 'High and Tight & Beard & Shave', 'Haircut & Beard & High and Tight', 'High and Tight and High and Tight', 'High and Tight & Haircut']) expect(structuralGuide(t) === 'cut-beard', t).toBe(false);
    expect(structuralGuide('High and Tight')).toBe('haircut');
  });
});

describe('6h NIT 7: iOS keeps main\'s duration fallback when the menu has no fade, taper or haircut; web (guides on or off) has no FAQ answer', () => {
  for (const menu of [[{ title: 'Beard Trim', duration: '15 min' }], [{ title: 'Line Up', duration: '10 min' }, { title: 'Beard Trim', duration: '15 min' }], [{ title: 'Kids Haircut', duration: '20 min' }]]) {
    it(`ios: ${menu.map((m) => m.title).join(' + ')} still answers the first listed time (main's fallback)`, () => {
      expect(faqBlock(siteWith(menu, { source: 'ios' }), 'length'), 'a time is answered').toContain(`The ${menu[0].title} is listed as ${menu[0].duration}`);
    });
    it(`web: ${menu.map((m) => m.title).join(' + ')} has no time answer, guides off or on`, () => {
      expect(faqBlock(siteWith(menu, { source: 'web-app', guides: false }), 'length')).toBeNull();
      expect(faqBlock(siteWith(menu), 'length')).toBeNull();
    });
  }
});

describe('6h LIVE IMPACT (pinned): web guides OFF keeps main\'s guide-by-library-pattern, but the FAQ lines are gone; iOS still prints main\'s loose FAQ lines', () => {
  const titles = ['Dog Haircut', 'Clippers', 'Haircut Membership', 'Haircut Gift Card', 'Temple Fade Removal'];
  it('web guides off: guide = library pattern, and the FAQ lines (e.g. "The listed price for the Dog Haircut") are absent', () => {
    for (const t of titles) {
      const d = siteWith([{ title: t, price: '$10' }], { source: 'web-app', guides: false });
      expect(guideForTitle(d, t), t).toBe(guideIdForTitle(t));
      expect(faqBlock(d, 'price'), t).toBeNull();
      const text = render(d).pages.map((p) => decode(p.html)).join('\n');
      expect(text.includes(`The listed price for the ${t}`), t).toBe(false);
    }
    expect(faqBlock(siteWith([{ title: 'Kids Nails', price: '$10' }], { source: 'web-app', guides: false }), 'kids')).toBeNull();
  });
  it('ios: main\'s loose FAQ lines are printed exactly (names the, wrong, service as main does)', () => {
    for (const t of titles) {
      const d = siteWith([{ title: t, price: '$10' }], { source: 'ios' });
      expect(guideForTitle(d, t), t).toBe(guideIdForTitle(t));
      expect(faqBlock(d, 'price'), t).toContain(t);
    }
    expect(faqBlock(siteWith([{ title: 'Kids Nails', price: '$10' }], { source: 'ios' }), 'kids')).toContain('Kids Nails');
  });
});
