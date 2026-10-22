// /custom-15 pay-first flow: the visitor pays for the sample site first, then
// gives their details. Until they do, nothing may publish the sample.
//
// Shared by the browser (App's Stripe return + the details step) and the
// server (publishSite, the Stripe webhook, the 10-minute sweeper). Pure.
import type { WebsiteData } from '../types';

/** Checkout plans that pay before the shop's details are known. */
export const PAY_FIRST_PLANS = ['monthly-custom15', 'monthly-custom10'] as const;

export function isPayFirstPlan(plan: string | null | undefined): boolean {
  return !!plan && (PAY_FIRST_PLANS as readonly string[]).includes(plan);
}

/**
 * Must this copy be held back (not published)?
 * - It is explicitly flagged as the unfilled sample, or
 * - it belongs to a pay-first checkout and was never confirmed (covers
 *   copies written before the flag existed, i.e. by a stale browser bundle).
 */
export function isAwaitingDetails(
  siteData: Pick<WebsiteData, 'awaitingDetails' | 'detailsConfirmed'> | null | undefined,
  plan?: string | null,
): boolean {
  if (!siteData) return false;
  if (siteData.awaitingDetails === true) return true;
  return isPayFirstPlan(plan) && siteData.detailsConfirmed !== true;
}

export interface PayFirstDetails {
  shopName: string;
  area?: string;
  phone?: string;
  bookingUrl?: string;
}

/** Shop name, and at least one way to reach the shop. Null when valid. */
export function validatePayFirstDetails(d: PayFirstDetails): string | null {
  if (!(d.shopName || '').trim()) return 'Enter your shop name.';
  const hasPhone = /\d/.test(d.phone || '');
  const hasLink = !!(d.bookingUrl || '').trim();
  if (!hasPhone && !hasLink) return 'Add a phone number or a booking link so customers can reach you.';
  return null;
}

/** imageUrlMap for a site whose images are all http(s) URLs (hotlinked). */
export function httpImageUrlMap(sd: WebsiteData): Record<string, string> {
  const map: Record<string, string> = {};
  const isHttp = (u?: string) => !!u && /^https?:\/\//i.test(u);
  if (isHttp(sd.hero?.imageUrl)) map.hero = sd.hero.imageUrl;
  if (isHttp(sd.about?.imageUrl)) map.about = sd.about.imageUrl;
  (sd.gallery || []).forEach((u, i) => { if (isHttp(u)) map[`gallery${i}`] = u; });
  (sd.craftImages || []).forEach((u, i) => { if (isHttp(u)) map[`craft${i}`] = u; });
  (sd.staff || []).forEach((s, i) => { if (isHttp(s?.photo)) map[`staff${i}`] = s.photo as string; });
  return map;
}
