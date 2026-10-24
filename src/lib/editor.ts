import { gallerySlots } from '@/lib/sections/gallery';
import { formatPhone } from '@/lib/phone';
import type { WebsiteData } from '@/web/types';
import { buildSiteFromScrape } from '@/web/lib/buildSiteFromScrape';
import { extractFirstUrl, isSupportedBookingHost } from '@/web/lib/supportedBookingHost';
import { generateContent } from '@/web/services/geminiService';
import { DEFAULT_PULLQUOTE } from '@/web/lib/render/prime';
import { isStockImage } from '@/web/lib/stockImages';
import { api } from '@/lib/api';
import { IMAGE_PATHS, asPublished, copyKeyOfPath, getPath, labelKeyOfPath, setPath } from '@/lib/editable';
import { copyBlockInfo } from '@/web/lib/render/guides';
import { saveCopyText } from '@/lib/copyEdit';
import { LABELS, clampLabel, defaultLabel, isFigureFreeLabel, type LabelDef } from '@/web/lib/render/labels';
import { nicheOf } from '@/web/lib/render/honest';

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
 * What the barber chose about pages, kept when a rebuild replaces the rest of the data: which pages are on, the
 * guide pages (extraPages, with their seed and photos), the edited library texts and the section settings.
 */
export function keptPageChoices(d: WebsiteData): Partial<WebsiteData> {
  return {
    ...(d.pages ? { pages: d.pages } : {}),
    ...(d.extraPages ? { extraPages: d.extraPages } : {}),
    ...(d.copy ? { copy: d.copy } : {}),
    ...(d.pageSections ? { pageSections: d.pageSections } : {}),
  };
}

/**
 * Port of App.tsx handleHomePromptFinish: re-run the template generation so
 * the copy bakes in the real service area. Falls back to patching area,
 * phone and contact.address if generation throws.
 */
export async function applyHomePrompts(d: WebsiteData, area: string, rawPhone: string): Promise<WebsiteData> {
  const phone = formatPhone(rawPhone);
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
    // The pages choice is the barber's, not generated: a rebuilt site keeps it.
    return { ...regenerated, services: d.services ?? [], ...keptPageChoices(d) };
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
    return { ...built.scraped, colorTheme: d.colorTheme, ...keptPageChoices(d) };
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

/**
 * Save text typed for `path`. A label is trimmed and cut to its maximum, and stored only when it differs
 * from the design's own wording (the same wording, or nothing, removes the key so the default follows the
 * business type). A `labels.` path outside the registry changes nothing. Everything else is set as typed.
 */
export function savePathValue(d: WebsiteData, path: string, value: string): WebsiteData {
  if (path.startsWith('copy.')) {
    const ck = copyKeyOfPath(path);
    return ck ? saveCopyText(d, ck, value) : d;
  }
  if (path.startsWith('labels.')) {
    const key = labelKeyOfPath(path);
    if (!key) return d;
    const def = (LABELS as Record<string, LabelDef>)[key];
    const text = clampLabel(value, def.max);
    // A label printed beside a real figure (the prime rating and review-count boxes) may not hold one.
    if (def.plain && !isFigureFreeLabel(text)) return d;
    const { [key]: _gone, ...rest } = (d.labels ?? {}) as Record<string, string>;
    void _gone;
    if (text === '' || text === defaultLabel(key, nicheOf(d), d)) return { ...d, labels: rest };
    return setPath(d, path, text);
  }
  return setPath(d, path, value);
}

const SERVICE_FIELD: Record<string, string> = { title: 'name', subtitle: 'subtitle', description: 'description' };

/** "services.2.title" → "Service 3 name". */
export function fieldLabel(path: string): string {
  if (FIELD_LABELS[path]) return FIELD_LABELS[path];
  const copyKey = copyKeyOfPath(path);
  if (copyKey) return copyLabel(copyKey);
  const labelKey = labelKeyOfPath(path);
  if (labelKey) return (LABELS as Record<string, LabelDef>)[labelKey].title;
  let m = /^about\.description\.(\d+)$/.exec(path);
  if (m) return `About paragraph ${Number(m[1]) + 1}`;
  m = /^services\.(\d+)\.(title|subtitle|description)$/.exec(path);
  if (m) return `Service ${Number(m[1]) + 1} ${SERVICE_FIELD[m[2]]}`;
  return path;
}

const humanize = (id: string): string => {
  const t = id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const COPY_SCOPE: Record<string, string> = { faq: 'FAQ', 'first-visit': 'First visit', 'hair-care': 'Hair care', 'beard-care': 'Beard care' };

/** "guide.fade.what" -> "Service guide: Fade, what"; "faq.book" -> the question itself. */
export function copyLabel(key: string): string {
  const info = copyBlockInfo(key);
  if (info?.q) return info.q;
  const parts = key.split('.');
  if (parts[0] === 'guide') return `Service guide: ${humanize(parts[1])}, ${humanize(parts.slice(2).join(' ')).toLowerCase()}`;
  return `${COPY_SCOPE[parts[0]] ?? humanize(parts[0])}: ${humanize(parts.slice(1).join(' ')).toLowerCase()}`;
}

/** "gallery.2" → "Gallery 3", "staff.0.photo" → "Staff 1 photo". */
export function imageLabel(path: string, d?: WebsiteData): string {
  if (path === 'hero.imageUrl') return 'Hero photo';
  if (path === 'about.imageUrl') return 'About photo';
  let m = /^gallery\.(\d+)$/.exec(path);
  if (m) {
    // Counted the way the Gallery sheet counts: first slot this design shows is "Gallery 1".
    const pos = d ? gallerySlots(d).indexOf(Number(m[1])) : -1;
    return `Gallery ${pos >= 0 ? pos + 1 : Number(m[1]) + 1}`;
  }
  m = /^craftImages\.(\d+)$/.exec(path);
  if (m) return `Craft photo ${Number(m[1]) + 1}`;
  m = /^staff\.(\d+)\.photo$/.exec(path);
  if (m) return `Staff ${Number(m[1]) + 1} photo`;
  m = /^services\.(\d+)\.imageUrl$/.exec(path);
  if (m) return `Service ${Number(m[1]) + 1} page photo`;
  m = /^extraPages\.images\.(first-visit|hair-care|beard-care)$/.exec(path);
  if (m) return `${COPY_SCOPE[m[1]]} page photo`;
  return path;
}

/**
 * The slots the Photos sheet offers: every IMAGE_PATHS slot (sheet-only ones
 * included) except craftImages, which no template renders — a photo put
 * there would never appear. The data field itself is left alone.
 */
export function photoSlots(d: WebsiteData): string[] {
  // Gallery: exactly the slots the Gallery sheet shows for this design (Design 1 keeps gallery.0/1 for the
  // hero and about backdrops), so the two lists always agree.
  const gallery = gallerySlots(d).map((i) => `gallery.${i}`);
  const out: string[] = [];
  for (const p of IMAGE_PATHS(d)) {
    if (p.startsWith('craftImages.')) continue;
    if (p.startsWith('gallery.')) continue;
    out.push(p);
    if (p === 'about.imageUrl') out.push(...gallery);
  }
  return out;
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
