// Which guide (a library guide id) a service title gets on a web-created site with service guides on, and which families a classifier may
// choose. Review 6g: keyword-CONTAINS matching failed again and again (Clippers, Dog Haircut, Bang Cut, Childrens Haircut, combos,
// memberships), so the assignment is STRUCTURAL and closed (structuralGuide below): every token of the folded title must be in the reviewed
// vocabulary of ONE guide, a combo of families is none unless it is the explicit cut-beard rule, and color is never assigned.
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
    "brows?", "eyebrows?", "lash(?:es)?", "m(?:ou|u)staches?", "nose", "ears?", "neck", "necklines?", "napes?", "wax(?:es|ing)?", "thread(?:s|ing)?", "facials?", "face(?!\\s+shav)", "faces", "masks?", "massages?", "scalp",
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

// ── The closed vocabulary (review 6g) ──────────────────────────────────────────────────────────────────
// On a web-created site with service guides on (guides.ts serviceTextOn), the guide of EVERY service title (library guides and families
// alike) comes from this matcher and from nothing else. A guide id is assigned only when
//   - every token of the folded title is in that guide's reviewed vocabulary (cores + modifiers, tables in the 6g report) and at
//     least one core is present, and
//   - no other guide's vocabulary accepts the title (cores are disjoint; a title two guides accept is none), and
//   - the title is not vetoed (FAMILY_VETO, nonServiceTitle), and
//   - the only combination of two families is the explicit true combo rule cut-beard: ONE cut-type side + ONE beard side joined by
//     exactly one of and, &, +, with. Every other combo (haircut and shave, fade and line up ...) is none.
// There is NO color guide here: nothing about a color title guarantees "dye", "toner" or a method (6f B1), so every color title is none.
// A title that is a membership, package, pass, subscription, voucher, gift, product, another trade, or holds any unknown word is none.
type Vocab = {
  /** Phrases that say what the service is. At least one must be present. */
  cores: readonly string[];
  /** kids-cut only: phrases of which at least one must also be present (the hair work a child's service is). Their words are valid tokens. */
  needs?: readonly string[];
  /** Single words that are harmless beside a core for this guide's wording. Every entry is justified in the 6g report. */
  mods: readonly string[];
};

// Hair work that is a cut, by name or by "hair trim". The haircut guide ("A haircut shortens and shapes your hair") is true for each.
const CUT_CORES = [
  'hair trim', 'hair trims', 'mohawk', 'mohawks', 'faux hawk', 'fauxhawk', 'faux hawks', 'fauxhawks',
  'mullet', 'mullets', 'flat top', 'flattop', 'flat tops', 'flattops', 'caesar', 'caesars', 'undercut', 'undercuts',
  'high and tight', 'high & tight', 'under cut', 'under cuts', 'executive cut', 'executive cuts',
  'buzz cut', 'buzzcut', 'buzz cuts', 'buzzcuts', 'crew cut', 'crewcut', 'crew cuts', 'crewcuts',
] as const;
/** The generic words for a haircut. */
const PLAIN_CORES = ['haircut', 'haircuts', 'hair cut', 'hair cuts', 'cut', 'cuts'] as const;
/** Who it is for. The guides say "suits anyone", so none of these changes what is true. */
const DEMO = ["men's", 'mens', 'men', 'gentlemen', 'gentlemens', "gentlemen's", 'gents', "gent's", 'gent', "women's", 'womens', 'women', 'ladies', 'adult', 'adults', 'senior', 'seniors'] as const;
/** Plain descriptors that make no claim about the method. */
const LEVEL = ['regular', 'standard', 'basic', 'classic'] as const;

export const FAMILY_VOCAB: Partial<Record<GuideId, Vocab>> = {
  // "A haircut shortens and shapes your hair ... trims the hair with clippers, scissors or both ... suits anyone."
  haircut: {
    cores: [...CUT_CORES, ...PLAIN_CORES],
    mods: [...DEMO, ...LEVEL, 'short', 'long', 'hair', 'trim', 'trims', 'scissor', 'clipper', 'layered', 'textured', 'pompadour', 'for',
      // 6h: who it is for and plain descriptors of a cut (the sentences say "suits anyone" and name no method)
      'teen', 'teens', 'youth', 'student', 'students', 'veteran', 'veterans', 'military', 'citizen', 'citizens', 'curly', 'afro', 'only', 'tapered'],
  },
  // "A kids' cut is a haircut made for a child." An age word AND hair work that is a cut, a fade or a taper.
  'kids-cut': {
    cores: ['kid', 'kids', "kid's", 'child', "child's", 'childs', 'children', "children's", 'childrens', 'boy', 'boys', "boy's", 'girl', 'girls', "girl's", 'junior', 'juniors', 'toddler', 'toddlers'],
    needs: [...CUT_CORES, ...PLAIN_CORES, 'fade', 'fades', 'taper', 'tapers', 'trim', 'trims'],
    mods: [...LEVEL, 'short', 'hair', 'trim', 'trims', 'for', 'little', 'big'],
  },
  // "A fade blends short hair into longer hair ... often down to the skin."
  fade: {
    cores: ['fade', 'fades'],
    mods: [...DEMO, ...LEVEL, 'skin', 'bald', 'low', 'mid', 'high', 'drop', 'burst', 'temple', 'shadow', 'taper', 'haircut', 'cut', 'hair', 'short', 'for', 'mohawk'],
  },
  // "A taper makes the hair gradually shorter toward the neckline and around the ears."
  taper: {
    cores: ['taper', 'tapers'],
    mods: [...DEMO, ...LEVEL, 'low', 'mid', 'high', 'haircut', 'cut', 'hair', 'short', 'for', 'mohawk'],
  },
  // "A line-up sharpens the hairline, the temples and the neckline."
  'line-up': {
    cores: ['line up', 'line ups', 'lineup', 'lineups', 'shape up', 'shape ups', 'shapeup', 'shapeups', 'edge up', 'edge ups', 'edgeup', 'edgeups',
      'line up with razor', 'line up with a razor', 'lineup with razor', 'lineup with a razor'],
    mods: [...DEMO, ...LEVEL, 'hair', 'for', 'razor', 'hairline'],
  },
  // "A beard trim tidies the length and the outline of the beard."
  'beard-trim': {
    cores: ['beard trim', 'beard trims', 'beard shaping', 'beard shape', 'beard sculpt', 'beard sculpts', 'beard sculpting', 'beard cut', 'beard cuts',
      'beard cleanup', 'beard cleanups', 'beard clean up', 'beard clean ups',
      'beard line up', 'beard line ups', 'beard lineup', 'beard lineups', 'beard shape up', 'beard shape ups', 'beard shapeup', 'beard edge up', 'beard edge ups', 'beard edgeup'],
    mods: [...DEMO, ...LEVEL, 'full', 'short', 'long', 'for'],
  },
  // "A razor shave removes hair close to the skin. Warm towels are often used first."
  shave: {
    cores: ['shave', 'shaves', 'shaving', 'shave and hot towel', 'shave & hot towel', 'shave + hot towel', 'shave with hot towel', 'shave with a hot towel'],
    mods: [...DEMO, ...LEVEL, 'hot', 'towel', 'straight', 'razor', 'wet', 'traditional', 'head', 'beard', 'for', 'face', 'clean', 'royal', 'luxury'],
  },
  // "A hair design is a pattern or line cut into short hair, usually with a trimmer."
  design: {
    cores: ['hair design', 'hair designs', 'hair art', 'haircut design', 'haircut designs', 'cut design', 'cut designs', 'design', 'designs', 'hard part', 'hard parts', 'razor part', 'razor parts'],
    mods: [...DEMO, ...LEVEL, 'custom', 'simple', 'for', 'freestyle'],
  },
  // No `color` entry (6f B1, 6g): no title guarantees "dye", "toner" or a method.
};

const CONNECTORS: ReadonlySet<string> = new Set(['and', '&', '+', 'with', 'for', 'a', 'the']);
const COMBO_JOINERS: ReadonlySet<string> = new Set(['and', '&', '+', 'with']);
const ARTICLES: ReadonlySet<string> = new Set(['a', 'the']);

// A trailing qualifier that only says who the service is for: an age ("(Under 12)", "12 & Under", "(65+)", "(Ages 5-12)") or a plain
// descriptor in parentheses ("(Men)", "(Long Hair)"). An age is dropped; a descriptor is unwrapped and its words must still be vocabulary.
// Any other parenthesis, or a bare number, is not vouched for and the title stays none (tokensOf rejects it).
const AGE_Q: readonly RegExp[] = [
  /^(?:ages?|aged)\s+\d{1,2}(?:\s*-\s*\d{1,2})?\s*(?:\+|yrs?|years?)?$/,
  /^(?:under|over|below|above|up to)\s+\d{1,2}(?:\s*(?:yrs?|years?))?$/,
  /^\d{1,2}\s*(?:\+|(?:yrs?|years?)?\s*(?:&|and|\+)\s*(?:under|over|up|younger|older|below|above))$/,
  /^\d{1,2}\s*-\s*\d{1,2}$/,
];
const PAREN_WORDS: ReadonlySet<string> = new Set([...DEMO, ...LEVEL, 'short', 'long', 'hair']);
const ageQualifier = (q: string): boolean => AGE_Q.some((r) => r.test(q));
function dropQualifier(t: string): string {
  const m = /^(.*\S)\s*\(([^()]*)\)$/.exec(t);
  if (m) {
    const q = m[2].trim();
    if (ageQualifier(q)) return m[1];
    const words = q.split(/\s+/);
    return q && words.every((w) => PAREN_WORDS.has(w)) ? `${m[1]} ${q}` : t;
  }
  const n = /^(.*\S)\s+(?:(?:under|over)\s+\d{1,2}|\d{1,2}\s*(?:&|and)\s*(?:under|over|younger|older|up)|\d{1,2}\+|ages?\s+\d{1,2}(?:\s*-\s*\d{1,2})?)$/.exec(t);
  return n ? n[1] : t;
}

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
  if (!tokens.length) return false;
  const core = stripPhrases(` ${tokens.join(' ')} `, v.cores, '§');
  if (!core.hit) return false;
  let text = core.text;
  if (v.needs) { const need = stripPhrases(text, v.needs, '¤'); if (!need.hit) return false; text = need.text; }
  const rest = text.trim().split(' ');
  const mods = new Set(v.mods);
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i];
    if (w === '§' || w === '¤') continue;
    if (!mods.has(w)) return false;                       // one unknown token and the guide is out
    if (CONNECTORS.has(w)) {
      if (i === 0 || i === rest.length - 1) return false;  // a connector must sit between two things
      const prev = rest[i - 1];
      if (CONNECTORS.has(prev) && !(ARTICLES.has(w) && prev !== w)) return false;
    }
  }
  return true;
}

const CUT_SIDE: readonly GuideId[] = ['haircut', 'fade', 'taper'];
/** The one true combination: a cut-type side and a beard side around exactly one joiner, in either order ("Haircut & Beard Trim", "Beard and Fade"). */
function isCutBeard(tokens: string[]): boolean {
  const beardSide = (side: string[]): boolean => (side.length === 1 && side[0] === 'beard') || matchesVocab(side, FAMILY_VOCAB['beard-trim']!);
  const cutSide = (side: string[]): boolean => CUT_SIDE.some((g) => matchesVocab(side, FAMILY_VOCAB[g]!));
  // Each joiner is a candidate split; a joiner inside a core ("high AND tight") simply fails to give two sides. Exactly one split may work.
  let ok = 0;
  tokens.forEach((w, i) => {
    if (!COMBO_JOINERS.has(w)) return;
    const left = tokens.slice(0, i);
    let right = tokens.slice(i + 1);
    if (right[0] === 'a') right = right.slice(1);
    if (!left.length || !right.length) return;
    if ((cutSide(left) && beardSide(right)) || (beardSide(left) && cutSide(right))) ok++;
  });
  return ok === 1;
}

/**
 * THE guide of a service title on a web-created site with service guides on: one of the closed set, or null. Null is the safe answer
 * (the page stays thin and noindex, the FAQ names no price for it).
 */
export function structuralGuide(title: unknown): GuideId | null {
  const t = fold(title).trim();
  if (!t || t.length > 120) return null;
  if (FAMILY_VETO.test(t) || nonServiceTitle(t)) return null;
  const tokens = tokensOf(dropQualifier(t));
  if (!tokens || tokens.length > 8) return null;
  const hit: GuideId[] = [];
  for (const id of GUIDE_IDS) { const v = FAMILY_VOCAB[id]; if (v && matchesVocab(tokens, v)) hit.push(id); }
  if (isCutBeard(tokens)) hit.push('cut-beard');
  return hit.length === 1 ? hit[0] : null;
}

/**
 * The guides a custom title may be assigned as a family (what a classifier may choose from, what the owner may pick, what the renderer and
 * the server honour). Empty = none. At most one.
 */
export function familyCandidates(title: unknown): GuideId[] {
  const g = structuralGuide(title);
  return g ? [g] : [];
}

/** True when `family` may be assigned to this title. */
export const familyAllowed = (title: unknown, family: unknown): boolean =>
  typeof family === 'string' && (familyCandidates(title) as readonly string[]).includes(family);
