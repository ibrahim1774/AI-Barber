import Storage from 'expo-sqlite/kv-store';
import type { WebsiteData } from '@/web/types';
import { buildSiteFromScrape } from '@/web/lib/buildSiteFromScrape';
import { extractFirstUrl, isSupportedBookingHost } from '@/web/lib/supportedBookingHost';
import { generateContent } from '@/web/services/geminiService';
import { DEFAULT_POLICY, DEFAULT_PULLQUOTE } from '@/web/lib/render/prime';
import { api } from '@/lib/api';
import type { SiteRecord } from '@/lib/siteStore';

/**
 * Port of App.tsx handleHomeDesignSwitch: the same content re-skinned, only
 * `template` changes. Going to prime also seeds policy / pullQuote with the
 * defaults the prime renderer falls back to (siteData.policy || DEFAULT_POLICY),
 * so the page looks the same as on the web and both become editable (markData
 * only marks values that exist). A site's own policy / pull quote is kept.
 */
export function switchDesign(d: WebsiteData, t: 'luxe' | 'prime'): WebsiteData {
  if (t !== 'prime') return { ...d, template: t };
  return {
    ...d,
    template: t,
    policy: d.policy ?? { ...DEFAULT_POLICY },
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
    return await generateContent({
      shopName: d.shopName,
      area,
      phone,
      template: d.template,
      colorTheme: d.colorTheme,
      bookingUrl: d.bookingUrl,
    });
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
  } catch {
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

// ---------------------------------------------------------------------------
// Once-per-draft overlays: HomePrompts, then LaunchGuide
// ---------------------------------------------------------------------------

export type Overlay = 'prompts' | 'guide';

const flagKey = (kind: Overlay, draftId: string) => `${kind}.v1.${draftId}`;

async function seen(kind: Overlay, draftId: string): Promise<boolean> {
  try {
    return (await Storage.getItem(flagKey(kind, draftId))) === '1';
  } catch {
    return false;
  }
}

export async function markSeen(kind: Overlay, draftId: string): Promise<void> {
  await Storage.setItem(flagKey(kind, draftId), '1');
}

/**
 * A new generation shows the prompts and guide again. startDraft keeps the
 * draftId across re-imports (one site per install), so it resets the flags.
 */
export async function clearOverlayFlags(draftId: string): Promise<void> {
  await Promise.all([Storage.removeItem(flagKey('prompts', draftId)), Storage.removeItem(flagKey('guide', draftId))]);
}

/**
 * Which overlay the editor should show now, if any. Neither shows over a
 * published site (as on the web). The booking-link / area-phone prompts are
 * the web's name-only funnel: they regenerate the site, so an imported site
 * (booking link or Google listing) goes straight to the guide.
 */
export async function nextOverlay(site: SiteRecord): Promise<Overlay | null> {
  if (site.slug != null) return null;
  if (!site.inputs.importedFrom && !(await seen('prompts', site.draftId))) return 'prompts';
  if (!(await seen('guide', site.draftId))) return 'guide';
  return null;
}
