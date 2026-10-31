import { MOVE_IN_PROGRESS_MESSAGE } from '@/lib/claimCopy';
import { accessToken } from '@/lib/accessToken';
import type { SiteRecord } from '@/lib/siteStore';
import { isSamplePrice } from '@/lib/samplePrices';
import { websiteToSetupServices, type SetupService } from '@/lib/setup/servicesMap';

const base = () => process.env.EXPO_PUBLIC_API_BASE ?? 'https://www.aibarber.org';

export class OwnerApiError extends Error {
  /** The server's JSON error body when it sent one (e.g. `{ error: 'member-limit', limit: 2 }`). */
  body?: Record<string, unknown>;
  constructor(public status: number, public code: string, message: string, body?: Record<string, unknown>) {
    super(message);
    this.name = 'OwnerApiError';
    if (body) this.body = body;
  }
}

const OFFLINE = "Couldn't reach Prime Barber. Check your connection and try again.";

/** Web: the subscription id ('web:sub_…') is ours, not an Apple transaction id; the server derives the web plan from the signed-in account. */
function withoutWebTransaction(body: unknown): unknown {
  if (body && typeof body === 'object' && typeof (body as { transactionId?: unknown }).transactionId === 'string' && (body as { transactionId: string }).transactionId.startsWith('web:')) {
    const { transactionId: _drop, ...rest } = body as Record<string, unknown>;
    return rest;
  }
  return body;
}

export async function call<T>(method: 'GET' | 'POST', path: string, rawBody?: unknown): Promise<T> {
  const body = withoutWebTransaction(rawBody);
  const token = await accessToken();
  if (!token) throw new OwnerApiError(401, 'unauthorized', 'Sign in to continue.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  let status = 0;
  let raw = '';
  try {
    const resp = await fetch(`${base()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    status = resp.status;
    raw = await resp.text();
  } catch {
    throw new OwnerApiError(0, 'network', OFFLINE);
  } finally {
    clearTimeout(timer);
  }
  let json: any = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  if (status < 200 || status >= 300) {
    const code = typeof json?.error === 'string' && json.error ? json.error : `http-${status}`;
    throw new OwnerApiError(status, code, friendly(status, code), json && typeof json === 'object' && !Array.isArray(json) ? json : undefined);
  }
  return json as T;
}

function friendly(status: number, code: string): string {
  if (code === 'move-in-progress') return MOVE_IN_PROGRESS_MESSAGE;
  if (status === 401) return 'Your sign-in has expired. Sign in again.';
  if (code === 'store-paused') return 'Your Prime Barber plan needs to be active to sell online.';
  if (status === 423 || code === 'bookings-paused') return 'Your Prime Barber plan needs to be active to take bookings.';
  if (code === 'stripe-account-unavailable') return "We couldn't reach your Stripe account. Email support@davoxa.com and we'll sort it out.";
  if (code === 'members-unavailable') return "Adding barbers isn't available yet. Try again in a little while.";
  if (code === 'members-need-bookings') return 'Adding barbers is part of the Bookings plan.';
  if (code === 'member-limit') return "You've reached the number of barbers your plan includes.";
  if (status === 400) return "Some of your details couldn't be saved. Check your services and try again.";
  if (status >= 500) return 'Prime Barber is having trouble right now. Try again in a minute.';
  return code.replace(/-/g, ' ');
}

export type SetupBody = {
  siteId: string;
  name: string;
  timezone: string;
  address?: string;
  phone?: string;
  transactionId?: string;
  services: SetupService[];
};

/** The device's IANA zone; falls back to New York if the runtime reports none. */
export function deviceTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz.includes('/')) return tz;
  } catch {
    // fall through
  }
  return 'America/New_York';
}

/** Example prices the migration filled on the website cards never reach the shop until the barber has reviewed the services. */
function withoutExamplePrices(list: SetupService[], inputs: { samplePricesFilled?: boolean; pricesReviewed?: boolean; importedFrom?: string }): SetupService[] {
  // A Google-start site holds no samples (an earlier build's fills are kept as the barber's prices).
  if (!inputs.samplePricesFilled || inputs.pricesReviewed || inputs.importedFrom === 'gbp') return list;
  return list.map((s) => (isSamplePrice(s.name, String((s.priceCents ?? 0) / 100)) ? { ...s, priceCents: null } : s));
}

/** POST /api/shop/setup body from the local site. */
export function buildSetupBody(site: SiteRecord, timezone: string = deviceTimezone()): SetupBody {
  const d = site.data;
  const body: SetupBody = {
    siteId: site.draftId,
    name: (d.shopName || site.inputs.shopName || 'My barbershop').trim(),
    timezone,
    services: withoutExamplePrices(websiteToSetupServices(d.services ?? []), site.inputs),
  };
  const address = d.contact?.address?.trim();
  if (address) body.address = address;
  const phone = d.phone?.trim();
  if (phone) body.phone = phone;
  if (site.transactionId) body.transactionId = site.transactionId;
  return body;
}

export const shopSetup = (body: SetupBody) => call<{ shop: { id: string; slug: string } }>('POST', '/api/shop/setup', body);
export const stripeOnboard = () => call<{ url: string }>('POST', '/api/shop/stripe/onboard', {});
export type StripeStatus = { connected: boolean; chargesEnabled: boolean; detailsSubmitted: boolean };
export const stripeStatus = () => call<StripeStatus>('GET', '/api/shop/stripe/status');
