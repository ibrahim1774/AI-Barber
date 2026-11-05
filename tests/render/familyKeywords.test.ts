// Review 6e B1-r: a custom title gets a family only if EVERY token of it is in that family's reviewed closed vocabulary (familyKeywords.ts).
// Pure rendering and parsing: no model, no network.
import { describe, expect, it } from 'vitest';
import { familyAllowed, familyCandidates, FAMILY_VETO, FAMILY_VOCAB } from '../../lib/render/familyKeywords';
import { familyFor, guideForTitle, guideIdForTitle, libraryGuideFor } from '../../lib/render/guides';
import { GUIDE_IDS, type GuideId } from '../../lib/render/copyRules';
import type { WebsiteData } from '../../types';

const site = (title: string, ep: Record<string, unknown> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '', bookingUrl: '', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' }, about: { heading: 'About', description: ['x'], imageUrl: '' },
  services: [{ title, subtitle: '', description: '', icon: 'scissors', imageUrl: '' }], gallery: [], hours: [],
  contact: { address: '', email: '' }, pages: { order: [], hidden: [] },
  extraPages: { on: [], serviceGuides: true, seed: 1, ...ep } as never, source: 'web-app',
} as unknown as WebsiteData);
const keyOf = (t: string): string => t.toLowerCase().replace(/\s+/g, ' ').trim();

/** What a web-created site prints for a title with every family the data could carry: the library guide, else the one family the vocabulary allows. */
const resolveWeb = (title: string): GuideId | null => {
  const lib = libraryGuideFor(site(title), title);
  if (lib) return lib;
  const cands = familyCandidates(title);
  return cands.length === 1 ? cands[0] : null;
};

// ── ~100 realistic valid titles. [title, the guide it must resolve to]. VALID_LIBRARY: the library's own patterns answer (a family is
// never consulted); VALID_FAMILY: no library pattern matches, the vocabulary assigns the family.
const VALID_LIBRARY: [string, GuideId][] = [["Haircut", "haircut"], ["Men's Haircut", "haircut"], ["Mens Haircut", "haircut"], ["Adult Haircut", "haircut"], ["Kids Haircut", "kids-cut"], ["Boys Haircut", "kids-cut"], ["Child Haircut", "kids-cut"], ["Junior Cut", "kids-cut"], ["Kids Cut", "kids-cut"], ["Senior Haircut", "haircut"], ["Classic Haircut", "haircut"], ["Buzz Cut", "haircut"], ["Crew Cut", "haircut"], ["Scissor Cut", "haircut"], ["Clipper Cut", "haircut"], ["Skin Fade", "fade"], ["Low Fade", "fade"], ["Mid Fade", "fade"], ["High Fade", "fade"], ["Burst Fade", "fade"], ["Drop Fade", "fade"], ["Taper Fade", "fade"], ["Low Taper", "taper"], ["Mid Taper", "taper"], ["Classic Taper", "taper"], ["Fade & Beard", "cut-beard"], ["Haircut & Beard", "cut-beard"], ["Cut and Beard", "cut-beard"], ["Taper and Beard", "cut-beard"], ["Beard Trim", "beard-trim"], ["Beard Sculpt", "beard-trim"], ["Beard Cleanup", "beard-trim"], ["Line Up", "line-up"], ["Line-Up", "line-up"], ["Lineup", "line-up"], ["Shape Up", "line-up"], ["Shape-Up", "line-up"], ["Edge Up", "line-up"], ["Edge-Up", "line-up"], ["Haircut & Line Up", "line-up"], ["Hot Towel Shave", "shave"], ["Straight Razor Shave", "shave"], ["Head Shave", "shave"], ["Face Shave", "shave"], ["Clean Shave", "shave"], ["Razor Shave", "shave"], ["Hair Color", "color"], ["Hair Colour", "color"], ["Highlights", "color"], ["Gray Blending", "color"], ["Grey Coverage", "color"], ["Hair Dye", "color"], ["Hair Design", "design"], ["Haircut with Design", "design"], ["Beard Dye Blend", "color"]];
const VALID_FAMILY: [string, GuideId][] = [["Mohawk", "haircut"], ["Men's Mohawk", "haircut"], ["Mohawks", "haircut"], ["Faux Hawk", "haircut"], ["Fauxhawk", "haircut"], ["Faux-Hawk", "haircut"], ["Classic Mullet", "haircut"], ["Mullet", "haircut"], ["Flat Top", "haircut"], ["Flattop", "haircut"], ["Caesar", "haircut"], ["Pompadour", "haircut"], ["Classic Pompadour", "haircut"], ["Undercut", "haircut"], ["Men's Undercut", "haircut"], ["Hair Trim", "haircut"], ["Men's Hair Trim", "haircut"], ["Adult Hair Trim", "haircut"], ["Bang Trim", "haircut"], ["Bangs Trim", "haircut"], ["Fringe Trim", "haircut"], ["High and Tight", "haircut"], ["High & Tight", "haircut"], ["Mohawk & Mullet", "haircut"], ["Undercut and Flat Top", "haircut"], ["Short Mullet", "haircut"], ["Mohawk Trim", "haircut"], ["Toddler Mohawk", "kids-cut"], ["Toddler Undercut", "kids-cut"], ["Toddler Hair Trim", "kids-cut"], ["Infant Hair Trim", "kids-cut"], ["Baby's First Hair Trim", "kids-cut"], ["Hair Trim for Toddlers", "kids-cut"], ["Toddlers Mohawk", "kids-cut"], ["Bleach", "color"], ["Hair Bleach", "color"], ["Bleaching", "color"], ["Full Bleach", "color"], ["Partial Bleach", "color"], ["Bleach Roots", "color"], ["Bleach Tips", "color"], ["Bleach and Tone", "color"], ["Bleach & Toner", "color"], ["Balayage", "color"], ["Men's Balayage", "color"], ["Frosted Tips", "color"], ["Frosted Tip", "color"], ["Balayage & Toner", "color"]];
const INVALID: string[] = ["Hairline Unit", "Ombre Lips", "Ombre", "Ombr\u00e9", "Hairline", "Hairlines", "Hairline Cleanup", "Hairline Tattoo", "Hairline Restoration", "Temple", "Temples", "Temple Massage", "Temple Touch Up", "Hairline & Temples", "Toddler", "Toddlers", "Infant", "Infant Service", "Toddler Trim", "Toddler Photos", "Toddler Care", "Toddler Birthday Party", "Baby's First", "Baby's First Trim", "Bald Head", "Bald Heads", "Bald Head Polish", "Bald Head Service", "Head Polish", "Head Trim", "Freestyle", "Freestyle Lines", "Freestyle Dance", "Stencil", "Stencil Lines", "Stencil Art", "Goatee", "Goatee Trim", "Soul Patch", "Soul Patch Trim", "Scalp Massage", "Scalp Treatment", "Scalp Scrub", "Scalp Tattoo", "Hot Towel Facial", "Facial", "Beard Facial", "Charcoal Face Mask", "Eyebrow Threading", "Eyebrow Tint", "Eyebrow Trim", "Brow Wax", "Brow Lamination", "Lash Lift", "Eyelash Lift", "Eyelash Extensions", "Eyelash Tint", "Nose Wax", "Ear Wax", "Ear Hair Trim", "Nose Hair Trim", "Mustache Trim", "Moustache Trim", "Neck Clean Up", "Neckline Cleanup", "Shave Cream", "Shave Oil", "Beard Oil", "Beard Balm", "Beard Wash", "Beard Wax", "Beard Comb", "Beard Kit", "Henna Design", "Henna Tattoo", "Gift Card", "E-Gift Card", "Haircut Gift Card", "Voucher", "Haircut Voucher", "Gift Certificate", "Gel Manicure", "Manicure", "Pedicure", "Acrylic Nails", "Nail Polish", "Mani Pedi", "Chest Trim", "Back Trim", "Body Groom", "Bikini Trim", "Dog Trim", "Pet Grooming", "Locs Retwist", "Loc Maintenance", "Braids", "Box Braids", "Cornrows", "Twists", "Sew In Weave", "Wig Install", "Hair Extensions", "Perm", "Relaxer", "Keratin Treatment", "Hair Straightening", "Hair Wash", "Shampoo & Blow Dry", "Blowout", "Hair Styling", "Deep Conditioning", "Protein Treatment", "Steam Ritual", "Detox Peel", "Spa Day", "Relaxation Package", "Teeth Whitening", "Teeth Bleach", "Teeth Whitening Bleach", "Bleach Kit", "Bleach Bath Salts", "Platinum Experience", "Silver Package", "Gold Membership", "Student Special", "Senior Special", "Military Discount", "VIP Experience", "Deluxe Combo", "Monthly Membership", "Wedding Party Package", "Groomsmen Package", "Bridal Trial", "Pomade", "Mohawk Pomade", "Mohawk Clay", "Mohawk Kit", "Product Purchase", "Consultation", "Cancellation Fee", "Tip", "Classic", "Regular", "Standard", "Basic", "Gentleman", "Men's Grooming", "Little Gents", "Youth", "Teen", "Outline", "Stubble Smooth", "Royal Treatment", "The Works", "Signature Service", "Clean Up", "Trim", "Quick Trim", "Pre-Wedding Trim", "Dry Cleaning", "Shine", "Texture", "Mohawk Spikes", "Mohawk 2", "2 Mohawks", "#1 Mohawk", "Mohawk and", "and Mohawk", "Mohawk with", "Mohawk and and Mullet", "Mohawk for for", "Mohawk Lips", "Mullet Dinner", "Caesar Salad", "Pompadour Wig", "Undercut Tattoo", "Flat Top Grill", "Hair Trim Oil", "Hair Trim Class", "Toddler Mohawk Hairline", "Toddler Mohawk Facial", "Toddler Nails", "Premium Hair Trim", "Balayage Kit", "Balayage Class", "Bleach Lips", "Frosted Tips Lipstick", "Frosted Flakes", "Gray Hair Spray", "Mohawk \u0417\u0434\u0435\u0441\u044c", "Mo\u04bbawk", "Mo\u200bhawk Lips", "Mohawk\ud83d\ude00", "Bleach Touch-Up", "Beard Shape Up Gel"];
const LIBRARY_OWNED: string[] = ["Beard Dye", "Mohawk Dye", "Mohawk Color", "Mohawk Fade", "Mohawk for Men's Beard", "Toddler Haircut Party"];

// Titles a LIBRARY pattern still answers on a web site (iOS parity: library patterns are unchanged). They are not a family decision;
// the family layer itself says none for each of them (asserted below), the library wording is the pre-existing one.

describe('valid barber titles resolve to the right guide', () => {
  it('has at least 100 valid titles', () => { expect(VALID_LIBRARY.length + VALID_FAMILY.length).toBeGreaterThanOrEqual(100); });
  for (const [title, want] of VALID_LIBRARY) {
    it(`library ${JSON.stringify(title)} -> ${want}`, () => {
      expect(guideIdForTitle(title)).toBe(want);
      expect(resolveWeb(title)).toBe(want);
      expect(familyCandidates(title), 'a library title never needs a family').toEqual([]);
    });
  }
  for (const [title, want] of VALID_FAMILY) {
    it(`family ${JSON.stringify(title)} -> ${want}`, () => {
      expect(guideIdForTitle(title), 'a family title is one no library pattern matches').toBeNull();
      expect(familyCandidates(title)).toEqual([want]);
      expect(resolveWeb(title)).toBe(want);
      for (const id of GUIDE_IDS) {
        const got = familyFor(site(title, { svcFamily: { [keyOf(title)]: id } }), title);
        expect(got, `${id} for ${title}`).toBe(id === want ? id : null);
      }
    });
  }
});

describe('invalid, odd, product and other-trade titles never get a family', () => {
  it('has at least 150 such titles', () => { expect(INVALID.length).toBeGreaterThanOrEqual(150); });
  for (const title of INVALID) {
    it(`${JSON.stringify(title)} -> none`, () => {
      expect(familyCandidates(title)).toEqual([]);
      for (const id of GUIDE_IDS) {
        expect(familyAllowed(title, id), `${id} for ${title}`).toBe(false);
        expect(familyFor(site(title, { svcFamily: { [keyOf(title)]: id } }), title) ?? libraryGuideFor(site(title), title), `${id} for ${title}`).toBeNull();
      }
      expect(resolveWeb(title)).toBeNull();
    });
  }
  for (const title of LIBRARY_OWNED) {
    it(`library-owned ${JSON.stringify(title)}: the family layer says none (the library keeps its own pre-existing answer)`, () => {
      expect(familyCandidates(title)).toEqual([]);
      for (const id of GUIDE_IDS) expect(familyAllowed(title, id)).toBe(false);
    });
  }
});

describe('the vocabulary is closed', () => {
  const FAMILIES = Object.keys(FAMILY_VOCAB) as GuideId[];
  const allWords = new Set<string>();
  for (const v of Object.values(FAMILY_VOCAB)) for (const w of [...v!.cores, ...(v!.needs ?? []), ...v!.mods]) for (const p of w.split(' ')) allWords.add(p);

  it('only haircut, kids-cut and color have a vocabulary; shave, line-up, beard-trim, design, cut-beard, fade, taper never get a family', () => {
    expect(FAMILIES.sort()).toEqual(['color', 'haircut', 'kids-cut']);
    for (const id of ['shave', 'line-up', 'beard-trim', 'design', 'cut-beard', 'fade', 'taper'] as GuideId[]) {
      for (const t of [...VALID_FAMILY.map(([x]) => x), 'Hairline', 'Goatee', 'Bald Head', 'Stencil', 'Freestyle', 'Head Polish']) expect(familyAllowed(t, id), `${id} ${t}`).toBe(false);
    }
  });
  it('no vocabulary word is on the veto list (the two layers are independent)', () => {
    for (const w of allWords) expect(FAMILY_VETO.test(w), w).toBe(false);
  });
  it('core phrases are disjoint between families, and every phrase is lower-case single-spaced', () => {
    const seen = new Map<string, GuideId>();
    for (const id of FAMILIES) for (const c of FAMILY_VOCAB[id]!.cores) {
      expect(c, c).toMatch(/^[a-z'&+]+(?: [a-z'&+]+)*$/);
      expect(seen.has(c), `${c} is a core of both ${seen.get(c)} and ${id}`).toBe(false);
      seen.set(c, id);
    }
    // a kids-cut "needs" phrase is a haircut core, never a core of another family
    for (const n of FAMILY_VOCAB['kids-cut']!.needs!) expect(FAMILY_VOCAB.haircut!.cores).toContain(n);
  });
  it('the removed risky keywords are in no vocabulary at all', () => {
    for (const w of ['hairline', 'hairlines', 'temple', 'temples', 'ombre', 'freestyle', 'stencil', 'goatee', 'soul', 'patch', 'bald', 'polish', 'head', 'beard', 'dye', 'color', 'colour', 'fade', 'taper', 'shave', 'razor', 'towel', 'clipper', 'scissor', 'neck', 'mustache', 'moustache', 'kids', 'kid', 'boys', 'child', 'junior', 'skin', 'low', 'mid', 'edge', 'drop', 'burst', 'cleanup', 'cut', 'haircut']) expect(allWords.has(w), w).toBe(false);
  });
  it('risky single keywords and the titles that burned us are none, alone and in company', () => {
    const risky = ['Hairline', 'Hairlines', 'Temple', 'Temples', 'Toddler', 'Toddlers', 'Infant', 'Ombre', 'Ombré', 'Freestyle', 'Stencil', 'Bald Head', 'Bald Heads', 'Head Polish', 'Goatee', 'Soul Patch', 'Hairline Unit', 'Ombre Lips', 'Hairline Cleanup', 'Freestyle Lines', 'Stencil Lines', 'Bald Head Polish', 'Temples Touch Up', 'Toddler Trim', 'Toddler Photos'];
    for (const t of risky) expect(familyCandidates(t), t).toEqual([]);
  });
  it('PROPERTY: adding any single unknown token to any valid family title makes it none (front, middle, end)', () => {
    const UNKNOWN = ['unit', 'lips', 'kit', 'lamination', 'photo', 'photos', 'class', 'dye', 'color', 'fade', 'beard', 'taper', 'shave', 'hairline', 'temples', 'ombre', 'kids', 'zzz', 'foo', 'x', 'premium', 'deluxe', 'special', 'tattoo', 'salad', 'dinner', 'wig', 'oil', 'cream', 'gel', 'mask', 'nails', 'brow', 'lash', 'wax', 'massage', 'facial', 'spa', 'package', 'gift', 'card', 'voucher', 'party', 'design', 'line', 'up', 'cut', 'haircut', 'touch', 'tone2', 'hairlines', 'goatee', 'stencil', 'freestyle', 'polish', 'bald'];
    for (const u of UNKNOWN) expect(allWords.has(u) ? `${u} is in the vocabulary` : '', u).toBe('');   // an "unknown" word really is outside every vocabulary (toddler / infant are cores, so they are not in this list)
    let checked = 0;
    for (const [title, want] of VALID_FAMILY) {
      expect(familyCandidates(title)).toEqual([want]);
      const words = title.split(/\s+/);
      for (const u of UNKNOWN) {
        for (let i = 0; i <= words.length; i++) {
          const t = [...words.slice(0, i), u, ...words.slice(i)].join(' ');
          expect(familyCandidates(t), t).toEqual([]); checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });
  it('PROPERTY: any unknown token appended to the cores of every family makes it none', () => {
    for (const id of FAMILIES) for (const c of FAMILY_VOCAB[id]!.cores) {
      const base = id === 'kids-cut' ? `${c} mohawk` : c;
      expect(familyCandidates(base), base).toEqual([id]);
      for (const u of ['unit', 'lips', 'oil', 'massage', 'zzz']) { expect(familyCandidates(`${base} ${u}`), `${base} ${u}`).toEqual([]); expect(familyCandidates(`${u} ${base}`), `${u} ${base}`).toEqual([]); }
    }
  });
  it('a core of one family beside a word of another is none (no combo is reviewed)', () => {
    for (const t of ['Mohawk Bleach', 'Bleach Mohawk', 'Balayage Undercut', 'Toddler Bleach', 'Toddler Balayage', 'Mohawk and Balayage', 'Frosted Tips Mullet', 'Toddler Mohawk Bleach']) expect(familyCandidates(t), t).toEqual([]);
  });
  it('kids-cut needs an age word AND a named cut; either alone is none, and haircut never takes a title with an age word', () => {
    for (const t of ['Toddler', 'Infant Trim', 'Toddler Trim', 'Mohawk Toddler Photos']) expect(familyCandidates(t), t).toEqual([]);
    expect(familyCandidates('Toddler Mohawk')).toEqual(['kids-cut']);
    expect(familyCandidates('Mohawk')).toEqual(['haircut']);
  });
  it('connectors only join two things', () => {
    for (const t of ['Mohawk and', 'and Mohawk', '& Mohawk', 'Mohawk +', 'Mohawk with', 'Mohawk for', 'Mohawk and and Mullet', 'Mohawk with and Mullet', 'Mohawk a', 'the', 'and', 'Mohawk & & Mullet']) expect(familyCandidates(t), t).toEqual([]);
    for (const t of ['Mohawk and Mullet', 'Mohawk & Mullet', 'Mohawk + Mullet', 'Mohawk with the Mullet', 'Mohawk, Mullet', 'Mohawk/Mullet']) expect(familyCandidates(t), t).toEqual(['haircut']);
  });
  it('digits, symbols and other scripts anywhere make the title unmatched', () => {
    for (const t of ['Mohawk 2', '2 Mohawks', '#1 Mohawk', 'Mohawk $20', 'Mohawk (kids)', 'Mohawk!', 'Mohawk 💈', 'Мohawk', 'Mohawk Здесь', 'Mohawk\u200b', 'Mo\u200bhawk Lips']) expect(familyCandidates(t), t).toEqual([]);
  });
  it('word boundaries: a keyword inside a longer word is not a keyword', () => {
    for (const t of ['Ombrella', 'Bleachery', 'Toddlerland', 'Mulletry', 'Infantry', 'Undercutting', 'Mohawky', 'Balayages Shop', 'Flat Tops Grill', 'Caesars Palace', 'Pompadours Wig']) expect(familyCandidates(t), t).toEqual([]);
  });
  it('the veto still runs first: each veto word added to a family title gives none', () => {
    for (const v of ['brow', 'lash', 'wax', 'facial', 'massage', 'scalp', 'nail', 'kit', 'oil', 'gift', 'card', 'package', 'membership', 'tattoo', 'perm', 'braids', 'wedding', 'product']) {
      expect(FAMILY_VETO.test(v), v).toBe(true);
      for (const k of ['mohawk', 'bleach', 'toddler mohawk']) { expect(familyCandidates(`${k} ${v}`), `${k} ${v}`).toEqual([]); expect(familyCandidates(`${v} ${k}`), `${v} ${k}`).toEqual([]); }
    }
  });
  it('folding: case, accents, curly apostrophes and invisible editor markers do not change the answer; hostile input is bounded', () => {
    for (const t of ['MOHAWK', 'mohawk', 'Mohawk', "MEN\u2019S MOHAWK", "Men's Mohawk", 'Moh\u0061wk']) expect(familyCandidates(t), t).toEqual(['haircut']);
    expect(familyCandidates('Mo\u2063b\u2063hawk')).toEqual(['haircut']);
    expect(familyCandidates('\u2063b\u2063Mohawk\u2063/\u2063')).toEqual(['haircut']);
    for (const v of [null, undefined, 5, {}, [], '', '   ', 'x'.repeat(500), 'mohawk '.repeat(40), 'mohawk and '.repeat(5) + 'mullet']) expect(familyCandidates(v as never), String(v).slice(0, 20)).toEqual([]);
    expect(familyAllowed('Mohawk', 'haircut')).toBe(true);
    expect(familyAllowed('Mohawk', 'shave')).toBe(false);
    expect(familyAllowed('Mohawk', 7 as never)).toBe(false);
    expect(familyAllowed('Mohawk', '__proto__')).toBe(false);
  });
});

describe('library titles are untouched by the family layer', () => {
  it('a family stored for a title the library matches never overrides the library', () => {
    for (const [title, lib] of VALID_LIBRARY) for (const id of GUIDE_IDS) expect(guideForTitle(site(title, { svcFamily: { [keyOf(title)]: id } }), title), `${id} for ${title}`).toBe(lib);
  });
});
