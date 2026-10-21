/**
 * The ONE place the Bookings tab imports the shop data layer from. A2's
 * src/lib/shop.ts replaces A1's stub at merge: change the line below to
 * `from '@/lib/shop'` and delete src/lib/shop.stub-a1.ts.
 */
export * from '@/lib/shop.stub-a1';

import type { ShareLink } from '@/lib/share';
import type { Member, Service } from '@/lib/shop.stub-a1';

/**
 * ShareKind 'booking' is added by A2 (src/lib/share.ts). Until that merges the
 * union only has 'website', hence the cast.
 */
export const BOOKING_SHARE_KIND = 'booking' as string as ShareLink['kind'];

/** Tolerant readers: A2's Member / Service may spell the display fields differently. */
export const memberName = (m: Member): string =>
  String((m as any).name ?? (m as any).displayName ?? (m as any).display_name ?? 'Barber');
export const serviceName = (s: Service): string => String((s as any).name ?? 'Service');
export const serviceMinutes = (s: Service): number =>
  Number((s as any).durationMin ?? (s as any).duration_min ?? 30);
export const servicePrice = (s: Service): number | null =>
  (s as any).priceCents ?? (s as any).price_cents ?? null;
