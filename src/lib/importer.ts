import type { ShopInputs, WebsiteData } from '@/web/types';
import { buildSiteFromScrape } from '@/web/lib/buildSiteFromScrape';
import { extractFirstUrl, isSupportedBookingHost } from '@/web/lib/supportedBookingHost';
import { generateContent } from '@/web/services/geminiService';
import type { ScrapePayload } from '@/lib/api';

// A Google listing has no service menu — seed the barber default so the
// services section isn't an empty shell (copied from GbpImportPage.tsx).
const DEFAULT_BARBER_SERVICES = [
  { title: 'Classic Haircut', description: 'A clean, considered cut tailored to how you actually wear your hair.' },
  { title: 'Beard Trim & Styling', description: 'Defined lines, blended length, and a finish that holds between visits.' },
  { title: 'Hot Towel Shave', description: 'A traditional straight-razor shave with warm towels and a clean, close finish.' },
  { title: 'Skin Fade', description: 'Precise tapering from skin upward, blended for a clean, modern shape.' },
  { title: 'Hair & Scalp Treatment', description: 'A thorough cleanse and conditioning treatment to reset the scalp.' },
];

export function checkBookingLink(text: string): { ok: true; url: string } | { ok: false; message: string } {
  const normalized = extractFirstUrl(text);
  if (!normalized) return { ok: false, message: 'Paste your booking link to continue.' };
  if (!isSupportedBookingHost(normalized)) {
    return {
      ok: false,
      message:
        "That link isn't Booksy / theCut / Fresha / Square / Vagaro / StyleSeat. Tap “No booking link?” below and we'll find you on Google instead.",
    };
  }
  return { ok: true, url: normalized };
}

export function toShopSite(
  payload: ScrapePayload,
  fallbackUrl: string,
  source: 'booking' | 'gbp',
): { inputs: ShopInputs; site: WebsiteData } {
  const data: ScrapePayload = payload.services?.length
    ? payload
    : { ...payload, services: DEFAULT_BARBER_SERVICES.map((s) => ({ ...s })) };
  const built = buildSiteFromScrape(data, fallbackUrl, {
    manual: {
      shopName: (data.shopName || '').trim(),
      area: (data.area || data.address || '').trim(),
      phone: (data.phone || '').trim(),
      bookingUrl: (data.bookingUrl || '').trim(),
    },
  });
  // Success marker: the lead fires only for a site generated from a booking
  // link or a Google listing.
  return { inputs: { ...built.inputs, importedFrom: source }, site: built.scraped };
}

export async function manualSite(shopName: string): Promise<{ inputs: ShopInputs; site: WebsiteData }> {
  const inputs = { shopName: shopName.trim(), area: '', phone: '' } as ShopInputs;
  const site = await generateContent(inputs);
  return { inputs, site };
}
