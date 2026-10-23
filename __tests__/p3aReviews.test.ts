import type { WebsiteData } from '@/web/types';
import { reviewKey } from '@/web/lib/render/honest';
import {
  hasRating, ratingShown, reviewRows, setRatingLine, setRatingShown, setReviewHidden, standardRatingLine, storedRatingLine,
} from '@/lib/sections/reviews';
import { renderSite, forRender } from '@/lib/render';
import { buildPreviewHtml } from '@/lib/editable';

const base = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Jacks', area: 'Austin, TX', phone: '(512) 555-0142', template: 'luxe',
  hero: { heading: 'H', tagline: 'T', imageUrl: '' }, about: { heading: 'A', description: ['x'], imageUrl: '' },
  services: [], gallery: [], contact: { address: '', email: '' },
  aggregateRating: { rating: 4.8, count: 1200 }, reviewsSource: 'Booksy',
  reviews: [{ author: 'Al', comment: 'Great cut', rating: 5 }, { author: 'Bo', comment: 'Fine work', rating: 4 }],
  ...extra,
} as WebsiteData);

describe('rating', () => {
  test('hide / show toggles display.rating and never touches the data', () => {
    const hidden = setRatingShown(base(), false);
    expect(hidden.display).toEqual({ rating: 'hide' });
    expect(hidden.aggregateRating).toEqual({ rating: 4.8, count: 1200 });
    expect(ratingShown(hidden)).toBe(false);
    expect(hasRating(hidden)).toBe(true);
    const shown = setRatingShown(hidden, true);
    expect(shown.display).toBeUndefined();
    expect(ratingShown(shown)).toBe(true);
  });

  test('hiding takes the rating off the page in the editor preview and the published page', () => {
    const hidden = setRatingShown(base(), false);
    expect(buildPreviewHtml(base(), false)).toContain('from 1,200 reviews');
    expect(buildPreviewHtml(hidden, false)).not.toContain('1,200');
    expect(renderSite(forRender(hidden))).not.toContain('1,200');
  });

  test('wording: a figure outside the placeholders is refused and nothing is saved', () => {
    const d = base();
    for (const bad of ['Rated 5 stars', 'Over 1000 clients', '100% happy', 'Rated ★★★★★', 'Rated five stars']) {
      const r = setRatingLine(d, bad);
      expect(r.error).not.toBe('');
      expect(r.data).toBe(d);
    }
  });

  test('wording: plain words and placeholders are saved, and the page uses the real figures', () => {
    const r = setRatingLine(base(), 'Rated {rating} by {count} clients on {source}');
    expect(r.error).toBe('');
    expect(storedRatingLine(r.data)).toBe('Rated {rating} by {count} clients on {source}');
    expect(renderSite(forRender(r.data))).toContain('Rated 4.8 by 1,200 clients on Booksy');
    const plain = setRatingLine(base(), 'Loved by our clients');
    expect(plain.error).toBe('');
  });

  test('empty wording returns to the standard line', () => {
    const r = setRatingLine(base(), 'Loved by our clients').data;
    const back = setRatingLine(r, '  ');
    expect(back.error).toBe('');
    expect(storedRatingLine(back.data)).toBe('');
    expect(standardRatingLine(base())).toBe('4.8 from 1,200 reviews');
    expect(standardRatingLine(base({ aggregateRating: undefined }))).toBe('');
  });

  test('saving wording keeps the other labels', () => {
    const d = base({ labels: { mapHeading: 'Visit us' } });
    const r = setRatingLine(d, 'Loved by our clients').data;
    expect(r.labels).toEqual({ mapHeading: 'Visit us', ratingLine: 'Loved by our clients' });
  });
});

describe('hiding a review', () => {
  test('rows are keyed by content hash and show their state', () => {
    const d = base();
    const rows = reviewRows(d);
    expect(rows.map((r) => r.key)).toEqual([reviewKey(d.reviews![0]), reviewKey(d.reviews![1])]);
    expect(rows.every((r) => !r.hidden)).toBe(true);
  });

  test('hide and unhide by key; the review itself is never edited or removed', () => {
    const d = base();
    const key = reviewKey(d.reviews![0]);
    const hid = setReviewHidden(d, key, true);
    expect(hid.hiddenReviews).toEqual([key]);
    expect(hid.reviews).toBe(d.reviews);
    expect(reviewRows(hid)[0].hidden).toBe(true);
    expect(setReviewHidden(hid, key, true)).toBe(hid);
    const back = setReviewHidden(hid, key, false);
    expect(back.hiddenReviews).toBeUndefined();
  });

  test('a hidden review is gone from the page and survives a re-import that reorders reviews', () => {
    const d = base();
    const hid = setReviewHidden(d, reviewKey(d.reviews![0]), true);
    const reordered = { ...hid, reviews: [...hid.reviews!].reverse() };
    const html = buildPreviewHtml(reordered, false);
    expect(html).not.toContain('Great cut');
    expect(html).toContain('Fine work');
    expect(reviewRows(reordered).map((r) => r.hidden)).toEqual([false, true]);
  });
});
