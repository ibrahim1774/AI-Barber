// Shared builder: takes the `/api/import-scrape` response and turns
// it into the WebsiteData payload the renderers consume. Used by:
//   - /booksy → BooksyGeneratorForm (pure scrape, no manual fields)
//   - everywhere else → NewLeadQuizForm when the visitor pastes a
//     supported booking link. Manual fields override scraped
//     identity (shop name, area, phone) so the user's typed input
//     wins; scrape fills the visual + content gaps (photos,
//     services, hours, reviews, bio, staff).
import type { WebsiteData, ShopInputs } from '../types';
import { detectBooksyNiche } from './booksyNiche';

const SERVICE_ICONS = ['scissors', 'razor', 'mustache', 'face', 'sparkles'] as const;

interface ScrapeResponse {
  shopName?: string;
  area?: string;
  address?: string;
  phone?: string;
  description?: string;
  bookingUrl?: string;
  photos?: string[];
  services?: any[];
  reviews?: any[];
  hours?: any[];
  staff?: any[];
  aggregateRating?: any;
}

interface BuildOptions {
  // When `manual` is provided, those fields override the scraped
  // equivalents. The quiz funnel passes the typed shopName/area/phone
  // so the visitor's identity stays authoritative.
  manual?: Partial<ShopInputs>;
  // Template choice — defaults to 'luxe' (matches /booksy). Quiz
  // passes the user's picked template if any.
  template?: 'luxe' | 'euphoria' | 'prime';
}

export interface BuiltSite {
  inputs: ShopInputs;
  scraped: WebsiteData;
}

// Derive a plausible shop name from the booking URL the visitor pasted.
// Used as a fallback when the scrape returns no name (or fails) so the
// generated site never shows the seed placeholder ("Premium Cuts") or a
// generic "Your Barbershop" — it reflects the real link instead.
//   booksy.com/en-us/123456_kingdom-barber-shop_barber-shop_brooklyn → "Kingdom Barber Shop"
//   book.heygoldie.com/Royal-Original-Empire                         → "Royal Original Empire"
//   kingdomcuts.booksy.com                                           → "Kingdomcuts"
export function deriveShopNameFromUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const host = u.hostname.replace(/^www\./, '');
    const segs = u.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
    const titleCase = (s: string) =>
      s.replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim()
        .split(' ').filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

    // Booksy canonical path: /{lang}/{id}_{name}_{category}_{city}
    const booksySeg = segs.find((s) => /^\d+_/.test(s));
    if (booksySeg) {
      const parts = booksySeg.split('_');
      if (parts[1]) return titleCase(parts[1]);
    }

    // Otherwise the most descriptive path segment (skip routing words).
    const skip = new Set([
      'en-us', 'en', 'us', 'dl', 'show-business', 'b', 's', 'book', 'booking',
      'widget', 'barber', 'barber-shop', 'barbershop', 'pro', 'p', 'biz', 'business',
    ]);
    const cand = [...segs].reverse().find(
      (s) => /[a-z]/i.test(s) && !/^\d+$/.test(s) && !skip.has(s.toLowerCase()),
    );
    if (cand) {
      const name = titleCase(cand.replace(/^\d+[-_]?/, ''));
      if (name.length >= 2) return name;
    }

    // Vanity subdomain (kingdomcuts.booksy.com) — skip platform/common subs.
    const sub = host.split('.')[0];
    const common = new Set([
      'www', 'booksy', 'app', 'book', 'thecut', 'fresha', 'vagaro', 'squareup',
      'getsquire', 'square', 'styleseat', 'heygoldie', 'widget', 'my', 'm',
    ]);
    if (sub && !common.has(sub.toLowerCase()) && /[a-z]/i.test(sub)) return titleCase(sub);

    return '';
  } catch {
    return '';
  }
}

export function buildSiteFromScrape(data: ScrapeResponse, fallbackUrl: string, opts: BuildOptions = {}): BuiltSite {
  const manual = opts.manual ?? {};
  const template = opts.template ?? manual.template ?? 'luxe';

  // Manual fields win over scraped identity. Empty manual = use scrape, then
  // a name derived from the booking URL, and only then a generic default.
  // What kind of business is this? Booksy hosts hair, nails, lashes,
  // massage, tattoo, pet grooming and more — the copy below adapts so a
  // nail tech's site never calls itself a barbershop.
  const nicheProfile = detectBooksyNiche(
    fallbackUrl || data.bookingUrl || '',
    (manual.shopName || data.shopName || ''),
    (data.services || []).map((s: any) => `${s?.title || ''} ${s?.category || ''}`),
  );
  const shopName = (manual.shopName || '').trim()
    || (data.shopName || '').trim()
    || deriveShopNameFromUrl(fallbackUrl)
    || nicheProfile.fallbackName;
  const area = (manual.area || '').trim() || (data.area || '').trim() || '';
  const phone = (manual.phone || '').trim() || (data.phone || '').trim() || '';
  const bookingUrl = (manual.bookingUrl || data.bookingUrl || fallbackUrl || '').trim();

  // Bio → 2 paragraphs, or generic default if scrape returned nothing.
  const bio = (data.description || '').trim();
  const aboutParas: string[] = bio
    ? (bio
        .replace(/\s+/g, ' ')
        .match(/.{1,420}(\s|$)/g)
        ?.map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 2) || [bio])
    : [
        `${shopName} ${nicheProfile.aboutFallback[0]}`,
        nicheProfile.aboutFallback[1],
      ];

  const inputs: ShopInputs = {
    shopName,
    area,
    phone,
    template,
    bookingUrl,
    colorTheme: manual.colorTheme,
    // Rides into the Make.com lead row so "Barbershop" isn't reported
    // for a lash studio (see services/leadCaptureService.ts).
    industry: nicheProfile.industry,
  } as ShopInputs;

  const scraped: WebsiteData = {
    shopName,
    area,
    phone,
    template,
    bookingUrl,
    colorTheme: manual.colorTheme,
    hero: {
      heading: shopName,
      tagline: nicheProfile.heroTagline,
      imageUrl: data.photos?.[0] || '',
    },
    about: {
      heading: nicheProfile.aboutHeading,
      description: aboutParas,
      imageUrl: data.photos?.[1] || data.photos?.[0] || '',
    },
    services: (data.services || []).slice(0, 12).map((s: any, i: number) => {
      const subtitleParts = [s.duration, s.price].filter(Boolean);
      return {
        title: s.title,
        subtitle: subtitleParts.join(' · ') || s.category || '',
        description: s.description || (s.price ? `Starting at ${s.price}.` : 'Book ahead — same care every visit.'),
        icon: SERVICE_ICONS[i % SERVICE_ICONS.length],
        imageUrl: '',
        duration: s.duration || '',
        category: s.category || '',
        price: s.price || '',
      };
    }),
    gallery: [
      data.photos?.[0] || '',
      data.photos?.[1] || '',
      data.photos?.[2] || '',
      data.photos?.[3] || '',
      data.photos?.[4] || '',
      data.photos?.[5] || '',
      data.photos?.[6] || '',
      data.photos?.[7] || '',
    ],
    featureCards: [
      { title: 'Experience', sub: 'Professional' },
      { title: 'Service', sub: 'Trusted' },
      { title: 'Open Monday to Friday', sub: '9am - 7pm' },
    ],
    reviews: (data.reviews || []).slice(0, 12),
    bio,
    aggregateRating: data.aggregateRating,
    hours: data.hours || [],
    staff: (data.staff || []).slice(0, 12),
    contact: {
      address: data.address || area,
      email: '',
    },
  };

  return { inputs, scraped };
}
