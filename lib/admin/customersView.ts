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

/** Names of sources that are not fully ok, e.g. ["stripe: partial", "pro: skipped"]. Empty = no banner. */
export function sourceBanner(sources: SourceStatus | null | undefined): string[] {
  return Object.entries(sources || {}).filter(([, v]) => v !== 'ok').map(([k, v]) => `${k}: ${v}`);
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
