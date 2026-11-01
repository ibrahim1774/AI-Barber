// Email notifications to WEB-APP shop owners (barbers): the web counterpart of the iOS owner push.
// iOS shops (ios_otid set) keep getting Expo pushes only; this module is additive and only runs for a
// shop with no iOS link while WEB_APP_ENTITLEMENTS=1. Everything here swallows its own errors: a mail
// problem must never fail or delay a booking/order flow. No password is ever included.
import { render, firstOf, esc, signInLink, sendMail, type Mail } from './emails.js';
import { APP_ORIGIN, webAppEntitlementsOn } from './webAppServer.js';

export type OwnerEvent =
  | { kind: 'booking_created' | 'booking_cancelled' | 'booking_rescheduled'; customerName: string | null; service: string; whenShort: string; whenLong: string }
  | { kind: 'customer_says_paid'; customerName: string | null; service: string; whenShort: string; whenLong: string; method: string; amountCents: number | null }
  | { kind: 'order_created'; customerName: string | null; itemCount: number; totalCents: number; fulfilment: string; orderLabel: string }
  | { kind: 'order_says_paid'; customerName: string | null; totalCents: number; method: string; orderLabel: string };

export interface OwnerContact { email: string | null; firstName: string | null }
export interface OwnerNotifyDeps {
  contact(ownerId: string): Promise<OwnerContact>;
  send(to: string, mail: Mail): Promise<void>;
}

/** A web-app shop: the flag is on and the shop has no iOS link (same test as lib/webApp/entitlementGate.ts gateRow). */
export const isWebShop = (shop: { ios_otid?: string | null }): boolean => webAppEntitlementsOn() && !shop.ios_otid;

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
  const cta = { label: 'Open AI Barber', href: signInLink(origin) };
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
      facts = [['Who', name], ['Total', money(e.totalCents)], ['Items', String(e.itemCount)], ['Type', clean(e.fulfilment)]];
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
  if (!r.ok) return { email: null, firstName: null };
  const u: any = await r.json().catch(() => null);
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
    if (!email) return 'skipped';
    await deps.send(email, ownerEmailFor(event, firstName));
    return 'sent';
  } catch (e: any) {
    console.error('[web-app owner notify] failed:', event?.kind, e?.message || e);
    return 'failed';
  }
}

/**
 * Hook used by the booking/store notify paths: sends only for a web shop with the flag on, else does nothing.
 * `send` is injectable for tests; production passes nothing and uses Resend.
 */
export async function maybeEmailOwner(
  shop: { owner_id: string; ios_otid?: string | null },
  event: OwnerEvent,
  send: (ownerId: string, e: OwnerEvent) => Promise<unknown> = (id, e) => sendOwnerEmail(id, e),
): Promise<void> {
  try {
    if (!isWebShop(shop)) return;
    await send(shop.owner_id, event);
  } catch (e: any) {
    console.error('[web-app owner notify] hook failed:', e?.message || e);
  }
}
