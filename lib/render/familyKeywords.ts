// Which library family (a guide id) a CUSTOM service title may be assigned to. A family prints the library's own specific wording
// ("A razor shave removes hair close to the skin ..."), so it may only be assigned when the title ITSELF says it is that kind of service.
//
//   familyCandidates(title)  []  = no family may be assigned (the page stays thin / noindex)
//                            [f] = the only family a classifier may choose from (or the owner may pick), and the only one the
//                                  renderer and the server will honour for this title
//
// Review 6e B1-r: keyword-CONTAINS matching failed twice (a title can hold a good word and still be something else: "Hairline Unit",
// "Ombre Lips"). So matching is STRUCTURAL and closed. Rules (each pinned by tests/render/familyKeywords.test.ts):
//   1. The title is folded (case, accents, invisible markers) and split into tokens. Any character outside letters, space, apostrophe,
//      "&" and "+" (after "-", "/", "." and "," count as spaces) makes the title unmatched. Digits too: a number says nothing we can vouch for.
//   2. A family is assigned only if EVERY token of the title is in that family's reviewed closed VOCABULARY: its core phrases (the words
//      that say what the service is) plus a short list of harmless modifiers, and at least one core phrase is present. One unknown
//      token anywhere = no family. Connector words (and, &, +, with, for, a, the) may not start or end the title or stack up.
//   3. Cores are disjoint between families and no modifier lets a title reach two families. If two ever matched the answer is none.
//   4. Only haircut, kids-cut and color have a vocabulary. shave, line-up, beard-trim and design have none (cut-beard, fade and taper
//      never had one): every title for those that the library can describe truthfully is already matched by the library's own patterns,
//      and the words that were added on top (hairline, temple, goatee, soul patch, bald head, head polish, freestyle, stencil) gave
//      false wording ("Hairline Unit" -> line-up, "Ombre Lips" -> color), so they are gone.
//   5. FAMILY_VETO (retail goods, other trades, tiers) still runs first as a second, independent layer; no vocabulary word is in it.
// Pure, no DOM, no imports from the page renderers (guides.ts imports this).
import { GUIDE_IDS, type GuideId } from './copyRules.js';

/** Fold case, accents and the invisible marker characters so a keyword cannot hide behind them. */
const fold = (v: unknown): string =>
  typeof v === 'string'
    ? v.replace(/⁣(?:[a-zA-Z]+|\/)⁣/g, '').replace(/⁣/g, '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’‘`´]/g, "'").toLowerCase()
    : '';

/** Words that rule a family out. Whole words; a plural or common variant is spelled out. */
export const FAMILY_VETO: RegExp = new RegExp(
  '\\b(?:' + [
    // face and body services the library has no page for
    "brows?", "eyebrows?", "lash(?:es)?", "m(?:ou|u)staches?", "nose", "ears?", "neck", "necklines?", "napes?", "wax(?:es|ing)?", "thread(?:s|ing)?", "facials?", "face", "faces", "masks?", "massages?", "scalp",
    "steam(?:s|ing)?", "spa", "ritual(?:s)?", "peels?", "exfoliat\\w*", "scrubs?", "cleans(?:e|er|ing)", "detox", "tint(?:s|ing)?", "teeth", "tooth", "whiten\\w*",
    "nails?", "mani", "manis", "manicures?", "pedi", "pedis", "pedicures?", "gel", "acrylics?", "(?<!\\bhead\\s+)polish(?:ed|es|ing)?",
    "chest", "back", "body", "arms?", "legs?", "underarms?", "armpits?", "bikini", "pubic", "groin", "hands?", "feet", "foot", "pets?", "dogs?",
    "tattoos?", "piercings?", "henna", "restoration", "restore", "transplants?", "micropigmentation", "growth", "regrowth",
    // hair services that are not a cut, shave, colour, line up, beard or design
    "locs?", "dreads?", "dreadlocks?", "twists?", "braid(?:s|ed|ing)?", "cornrows?", "weaves?", "wigs?", "extensions?", "perms?", "relax(?:er|ers|ing)?", "keratin", "straighten\\w*",
    "wash(?:es|ed|ing)?", "shampoo(?:s|ing)?", "condition(?:s|er|ers|ing)?", "blow", "blowouts?", "blowdry", "styl(?:e|es|ed|ing)", "treatments?", "therapy", "protein",
    // bundles, products and tiers that say nothing about the work
    "packages?", "combos?", "bundles?", "memberships?", "subscriptions?", "gifts?", "cards?", "vouchers?", "products?", "special", "specials", "experiences?", "deluxe", "vip",
    "wedding", "bridal", "party", "event", "fee", "deposit", "consultations?", "lessons?", "class(?:es)?",
    // retail goods (review 6d): a product is not a service, whatever else the title says
    "oils?", "balms?", "pomades?", "butters?", "serums?", "creams?", "lotions?", "sprays?", "powders?", "clays?", "tonics?", "brush(?:es)?", "combs?", "kits?", "colognes?", "fragrances?", "aftershaves?", "certificates?", "merch\\w*", "retail", "wholesale",
  ].join('|') + ')\\b', 'i');

// ── Library matches on a WEB-created site (review 6d) ────────────────────────────────────────────────
// The library patterns match single words ("beard", "design", "cut") and so give a retail product or a non-service the wording of a
// service ("Beard Oil" -> "A beard trim tidies the length ...", "Henna Design" -> "A hair design is a pattern cut into short hair").
// On a web-created site a title like that resolves to NO guide (thin, noindex). iOS and legacy sites are untouched (same library, same
// output). Two lists:
//   HARD: never a service whatever else the title says (gift card, product, kit, henna, tattoo, piercing, pomade ...).
//   SOFT: a product noun (oil, balm, wax, shampoo, wash ...) that ENDS the title; it is a product unless a service word AND a joiner (and, &, with, +) show it is one item of a service:
//         "Beard Oil" and "Shave Oil" are products, "Haircut & Beard Oil" and "Beard Trim with Oil" are services.
const HARD_NON_SERVICE = new RegExp('\\b(?:' + [
  'gifts?', 'e-?gifts?', 'vouchers?', 'certificates?', 'products?', 'merch\\w*', 'retail', 'wholesale', 'kits?', 'pomades?', 'colognes?', 'fragrances?', 'aftershaves?',
  'henna', 'tattoo\\w*', 'piercings?', 'ink(?:ing)?', 'sticker\\w*', 'gear',
].join('|') + ')\\b', 'i');
const SOFT_SRC = [
  'oils?', 'balms?', 'wax(?:es)?', 'butters?', 'serums?', 'creams?', 'lotions?', 'sprays?', 'powders?', 'clays?', 'tonics?', 'gels?', 'brush(?:es)?', 'combs?',
  'shampoo(?:s)?', 'conditioners?', 'wash(?:es)?', 'soaps?', 'scrubs?', 'masks?', 'pads?', 'blades?',
].join('|');
/** The title ENDS with the product noun ("Shave Oil", "Beard Balm"): the thing sold. */
const SOFT_LAST = new RegExp('\\b(?:' + SOFT_SRC + ')\\s*$', 'i');
const JOINER = /(?:\band\b|&|\+|\bwith\b|\bw\/|\bplus\b|,)/i;
const SERVICE_WORD = /\b(?:hair)?cuts?\b|\b(?:trims?|shav\w*|fades?|tapers?|line[\s-]?ups?|edge[\s-]?ups?|shape[\s-]?ups?|designs?|colou?r\w*|dye\w*|highlights?|blend\w*|gr[ae]y)\b/i;
/** Extra words that take a title out of ONE library guide on a web site (the library pattern matched a word that does not mean what the guide says). */
const LIBRARY_EXCLUDE_WEB: Partial<Record<GuideId, RegExp>> = {
  'beard-trim': /\b(?:bleach\w*|lighten\w*|tint\w*|perm\w*|relax\w*|extensions?|transplant\w*|growth|regrowth|restor\w*|implants?|filler|botox)\b/i,
  design: /\b(?:nails?|nail\s?art|brows?|eyebrows?|lash\w*|makeup|make-up|logo|web\w*|graphic\w*|interior|invitation\w*)\b/i,
};

/** True when the title names something that is not a barber service (a product, a gift card, a tattoo ...). Used by the library guide lookup on web sites and by the AI text gate. */
export function nonServiceTitle(title: unknown): boolean {
  const t = fold(title);
  if (!t) return false;
  if (HARD_NON_SERVICE.test(t)) return true;
  // The title ENDS with the product noun (the thing sold: "Beard Oil", "Shave Oil"), and either no service word is beside it or nothing joins a
  // second item. "Haircut & Beard Oil", "Beard Trim with Oil", "Hot Oil Treatment" and "Beard Wash & Trim" are services.
  if (!SOFT_LAST.test(t)) return false;
  return !SERVICE_WORD.test(t) || !JOINER.test(t);
}
/** True when a web-created site must NOT use the library guide `guide` for this title although the library pattern matched. */
export function libraryGuideOverruled(title: unknown, guide: GuideId | null): boolean {
  if (!guide) return false;
  if (nonServiceTitle(title)) return true;
  const extra = LIBRARY_EXCLUDE_WEB[guide];
  return !!extra && extra.test(fold(title));
}

type Vocab = {
  /** Phrases that say what the service is. At least one must be present. */
  cores: readonly string[];
  /** kids-cut only: phrases of which at least one must also be present (the hair work a child's service is). Their words are valid tokens. */
  needs?: readonly string[];
  /** Single words that are harmless beside a core for this family's wording. Every entry is justified in the 6e report. */
  mods: readonly string[];
};

// Hair work that is a cut, by name or by "hair trim". The haircut guide ("A haircut shortens and shapes your hair") is true for each.
const CUT_CORES = [
  'hair trim', 'hair trims', 'bang trim', 'bangs trim', 'fringe trim', 'mohawk', 'mohawks', 'faux hawk', 'fauxhawk', 'faux hawks', 'fauxhawks',
  'mullet', 'mullets', 'flat top', 'flattop', 'flat tops', 'flattops', 'caesar', 'caesars', 'pompadour', 'pompadours', 'undercut', 'undercuts',
  'high and tight', 'high & tight',
] as const;

export const FAMILY_VOCAB: Partial<Record<GuideId, Vocab>> = {
  // "A haircut shortens and shapes your hair ... the barber trims the hair with clippers, scissors or both ... suits anyone."
  haircut: {
    cores: CUT_CORES,
    mods: ["men's", 'mens', 'men', 'adult', 'adults', 'regular', 'standard', 'basic', 'classic', 'senior', 'short', 'hair', 'trim', 'trims', 'and', '&', '+', 'with', 'for', 'a', 'the'],
  },
  // "A kids' cut is a haircut made for a child." Needs an age word AND a named cut / hair trim ("Toddler Trim" alone could be nails).
  'kids-cut': {
    cores: ['toddler', 'toddlers', 'infant', 'infants', "baby's first", 'babys first', 'babies first'],
    needs: CUT_CORES,
    mods: ['first', 'trim', 'trims', 'and', '&', '+', 'with', 'for', 'a', 'the'],
  },
  // "A color service changes the shade of the hair with dye." Bleach lightens the shade; balayage and frosted tips are colour techniques.
  color: {
    cores: ['bleach', 'bleaching', 'bleached', 'balayage', 'frosted tip', 'frosted tips'],
    mods: ["men's", 'mens', 'men', 'adult', 'adults', 'hair', 'full', 'partial', 'root', 'roots', 'tip', 'tips', 'tone', 'toner', 'toning', 'and', '&', '+', 'with', 'a', 'the'],
  },
};

const CONNECTORS: ReadonlySet<string> = new Set(['and', '&', '+', 'with', 'for', 'a', 'the']);
const ARTICLES: ReadonlySet<string> = new Set(['a', 'the']);

/** Tokens of a folded title, or null when it holds a character we do not vouch for (digits, symbols, other scripts). */
function tokensOf(t: string): string[] | null {
  const s = t.replace(/[-/.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || !/^[a-z' &+]+$/.test(s)) return null;
  return s.match(/[a-z]+(?:'[a-z]+)?|&|\+/g);
}

/** Replace every whole-token occurrence of each phrase (longest first) by `mark`, so replaced words can never glue into a new phrase. */
function stripPhrases(joined: string, phrases: readonly string[], mark: string): { text: string; hit: boolean } {
  let text = joined; let hit = false;
  for (const p of [...phrases].sort((a, b) => b.length - a.length)) {
    const needle = ` ${p} `;
    while (text.includes(needle)) { text = text.replace(needle, ` ${mark} `); hit = true; }
  }
  return { text, hit };
}

function matchesVocab(tokens: string[], v: Vocab): boolean {
  const core = stripPhrases(` ${tokens.join(' ')} `, v.cores, '§');
  if (!core.hit) return false;
  let text = core.text;
  if (v.needs) { const need = stripPhrases(text, v.needs, '¤'); if (!need.hit) return false; text = need.text; }
  const rest = text.trim().split(' ');
  const mods = new Set(v.mods);
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i];
    if (w === '§' || w === '¤') continue;
    if (!mods.has(w)) return false;                       // one unknown token and the family is out
    if (CONNECTORS.has(w)) {
      if (i === 0 || i === rest.length - 1) return false;  // a connector must sit between two things
      const prev = rest[i - 1];
      if (CONNECTORS.has(prev) && !(ARTICLES.has(w) && prev !== w)) return false;
    }
  }
  return true;
}

/**
 * The families this custom title may be assigned. Empty = none. At most one: a family needs a vocabulary match on EVERY token of the
 * title, never for a vetoed title, and a title that two families would claim is none.
 */
export function familyCandidates(title: unknown): GuideId[] {
  const t = fold(title).trim();
  if (!t || t.length > 120) return [];
  if (FAMILY_VETO.test(t)) return [];
  const tokens = tokensOf(t);
  if (!tokens || tokens.length > 8) return [];
  const hit: GuideId[] = [];
  for (const id of GUIDE_IDS) { const v = FAMILY_VOCAB[id]; if (v && matchesVocab(tokens, v)) hit.push(id); }
  return hit.length === 1 ? hit : [];
}

/** True when `family` may be assigned to this title. */
export const familyAllowed = (title: unknown, family: unknown): boolean =>
  typeof family === 'string' && (familyCandidates(title) as readonly string[]).includes(family);
