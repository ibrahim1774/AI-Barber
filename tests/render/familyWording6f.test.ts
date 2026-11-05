// Review 6e/6f: (1) every sentence a FAMILY can print is true for EVERY title that can reach that family (no color family: nothing guarantees
// dye, bleach, toner or a method); (2) the FAQ never quotes one service's own price as "a haircut" unless it IS a plain haircut.
// Pure rendering, no model, no network.
import { describe, expect, it } from 'vitest';
import { GUIDES } from '../../lib/render/copyLibrary';
import { familyCandidates, FAMILY_VOCAB, plainCutTitle } from '../../lib/render/familyKeywords';
import { blockText, lenientEnv, resolveBlock } from '../../lib/render/guides';
import { GUIDE_IDS, type GuideId } from '../../lib/render/copyRules';
import type { WebsiteData } from '../../types';

const sentences = (g: GuideId): string[] => {
  const def = GUIDES[g];
  return [...def.interval, ...def.blocks.flatMap((b) => b.variants.flat())];
};

// ── 1. Wording audit ───────────────────────────────────────────────────────────────────────────────
// Each family sentence, with the reason it is true for every title that reaches the family. A change to the library text or the vocabulary
// that adds a sentence breaks the count and forces this table to be reviewed again.
const FAMILY_SENTENCE_AUDIT: Record<string, { sentences: number; truth: string }> = {
  haircut: { sentences: 27, truth: 'Each core is a named cut (mohawk, mullet, flat top, caesar, undercut, high and tight) or a hair trim: all shorten/shape hair with clippers or scissors; "suits anyone" is generic; product advice is "only a small amount", an instruction, not a claim about the service.' },
  'kids-cut': { sentences: 26, truth: 'Reached only by an age word (toddler) AND a named cut; school and sport lines are generic advice for a child, true for a toddler cut.' },
};
// Words that would assert a technique or product the title does not guarantee.
const TECHNIQUE = /\b(?:dye\w*|bleach\w*|toner|toning|lighten\w*|foils?|razors?|shav\w*|wax\w*|gel|sprays?|colou?r\w*|perm\w*|relax\w*|chemical\w*|beard\w*|fades?|tapers?)\b/i;

describe('family wording is true for every title that can reach the family (6f B1)', () => {
  it('only haircut and kids-cut have a vocabulary; there is no color family', () => {
    expect(Object.keys(FAMILY_VOCAB).sort()).toEqual(['haircut', 'kids-cut']);
    expect((FAMILY_VOCAB as Record<string, unknown>).color).toBeUndefined();
  });
  it('bleach, balayage, frosted tips and every old color core get no family (nothing guarantees dye)', () => {
    for (const t of ['Bleach', 'Balayage', 'Frosted Tips', 'Frosted Tip', 'Bleaching', 'Bleached', 'Hair Bleach', 'Full Bleach', 'Root Bleach', 'Bleach and Tone', 'Bleach & Toner', 'Men\'s Bleach', 'Partial Balayage', 'Hair Bleaching', 'Balayage & Toner', 'Men\'s Balayage'])
      for (const id of GUIDE_IDS) expect(familyCandidates(t).includes(id), `${t} ${id}`).toBe(false);
  });
  it('no sentence of a family guide, in any wording, asserts a technique or product (table test)', () => {
    for (const fam of Object.keys(FAMILY_VOCAB) as GuideId[]) {
      const all = sentences(fam);
      expect(all.length, fam).toBeGreaterThan(0);
      for (const s of all) expect(TECHNIQUE.test(s), `${fam}: ${s}`).toBe(false);
    }
  });
  it('the number of sentences per family is pinned: a new sentence must be audited here first', () => {
    for (const fam of Object.keys(FAMILY_VOCAB)) expect(sentences(fam as GuideId).length, `${fam}: ${FAMILY_SENTENCE_AUDIT[fam]?.truth ?? 'unaudited'}`).toBe(FAMILY_SENTENCE_AUDIT[fam].sentences);
    expect(Object.keys(FAMILY_SENTENCE_AUDIT).sort()).toEqual(Object.keys(FAMILY_VOCAB).sort());
  });
  it('every title the vocabulary can build (1 to 3 tokens) that reaches a family holds no technique word and, for haircut, is a plain cut', () => {
    const words = new Set<string>();
    for (const v of Object.values(FAMILY_VOCAB)) for (const w of [...v!.cores, ...(v!.needs ?? []), ...v!.mods]) words.add(w);
    const w = [...words];
    let reached = 0;
    const check = (t: string) => {
      const c = familyCandidates(t);
      if (c.length !== 1) return;
      reached++;
      expect(TECHNIQUE.test(t), t).toBe(false);
      if (c[0] === 'haircut') expect(plainCutTitle(t), t).toBe(true);
      if (c[0] === 'kids-cut') expect(/\btoddlers?\b/i.test(t), t).toBe(true);
    };
    for (const a of w) { check(a); for (const b of w) { check(`${a} ${b}`); for (const c of w) check(`${a} ${b} ${c}`); } }
    expect(reached).toBeGreaterThan(300);
  });
  it('infant and baby titles get no family (the school and sport lines are for a child)', () => {
    for (const t of ['Infant Hair Trim', "Baby's First Hair Trim", 'Infant Mohawk', 'Babies First Hair Trim']) expect(familyCandidates(t), t).toEqual([]);
    expect(familyCandidates('Toddler Hair Trim')).toEqual(['kids-cut']);
  });
  it('bang and fringe trims and pompadours get no family', () => {
    for (const t of ['Bang Trim', 'Bangs Trim', 'Fringe Trim', 'Pompadour', 'Classic Pompadour']) expect(familyCandidates(t), t).toEqual([]);
  });
});

// ── 2. FAQ attribution ─────────────────────────────────────────────────────────────────────────────
const siteWith = (services: { title: string; price?: string; duration?: string }[], source = 'web-app'): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '', bookingUrl: '', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' }, about: { heading: 'About', description: ['x'], imageUrl: '' },
  services: services.map((s) => ({ subtitle: '', description: '', icon: 'scissors', imageUrl: '', ...s })), gallery: [], hours: [],
  contact: { address: '', email: '' }, pages: { order: [], hidden: [] },
  extraPages: { on: ['faq'], serviceGuides: true, seed: 1 } as never, source,
} as unknown as WebsiteData);
const faq = (d: WebsiteData, id: 'price' | 'length' | 'kids'): string | null => {
  const b = resolveBlock(lenientEnv(d, { ignoreCopy: true }), `faq.${id}`);
  return b ? blockText(b) : null;
};

describe('the FAQ price is a plain haircut, never another service quoted as "a haircut" (6f B2)', () => {
  const PARTIAL = ['Bang Trim', 'Fringe Trim', 'Bangs Trim', 'Neck Trim', 'Beard Trim', 'Kids Trim', 'Fade + Beard', 'Bang Cut', 'Fringe Cut', 'Sideburn Cut', 'Kids Fade', 'Boys Taper', 'Beard Fade', 'Nail Cut', 'Dog Cut', 'Eyebrow Cut', 'Mustache Trim', 'Toddler Mohawk'];
  for (const t of PARTIAL) {
    it(`${t} $10 alone never answers "How much is a haircut?"`, () => {
      expect(faq(siteWith([{ title: t, price: '$10', duration: '15 min' }]), 'price')).toBeNull();
    });
    it(`${t} $10 listed before Haircut $35: the haircut price is $35`, () => {
      const a = faq(siteWith([{ title: t, price: '$10' }, { title: 'Haircut', price: '$35' }]), 'price')!;
      expect(a).toContain('$35'); expect(a).toContain('Haircut'); expect(a).not.toContain('$10'); expect(a).not.toContain(t);
    });
  }
  it('plain cuts still answer, as before: Haircut, Skin Fade, Low Taper, Mohawk, Hair Trim, Buzz Cut', () => {
    for (const t of ['Haircut', "Men's Haircut", 'Skin Fade', 'Low Taper', 'Mohawk', 'Hair Trim', 'Buzz Cut', 'Mullet']) {
      const d = siteWith([{ title: t, price: '$25' }], 'web-app');
      (d.extraPages as Record<string, unknown>).svcFamily = { [t.toLowerCase()]: 'haircut' };
      expect(faq(d, 'price'), t).toContain('$25');
    }
  });
  it('the duration question names the service it quotes and never says haircut', () => {
    for (const t of ['Bang Trim', 'Fringe Trim', 'Neck Trim', 'Beard Trim', 'Kids Trim', 'Fade + Beard']) {
      const a = faq(siteWith([{ title: t, price: '$10', duration: '15 min' }]), 'length')!;
      expect(a, t).toContain(t); expect(a).toContain('15 min'); expect(a).not.toMatch(/haircut/i);
    }
    // a plain cut with a time wins over an earlier partial one
    const d = siteWith([{ title: 'Bang Trim', duration: '5 min' }, { title: 'Haircut', duration: '30 min' }]);
    expect(faq(d, 'length')).toContain('30 min'); expect(faq(d, 'length')).not.toContain('5 min');
  });
  it('the kids question quotes only a kids-cut service, with its own price', () => {
    const a = faq(siteWith([{ title: 'Haircut', price: '$35' }, { title: 'Kids Haircut', price: '$20' }]), 'kids')!;
    expect(a).toContain('Kids Haircut'); expect(a).toContain('$20'); expect(a).not.toContain('$35');
    expect(faq(siteWith([{ title: 'Haircut', price: '$35' }]), 'kids')).toBeNull();
  });
  it('LIVE parity: a site that is not web-created keeps the old behaviour exactly', () => {
    const d = siteWith([{ title: 'Bang Cut', price: '$10' }, { title: 'Haircut', price: '$35' }], 'ios');
    expect(faq(d, 'price')).toContain('$10');
    expect(faq(siteWith([{ title: 'Kids Fade', price: '$20' }], 'ios'), 'price')).toContain('$20');
    // and a web-created site with service guides OFF is not gated either
    const off = siteWith([{ title: 'Bang Cut', price: '$10' }]);
    (off.extraPages as Record<string, unknown>).serviceGuides = false;
    expect(faq(off, 'price')).toContain('$10');
  });
});

describe('library matches that do not mean what the guide says resolve to none on a web site (6e S1)', () => {
  it('table', async () => {
    const { libraryGuideFor } = await import('../../lib/render/guides');
    const web = siteWith([]);
    const ios = siteWith([], 'ios');
    const T: [string, GuideId][] = [['Kids Party Package', 'kids-cut'], ['Kids Party', 'kids-cut'], ['Kids Package', 'kids-cut'], ['Kids Cornrows', 'kids-cut'], ['Kids Locs', 'kids-cut'], ['Kids Twists', 'kids-cut'], ['Kids Mani', 'kids-cut'], ['Kids Pedi', 'kids-cut'], ['Kids Facial', 'kids-cut'], ['Kids Brow', 'kids-cut'], ['Kids Lash', 'kids-cut'], ['Kids Threading', 'kids-cut'], ['Kids Waxing', 'kids-cut'], ['Kids Lice Treatment', 'kids-cut'], ['Kids Updo', 'kids-cut'], ['Kids Makeup', 'kids-cut'], ['Color Consultation', 'color'], ['Color Skin', 'color'], ['Color Nails', 'color'], ['Color Brow', 'color'], ['Color Lash', 'color'], ['Kids Braids', 'kids-cut'], ['Kids Nail Trim', 'kids-cut'], ['Hair Color Consultation', 'color'], ['Color Contacts', 'color'], ['Color Lens', 'color'], ['Temple Fade Removal', 'fade'], ['Undercut Design Stencil', 'design'], ['Design Removal', 'design']];
    for (const [t, g] of T) {
      expect(libraryGuideFor(ios, t), `ios ${t}`).toBe(g);
      expect(libraryGuideFor(web, t), `web ${t}`).toBeNull();
    }
    for (const [t, g] of [['Kids Haircut', 'kids-cut'], ['Hair Color', 'color'], ['Skin Fade', 'fade'], ['Hair Design', 'design'], ['Kids Haircut with Wax Style', 'kids-cut'], ['Haircut & Style', 'haircut']] as [string, GuideId][]) expect(libraryGuideFor(web, t), t).toBe(g);
  });
});
