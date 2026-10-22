import type { WebsiteData } from '@/web/types';
import type { Entitlements } from '@/lib/entitlements';

import { isAiBarberBookingUrl } from '@/lib/shop';

/**
 * Drops the website's Book and Shop links the plan no longer covers (the same
 * rule the server applies on publish). Pure: the input is never changed, so
 * an upgrade brings the links back. Without known entitlements, or while the
 * subscription itself isn't visibly active (Superwall can lag right after a
 * purchase), nothing is dropped and the server decides.
 */
export function stripLapsedLinks<T extends WebsiteData>(data: T, ents: Entitlements, ownFallback?: string | null): T {
  if (!ents.known || !ents.hosting) return data;
  const d = data as WebsiteData & { shopUrl?: string };
  // An AI Barber booking link (the site's /book or the old aibarber.org form); a Booksy or Square link is never touched.
  const dropBooking = !ents.bookings && typeof d.bookingUrl === 'string' && isAiBarberBookingUrl(d.bookingUrl);
  const dropShop = !ents.store && d.shopUrl != null;
  if (!dropBooking && !dropShop) return data;
  const out = { ...data } as Record<string, unknown>;
  // A dropped AI Barber link falls back to the barber's own link when they have one.
  if (dropBooking) {
    if (ownFallback?.trim()) out.bookingUrl = ownFallback.trim();
    else delete out.bookingUrl;
  }
  if (dropShop) delete out.shopUrl;
  return out as T;
}
