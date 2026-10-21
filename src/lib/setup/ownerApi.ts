import { supabase } from '@/lib/supabase';
import type { SiteRecord } from '@/lib/siteStore';
import { websiteToSetupServices, type SetupService } from '@/lib/setup/servicesMap';

const base = () => process.env.EXPO_PUBLIC_API_BASE ?? 'https://www.aibarber.org';

export class OwnerApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'OwnerApiError';
  }
}

const OFFLINE = "Couldn't reach AI Barber. Check your connection and try again.";

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
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
    throw new OwnerApiError(status, code, friendly(status, code));
  }
  return json as T;
}

function friendly(status: number, code: string): string {
  if (status === 401) return 'Your sign-in has expired. Sign in again.';
  if (status === 423 || code === 'bookings-paused') return 'Your AI Barber plan needs to be active to take bookings.';
  if (code === 'stripe-account-unavailable') return "We couldn't reach your Stripe account. Email support@davoxa.com and we'll sort it out.";
  if (status === 400) return "Some of your details couldn't be saved. Check your services and try again.";
  if (status >= 500) return 'AI Barber is having trouble right now. Try again in a minute.';
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

/** POST /api/shop/setup body from the local site. */
export function buildSetupBody(site: SiteRecord, timezone: string = deviceTimezone()): SetupBody {
  const d = site.data;
  const body: SetupBody = {
    siteId: site.draftId,
    name: (d.shopName || site.inputs.shopName || 'My barbershop').trim(),
    timezone,
    services: websiteToSetupServices(d.services ?? []),
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
