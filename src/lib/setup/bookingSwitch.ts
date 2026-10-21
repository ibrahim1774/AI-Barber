import type { WebsiteData, ShopInputs } from '@/web/types';
import { bookingUrl, isAiBarberBookingUrl, type Shop } from '@/lib/shop';

/** The barber's current Book-button link when it is someone else's calendar (Booksy, Square...). */
export function existingBookingLink(d: Pick<WebsiteData, 'bookingUrl'>): string | null {
  const u = d.bookingUrl?.trim();
  return u && !isAiBarberBookingUrl(u) ? u : null;
}

/** Points the Book buttons at the AI Barber booking page. Only call after the barber confirms. */
export function switchBookButton<T extends Pick<WebsiteData, 'bookingUrl'>>(d: T, shop: Pick<Shop, 'slug'>): T {
  return { ...d, bookingUrl: bookingUrl(shop) };
}

export function switchInputs(i: ShopInputs, shop: Pick<Shop, 'slug'>): ShopInputs {
  return { ...i, bookingUrl: bookingUrl(shop) };
}

export const DOUBLE_BOOKING_WARNING =
  'You already have a booking link on your website. If you keep two calendars, customers can book the same time twice. Switch only if AI Barber will be your one calendar.';
