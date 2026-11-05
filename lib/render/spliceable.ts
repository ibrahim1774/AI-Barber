// spliceable(kind, value): the ONE gate between a barber-controlled string and a library sentence (fix round 12d).
//
// Four review rounds each found a new way for free text to break a sentence, because the old code tried to CLEAN the text
// ("tidy" it) and every cleaning rule had an edge case. This module does the opposite: a value goes into a strict sentence
// only when it passes a strict WHITELIST for its kind, exactly as typed; otherwise the answer is null and the caller
// OMITS the clause or sentence. Nothing is ever repaired, lower-cased or re-cased. The only normalisation is trimming
// and collapsing runs of spaces and tabs (a layout matter, not a content change).
//
// Kinds:
//   phone     digits, spaces and ( ) + - . only; 7 to 15 digits; no words ("Call or text ..." is refused)
//   price     a currency amount or a range of two ("$25", "$25-$40", "$25+", "25 USD"); never zero
//   duration  a number and a unit ("45 min", "1h 30m", "1.5 hrs", "30-45 mins"); never zero
//   label     1 to 3 plain words of letters, digits, "&" and apostrophes, no sentence punctuation (a button or page name)
//   name      a shop, place or service title: letters, digits, spaces and a few inner marks; no markup, no sentence end,
//             no symbol-only text, no stray symbols at either end, capped
//   address   a street address (a house number then a street name) of plain characters, capped; no line break
//   count     a small whole number as digits (days a week)
// Anything else (the policy text, free prose) is not spliceable at all.
//
// Pure, no DOM, imports nothing.

export type SpliceKind = 'phone' | 'price' | 'duration' | 'label' | 'name' | 'address' | 'count';
export const SPLICE_KINDS: readonly SpliceKind[] = ['phone', 'price', 'duration', 'label', 'name', 'address', 'count'];

/** Which kind each library token is spliced as. A token with no entry is never spliced into a strict sentence. */
export const TOKEN_KIND: Readonly<Record<string, SpliceKind | null>> = {
  shop: 'name', place: 'name', industry: 'name', service: 'name',
  price: 'price', duration: 'duration', phone: 'phone', address: 'address', openDays: 'count',
  policy: null, // free prose: never spliced into a strict sentence
  link: 'label', // the label of {link:...}
  svc: 'name', // the title shown by {svc:...}
};

const NAME_MAX = 100;
const LABEL_MAX = 30;
const ADDRESS_MAX = 120;

/** Trim and collapse spaces and tabs. A line break or other control character makes the value unusable (null). */
function flat(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (/[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060\ufeff]/.test(value)) return null;
  const v = value.replace(/[ \t\u00a0]+/g, ' ').trim();
  return v === '' ? null : v;
}
/** Every "&" is either standalone ("Cut & Style") or inside a word ("R&B"); "&word" would read as an entity next to a ";". */
const ampOk = (v: string): boolean => !/&/.test(v.replace(/ & /g, ' ').replace(/(?<=[\p{L}\p{N}])&(?=[\p{L}\p{N}])/gu, ' ')) && !/&(?:[\p{L}\p{N}]+);/u.test(v);
const hasAlnum = (v: string): boolean => /[\p{L}\p{N}]/u.test(v);
const nonZero = (v: string): boolean => /[1-9]/.test(v);

// ── phone ──
const PHONE_CHARS = /^[0-9 ()+.\-]+$/;
export function isPhone(v: string): boolean {
  if (!PHONE_CHARS.test(v)) return false;
  const digits = v.replace(/\D/g, '').length;
  if (digits < 7 || digits > 15) return false;
  if (!/^[+(\d]/.test(v) || !/\d$/.test(v)) return false;
  if (/.\+/.test(v)) return false; // a plus sign only as the first character
  if (/[-.]{2}|[-.]\s*[-.]|\(\s*\)|\)\s*\(|\s{2}/.test(v)) return false;
  let depth = 0;
  for (const c of v) { if (c === '(') depth++; if (c === ')') depth--; if (depth < 0 || depth > 1) return false; }
  return depth === 0;
}

// ── price and duration ──
const MONEY = /^(?:[$£€]\s?\d{1,5}(?:[.,]\d{1,2})?(?:\s?[-–]\s?[$£€]?\d{1,5}(?:[.,]\d{1,2})?)?\+?|\d{1,5}(?:[.,]\d{1,2})?(?:\s?[-–]\s?\d{1,5}(?:[.,]\d{1,2})?)?\+?\s?(?:USD|CAD|GBP|EUR|MXN))$/i;
const DURATION_UNIT = '\\d+(?:[.,]\\d+)?(?:\\s?[-–]\\s?\\d+(?:[.,]\\d+)?)?\\s?(?:min(?:ute)?s?|hrs?|hours?|h|m)';
const DURATION = new RegExp(`^${DURATION_UNIT}(?:\\s*(?:and\\s+|&\\s*)?${DURATION_UNIT})?$`, 'i');
export const isMoney = (v: string): boolean => MONEY.test(v.trim()) && nonZero(v);
export const isDuration = (v: string): boolean => DURATION.test(v.trim()) && nonZero(v);

// ── label ──
const LABEL_WORD = /^[\p{L}\p{N}][\p{L}\p{N}'’]*$/u;
export function isLabel(v: string): boolean {
  if (v.length > LABEL_MAX || !hasAlnum(v)) return false;
  const words = v.split(' ');
  if (words.length > 3) return false;
  return words.every((w, i) => LABEL_WORD.test(w) || (w === '&' && i > 0 && i < words.length - 1 && words[i - 1] !== '&'));
}

// ── name ──
const NAME_CHARS = /^[\p{L}\p{M}\p{N} &'’()+#/,.\-–]+$/u;
export function isName(v: string): boolean {
  if (v.length > NAME_MAX || !hasAlnum(v) || !NAME_CHARS.test(v) || !ampOk(v)) return false;
  if (!/^(?:[\p{L}\p{N}]|#\d)/u.test(v)) return false; // opens with a letter or digit ("#1 Cut" is fine)
  if (!/[\p{L}\p{N})'’]$/u.test(v)) return false; // ends with a letter, digit, closing bracket or apostrophe
  if (/[.](?:\s|$)|[,](?!\s)|\s[,.]/.test(v)) return false; // no sentence end inside; a comma is followed by a space
  if (/[^\p{L}\p{M}\p{N}\s][^\p{L}\p{M}\p{N}\s]/u.test(v)) return false; // no two symbols side by side
  if (/(?:^|\s)[&+/\-–,.#]\s+[&+/\-–,.#](?:\s|$)/.test(v)) return false;
  if (/#(?!\d)/.test(v) || /\d#/.test(v)) return false; // "#" only in front of a digit
  let depth = 0;
  for (const c of v) { if (c === '(') depth++; if (c === ')') depth--; if (depth < 0 || depth > 1) return false; }
  if (depth !== 0) return false;
  if (/\(\s*\)/.test(v)) return false;
  return true;
}

// ── address ──
const ADDRESS_CHARS = /^[\p{L}\p{M}\p{N} ,.#'’&()/\-–]+$/u;
/** A street address has a house number followed by a street name; a city, "Mobile - I come to you" or a PO box does not. */
export const isStreetAddress = (v: string): boolean =>
  /(?:^|[\s,])#?\d{1,6}[A-Za-z]?(?:-\d{1,6})?\s+[A-Za-z]/.test(v) && !/\bp\.?\s?o\.?\s*box\b/i.test(v) && !/\b(?:mobile|travel|house\s*calls?|i come to you|we come to you|home visits?)\b/i.test(v);
export function isAddress(v: string): boolean {
  if (v.length > ADDRESS_MAX || !ADDRESS_CHARS.test(v) || !ampOk(v) || !isStreetAddress(v)) return false;
  if (!/^[\p{L}\p{N}#]/u.test(v) || !/[\p{L}\p{N})]$/u.test(v)) return false;
  if (/[,.\-–][,.\-–]|\s[,.]|,(?!\s)/.test(v)) return false;
  let depth = 0;
  for (const c of v) { if (c === '(') depth++; if (c === ')') depth--; if (depth < 0 || depth > 1) return false; }
  return depth === 0;
}

/**
 * The value as it may be spliced into a strict library sentence (exactly as typed, spaces collapsed), or null when it does
 * not pass the whitelist of its kind. Null means: omit the clause or sentence. Never repairs, never changes case.
 */
export function spliceable(kind: SpliceKind, value: unknown): string | null {
  const v = flat(value);
  if (v === null) return null;
  switch (kind) {
    case 'phone': return isPhone(v) ? v : null;
    case 'price': return isMoney(v) ? v : null;
    case 'duration': return isDuration(v) ? v : null;
    case 'label': return isLabel(v) ? v : null;
    case 'name': return isName(v) ? v : null;
    case 'address': return isAddress(v) ? v : null;
    case 'count': return /^[1-7]$/.test(v) ? v : null;
    default: return null;
  }
}
