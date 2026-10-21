import type { WebsiteData } from '@/web/types';
import type { Entitlements } from '@/lib/entitlements';

/** An AI Barber booking link; a Booksy or Square link is the barber's own and is never touched. */
const AIBARBER_BOOK = /^https?:\/\/(www\.)?aibarber\.org\/book\//i;

/**
 * Drops the website's Book and Shop links the plan no longer covers (the same
 * rule the server applies on publish). Pure: the input is never changed, so
 * an upgrade brings the links back. Without known entitlements, or while the
 * subscription itself isn't visibly active (Superwall can lag right after a
 * purchase), nothing is dropped and the server decides.
 */
export function stripLapsedLinks<T extends WebsiteData>(data: T, ents: Entitlements): T {
  if (!ents.known || !ents.hosting) return data;
  const d = data as WebsiteData & { shopUrl?: string };
  const dropBooking = !ents.bookings && typeof d.bookingUrl === 'string' && AIBARBER_BOOK.test(d.bookingUrl.trim());
  const dropShop = !ents.store && d.shopUrl != null;
  if (!dropBooking && !dropShop) return data;
  const out = { ...data } as Record<string, unknown>;
  if (dropBooking) delete out.bookingUrl;
  if (dropShop) delete out.shopUrl;
  return out as T;
}
