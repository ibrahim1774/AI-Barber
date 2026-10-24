import type { WebsiteData } from '../../../types';

/** Words that are intentionally NOT editable in the preview, and why. Each entry must match something in the run (no dead entries). */
export interface Allowed { name: string; why: string; test: (text: string, d: WebsiteData) => boolean }
const reviewTexts = (d: WebsiteData): Set<string> => {
  const out = new Set<string>();
  for (const r of d.reviews ?? []) for (const v of [r.author, r.date, r.comment, `"${r.comment}"`, `“${r.comment}”`]) if (v) out.add(v);
  return out;
};
export const ALLOW: Allowed[] = [
  { name: 'copyright', why: 'The copyright year is generated, and "Built by Prime Barber" is the platform attribution (the shop name inside the line is editable).', test: (t) => /^(Copyright )?(&copy;|©)\s*\d{4}\b/.test(t) || /Built by Prime Barber/.test(t) },
  { name: 'review text', why: 'Reviews are quotes from clients: hidden, never edited (types.ts, honest.ts reviewKey).', test: (t, d) => reviewTexts(d).has(t) },
  { name: 'rating figures', why: 'The rating and review count are scraped facts; only their wording is editable, from the app\'s own rating control (labels.ratingLine, tap:false).', test: (t, d) => { const a = d.aggregateRating; return !!a && (new RegExp(`^(\\u2605\\s*)?${a.rating.toFixed(1)}\\b`).test(t) || t === `from ${a.count} reviews` || t === String(a.count)); } },
  { name: 'review source', why: '"Reviews from Google" names where the reviews came from (reviewsSourceLabel): a sourced fact, not the barber\'s wording.', test: (t) => /^(Selected reviews|Reviews)( from .+)?$/.test(t) && /from/.test(t) },
  { name: 'initial letter', why: 'An avatar letter: the first letter of a reviewer\'s name (Prime; reviews are never edited) or of a barber\'s name when there is no photo (the name beside it is editable).', test: (t) => /^[A-Z]$/.test(t) },
  { name: 'decorative numerals', why: 'Euphoria numbers its service rows 01, 02 ...: ornament, no wording.', test: (t) => /^0\d$/.test(t) },
];
export const allowedBy = (text: string, d: WebsiteData): Allowed | undefined => ALLOW.find((a) => a.test(text, d));
