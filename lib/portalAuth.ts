// /api/create-portal-session: who may open a Stripe billing portal for which customer.
// The browser never names the customer (except the admin): it is derived server-side from the
// caller's own records, the Stripe customers whose email is the caller's VERIFIED Supabase email.
// Every lookup fails closed (503).
import { ADMIN_EMAIL } from './admin/auth.js';
import { bearerOf } from './deployAuth.js';

export interface PortalUser { id: string; email: string | null; emailVerified: boolean }

export interface PortalDeps {
  /** The token's user; null when invalid. Throws on an outage. */
  userOf(token: string): Promise<PortalUser | null>;
  /** Stripe customers with exactly this email, newest first. Throws on an outage. */
  customersByEmail(email: string): Promise<{ id: string; created: number }[]>;
}

export type PortalAuth = { ok: true; customer: string } | { ok: false; status: 400 | 401 | 403 | 404 | 503; error: string };

const CUSTOMER = /^cus_[A-Za-z0-9]{6,64}$/;

export async function resolvePortalCustomer(input: { authorization?: unknown; customerId?: unknown }, deps: PortalDeps): Promise<PortalAuth> {
  const token = bearerOf(input.authorization);
  if (!token) return { ok: false, status: 401, error: 'sign-in-required' };
  let user: PortalUser | null;
  try {
    user = await deps.userOf(token);
  } catch (e: any) {
    console.error('[portal] user lookup failed (refusing):', e?.message || e);
    return { ok: false, status: 503, error: 'temporarily-unavailable' };
  }
  if (!user) return { ok: false, status: 401, error: 'sign-in-required' };
  const email = (user.email || '').toLowerCase();
  if (email === ADMIN_EMAIL && user.emailVerified) {
    // The admin may open any customer's portal (support), named explicitly.
    if (typeof input.customerId === 'string' && CUSTOMER.test(input.customerId)) return { ok: true, customer: input.customerId };
  }
  if (!email || !user.emailVerified) return { ok: false, status: 403, error: 'email-not-verified' };
  let customers: { id: string; created: number }[];
  try {
    customers = await deps.customersByEmail(email);
  } catch (e: any) {
    console.error('[portal] customer lookup failed (refusing):', e?.message || e);
    return { ok: false, status: 503, error: 'temporarily-unavailable' };
  }
  const own = customers.filter((c) => CUSTOMER.test(c.id)).sort((a, b) => b.created - a.created)[0];
  if (!own) return { ok: false, status: 404, error: 'no-billing-account' };
  return { ok: true, customer: own.id };
}
