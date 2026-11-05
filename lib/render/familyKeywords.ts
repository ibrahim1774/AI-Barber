// Which library family (a guide id) a CUSTOM service title may be assigned to. Review 6c B1: a family prints the library's own
// specific wording ("A razor shave removes hair close to the skin ..."), so it may only be assigned when the title ITSELF says it is
// that kind of service. This is a deterministic, reviewed whitelist; nothing a model says can add a family to it.
//
//   familyCandidates(title)  []  = no family may be assigned (the page stays thin / noindex)
//                            [..] = the only families a classifier may choose from (or the owner may pick), and the only ones
//                                   the renderer and the server will honour for this title
//
// Rules (each is pinned by tests/render/familyKeywords.test.ts):
//   1. VETO first. A title with any VETO word never gets a family: it names something the library does not describe (a wax, a
//      facial, a massage, a nail or lash service, braids, a package, a gift card ...) or a tier / marketing word that says nothing
//      about the work. Matched on whole words, after folding case and accents.
//   2. A family needs one of its own keywords in the title (whole words, singular or plural, common spellings). Each keyword was
//      chosen so that the family's "What it is" sentence is true for EVERY title that contains it once the veto has been applied.
//      Words that are ambiguous (classic, regular, gentleman, men's, senior, little, youth, teen, student, art, platinum, silver,
//      outline, stubble, smooth, clean up ...) are deliberately NOT keywords.
//   3. The generic 'haircut' family loses to any specific family that also matched ("Toddler Trim" is kids-cut, not haircut).
//   4. cut-beard, fade and taper have no synonyms here: the library's own patterns already cover every title that really is one,
//      and a family may never be used to widen them.
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
  ].join('|') + ')\\b', 'i');

type Keywords = Partial<Record<GuideId, RegExp[]>>;

/** The reviewed keywords. A title the library already matches never reaches this (the library wins). */
export const FAMILY_KEYWORDS: Keywords = {
  // "A haircut shortens and shapes your hair." True for a trim of the hair, and for the named cuts. A bare "Trim" is NOT a keyword
  // (it may be a beard or a body trim); "sideburns" is not one either (not a beard).
  haircut: [/\b(?:hair|bangs?|fringe|head)\s+trims?\b/, /\btrims?\s+(?:for\s+)?(?:the\s+)?(?:hair|head)\b/, /\bmohawks?\b/, /\bfaux\s?hawks?\b/, /\bmullets?\b/, /\bflat\s?tops?\b/, /\bcaesars?\b/, /\bpompadours?\b/, /\bundercuts?\b/, /\bhigh\s+(?:and|&|n)\s+tight\b/],
  // "A kids' cut is a haircut made for a child."
  'kids-cut': [/\btoddlers?\b/, /\binfants?\b/, /\bbab(?:y|ies)'?s?\s+first\b/],
  // "This service removes hair from the face or the head with a razor."
  shave: [/\bbald\s+heads?\b/, /\bhead\s+polish\b/],
  // "A color service changes the shade of the hair with dye."
  color: [/\bbleach(?:ed|ing)?\b/, /\bbalayage\b/, /\bfrosted\s+tips?\b/, /\bombre\b/],
  // "A line-up sharpens the hairline, the temples and the neckline."
  'line-up': [/\bhairlines?\b/, /\btemples?\b/],
  // "A beard trim tidies the length and the outline of the beard."
  'beard-trim': [/\bgoatees?\b/, /\bsoul\s+patch(?:es)?\b/],
  // "A hair design is a pattern or line cut into short hair."
  design: [/\bfreestyles?\b/, /\bstencils?\b/],
};

const SPECIFIC_FIRST: readonly GuideId[] = GUIDE_IDS;

/**
 * The families this custom title may be assigned. Empty = none. Never contains a family without a keyword match in the title
 * itself, never anything for a vetoed title, and 'haircut' only when no specific family matched.
 */
export function familyCandidates(title: unknown): GuideId[] {
  const t = fold(title).trim();
  if (!t || t.length > 120) return [];
  if (FAMILY_VETO.test(t)) return [];
  const hit: GuideId[] = [];
  for (const id of SPECIFIC_FIRST) {
    const res = FAMILY_KEYWORDS[id];
    if (res && res.some((re) => re.test(t))) hit.push(id);
  }
  return hit.length > 1 ? hit.filter((id) => id !== 'haircut') : hit;
}

/** True when `family` may be assigned to this title. */
export const familyAllowed = (title: unknown, family: unknown): boolean =>
  typeof family === 'string' && (familyCandidates(title) as readonly string[]).includes(family);
