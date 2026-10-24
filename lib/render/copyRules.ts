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
//   R9 no people    no quotes, no client counts, no "clients say", no reviews.
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
  { id: 'R2', re: /\b(?:best|#1|number one|leading|premier|finest|awards?|award-winning|voted|renowned|famous|premium|luxury|luxurious|world-class|unmatched|unrivaled|unrivalled|expert|experts|expertise|masters?|top[\s-](?:rated|notch|tier|quality|class|barbers?|shops?)|highest|friendly|professional|professionals|skilled|talented|passionate|high-quality|quality|precision|artisan|crafted|craftsmanship|excellence|exceptional|amazing|incredible|state-of-the-art|second to none|trusted|reliable)\b/i },
  // R3 tenure and credentials
  { id: 'R3', re: /\b(?:years?|since|established|est\.|decades?|generations?|family-owned|family owned|licensed|licenced|certified|trained|accredited|experienced|veterans?|seasoned)\b/i },
  // R4 practices and amenities
  { id: 'R4', re: /\b(?:walk-?ins?|appointments? only|appointment-only|parking|wheelchair|accessible|wi-?fi|drinks?|coffee|beer|complimentary|free|same-day|no wait|open late|sanitis(?:e|ed|ing)|sanitiz(?:e|ed|ing)|steril(?:ise|ize)d?|cash|cards?|payments?|pay)\b/i },
  // R5 promises
  { id: 'R5', re: /\b(?:guarantee[ds]?|satisfaction|satisfied|perfect|perfectly|flawless|promise[sd]?)\b|100\s*%/i },
  // R6 figures (digits are checked separately)
  { id: 'R6', re: /\b(?:affordable|cheap|cheaper|competitive|deals?|discounts?|inexpensive|value for money)\b/i },
  // R7 places
  { id: 'R7', re: /\b(?:near|nearby|serving|serves|surrounding|minutes from|downtown|neighbou?rhood|in town|around the corner|local|locally|street|avenue|boulevard|county|city)\b/i },
  // R9 people and reviews
  { id: 'R9', re: /["“”]|\b(?:clients?|customers?|guests?|regulars?)\s+(?:say|said|love|loves|trust|choose|keep|return|come back|rave)\b|\b(?:testimonials?|reviews?|reviewed|rated|ratings?|stars?|thousands|hundreds|many clients|our clients|barber named)\b/i },
];

// Reader advice may hold a range of days or weeks ("2–4 weeks"); nothing else may hold a digit.
const ADVICE_RANGE = /\d+[–-]\d+\s+(?:days?|weeks?)\b/g;

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
export function copyProblems(text: string, opts: { allow?: readonly VocabGroup[] } = {}): string[] {
  const out: string[] = [];
  const raw = String(text ?? '');
  for (const m of raw.matchAll(TOKEN_RE)) if (!isKnownToken(m[1], m[2])) out.push(`token: unknown {${m[1]}${m[2] ? `:${m[2]}` : ''}}`);
  const bare = raw.replace(TOKEN_ANY, ' tok ');
  if (/[{}]/.test(bare)) out.push('token: stray brace');
  if (!bare.trim()) out.push('empty');
  for (const { id, re } of R) {
    const m = re.exec(bare);
    if (m) out.push(`${id}: ${m[0].trim()}`);
  }
  const noAdvice = bare.replace(ADVICE_RANGE, ' ');
  const digit = /\d/.exec(noAdvice);
  if (digit) out.push(`R6: digit "${digit[0]}"`);
  for (const w of properNouns(bare)) out.push(`R7: name "${w}"`);
  const allow = new Set(opts.allow ?? []);
  for (const g of VOCAB_GROUPS) {
    if (allow.has(g)) continue;
    const m = VOCAB[g].exec(bare);
    if (m) out.push(`R8: names a service (${g}): ${m[0]}`);
  }
  return out;
}

/** The vocabulary groups that have a hit in `text` (tokens taken out). */
export function serviceWordsIn(text: string): VocabGroup[] {
  const bare = String(text ?? '').replace(TOKEN_ANY, ' tok ');
  return VOCAB_GROUPS.filter((g) => VOCAB[g].test(bare));
}
