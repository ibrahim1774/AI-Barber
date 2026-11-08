// Entitlement rows only: a bound site row survives cancellation, so it says nothing about who is paying now.
// Webhook lag right after payment is covered by the client's paid-no-phone hint.
// Whether the web app must ask this signed-in user for a mobile number (server truth for /api/web-app/me).
import { isEntitledStatus } from './stripeCore.js';

export interface NeedsPhoneInput {
  /** WEB_APP_PHONE_GATE === '1' */
  flag: boolean;
  /** The saved phone (customer_contacts, then auth phone, then metadata), or null. */
  phone: string | null | undefined;
  /** web_app_entitlements rows of this user for this Stripe mode. */
  entitlementRows: Array<{ status: string }>;
}

/** Only users with an entitled (active, trialing, past_due) plan, only with the flag on, only when no phone is on file. */
export function needsPhone(i: NeedsPhoneInput): boolean {
  if (!i.flag) return false;
  if (typeof i.phone === 'string' && i.phone.trim()) return false;
  return i.entitlementRows.some((r) => isEntitledStatus(r.status));
}
