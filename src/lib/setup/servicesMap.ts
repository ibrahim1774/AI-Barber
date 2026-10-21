import type { ServiceItem, WebsiteData } from '@/web/types';
import type { Service } from '@/lib/shop';
import { durationLabel, parseDuration } from '@/lib/sections/services';

/** "$30" / "$25.50" / "From $25" / "30" to cents; null for "ask" or anything not a plain amount. */
export function parsePriceCents(price?: string): number | null {
  if (!price) return null;
  const m = /^\s*(?:from\s+|starting at\s+)?\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(?:\+)?\s*$/i.exec(price);
  if (!m) return null;
  const whole = Number(m[1].replace(/,/g, ''));
  const cents = m[2] === undefined ? 0 : Number(m[2].padEnd(2, '0'));
  return whole * 100 + cents;
}

/** 3000 -> "$30", 2550 -> "$25.50", 120000 -> "$1,200". */
export function centsToPrice(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const rest = cents % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${grouped}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
}

export type SetupService = {
  name: string;
  priceCents: number | null;
  durationMin: number;
  description?: string;
  photoUrl?: string;
};

// The server's limits (parseSetup in /api/shop/setup): anything over is a 400.
const MAX_SERVICES = 50;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;
const MIN_DURATION = 5;
const MAX_DURATION = 600;
const MAX_PHOTO_URL = 1000;

/** The site's services as the body of POST /api/shop/setup `services`. */
export function websiteToSetupServices(services: ServiceItem[]): SetupService[] {
  const out: SetupService[] = [];
  for (const s of services) {
    if (out.length >= MAX_SERVICES) break;
    const name = (s.title ?? '').trim().slice(0, MAX_NAME).trim();
    if (!name) continue;
    const item: SetupService = {
      name,
      priceCents: parsePriceCents(s.price),
      durationMin: Math.min(MAX_DURATION, Math.max(MIN_DURATION, parseDuration(s.duration) ?? 30)),
    };
    const description = (s.description ?? '').trim().slice(0, MAX_DESCRIPTION).trim();
    if (description) item.description = description;
    const photo = (s.imageUrl ?? '').trim();
    if (/^https:\/\//i.test(photo) && photo.length <= MAX_PHOTO_URL) item.photoUrl = photo;
    out.push(item);
  }
  return out;
}

/**
 * The services the website shows, from ab_services (the one source once a shop
 * exists): only show_on_site ones, in order, price "$30", duration "30 min".
 * `existing` (the site's current items) keeps each match's icon, subtitle and
 * category, matched by title.
 */
export function servicesToWebsite(services: Service[], existing: ServiceItem[] = []): ServiceItem[] {
  const byTitle = new Map(existing.map((e) => [e.title.trim().toLowerCase(), e]));
  return services
    .filter((s) => s.showOnSite)
    .slice()
    .sort((a, b) => a.sort - b.sort)
    .map((s) => {
      const prev = byTitle.get(s.name.trim().toLowerCase());
      const item: ServiceItem = {
        title: s.name,
        subtitle: prev?.subtitle ?? '',
        description: s.description ?? '',
        icon: prev?.icon ?? 'scissors',
        imageUrl: s.photoUrl ?? '',
        duration: durationLabel(s.durationMin),
      };
      if (prev?.category) item.category = prev.category;
      if (s.priceCents != null) item.price = centsToPrice(s.priceCents);
      return item;
    });
}

/** Applies the mirror to the site data. */
export function withMirroredServices(d: WebsiteData, services: Service[]): WebsiteData {
  return { ...d, services: servicesToWebsite(services, d.services) };
}
