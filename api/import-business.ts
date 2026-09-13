import type { VercelRequest, VercelResponse } from '@vercel/node';
import { scrapeGoogleBusiness, isGbpUrl } from '../lib/gbp/gbp.js';
import { ScrapeError } from '../lib/scrapers/types.js';

// Google Business Profile import for the homepage importer.
//
// Scope note: PrimeHub's /api/import-business is a multi-platform
// dispatcher (Google + Instagram + Facebook + every booking site).
// AI-Barber already has /api/import-scrape for booking links
// (Booksy / theCut / Fresha / Square / StyleSeat / Vagaro / Goldie /
// Setmore), and the importer's "Yes, I have a booking link" branch
// calls THAT proven route. So this endpoint owns Google only — one
// pipeline per route, no duplicated adapter set.
//
// Response shape is deliberately AI-Barber's `/api/import-scrape`
// shape (shopName / area / phone / photos / services / reviews /
// hours{open,close} …) rather than PrimeHub's ScrapedBusiness, so the
// client can hand it straight to lib/buildSiteFromScrape.ts with no
// second mapping layer.
//
// Error contract (matches import-scrape):
//   400 — missing or empty URL
//   422 — ScrapeError (message is user-friendly, surface as-is)
//   500 — unexpected error (logged server-side, generic message out)

export const config = {
  maxDuration: 120, // Apify cold starts can push past 30s
};

// Google gives a single day string ("10AM to 10PM"); AI-Barber's
// WebsiteData.hours wants {open, close}. Anything that doesn't split
// into two times is dropped rather than rendered half-filled — the
// renderers print `open – close` unconditionally for a non-closed row.
function splitHours(
  rows: { day: string; hours: string; closed?: boolean }[],
): { day: string; open: string; close: string; closed?: boolean }[] {
  const out: { day: string; open: string; close: string; closed?: boolean }[] = [];
  for (const r of rows) {
    const day = String(r.day || '').trim();
    if (!day) continue;
    const raw = String(r.hours || '').trim();
    if (!raw || r.closed || /closed/i.test(raw)) {
      out.push({ day, open: '', close: '', closed: true });
      continue;
    }
    if (/24\s*hours/i.test(raw)) {
      out.push({ day, open: '12:00 AM', close: '11:59 PM' });
      continue;
    }
    // "10AM to 10PM" / "10 AM – 10 PM" / "9:00-19:00"
    const m = raw.match(/^(.+?)\s*(?:–|—|-|\bto\b)\s*(.+)$/i);
    if (!m) continue; // unparseable — better a missing row than a broken one
    const open = m[1].trim();
    const close = m[2].trim();
    if (!open || !close) continue;
    out.push({ day, open, close });
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET = warm-up ping from the importer page (fired on first keystroke)
  // so the real request never pays a serverless cold start.
  if (req.method === 'GET') return res.status(200).json({ ok: true, warm: true });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const url = ((req.body || {}) as { url?: string }).url?.trim() || '';
  if (!url) return res.status(400).json({ error: 'Missing URL' });

  const apifyToken = process.env.APIFY_TOKEN || '';
  if (!apifyToken) {
    return res.status(422).json({
      error: "We can't reach Google right now. Use the manual form below and we'll build your site from what you type.",
    });
  }

  // A typed name ("Fade Factory, Houston") is not a URL — route it
  // through the same Google search query the adapter understands.
  const target = isGbpUrl(url)
    ? url
    : `https://www.google.com/search?q=${encodeURIComponent(url)}`;

  console.log('[ImportBiz] scrape requested', target);
  const startedAt = Date.now();

  try {
    const data = await scrapeGoogleBusiness(target, { apifyToken });
    const elapsed = Date.now() - startedAt;
    console.log(
      `[ImportBiz] gbp → ${data.companyName} in ${elapsed}ms; photos=${data.photos.length}; reviews=${data.reviews.length}`,
    );
    return res.status(200).json({
      // lib/buildSiteFromScrape.ts ScrapeResponse shape
      shopName: data.companyName,
      area: data.location,
      address: data.address,
      phone: data.phone,
      description: data.description,
      // Google listings never carry a booking link we can trust as the
      // shop's own booking page; leave it empty so the importer's
      // booking-link branch stays the only source of one.
      bookingUrl: data.bookingUrl,
      photos: data.photos,
      // Google exposes no service menu — the client seeds a barber
      // default so the services section isn't an empty shell.
      services: [],
      reviews: data.reviews,
      hours: splitHours(data.hours),
      staff: [],
      aggregateRating: data.aggregateRating,
      // Metadata (underscore-prefixed, ignored by buildSiteFromScrape)
      _platform: 'gbp',
      _website: data.website,
      _categories: data.categories,
      _elapsedMs: elapsed,
    });
  } catch (e: any) {
    if (e instanceof ScrapeError) {
      return res.status(422).json({ error: e.message });
    }
    console.error('[ImportBiz] unexpected error:', e?.message || e);
    return res.status(500).json({
      error: 'Import failed unexpectedly. Try again, or use the manual form below.',
    });
  }
}
