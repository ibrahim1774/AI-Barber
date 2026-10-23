import type { WebsiteData } from '@/web/types';
import { aggregateToShow, reviewKey, reviewsSourceName } from '@/web/lib/render/honest';
import { defaultRatingLine, isValidRatingLine, ratingLineProblem } from '@/web/lib/render/labels';

// The rating and review controls (P3a). The scraped rating and review count are facts from the booking
// page or Google listing: the barber can hide them or re-word the sentence around them, never retype a
// number. Reviews are quotes: hidden, never edited.

/** Most hidden-review keys kept (a re-import can bring a hidden review back, so keys outlive the reviews). */
const MAX_HIDDEN = 200;

/** Whether there is anything to control: a readable rating or at least one scraped review. */
export const hasRatingOrReviews = (d: WebsiteData): boolean => hasRating(d) || (d.reviews?.length ?? 0) > 0;

/** Whether the page shows the rating (a readable scraped aggregate that is not hidden). */
export const ratingShown = (d: WebsiteData): boolean => aggregateToShow(d) !== null;

/** Whether the data holds a readable rating at all (hidden or not). */
export const hasRating = (d: WebsiteData): boolean => aggregateToShow({ aggregateRating: d.aggregateRating }) !== null;

export function setRatingShown(d: WebsiteData, show: boolean): WebsiteData {
  const display = { ...(d.display ?? {}) };
  if (show) delete display.rating;
  else display.rating = 'hide';
  const next = { ...d };
  if (Object.keys(display).length) next.display = display;
  else delete next.display;
  return next;
}

/** The standard sentence for this site's rating, "4.8 from 1,200 reviews", or '' without one. */
export function standardRatingLine(d: WebsiteData): string {
  const agg = aggregateToShow({ aggregateRating: d.aggregateRating });
  return agg ? defaultRatingLine(agg) : '';
}

export const storedRatingLine = (d: WebsiteData): string => {
  const v = (d.labels as Record<string, unknown> | undefined)?.ratingLine;
  return typeof v === 'string' ? v : '';
};

/** Source name for the wording hint ("Booksy"), or ''. */
export const ratingSource = (d: WebsiteData): string => reviewsSourceName(d);

/**
 * Save the rating wording. '' returns to the standard line. A wording with a number, star, percent sign
 * or number word outside {rating} {count} {source} is refused: { error } and the data is unchanged.
 */
export function setRatingLine(d: WebsiteData, text: string): { data: WebsiteData; error: string } {
  const t = text.trim();
  const { ratingLine: _gone, ...rest } = (d.labels ?? {}) as Record<string, string>;
  void _gone;
  if (t === '') return { data: { ...d, labels: rest }, error: '' };
  if (!isValidRatingLine(t)) return { data: d, error: ratingLineProblem(t) };
  return { data: { ...d, labels: { ...rest, ratingLine: t } }, error: '' };
}

export interface ReviewRow { key: string; author: string; comment: string; hidden: boolean }

/** The scraped reviews with whether each is hidden. Keyed by content hash, not position. */
export function reviewRows(d: WebsiteData): ReviewRow[] {
  const hidden = new Set(d.hiddenReviews ?? []);
  return (d.reviews ?? []).map((r) => {
    const key = reviewKey(r);
    return { key, author: (r.author || '').trim() || 'Customer', comment: (r.comment || '').trim(), hidden: hidden.has(key) };
  });
}

export function setReviewHidden(d: WebsiteData, key: string, hide: boolean): WebsiteData {
  const cur = (d.hiddenReviews ?? []).filter((k) => typeof k === 'string');
  const has = cur.includes(key);
  if (hide === has) return d;
  const next = hide ? [...cur, key].slice(-MAX_HIDDEN) : cur.filter((k) => k !== key);
  const out = { ...d };
  if (next.length) out.hiddenReviews = next;
  else delete out.hiddenReviews;
  return out;
}
