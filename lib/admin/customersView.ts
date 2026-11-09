// Pure helpers for components/AdminCustomers.tsx: search, filters, banner, cell formatting.
// Kept free of React so they are unit-tested directly (the repo has no component test setup).
import type { CustomerFamily, CustomerRow, SourceStatus } from './customers.js';

export const FAMILY_LABEL: Record<CustomerFamily, string> = {
  'primebarber-web': 'Web app',
  'aibarber-legacy': 'AI Barber',
  ios: 'iOS',
  'custom-design': 'Custom design',
  'primehub-pro': 'PrimeHub Pro',
  'primehub-legacy': 'PrimeHub',
  'account-only': 'No plan',
};
export const FAMILY_ORDER = Object.keys(FAMILY_LABEL) as CustomerFamily[];

export interface Filters { q: string; families: ReadonlySet<CustomerFamily>; noPhone: boolean; showTest: boolean }

export const isTestRow = (r: CustomerRow) => r.flags.includes('test');

/** Every string field of a row, lower-cased, plus the phone's digits so "5551234" finds "+15551234567". */
export function haystack(r: CustomerRow): string {
  const parts: string[] = [];
  for (const v of Object.values(r)) {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) for (const x of v) parts.push(typeof x === 'string' ? x : [x?.plan, x?.status, x?.source].filter(Boolean).join(' '));
  }
  parts.push(FAMILY_LABEL[r.family], (r.phone || '').replace(/\D/g, ''));
  return parts.join('\n').toLowerCase();
}

export function matchesQuery(r: CustomerRow, q: string): boolean {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const h = haystack(r);
  // A phone typed with formatting ("(555) 123-4567") is compared by digits.
  return terms.every((t) => h.includes(t) || (/^[\d()+.\-]+$/.test(t) && t.replace(/\D/g, '').length >= 3 && h.includes(t.replace(/\D/g, ''))));
}

export function filterRows(rows: CustomerRow[], f: Filters): CustomerRow[] {
  return rows.filter((r) => {
    if (!f.showTest && isTestRow(r)) return false;
    if (f.families.size && !f.families.has(r.family)) return false;
    if (f.noPhone && !r.flags.includes('no-phone')) return false;
    return matchesQuery(r, f.q);
  });
}

/** Sources that failed or were cut short, e.g. ["stripe: partial"]. Empty = no banner. 'skipped' never counts. */
export function sourceBanner(sources: SourceStatus | null | undefined): string[] {
  return Object.entries(sources || {}).filter(([, v]) => v === 'error' || v === 'partial').map(([k, v]) => `${k}: ${v}`);
}

/** Sources that are simply not configured (e.g. PrimeHub Pro): a muted note, never a warning. */
export function skippedSources(sources: SourceStatus | null | undefined): string[] {
  return Object.entries(sources || {}).filter(([, v]) => v === 'skipped').map(([k]) => k);
}

/** Only http(s) URLs become links; anything else (javascript:, data:, bare text) is shown as plain text. */
export const safeHttpUrl = (u: string | null | undefined): string | null => (typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

/** The Stripe dashboard link, only when its customer id looks like a Stripe id. */
export function safeStripeUrl(r: Pick<CustomerRow, 'stripeCustomerUrl' | 'stripeCustomerId'>): string | null {
  const m = /^https:\/\/dashboard\.stripe\.com\/(?:test\/)?customers\/(cus_[A-Za-z0-9]+)$/.exec(r.stripeCustomerUrl || '');
  return m && m[1] === r.stripeCustomerId ? r.stripeCustomerUrl : null;
}

export interface EmailCell { label: string; value: string | null; same: boolean }

/** contact | Stripe | account | sign-up; a value equal to the previous column's shows as "same". */
export function emailCells(r: CustomerRow): EmailCell[] {
  const cols: Array<[string, string | null]> = [['Contact', r.contactEmail], ['Stripe', r.stripeEmail], ['Account', r.accountEmail], ['Sign-up', r.signupEmail]];
  return cols.map(([label, value], i) => ({ label, value, same: i > 0 && !!value && value === cols[i - 1][1] }));
}

/** Password reset only works for main-project accounts (Pro signs in with a code). */
export const canSendReset = (r: CustomerRow) => r.project === 'main' && !!r.userId;

export const planLabel = (r: CustomerRow) => (r.plan ? (r.interval ? `${r.plan} · ${r.interval}` : r.plan) : '');

export function countsByFamily(rows: CustomerRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.family] = (out[r.family] || 0) + 1;
  return out;
}

/** Supabase limits password-reset emails per address (about one a minute). */
export const RESET_COOLDOWN_MS = 60_000;
export const RESET_RATE_LIMITED_TEXT = 'Already sent — try again in a minute.';

export const RESET_EMAIL_LIMIT_TEXT = 'Email limit reached — try again later.';
export const RESET_TOO_MANY_TEXT = 'Too many actions — wait a minute and try again.';

/**
 * Which Supabase rate limit a failed reset hit: 'address' = the per-address "you can only request this after N seconds" (a mail was
 * just sent), 'email' = any other limit (the project-wide hourly email cap), null = not a rate limit.
 */
export function resetLimitKind(e: any): 'address' | 'email' | null {
  if (!e) return null;
  if (/for security purposes, you can only request this after/i.test(String(e.message || ''))) return 'address';
  if (e.status === 429 || e.code === 'over_email_send_rate_limit' || e.code === 'over_request_rate_limit' || /rate limit/i.test(String(e.message || ''))) return 'email';
  return null;
}

/** Seconds left on a row's reset button (0 = ready). `until` is the time the cooldown ends. */
export function resetSecondsLeft(until: number | undefined, now: number): number {
  return until && until > now ? Math.ceil((until - now) / 1000) : 0;
}

/** The notice for a failed reset: the API error 'reset-rate-limited' (per address), 'email-limit' (project cap), 'rate-limited' (the admin write limiter). */
export function resetFailedText(message: string | undefined): string {
  if (message === 'reset-rate-limited') return RESET_RATE_LIMITED_TEXT;
  if (message === 'email-limit') return RESET_EMAIL_LIMIT_TEXT;
  if (message === 'rate-limited') return RESET_TOO_MANY_TEXT;
  return `Reset failed: ${message || 'error'}`;
}
