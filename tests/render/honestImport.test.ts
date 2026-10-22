// Honest sites, import side: the Google "Is this you?" match block, review
// ratings that can't be read (never defaulted to 5), and the ≥4★ filter.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { scrapeViaPlaces, placesKey, scrapeGoogleBusiness, runApifyActor, resolveFinalUrl } = vi.hoisted(() => ({
  scrapeViaPlaces: vi.fn(),
  placesKey: vi.fn(() => ''),
  scrapeGoogleBusiness: vi.fn(),
  runApifyActor: vi.fn(),
  resolveFinalUrl: vi.fn(async (u: string) => u),
}));

vi.mock('../../lib/gbp/gbpPlaces.js', () => ({ scrapeViaPlaces, placesKey }));

import handler from '../../api/import-business';
import { parseReviewRating } from '../../lib/scrapers/util';

const ROOT = join(__dirname, '..', '..');
const mkRes = () => { const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() }; return res; };

const biz = (extra: any = {}) => ({
  source: 'gbp', companyName: 'Fresh Cuts', location: 'Austin, TX', address: '1 Main St, Austin, TX 78701',
  phone: '(512) 555-0100', description: '', website: '', bookingUrl: '',
  aggregateRating: { rating: 4.7, count: 212 }, hours: [], categories: ['Barber shop', 'Hair salon'],
  photos: ['https://lh3.googleusercontent.com/p/one.jpg', 'https://lh3.googleusercontent.com/p/two.jpg'],
  reviews: [{ author: 'Ann', rating: 5, comment: 'Great.' }],
  ...extra,
});

afterEach(() => { vi.clearAllMocks(); placesKey.mockReturnValue(''); delete process.env.APIFY_TOKEN; });

describe('/api/import-business match block', () => {
  it('Places path: describes what was found, rest of the response unchanged', async () => {
    placesKey.mockReturnValue('k');
    scrapeViaPlaces.mockResolvedValue(biz());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = mkRes();
    await handler({ method: 'POST', body: { url: 'Fresh Cuts, Austin' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.match).toEqual({
      name: 'Fresh Cuts',
      address: '1 Main St, Austin, TX 78701',
      photoUrl: 'https://lh3.googleusercontent.com/p/one.jpg',
      rating: 4.7,
      ratingCount: 212,
      category: 'Barber shop',
    });
    expect(body.shopName).toBe('Fresh Cuts');
    expect(body.services).toEqual([]);
    expect(body._platform).toBe('gbp');
    expect(body._via).toBe('places');
  });

  it('nulls for what Google did not give us', async () => {
    placesKey.mockReturnValue('k');
    scrapeViaPlaces.mockResolvedValue(biz({ photos: [], aggregateRating: undefined, categories: [], address: '' }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = mkRes();
    await handler({ method: 'POST', body: { url: 'Fresh Cuts, Austin' } } as any, res);
    const body = res.json.mock.calls[0][0];
    expect(body.match).toEqual({ name: 'Fresh Cuts', address: 'Austin, TX', photoUrl: null, rating: null, ratingCount: null, category: null });
  });
});

describe('/api/import-business match block — Apify path', () => {
  it('same match shape when Apify serves the import', async () => {
    vi.resetModules();
    vi.doMock('../../lib/gbp/gbpPlaces.js', () => ({ scrapeViaPlaces, placesKey }));
    vi.doMock('../../lib/gbp/gbp.js', () => ({ scrapeGoogleBusiness, isGbpUrl: () => false }));
    const { default: h } = await import('../../api/import-business');
    process.env.APIFY_TOKEN = 't';
    scrapeGoogleBusiness.mockResolvedValue(biz({ aggregateRating: { rating: 4.2, count: 9 } }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = mkRes();
    await h({ method: 'POST', body: { url: 'Fresh Cuts, Austin' } } as any, res);
    const body = res.json.mock.calls[0][0];
    expect(body._via).toBe('apify');
    expect(body.match).toEqual({
      name: 'Fresh Cuts', address: '1 Main St, Austin, TX 78701', photoUrl: 'https://lh3.googleusercontent.com/p/one.jpg',
      rating: 4.2, ratingCount: 9, category: 'Barber shop',
    });
    vi.doUnmock('../../lib/gbp/gbp.js');
  });
});

describe('review ratings are never invented', () => {
  it('parseReviewRating keeps real ratings and returns undefined for unreadable ones', () => {
    expect(parseReviewRating(5)).toBe(5);
    expect(parseReviewRating('4')).toBe(4);
    expect(parseReviewRating(4.6)).toBe(5);
    expect(parseReviewRating(7)).toBe(5);
    expect(parseReviewRating(1)).toBe(1);
    for (const bad of [undefined, null, '', 'abc', NaN, 0, -2]) expect(parseReviewRating(bad as any)).toBeUndefined();
  });

  it('gbp (Apify): unreadable rating is not 5 and is dropped by the ≥4★ filter', async () => {
    vi.resetModules();
    vi.doUnmock('../../lib/gbp/gbp.js');
    vi.doMock('../../lib/gbp/util.js', () => ({ runApifyActor, resolveFinalUrl }));
    const { scrapeGoogleBusiness: real } = await import('../../lib/gbp/gbp');
    runApifyActor.mockResolvedValue([{
      title: 'Fresh Cuts', city: 'Austin', state: 'TX',
      reviews: [
        { name: 'Ann', stars: 5, text: 'Great fade.' },
        { name: 'Bo', stars: null, text: 'No stars here.' },
        { name: 'Cy', stars: 2, text: 'Meh.' },
      ],
    }]);
    const out = await real('https://www.google.com/maps/place/Fresh+Cuts', { apifyToken: 't' });
    expect(out.reviews.map((r) => r.author)).toEqual(['Ann']);
    expect(out.reviews[0].rating).toBe(5);
    vi.doUnmock('../../lib/gbp/util.js');
  });

  it('gbp (Places): unreadable rating is not 5', async () => {
    vi.resetModules();
    vi.doUnmock('../../lib/gbp/gbpPlaces.js');
    const { scrapeViaPlaces: real } = await import('../../lib/gbp/gbpPlaces');
    const place = {
      id: 'abc', displayName: { text: 'Fresh Cuts' }, formattedAddress: '1 Main St, Austin, TX 78701, USA',
      reviews: [
        { authorAttribution: { displayName: 'Ann' }, rating: 5, text: { text: 'Great fade.' } },
        { authorAttribution: { displayName: 'Bo' }, text: { text: 'No stars here.' } },
      ],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ places: [place] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await real('Fresh Cuts, Austin', 'k');
    vi.unstubAllGlobals();
    expect(out).not.toBeNull();
    expect(out!.reviews.map((r) => r.author)).toEqual(['Ann']);
  });

  it('booking-page scrapers never default a missing rating to 5', () => {
    for (const f of ['lib/scrapers/booksy.ts', 'lib/scrapers/fresha.ts', 'lib/scrapers/setmore.ts', 'lib/scrapers/util.ts', 'lib/gbp/gbp.ts', 'lib/gbp/gbpPlaces.ts']) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const ratingLines = src.split('\n').filter((l) => /rating/i.test(l));
      for (const l of ratingLines) expect(l, f).not.toMatch(/\|\|\s*5\b|:\s*5,\s*$/);
    }
  });

  it('setmore: no aggregate rating when the average is unreadable', () => {
    const src = readFileSync(join(ROOT, 'lib/scrapers/setmore.ts'), 'utf8');
    expect(src).not.toContain('Number(meta.averageRating) || 0');
  });
});
