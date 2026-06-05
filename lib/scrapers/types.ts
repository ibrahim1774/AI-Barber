// Shared types for all booking-platform scrapers.

export interface ScrapedShop {
  shopName: string;
  area: string;
  address: string;
  phone?: string;
  // Shop bio / description — pulled from JSON-LD `description` on Booksy
  // and a few platforms. Empty when the platform doesn't ship it.
  description?: string;
  // Mon-Sun hours, in the order Booksy/JSON-LD lists them. Empty array
  // when the platform doesn't expose hours.
  hours?: { day: string; open: string; close: string; closed?: boolean }[];
  // "4.9 from 1,247 reviews" — JSON-LD aggregateRating.
  aggregateRating?: { rating: number; count: number };
  // Optional staff list. Booksy has barber profiles in the page; other
  // platforms usually don't. Always optional.
  staff?: { name: string; role?: string; photo?: string }[];
  // Services with the richer fields Booksy exposes. `category` lets the
  // renderer group "Haircuts / Beards / Color" sections.
  services: {
    title: string;
    price?: string;
    duration?: string;
    description?: string;
    category?: string;
  }[];
  photos: string[];
  reviews: { author: string; rating: number; comment: string; date?: string }[];
}

export interface ScrapeOptions {
  apifyToken?: string;
  // Optional test event code for Apify Events Manager debug
  apifyTestEventCode?: string;
}

export interface PlatformAdapter {
  // Stable id used in logs + URLs (lower-case, no spaces).
  id: string;
  // Human-friendly name shown in the UI.
  displayName: string;
  // URL patterns. Any match → this adapter handles the URL.
  hostMatchers: RegExp[];
  // The actual scrape.
  scrape(url: string, opts: ScrapeOptions): Promise<ScrapedShop>;
}

// Thrown by an adapter when it can't extract data. Callers catch and
// surface the message to the user as a friendly 422.
export class ScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScrapeError';
  }
}
