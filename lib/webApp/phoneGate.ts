// Whether the web app must ask this signed-in user for a mobile number (server truth for /api/web-app/me).
import { isEntitledStatus } from './stripeCore.js';

export interface NeedsPhoneInput {
  /** WEB_APP_PHONE_GATE === '1' */
  flag: boolean;
  /** The saved phone (customer_contacts, then auth phone, then metadata), or null. */
  phone: string | null | undefined;
  /** web_app_entitlements rows of this user for this Stripe mode. */
  entitlementRows: Array<{ status: string }>;
  /** A paid checkout is known for this user (a bound web_app_sites row), even before the webhook entitlement lands. */
  hasCheckout: boolean;
}

/** Only paying (or just-paid) users, only with the flag on, only when no phone is on file. */
export function needsPhone(i: NeedsPhoneInput): boolean {
  if (!i.flag) return false;
  if (typeof i.phone === 'string' && i.phone.trim()) return false;
  return i.hasCheckout || i.entitlementRows.some((r) => isEntitledStatus(r.status));
}
