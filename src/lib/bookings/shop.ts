/** The one place the Bookings tab imports the shop data layer from. */
export * from '@/lib/shop';

import type { ShareLink } from '@/lib/share';
import type { Member, Service } from '@/lib/shop';

export const BOOKING_SHARE_KIND: ShareLink['kind'] = 'booking';

/** Tolerant readers: A2's Member / Service may spell the display fields differently. */
export const memberName = (m: Member): string =>
  String((m as any).name ?? (m as any).displayName ?? (m as any).display_name ?? 'Barber');
export const serviceName = (s: Service): string => String((s as any).name ?? 'Service');
export const serviceMinutes = (s: Service): number =>
  Number((s as any).durationMin ?? (s as any).duration_min ?? 30);
export const servicePrice = (s: Service): number | null =>
  (s as any).priceCents ?? (s as any).price_cents ?? null;
