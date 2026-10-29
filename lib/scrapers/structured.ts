// Generic "what a public page says about itself" reader, shared by the adapters whose pages publish schema.org
// JSON-LD / OpenGraph / tel: links but have no private API (Squire, and GlossGenius as a fallback). Reads only what is
// on the page; anything absent stays empty so the app's defaults apply. Never invents a value.
import { normalizeDuration, normalizePrice, priceFromBounds, currencySymbol } from '../scrapeNormalize.js';
import { decodeEntities, findBusinessLd, formatUsPhone, ldToScrapedShop, metaContent, parseJsonLd } from './util.js';
import type { ScrapedShop } from './types.js';

const clean = (s: unknown): string => decodeEntities(String(s ?? '')).replace(/\s+/g, ' ').trim();

/** Minutes from a schema.org QuantitativeValue / ISO duration / number: {value: 90, unitCode: 'MIN'} -> 90. */
export function minutesFromLd(d: any): number | undefined {
  if (d == null) return undefined;
  if (typeof d === 'number') return d > 0 ? d : undefined;
  if (typeof d === 'string') {
    const iso = d.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
    if (iso && (iso[1] || iso[2])) return Number(iso[1] || 0) * 60 + Number(iso[2] || 0);
    const n = Number(d);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  const v = Number(d.value);
  if (!Number.isFinite(v) || v <= 0) return undefined;
  const unit = String(d.unitCode || '').toUpperCase();
  return unit === 'HUR' || unit === 'H' ? v * 60 : v;
}

/** schema.org Service nodes (a JSON-LD ItemList of Services, or nested offers) -> services with price + duration. */
export function servicesFromLd(blocks: any[]): NonNullable<ScrapedShop['services']> {
  const out: NonNullable<ScrapedShop['services']> = [];
  const visit = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    const type = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
    if (type.includes('ItemList') && Array.isArray(n.itemListElement)) {
      n.itemListElement.forEach((e: any) => visit(e?.item ?? e));
      return;
    }
    if (type.includes('Service') || type.includes('Offer')) {
      const name = clean(n.name ?? n.itemOffered?.name);
      if (!name) return;
      const offer = Array.isArray(n.offers) ? n.offers[0] : n.offers ?? (type.includes('Offer') ? n : undefined);
      const sym = currencySymbol(offer?.priceCurrency);
      const price = offer?.price != null && offer.price !== ''
        ? normalizePrice(offer.price, sym)
        : priceFromBounds(offer?.lowPrice, offer?.highPrice, sym);
      const mins = minutesFromLd(offer?.eligibleDuration ?? n.eligibleDuration ?? n.estimatedDuration ?? n.duration);
      out.push({
        title: name.slice(0, 80),
        price: price || undefined,
        duration: mins ? normalizeDuration(mins) : undefined,
        description: clean(n.description ?? n.itemOffered?.description).slice(0, 240) || undefined,
        category: clean(n.serviceType && n.serviceType !== 'None' ? n.serviceType : '') || undefined,
      });
    }
  };
  blocks.forEach(visit);
  return out;
}

// "Mo-Fr 09:00-17:00", "Sa 10:00-14:00" (schema.org openingHours strings) -> Mon-Sun rows.
const DAY_CODES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export function hoursFromOpeningHoursStrings(list: unknown): ScrapedShop['hours'] {
  const arr = Array.isArray(list) ? list : typeof list === 'string' ? [list] : [];
  const byDay: Record<number, { open: string; close: string }> = {};
  for (const line of arr) {
    const m = String(line).trim().match(/^([A-Za-z,\- ]+?)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
    if (!m) continue;
    for (const part of m[1].split(',')) {
      const [a, b] = part.trim().split('-').map((x) => DAY_CODES.indexOf(x.trim().slice(0, 2)));
      if (a < 0) continue;
      const end = b == null || Number.isNaN(b) ? a : b;
      if (end < 0) continue;
      for (let d = a; d <= end; d++) byDay[d] = { open: m[2], close: m[3] };
    }
  }
  if (!Object.keys(byDay).length) return [];
  return DAY_NAMES.map((day, i) => (byDay[i] ? { day, ...byDay[i] } : { day, open: '', close: '', closed: true }));
}

function stripNameSuffix(title: string): string {
  return clean(title)
    .replace(/\s*[|–—]\s*(?:SQUIRE|GlossGenius|Book.*|Barber.*)$/i, '')
    .replace(/\s+on\s+SQUIRE$/i, '')
    .replace(/\s+-\s+(?:Book|Online|Schedule).*$/i, '')
    .trim();
}

/**
 * Read a business out of a page's HTML: JSON-LD LocalBusiness first (name, address, phone, hours, rating, description,
 * photos, services, staff), then OpenGraph (name, description, image), then a tel: link and an <address> block.
 * Returns null when not even a name could be found.
 */
export function shopFromStructuredHtml(html: string): ScrapedShop | null {
  const ld = findBusinessLd(html);
  const base: Partial<ScrapedShop> = ld ? ldToScrapedShop(ld) : { services: [], photos: [], reviews: [] };

  const shopName = clean(base.shopName) || stripNameSuffix(metaContent(html, 'og:title')) || '';
  if (!shopName) return null;

  const blocks = parseJsonLd(html);
  const services = [...servicesFromLd(blocks), ...(base.services || [])];

  const photos: string[] = [...(base.photos || [])];
  const ldPhotos = ld?.photo ? (Array.isArray(ld.photo) ? ld.photo : [ld.photo]) : [];
  for (const p of ldPhotos) photos.push(typeof p === 'string' ? p : p?.url || p?.contentUrl || '');
  const og = metaContent(html, 'og:image');
  if (og) photos.push(og);

  let phone = base.phone ? formatUsPhone(base.phone) : '';
  if (!phone) {
    const tel = html.match(/href=["']tel:([^"']+)["']/i);
    if (tel) phone = formatUsPhone(decodeURIComponent(tel[1]));
  }

  let address = clean(base.address);
  if (!address) {
    const a = html.match(/<address[^>]*>([\s\S]*?)<\/address>/i);
    if (a) address = clean(a[1].replace(/<[^>]*>/g, ' ')).slice(0, 200);
  }

  let hours = (base as any).hours as ScrapedShop['hours'];
  if (!hours || !hours.length) hours = hoursFromOpeningHoursStrings(ld?.openingHours);

  const employees = ld?.employee ? (Array.isArray(ld.employee) ? ld.employee : [ld.employee]) : [];
  const staff = employees
    .map((e: any) => ({ name: clean(e?.name), role: clean(e?.jobTitle) || undefined, photo: typeof e?.image === 'string' ? e.image : e?.image?.url }))
    .filter((s: { name: string }) => s.name);

  return {
    shopName,
    area: clean(base.area),
    address,
    phone,
    description: clean((base as any).description) || clean(metaContent(html, 'og:description')),
    hours: hours || [],
    aggregateRating: (base as any).aggregateRating,
    staff,
    services,
    photos,
    reviews: base.reviews || [],
  };
}
