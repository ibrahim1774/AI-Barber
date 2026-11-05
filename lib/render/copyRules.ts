// The honesty rules for library copy (plan 2026-10-24, section 2a): R1 to R9.
//
// Every sentence in lib/render/copyLibrary.ts must pass copyProblems() in every wording, and guides.ts runs the
// same check again at render time, so a bad string can never reach a page even if it slipped past the tests.
// Barber-edited text (`copy` overrides) is the barber's own words and is never checked here.
//
// The rules, in short:
//   R1 voice        never "we / our / us" (the shop speaking): the text describes a service or advises the reader.
//   R2 no rank      no best / top-rated / premium / expert / award ... and no flattering filler (friendly, skilled ...).
//   R3 no tenure    no years / since / established / licensed / certified / experienced ...
//   R4 no practices no walk-in / parking / free / cash / card / payment / coffee ... and no product brands.
//   R5 no promises  no guarantee / satisfaction / 100% / perfect.
//   R6 no figures   no digits, except reader advice such as "2-4 weeks"; prices and durations come only from tokens.
//   R7 no places    no place names (a capitalised word inside a sentence is refused); the place comes only from {place}.
//   R8 service gate a sentence names a service (fade, taper, shave, kids ...) only inside the guide of that service,
//                   otherwise only through {svc:<guide>}, which resolves to the barber's own service or drops the sentence.
//   R10 no health  no cure / treat / heal / dandruff / hair loss / regrow / growth / thicker / prevent / safe for.
//   R11 ASCII      plain ASCII only, apart from the apostrophe and the en and em dash (no look-alike letters).
//   R16 no tattoo  the word never appears in library text.
//   R9 no people    no quotes, no client counts, no "clients say", no reviews.
//
// Three more rules apply only to the blocks added in Phase 1 (`strict`, the keys `svc.<title>.visit|alt`); the older wordings are
// frozen and are not re-checked against them (R10 and R11 were already taken above, so these start at R12):
//   R12 article     never "a / an / the {service}": a title can be plural, a mass noun or start with "The", so no article is safe.
//   R13 token form  a token stands alone as a noun phrase: not glued to letters or digits ("{service}s"), and never
//                   two tokens side by side (with or without a space between them).
//   R14 clean text  the words that come out have no doubled spaces, stray punctuation, braces, repeated words or "undefined" (outputProblems).
//   R15 agreement   {service} is never the subject of a verb ("{service} is ...", "{service} has ..."): a plural or mass
//                   title would break the grammar. Put it in an object position or after "for" ("The menu includes {service}.").
//
// Pure, no DOM, imports nothing.

/** The ten service guides, most specific first (the order guides.ts matches in). */
export const GUIDE_IDS = ['cut-beard', 'fade', 'taper', 'line-up', 'beard-trim', 'shave', 'kids-cut', 'design', 'color', 'haircut'] as const;
export type GuideId = (typeof GUIDE_IDS)[number];

/** Words that name a kind of service. A block may use the groups it is `allow`ed; every other group is R8. */
export type VocabGroup = 'cut-beard' | 'fade' | 'taper' | 'line-up' | 'beard-trim' | 'beard' | 'shave' | 'kids-cut' | 'design' | 'color';

export const VOCAB: Record<VocabGroup, RegExp> = {
  'cut-beard': /\b(?:cut\s+(?:and|&|\+)\s+(?:a\s+)?beard|haircut\s+(?:and|&|\+)\s+(?:a\s+)?beard|combos?)\b/i,
  fade: /\bfad(?:e|es|ed|ing)\b/i,
  taper: /\btaper(?:s|ed|ing)?\b/i,
  'line-up': /\b(?:line[\s-]?ups?|shape[\s-]?ups?|edge[\s-]?ups?)\b/i,
  'beard-trim': /\bbeard\s+trims?\b/i,
  beard: /\bbeards?\b/i,
  shave: /\b(?:shav(?:e|es|ed|ing)|razors?|hot\s+towels?|towel\s+shaves?)\b/i,
  'kids-cut': /\b(?:kids?|child(?:ren)?|boys?|juniors?)\b/i,
  design: /\b(?:designs?|patterns?)\b/i,
  color: /\b(?:colou?r(?:s|ed|ing)?|dy(?:e|es|ed|eing)|highlights?|gr[ae]y|blond(?:e)?)\b/i,
};
export const VOCAB_GROUPS = Object.keys(VOCAB) as VocabGroup[];

/** Tokens a library sentence may hold (guides.ts resolves them). */
export const TEXT_TOKENS = ['shop', 'place', 'industry', 'service', 'price', 'duration', 'phone', 'address', 'openDays', 'policy'] as const;
export const LINK_KEYS = ['location', 'hours', 'contact', 'book', 'services'] as const;
export const TOKEN_RE = /\{([A-Za-z]+)(?::([a-z-]+))?\}/g;

const TOKEN_ANY = /\{[^{}]*\}/g;

/** Is `{name}` / `{name:arg}` a token guides.ts knows? */
export function isKnownToken(name: string, arg?: string): boolean {
  if ((TEXT_TOKENS as readonly string[]).includes(name)) return arg === undefined;
  if (name === 'link') return arg !== undefined && (LINK_KEYS as readonly string[]).includes(arg);
  if (name === 'svc') return arg !== undefined && (GUIDE_IDS as readonly string[]).includes(arg);
  return false;
}

const R: { id: string; re: RegExp }[] = [
  // R1 voice
  { id: 'R1', re: /\b(?:we|our|ours|ourselves|us)\b/i },
  // R2 rank, superlatives, filler
  { id: 'R2', re: /#1|\b(?:best|number one|leading|premier|finest|awards?|award-winning|voted|renowned|famous|premium|luxury|luxurious|world-class|unmatched|unrivaled|unrivalled|expert|experts|expertise|masters?|top[\s-](?:rated|notch|tier|quality|class|barbers?|shops?)|highest|friendly|professional|professionals|skilled|talented|passionate|high-quality|quality|precision|artisan|crafted|craftsmanship|excellence|exceptional|amazing|incredible|state-of-the-art|second to none|trusted|reliable|recommended?|recommendations?|cleanest|freshest|smoothest|neatest|nicest|greatest|coolest|slickest|top\s+(?:barbers?|barbershops?|shops?|salons?|choice|pick|spot|stylists?|place|service)|the\s+top\s+(?:in|of)|love[ds]?|loving|(?:you(?:'ll| will)|you\s+can\s+expect\s+to)\s+(?:love|enjoy|leave|walk|get|see|look|feel))\b/i },
  // R3 tenure and credentials
  { id: 'R3', re: /\b(?:years?|since|established|est\.|decades?|generations?|family-owned|family owned|licensed|licenced|certified|trained|accredited|experienced|veterans?|seasoned)\b/i },
  // R4 practices and amenities
  { id: 'R4', re: /\b(?:walk-?ins?|appointments? only|appointment-only|parking|wheelchair|accessible|wi-?fi|drinks?|coffee|beer|complimentary|free|same-day|no wait|open late|sanitis(?:e|ed|ing)|sanitiz(?:e|ed|ing)|steril\w*|disinfect\w*|hygien\w*|no cost|no charge|on the house|open every day|every day of the week|24\/7|low prices?|cash|cards?|payments?|pay)\b/i },
  // R5 promises
  { id: 'R5', re: /\b(?:guarantee[ds]?|satisfaction|satisfied|perfect|perfectly|flawless|promise[sd]?)\b|100\s*%/i },
  // R6 figures (digits are checked separately)
  { id: 'R6', re: /\b(?:affordable|cheap|cheaper|competitive|deals?|discounts?|inexpensive|value for money)\b/i },
  // R7 places
  { id: 'R7', re: /\b(?:near|nearby|serving|serves|surrounding|minutes from|downtown|neighbou?rhood|in town|around the corner|local|locally|street|avenue|boulevard|county|city)\b/i },
  // R10 health claims
  { id: 'R10', re: /\b(?:cures?|cured|treat(?:s|ed|ment|ments)?|heal(?:s|ed|ing)?|dandruff|hair loss|regrow\w*|growth|thicker|prevent\w*|safe for|pores?|acne|eczema|psoriasis|health|healthy|healthier|stimulat\w*|circulation|grow(?:s|ing)?\s+(?:faster|longer|thicker|more|quicker)|help(?:s|ed|ing)?\s+(?:your\s+|the\s+)?(?:hair\s+)?grow)\b/i },
  // R16 no tattoo anywhere (Ibrahim, 2026-11-04)
  { id: 'R16', re: /\btattoo\w*/i },
  // R9 people and reviews
  { id: 'R9', re: /["“”]|\b(?:clients?|customers?|guests?|regulars?)\s+(?:say|said|love|loves|trust|choose|keep|return|come back|rave)\b|\b(?:testimonials?|reviews?|reviewed|rated|ratings?|stars?|thousands|hundreds|many clients|our clients|barber named)\b/i },
];

// Reader advice may hold a range of days or weeks ("2–4 weeks"); nothing else may hold a digit.
const ADVICE_RANGE = /(\d+)[–-](\d+)\s+(?:days?|weeks?)\b/g;
const RANGE_CAP = 12;

/** Capitalised words inside a sentence are proper nouns (a town, a barber's name): refused. */
function properNouns(text: string): string[] {
  const out: string[] = [];
  const words = text.split(/\s+/).filter(Boolean);
  words.forEach((w, i) => {
    const bare = w.replace(/^[^A-Za-z]+/, '');
    if (!/^[A-Z]/.test(bare)) return;
    if (i === 0 || bare === 'I' || /^I['’]/.test(bare)) return;
    if (/[.!?]["')\]]*$/.test(words[i - 1])) return;
    out.push(bare.replace(/[^A-Za-z'’-].*$/, ''));
  });
  return out;
}

/**
 * Every rule a library sentence breaks, as short messages ("R1: we"); empty = clean. Tokens are taken out first, so
 * `{service}` never trips a rule. `allow` is the vocabulary groups the block may use (R8).
 */
export function copyProblems(text: string, opts: { allow?: readonly VocabGroup[]; strict?: boolean } = {}): string[] {
  const out: string[] = [];
  const raw = String(text ?? '');
  if (opts.strict) out.push(...strictProblems(raw));
  for (const m of raw.matchAll(TOKEN_RE)) if (!isKnownToken(m[1], m[2])) out.push(`token: unknown {${m[1]}${m[2] ? `:${m[2]}` : ''}}`);
  const bare = raw.replace(TOKEN_ANY, ' tok ');
  if (/[{}]/.test(bare)) out.push('token: stray brace');
  if (!bare.trim()) out.push('empty');
  for (const { id, re } of R) {
    const m = re.exec(bare);
    if (m) out.push(`${id}: ${m[0].trim()}`);
  }
  const noAdvice = bare.replace(ADVICE_RANGE, (all, a: string, b: string) => (Number(a) <= RANGE_CAP && Number(b) <= RANGE_CAP ? ' ' : all));
  const digit = /\d/.exec(noAdvice);
  if (digit) out.push(`R6: digit "${digit[0]}"`);
  const odd = /[^\x00-\x7F’–—]/.exec(bare);
  if (odd) out.push(`R11: non-ASCII "${odd[0]}"`);
  for (const w of properNouns(bare)) out.push(`R7: name "${w}"`);
  const allow = new Set(opts.allow ?? []);
  for (const g of VOCAB_GROUPS) {
    if (allow.has(g)) continue;
    const m = VOCAB[g].exec(bare);
    if (m) out.push(`R8: names a service (${g}): ${m[0]}`);
  }
  return out;
}

// R12, R13 and R15 look at the raw sentence, tokens still in place.
const ARTICLE_BEFORE_SERVICE = /\b(?:a|an|the|this|that)\s+\{(?:service|svc:[a-z-]+)\}/i;
const TOKEN_TOUCHES_WORD = /[A-Za-z0-9]\{[^{}]*\}|\{[^{}]*\}[A-Za-z0-9]/;
const TOKENS_ADJACENT = /\}\s*\{/;
const SERVICE_AS_SUBJECT = /(?:^|[.!?]\s+|[,;:]\s+(?:and|but|so)\s+)\{(?:service|svc:[a-z-]+)\}\s+(?:is|are|was|were|has|have|had|puts|sits|appears|lists|offers|comes|takes|costs|works|gets|can|will|does|includes|keeps|makes)\b/i;

// R16: a sentence about directions needs the address in the same sentence, so it drops with it ("Mobile - I come to you",
// a city, no address). R17: no pronoun may point back at {service} (a plural title: "Braids ... has it"). R18: the book
// link's label is the barber's own button text ("Book now"), so it is never a noun phrase: it must be followed by "link".
const DIRECTIONS_WORD = /\b(?:directions?|map|maps|drive|driving|parking|get here|getting here|reach|find us|route|navigate)\b/i;
const HAS_SERVICE = /\{(?:service|svc:[a-z-]+)\}/;
const PRONOUN_IN_SERVICE_ENTRY = /\b(?:it|they|them|these|those|one|ones)\b/i;
const BOOK_LINK_BARE = /\{link:book\}(?!\s+link\b)/;

/** R12, R13 and R15 to R18 (strict blocks only). */
export function strictProblems(raw: string): string[] {
  const out: string[] = [];
  const a = ARTICLE_BEFORE_SERVICE.exec(raw);
  if (a) out.push(`R12: no article before the service: "${a[0]}"`);
  const g = TOKEN_TOUCHES_WORD.exec(raw);
  if (g) out.push(`R13: token glued to a word "${g[0]}"`);
  const j = TOKENS_ADJACENT.exec(raw);
  if (j) out.push(`R13: two tokens side by side "${j[0]}"`);
  const v = SERVICE_AS_SUBJECT.exec(raw);
  if (v) out.push(`R15: the service is the subject of a verb "${v[0].trim()}"`);
  if (DIRECTIONS_WORD.test(raw) && !/\{address\}/.test(raw)) out.push('R16: directions without {address} in the same sentence');
  // R17 looks at the whole entry, across "?" and "." too: "Looking for {service}? {shop} has it on the menu."
  const pr = HAS_SERVICE.test(raw) ? PRONOUN_IN_SERVICE_ENTRY.exec(raw.replace(TOKEN_ANY, ' tok ')) : null;
  if (pr) out.push(`R17: a pronoun in a sentence with the service "${pr[0]}"`);
  if (BOOK_LINK_BARE.test(raw)) out.push('R18: {link:book} must be followed by "link" (its label is the barber\'s button text)');
  const n = (raw.match(/\{service\}/g) ?? []).length;
  if (n > 1) out.push(`R15: {service} appears ${n} times in one sentence`);
  return out;
}

/** R14: what a sentence looks like once its tokens are filled in. Empty = clean. */
export function outputProblems(text: string, opts: { repeats?: boolean } = {}): string[] {
  const out: string[] = [];
  const t = String(text ?? '');
  if (!t.trim()) out.push('R14: empty');
  if (/\s{2,}/.test(t)) out.push('R14: doubled space');
  if (t !== t.trim()) out.push('R14: space at an end');
  if (/[{}]/.test(t)) out.push('R14: brace');
  if (/\b(?:undefined|null|NaN)\b|\[object/i.test(t)) out.push('R14: undefined or null');
  if (/\s[,.;:!?]/.test(t)) out.push('R14: space before punctuation');
  if (/[,;:]\s*[,.;:!?]|([!?])\1|\.{2}/.test(t)) out.push('R14: stray punctuation');
  if (/(?:^|\s)[-–—+&/]\s+[-–—+&/](?:\s|$)/.test(t)) out.push('R14: dash or symbol run');
  if (opts.repeats !== false && /\b([A-Za-z]+)\s+\1\b/i.test(t)) out.push('R14: a word repeated');
  return out;
}

/** The vocabulary groups that have a hit in `text` (tokens taken out). */
export function serviceWordsIn(text: string): VocabGroup[] {
  const bare = String(text ?? '').replace(TOKEN_ANY, ' tok ');
  return VOCAB_GROUPS.filter((g) => VOCAB[g].test(bare));
}
