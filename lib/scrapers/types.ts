// Shared types for all booking-platform scrapers.

export interface ScrapedShop {
  shopName: string;
  area: string;
  address: string;
  phone?: string;
  services: { title: string; price?: string }[];
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
