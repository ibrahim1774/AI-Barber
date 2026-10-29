import type { ShopInputs, WebsiteData } from '@/web/types';
import { buildSiteFromScrape } from '@/web/lib/buildSiteFromScrape';
import { extractFirstUrl, isSupportedBookingHost } from '@/web/lib/supportedBookingHost';
import { generateContent } from '@/web/services/geminiService';
import { BRAND_SWATCHES, DEFAULT_SWATCH } from '@/web/lib/brandSwatches';
import { seedGallery } from '@/lib/scratchDefaults';
import type { ListingMatch, ScrapePayload } from '@/lib/api';

// Same rule as the web's themeForInputs(): only a known swatch is carried over.
function resolveTheme(brandColor: string): string | undefined {
  return BRAND_SWATCHES.find((c) => c.toLowerCase() === brandColor.toLowerCase());
}


export function checkBookingLink(text: string): { ok: true; url: string } | { ok: false; message: string } {
  const normalized = extractFirstUrl(text);
  if (!normalized) {
    return {
      ok: false,
      message: text.trim()
        ? "That doesn't look like a valid link. Paste the full booking link from Booksy, theCut, Fresha, Square, Vagaro, StyleSeat, Squire, GlossGenius or Acuity."
        : 'Paste your booking link to continue.',
    };
  }
  if (!isSupportedBookingHost(normalized)) {
    return {
      ok: false,
      message:
        "That link isn't Booksy / theCut / Fresha / Square / Vagaro / StyleSeat / Squire / GlossGenius / Acuity. Tap “I don't have a link” below and we'll find you on Google instead.",
    };
  }
  return { ok: true, url: normalized };
}

export function toShopSite(
  payload: ScrapePayload,
  fallbackUrl: string,
  source: 'booking' | 'gbp',
  brandColor: string = DEFAULT_SWATCH,
): { inputs: ShopInputs; site: WebsiteData } {
  // Honest sites: no default menu is ever injected. A booking page's own services are used as scraped;
  // a Google listing gets only the services the barber ticked (listingSite), else none.
  const data = payload;
  const theme = resolveTheme(brandColor);
  const built = buildSiteFromScrape(data, fallbackUrl, {
    manual: {
      shopName: (data.shopName || '').trim(),
      area: (data.area || data.address || '').trim(),
      phone: (data.phone || '').trim(),
      bookingUrl: (data.bookingUrl || '').trim(),
      ...(theme ? { colorTheme: theme } : {}),
    },
  });
  // Success marker: the lead fires only for a site generated from a booking
  // link or a Google listing.
  // Photos stay exactly what the page had (honest sites: no sample photos on an import; the editor offers Add photos).
  const site = built.scraped;
  return { inputs: { ...built.inputs, importedFrom: source }, site };
}

export interface ManualInput {
  shopName: string;
  area: string;
  address: string;
  phone: string;
  place?: string;
  colorTheme: string;
  services?: { title: string; price?: string }[];
}

/** Shapes the generated scratch site: the street address, the "Barbershop in <place>" label, and sample gallery photos (like an import, nothing invented about the shop). */
export function shapeScratchSite(site: WebsiteData, input: ManualInput): WebsiteData {
  const place = (input.place ?? '').trim();
  return seedGallery({
    ...site,
    contact: { ...site.contact, address: input.address },
    ...(place ? { labels: { ...site.labels, pgPlace: place } } : {}),
  });
}

/**
 * The typed path: shop name, address, mobile, an optional service area, a colour and the services the barber ticked.
 * generateContent uses exactly those and invents nothing; none ticked means no Services section.
 */
export async function manualSite(input: ManualInput): Promise<{ inputs: ShopInputs; site: WebsiteData }> {
  const inputs = {
    shopName: input.shopName.trim(), area: input.area, phone: input.phone, colorTheme: resolveTheme(input.colorTheme),
    ...(input.services?.length ? { services: input.services } : {}),
  } as ShopInputs;
  const site = shapeScratchSite(await generateContent(inputs), input);
  return { inputs, site };
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/**
 * What the Google import found, for "Is this you?": the server's `match` block, or (an older server
 * without it) the same facts read from the payload. Ratings only when they are real numbers.
 */
export function listingMatch(payload: ScrapePayload): ListingMatch {
  const m = (payload.match && typeof payload.match === 'object' ? payload.match : null) as Partial<ListingMatch> | null;
  if (m) {
    const rating = num(m.rating);
    return {
      name: str(m.name) || str(payload.shopName),
      address: str(m.address),
      photoUrl: str(m.photoUrl) || null,
      rating,
      ratingCount: rating != null ? num(m.ratingCount) : null,
      category: str(m.category) || null,
    };
  }
  const agg = payload.aggregateRating && typeof payload.aggregateRating === 'object' ? payload.aggregateRating : {};
  const rating = num(agg.rating);
  return {
    name: str(payload.shopName),
    address: str(payload.address) || str(payload.area),
    photoUrl: str(payload.photos?.[0]) || null,
    rating,
    ratingCount: rating != null ? num(agg.count) : null,
    category: str(payload._categories?.[0]) || null,
  };
}

/**
 * The confirmed Google listing as a site: the ticked services (optional prices) go in as the payload's
 * services before buildSiteFromScrape; `_platform` / `_categories` stay so the review label and the
 * business type come out right. `match` is display-only and is dropped.
 */
export function listingSite(
  payload: ScrapePayload,
  services: { title: string; price?: string }[] | undefined,
  brandColor: string = DEFAULT_SWATCH,
): { inputs: ShopInputs; site: WebsiteData } {
  const { match: _match, ...rest } = payload;
  return toShopSite({ ...rest, services: services ?? [] }, '', 'gbp', brandColor);
}
