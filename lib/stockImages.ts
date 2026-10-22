// Stock photos and the services checklist, shared by the web app and the
// iOS app (vendored byte-for-byte by aibarber-ios scripts/sync-web.sh).
// Imports nothing on purpose.
//
// Every default image services/geminiService.ts seeds a typed site with is
// listed here, so templates and editors can tell a sample photo from the
// barber's own: Prime only says "no stock photos" when none is stock, and
// the editors nudge the barber to swap samples for their own photos.

export const LUXE_STOCK = {
  hero: 'https://cop5lgctumpj5e0w.public.blob.vercel-storage.com/barber/nate-johnston-tgPrIYnW3g4-unsplash.jpg',
  about: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1200&q=70',
  gallerySeed: 'https://images.unsplash.com/photo-1605497788044-5a32c7078486?auto=format&fit=crop&w=900&q=65',
} as const;

export const EUPHORIA_STOCK = {
  hero: 'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&w=1600&q=70',
  about: 'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=1200&q=70',
  gallerySeed: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=900&q=65',
} as const;

// "The Craft" atmospheric shots (craftImages). The section no longer
// renders, but the seeds still ride on typed sites.
export const CRAFT_STOCK: readonly string[] = [
  'https://cop5lgctumpj5e0w.public.blob.vercel-storage.com/barber/gulom-nazarov-DrG4V5skbMY-unsplash.jpg',
  'https://cop5lgctumpj5e0w.public.blob.vercel-storage.com/barber/jason-leung-2seUdPQNy_I-unsplash.jpg',
  'https://cop5lgctumpj5e0w.public.blob.vercel-storage.com/barber/agustin-fernandez-Znyjl9pbaUs-unsplash.jpg',
  'https://cop5lgctumpj5e0w.public.blob.vercel-storage.com/barber/salah-regouane-MRCdF3qUbp0-unsplash.jpg',
];

// Full sample gallery the /custom-design-29 and /custom-15 pages show
// (components/GeneratePage.tsx), so their sites never look empty.
export const DEMO_GALLERY_STOCK: readonly string[] = [
  'https://images.unsplash.com/photo-1605497788044-5a32c7078486?auto=format&fit=crop&w=900&q=65',
  'https://images.unsplash.com/photo-1585747860715-2ba37e788b70?auto=format&fit=crop&w=900&q=65',
  'https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&w=900&q=65',
  'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=900&q=65',
  'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&w=900&q=65',
  'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=900&q=65',
  'https://images.unsplash.com/photo-1512690459411-b9245aed614b?auto=format&fit=crop&w=900&q=65',
  'https://images.unsplash.com/photo-1517832606299-7ae9b720a186?auto=format&fit=crop&w=900&q=65',
];

export const STOCK_IMAGE_URLS: readonly string[] = Array.from(new Set([
  LUXE_STOCK.hero, LUXE_STOCK.about, LUXE_STOCK.gallerySeed,
  EUPHORIA_STOCK.hero, EUPHORIA_STOCK.about, EUPHORIA_STOCK.gallerySeed,
  ...CRAFT_STOCK,
  ...DEMO_GALLERY_STOCK,
]));

// Compare the full URL without its query string (Unsplash sizes the same
// photo with different params). Never by host: barbers' own uploads can
// live on the same blob host as the samples.
const stripQuery = (u: string): string => u.split('#')[0].split('?')[0].trim();
const STOCK_BASES = new Set(STOCK_IMAGE_URLS.map(stripQuery));

export function isStockImage(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  return STOCK_BASES.has(stripQuery(url));
}

// The services checklist the barber ticks (optional price each) on the
// typed and Google paths. Titles only; nothing is described for them.
export const SERVICE_CHOICES: readonly string[] = [
  'Haircut',
  'Skin fade',
  'Taper',
  'Beard trim',
  'Line up',
  'Hot towel shave',
  'Kids cut',
  'Haircut & beard',
  'Hair design',
  'Color',
];

// Checklist state (title → ticked + optional price) → the `services`
// input generateContent / buildSiteFromScrape take. Keeps SERVICE_CHOICES
// order; unticked rows dropped; an empty price is left off.
export type ServicePicks = Record<string, { on: boolean; price?: string }>;

export function checklistToServices(picks: ServicePicks): { title: string; price?: string }[] {
  return SERVICE_CHOICES
    .filter((t) => picks[t]?.on)
    .map((t) => {
      const price = (picks[t]?.price || '').trim();
      return price ? { title: t, price } : { title: t };
    });
}
