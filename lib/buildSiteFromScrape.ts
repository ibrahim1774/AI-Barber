// Shared builder: takes the `/api/import-scrape` response and turns
// it into the WebsiteData payload the renderers consume. Used by:
//   - /booksy → BooksyGeneratorForm (pure scrape, no manual fields)
//   - everywhere else → NewLeadQuizForm when the visitor pastes a
//     supported booking link. Manual fields override scraped
//     identity (shop name, area, phone) so the user's typed input
//     wins; scrape fills the visual + content gaps (photos,
//     services, hours, reviews, bio, staff).
import type { WebsiteData, ShopInputs } from '../types';

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
  template?: 'luxe' | 'euphoria';
}

export interface BuiltSite {
  inputs: ShopInputs;
  scraped: WebsiteData;
}

export function buildSiteFromScrape(data: ScrapeResponse, fallbackUrl: string, opts: BuildOptions = {}): BuiltSite {
  const manual = opts.manual ?? {};
  const template = opts.template ?? manual.template ?? 'luxe';

  // Manual fields win over scraped identity. Empty manual = use scrape.
  const shopName = (manual.shopName || '').trim() || (data.shopName || '').trim() || 'Your Barbershop';
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
        `${shopName} is a neighborhood barbershop built around honest work and consistent craft.`,
        'Every visit starts with a real conversation and ends with a cut you can wear with confidence.',
      ];

  const inputs: ShopInputs = {
    shopName,
    area,
    phone,
    template,
    bookingUrl,
    colorTheme: manual.colorTheme,
  };

  const scraped: WebsiteData = {
    shopName,
    area,
    phone,
    template,
    bookingUrl,
    colorTheme: manual.colorTheme,
    hero: {
      heading: shopName,
      tagline: 'Premium grooming services tailored to your style.',
      imageUrl: data.photos?.[0] || '',
    },
    about: {
      heading: 'About the Shop',
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
