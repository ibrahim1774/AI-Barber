import type { WebsiteData } from '@/web/types';
import { buildSiteFromScrape } from '@/web/lib/buildSiteFromScrape';
import { extractFirstUrl, isSupportedBookingHost } from '@/web/lib/supportedBookingHost';
import { generateContent } from '@/web/services/geminiService';
import { DEFAULT_PULLQUOTE } from '@/web/lib/render/prime';
import { isStockImage } from '@/web/lib/stockImages';
import { api } from '@/lib/api';
import { IMAGE_PATHS, asPublished, getPath } from '@/lib/editable';

/**
 * Port of App.tsx handleHomeDesignSwitch: the same content re-skinned, only
 * `template` changes. Going to prime seeds the generic pull quote the prime
 * renderer falls back to, so it is editable (markData only marks values that
 * exist). There is no default policy any more (honest sites: barber-written
 * only), so none is seeded. A site's own policy / pull quote is kept.
 */
export function switchDesign(d: WebsiteData, t: 'luxe' | 'prime'): WebsiteData {
  if (t !== 'prime') return { ...d, template: t };
  return {
    ...d,
    template: t,
    pullQuote: d.pullQuote ?? { ...DEFAULT_PULLQUOTE },
  };
}

/**
 * Port of App.tsx handleHomePromptFinish: re-run the template generation so
 * the copy bakes in the real service area. Falls back to patching area,
 * phone and contact.address if generation throws.
 */
export async function applyHomePrompts(d: WebsiteData, area: string, phone: string): Promise<WebsiteData> {
  try {
    // generateContent invents no services: the site's own (ticked or edited) ones are kept.
    const regenerated = await generateContent({
      shopName: d.shopName,
      area,
      phone,
      template: d.template,
      colorTheme: d.colorTheme,
      bookingUrl: d.bookingUrl,
    });
    return { ...regenerated, services: d.services ?? [] };
  } catch {
    return { ...d, area, phone, contact: { ...d.contact, address: area } };
  }
}

/**
 * Port of App.tsx handleHomePromptBookingLink: scrape the real listing and
 * rebuild the site, keeping the typed name and chosen theme. Null when the
 * link isn't a supported booking host or the scrape fails (the prompt then
 * falls back to the area / phone step).
 */
export async function applyBookingLink(d: WebsiteData, link: string): Promise<WebsiteData | null> {
  const normalizedUrl = extractFirstUrl(link) ?? undefined;
  if (!normalizedUrl || !isSupportedBookingHost(normalizedUrl)) return null;
  try {
    const scrapeData = await api.importScrape(normalizedUrl);
    const built = buildSiteFromScrape(scrapeData, normalizedUrl, {
      manual: { shopName: d.shopName, area: '', phone: '', bookingUrl: normalizedUrl, colorTheme: d.colorTheme },
      template: d.template === 'euphoria' ? 'euphoria' : 'luxe',
    });
    if (!built?.scraped?.shopName) return null;
    return { ...built.scraped, colorTheme: d.colorTheme };
  } catch (err) {
    console.warn('[home funnel] booking-link scrape failed:', err);
    return null;
  }
}

/** Same field the web's BrandSwatchGrid / EditorColorPicker writes. */
export function setColour(d: WebsiteData, swatch: string): WebsiteData {
  return { ...d, colorTheme: swatch };
}

// ---------------------------------------------------------------------------
// Labels for the "All fields" and "Photos" sheets
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  shopName: 'Shop name',
  'hero.heading': 'Hero heading',
  'hero.tagline': 'Hero tagline',
  'about.heading': 'About heading',
  phone: 'Phone number',
  area: 'Service area',
  'contact.address': 'Address',
  bookingUrl: 'Booking link',
  'policy.title': 'Policy title',
  'policy.body': 'Policy text',
  'pullQuote.text': 'Pull quote',
};

const SERVICE_FIELD: Record<string, string> = { title: 'name', subtitle: 'subtitle', description: 'description' };

/** "services.2.title" → "Service 3 name". */
export function fieldLabel(path: string): string {
  if (FIELD_LABELS[path]) return FIELD_LABELS[path];
  let m = /^about\.description\.(\d+)$/.exec(path);
  if (m) return `About paragraph ${Number(m[1]) + 1}`;
  m = /^services\.(\d+)\.(title|subtitle|description)$/.exec(path);
  if (m) return `Service ${Number(m[1]) + 1} ${SERVICE_FIELD[m[2]]}`;
  return path;
}

/** "gallery.2" → "Gallery 3", "staff.0.photo" → "Staff 1 photo". */
export function imageLabel(path: string): string {
  if (path === 'hero.imageUrl') return 'Hero photo';
  if (path === 'about.imageUrl') return 'About photo';
  let m = /^gallery\.(\d+)$/.exec(path);
  if (m) return `Gallery ${Number(m[1]) + 1}`;
  m = /^craftImages\.(\d+)$/.exec(path);
  if (m) return `Craft photo ${Number(m[1]) + 1}`;
  m = /^staff\.(\d+)\.photo$/.exec(path);
  if (m) return `Staff ${Number(m[1]) + 1} photo`;
  return path;
}

/**
 * The slots the Photos sheet offers: every IMAGE_PATHS slot (sheet-only ones
 * included) except craftImages, which no template renders — a photo put
 * there would never appear. The data field itself is left alone.
 */
export function photoSlots(d: WebsiteData): string[] {
  return IMAGE_PATHS(d).filter((p) => !p.startsWith('craftImages.'));
}

/** The photo slots still showing one of the generator's sample (stock) photos. */
export function stockPhotoPaths(d: WebsiteData): string[] {
  return photoSlots(d).filter((p) => isStockImage(getPath(d, p) as string | undefined));
}

export const STOCK_NUDGE = 'These are sample photos. Add your own so customers see your work.';

/**
 * The record as the editor shows and edits it: the same data the published page renders (old invented
 * copy removed, no price repeated in a subtitle; see asPublished). The same object when nothing changes.
 */
export function editorRecord<T extends { data: WebsiteData }>(r: T): T {
  const data = asPublished(r.data);
  return data === r.data ? r : { ...r, data };
}
