// Email notifications to WEB-APP shop owners (barbers): the web counterpart of the iOS owner push.
// iOS shops (ios_otid set) keep getting Expo pushes only; this module is additive and only runs for a
// web shop (see isWebShop: flag on, no iOS link AND a current-mode, entitled web_app_entitlements row).
// A shop with neither an iOS link nor a web plan (pre-web-app shops) never gets these emails.
// Everything here swallows its own errors: a mail problem must never fail or delay a booking/order
// flow. No password is ever included.
import { render, firstOf, esc, signInLink, sendMail, type Mail } from './emails.js';
import { APP_ORIGIN, webAppEntitlementsOn, sbRest } from './webAppServer.js';
import { isEntitledStatus, keyMode } from './stripeCore.js';

export type OwnerEvent =
  | { kind: 'booking_created' | 'booking_cancelled' | 'booking_rescheduled'; customerName: string | null; service: string; whenShort: string; whenLong: string }
  | { kind: 'customer_says_paid'; customerName: string | null; service: string; whenShort: string; whenLong: string; method: string; amountCents: number | null }
  | { kind: 'order_created'; customerName: string | null; itemCount: number; totalCents: number; fulfilment: string; orderLabel: string; /** One-line shipping address (shipping orders, once known). */ shipTo?: string | null }
  | { kind: 'order_says_paid'; customerName: string | null; totalCents: number; method: string; orderLabel: string };

export interface OwnerContact { email: string | null; firstName: string | null }
export interface OwnerNotifyDeps {
  contact(ownerId: string): Promise<OwnerContact>;
  /** Resolves with the provider message id once the email was accepted; must throw otherwise. */
  send(to: string, mail: Mail): Promise<string | void>;
}

/** The Stripe mode the web app runs in (from STRIPE_WEBAPP_SECRET_KEY), or null when unset/unknown. */
const currentMode = () => keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);

export interface WebPlanRow { environment: string | null; status: string | null }

/**
 * Pure: does this owner hold a web plan in `mode`? Only rows of the current Stripe mode count, and only
 * entitled statuses (active, trialing, past_due: same set as the lapse sweeper and gateRow). canceled,
 * unpaid, incomplete, invalid_price ... do not.
 */
export function hasCurrentWebPlan(rows: WebPlanRow[], mode: 'live' | 'test' | null): boolean {
  if (!mode) return false;
  return rows.some((r) => r.environment === mode && isEntitledStatus(String(r.status ?? '')));
}

/** Live lookup of the owner's web plan (service role). Filters in code, not only in the query. Throws on a lookup error. */
export async function ownerHasWebPlan(ownerId: string, rest: typeof sbRest = sbRest): Promise<boolean> {
  const mode = currentMode();
  if (!mode) { console.warn('[web-app owner notify] plan lookup: Stripe mode unknown, treating as no plan', { kind: 'ownerHasWebPlan' }); return false; }
  const rows = await rest(`web_app_entitlements?user_id=eq.${encodeURIComponent(ownerId)}&environment=eq.${mode}&select=environment,status`);
  if (rows != null && !Array.isArray(rows)) throw new Error('web_app_entitlements lookup returned a non-array');
  return hasCurrentWebPlan((rows ?? []) as WebPlanRow[], mode);
}

export type WebPlanLookup = (ownerId: string) => Promise<boolean>;

/**
 * A web-app shop, for any behaviour change keyed on "web shop" (owner emails, Stripe return URL):
 * no iOS link, WEB_APP_ENTITLEMENTS=1, a known Stripe mode, AND the owner has an entitled
 * web_app_entitlements row in that mode. Fails closed: no lookup given, or a lookup error => false.
 * An iOS-linked shop is decided before any lookup, so it never touches the database.
 */
export async function isWebShop(shop: { owner_id: string; ios_otid?: string | null }, hasWebPlan?: WebPlanLookup): Promise<boolean> {
  if (shop.ios_otid) return false;
  // Every drop below is for a shop with no iOS link, i.e. one that would be a web shop if the gate passed. They used to be silent,
  // so a missing owner email left no trace at all (e2e 2026-11-02, "New booking" mail never arrived, no log line). Say why.
  const skip = (why: string) => { console.warn(`[web-app owner notify] not a web shop (${why}), owner ${shop.owner_id} gets no email`); return false; };
  if (!webAppEntitlementsOn()) return skip('WEB_APP_ENTITLEMENTS is off');
  if (!currentMode()) return skip('Stripe mode unknown');
  if (!hasWebPlan) return skip('no plan lookup');
  try {
    if ((await hasWebPlan(shop.owner_id)) === true) return true;
    return skip('no entitled web plan in this Stripe mode');
  } catch (e: any) {
    console.error('[web-app owner notify] web plan lookup failed, treating as not a web shop:', e?.message || e);
    return false;
  }
}

/**
 * The origin a Stripe Connect onboarding should return to: the web app for a web shop (isWebShop),
 * null (the iOS stripe-return page) for everyone else. Fails closed to null on any lookup error.
 * `shopOtidOf` returns the owner's ab_shops.ios_otid (null when unlinked or no shop) and throws on error.
 */
export async function webReturnBaseOf(
  userId: string,
  shopOtidOf: (userId: string) => Promise<string | null>,
  hasWebPlan: WebPlanLookup,
): Promise<string | null> {
  try {
    if (!webAppEntitlementsOn()) return null;
    const ios_otid = await shopOtidOf(userId);
    return (await isWebShop({ owner_id: userId, ios_otid }, hasWebPlan)) ? APP_ORIGIN() : null;
  } catch (e: any) {
    console.error('[web-app owner notify] return-base lookup failed, using the iOS return page:', e?.message || e);
    return null;
  }
}

// Header-safe: collapse whitespace/control characters (a customer name must never inject a header line).
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** Customer's first name for subjects (short), or "A customer". */
const who = (n: string | null) => cap(firstOf(clean(n ?? '')) || 'A customer', 16);
const fullWho = (n: string | null) => clean(n ?? '') || 'A customer';
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const METHODS: Record<string, string> = { cashapp: 'Cash App', venmo: 'Venmo', zelle: 'Zelle', paypal: 'PayPal' };
const methodLabel = (m: string) => METHODS[m] ?? clean(m);

/** Build the owner email for an event. Pure; `first` is the owner's first name when known. */
export function ownerEmailFor(e: OwnerEvent, first: string | null, origin = APP_ORIGIN()): Mail {
  const hi = first ? `Hi ${esc(first)}, ` : '';
  const cta = { label: 'Open Prime Barber', href: signInLink(origin) };
  const name = fullWho(e.customerName);
  let subject: string; let headline: string; let lead: string; let leadText: string;
  let facts: Array<[string, string]> = [];
  switch (e.kind) {
    case 'booking_created':
      subject = `New booking: ${who(e.customerName)}, ${e.whenShort}`;
      headline = 'New booking';
      leadText = `${name} booked ${clean(e.service)}.`;
      facts = [['Who', name], ['What', clean(e.service)], ['When', e.whenLong]];
      break;
    case 'booking_cancelled':
      subject = `Cancelled: ${who(e.customerName)}, ${e.whenShort}`;
      headline = 'Booking cancelled';
      leadText = `${name} cancelled their appointment.`;
      facts = [['Who', name], ['What', clean(e.service)], ['Was', e.whenLong]];
      break;
    case 'booking_rescheduled':
      subject = `Rescheduled: ${who(e.customerName)}, ${e.whenShort}`;
      headline = 'Booking moved';
      leadText = `${name} moved their appointment.`;
      facts = [['Who', name], ['What', clean(e.service)], ['Now', e.whenLong]];
      break;
    case 'customer_says_paid': {
      const amt = e.amountCents != null && e.amountCents > 0 ? ` ${money(e.amountCents)}` : '';
      subject = `${who(e.customerName)} says they paid${amt}`;
      headline = 'Customer says they paid';
      leadText = `${name} says they paid${amt} by ${methodLabel(e.method)}. Check your ${methodLabel(e.method)} and mark it paid.`;
      facts = [['Who', name], ['What', clean(e.service)], ['When', e.whenLong]];
      break;
    }
    case 'order_created':
      subject = `New order: ${money(e.totalCents)} (${e.itemCount} ${e.itemCount === 1 ? 'item' : 'items'})`;
      headline = 'New store order';
      leadText = `${name} placed order ${clean(e.orderLabel)}.`;
      facts = [['Who', name], ['Total', money(e.totalCents)], ['Items', String(e.itemCount)], ['Type', clean(e.fulfilment)], ...(e.shipTo?.trim() ? [['Ship to', clean(e.shipTo)] as [string, string]] : [])];
      break;
    case 'order_says_paid':
      subject = `${who(e.customerName)} says they paid ${money(e.totalCents)}`;
      headline = 'Customer says they paid';
      leadText = `${name} says they paid ${money(e.totalCents)} by ${methodLabel(e.method)} for order ${clean(e.orderLabel)}.`;
      facts = [['Who', name], ['Total', money(e.totalCents)]];
      break;
  }
  lead = `${hi}${esc(leadText)}`;
  const mail = render({ subject, preheader: leadText, headline, lead, facts, cta, origin });
  // render() derives the text part from the HTML lead; rebuild it from the raw strings so nothing shows as &amp;.
  mail.text = [headline, '', `${first ? `Hi ${first}, ` : ''}${leadText}`, '', ...facts.map(([k, v]) => `${k}: ${v}`), '', `${cta.label}: ${cta.href}`].join('\n');
  return mail;
}

/** Owner's account email + first name from Supabase auth (service role), same source as dunning's contactFor. */
async function liveContact(ownerId: string): Promise<OwnerContact> {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(ownerId)}`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY as string, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!r.ok) { console.warn('[web-app owner notify] owner contact lookup failed, no email sent', { status: r.status, kind: 'liveContact' }); return { email: null, firstName: null }; }
  const u: any = await r.json().catch(() => null);
  if (!u?.email) console.warn('[web-app owner notify] owner has no email address, no email sent', { kind: 'liveContact' });
  const m = u?.user_metadata ?? {};
  const name = m.first_name || m.given_name || m.full_name || m.name || null;
  const first = typeof name === 'string' ? firstOf(name) : '';
  return { email: u?.email ?? null, firstName: first || null };
}

export const liveOwnerNotifyDeps: OwnerNotifyDeps = { contact: liveContact, send: sendMail };

/** Email the shop owner about an event. Never throws; resolves 'sent' | 'skipped' | 'failed'. */
export async function sendOwnerEmail(ownerId: string, event: OwnerEvent, deps: OwnerNotifyDeps = liveOwnerNotifyDeps): Promise<'sent' | 'skipped' | 'failed'> {
  try {
    const { email, firstName } = await deps.contact(ownerId);
    if (!email) { console.warn('[web-app owner notify] skipped: no owner email', { kind: event?.kind }); return 'skipped'; }
    const id = await deps.send(email, ownerEmailFor(event, firstName));
    // "sent" only when the provider accepted the mail and gave back an id (so it can be looked up in the Resend dashboard).
    console.info('[web-app owner notify] sent', { kind: event?.kind, messageId: typeof id === 'string' ? id : undefined });
    return 'sent';
  } catch (e: any) {
    console.error('[web-app owner notify] failed:', event?.kind, e?.message || e);
    return 'failed';
  }
}

/**
 * Hook used by the booking/store notify paths: sends only for a web shop (isWebShop), else does nothing.
 * `hasWebPlan` must be passed (live deps pass ownerHasWebPlan); without it nothing is sent (fail closed).
 */
export async function maybeEmailOwner(
  shop: { owner_id: string; ios_otid?: string | null },
  event: OwnerEvent,
  send: (ownerId: string, e: OwnerEvent) => Promise<unknown>,
  hasWebPlan: WebPlanLookup | undefined,
): Promise<void> {
  try {
    if (!(await isWebShop(shop, hasWebPlan))) return;
    const outcome = await send(shop.owner_id, event);
    console.info('[web-app owner notify] handed off', { kind: event.kind, outcome: typeof outcome === 'string' ? outcome : 'n/a' });
  } catch (e: any) {
    console.error('[web-app owner notify] hook failed:', e?.message || e);
  }
}
