// Custom domains from the app: .com names only (spec 2026-10-22-custom-domains). No imports.

/** Vercel's price (first year AND renewal, USD) must be at most this; premium names cost more. */
export const MAX_PRICE_USD = 15;

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

/** A registrable `.com` we offer: lower case, 3–63 character label, no punycode (`--` at 3–4). */
export function isComDomain(domain: unknown): domain is string {
  if (typeof domain !== 'string' || !domain.endsWith('.com')) return false;
  const label = domain.slice(0, -4);
  return LABEL_RE.test(label) && label.slice(2, 4) !== '--';
}

/**
 * The barber's search text as one `.com` label: lower case, accents folded, `&` → `and`, scheme,
 * `www.` and a `.com` ending dropped, everything else that isn't a letter, digit or dash removed
 * (so "Fresh Cuts" → "freshcuts"), dashes collapsed and trimmed, at most 63 characters. Null when
 * nothing usable (under 3 characters) is left.
 */
export function normalizeLabel(q: unknown): string | null {
  if (typeof q !== 'string' || q.length > 120) return null;
  let s = q.trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '').replace(/\.+$/, '').replace(/\.com$/, '');
  s = s.replace(/&/g, 'and').replace(/[^a-z0-9-]+/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  s = s.slice(0, 63).replace(/-+$/, '');
  if (s.length < 3 || !isComDomain(`${s}.com`)) return null;
  return s;
}

/** The exact `.com` first, then a few close suggestions built from the same name. */
export function candidateDomains(label: string): string[] {
  const out: string[] = [];
  const add = (l: string) => {
    const d = `${l}.com`;
    if (l.length <= 63 && isComDomain(d) && !out.includes(d)) out.push(d);
  };
  add(label);
  if (!/barber(shop)?$/.test(label)) {
    add(`${label}barber`);
    add(`${label}barbershop`);
  }
  if (!label.startsWith('the')) add(`the${label}`);
  if (!/cuts$/.test(label)) add(`${label}cuts`);
  add(`${label}studio`);
  return out.slice(0, 6);
}

/** Vercel price data → offered? Numbers only (the API may send strings), both prices within the cap. */
export function eligiblePrice(p: { purchasePrice?: unknown; renewalPrice?: unknown } | null | undefined): boolean {
  if (!p) return false;
  const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_PRICE_USD;
  return ok(p.purchasePrice) && ok(p.renewalPrice);
}
