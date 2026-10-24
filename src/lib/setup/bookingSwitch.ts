import type { WebsiteData, ShopInputs } from '@/web/types';
import { isAiBarberBookingUrl, type Shop } from '@/lib/shop';
import { SITE_BOOK_PATH } from '@/web/lib/render/subpages';

/** The barber's current Book-button link when it is someone else's calendar (Booksy, Square...). */
export function existingBookingLink(d: Pick<WebsiteData, 'bookingUrl'>): string | null {
  const u = d.bookingUrl?.trim();
  return u && !isAiBarberBookingUrl(u) ? u : null;
}

/** Points the Book buttons at the AI Barber booking page. Only call after the barber confirms. */
export function switchBookButton<T extends Pick<WebsiteData, 'bookingUrl'>>(d: T, _shop?: Pick<Shop, 'slug'>): T {
  return { ...d, bookingUrl: SITE_BOOK_PATH };
}

export function switchInputs(i: ShopInputs, _shop?: Pick<Shop, 'slug'>): ShopInputs {
  return { ...i, bookingUrl: SITE_BOOK_PATH };
}

export const DOUBLE_BOOKING_WARNING =
  'You already have a booking link on your website. If you keep two calendars, customers can book the same time twice. Switch only if Prime Barber will be your one calendar.';
