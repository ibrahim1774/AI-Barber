// Types for the Google Business Profile importer.
//
// Deliberately SEPARATE from lib/scrapers/types.ts: that module owns
// the booking-platform `ScrapedShop` shape (Booksy / Fresha / Square /
// …) and this one owns the Google-listing shape. Same filenames in
// two directories, different payloads — merging them would force one
// of the two funnels onto the wrong field names.
//
// ScrapeError is REUSED from lib/scrapers/types.ts on purpose so a
// single `instanceof ScrapeError` check in an API route covers both
// pipelines.
export { ScrapeError } from '../scrapers/types.js';

export interface GbpBusiness {
  source: 'gbp';
  companyName: string;
  // "Brooklyn, NY" — what the renderer shows as the service area.
  location: string;
  // Full street address — surfaced in the contact section.
  address: string;
  phone: string;
  description: string;
  // The business's own existing website, if Google knows one.
  website: string;
  bookingUrl: string;
  aggregateRating?: { rating: number; count: number };
  // Google's raw day rows — "10AM to 10PM". Converted to the
  // {open, close} pair AI-Barber's renderers want by
  // api/import-business.ts, not here.
  hours: { day: string; hours: string; closed?: boolean }[];
  // Google categories ("Barber shop", "Hair salon"). Kept for logging
  // and as a weak signal; AI-Barber is barber-only so nothing branches
  // on them.
  categories: string[];
  photos: string[];
  reviews: { author: string; rating: number; comment: string; date?: string }[];
}

export interface GbpScrapeOptions {
  apifyToken: string;
}
