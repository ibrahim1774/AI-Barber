// Booking-page slugs: https://www.aibarber.org/book/{slug}. Must satisfy the ab_shops check
// (lowercase a-z0-9 and inner dashes, <= 63 chars, not reserved).
import { randomBytes } from 'node:crypto';

export const RESERVED_SLUGS: readonly string[] = ['manage', 'api', 'stripe-return', 'book', 'shop'];
const SLUG_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const MAX_BASE = 50; // room for "-xxxx" under the 63-char limit
const MAX_SUFFIX_TRIES = 8;

export function isValidSlug(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 63 && SLUG_RE.test(s) && !RESERVED_SLUGS.includes(s);
}

/** Same transform as lib/publishSite.ts slugify, trimmed to the booking base budget. */
export function slugifyName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, MAX_BASE)
    .replace(/-+$/, '');
}

/** The Vercel label of a deployed iOS site ('https://fresh-cuts.vercel.app' -> 'fresh-cuts'), else null. */
export function vercelLabel(deployedUrl: string | null | undefined): string | null {
  if (!deployedUrl) return null;
  let host: string;
  try {
    host = new URL(deployedUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const m = /^([a-z0-9-]+)\.vercel\.app$/.exec(host);
  if (!m) return null;
  const label = m[1].substring(0, MAX_BASE).replace(/-+$/, '');
  return SLUG_RE.test(label) ? label : null;
}

function defaultRand(): string {
  let out = '';
  for (const b of randomBytes(4)) out += (b % 36).toString(36);
  return out;
}

/**
 * Pick a free slug: `preferred` (the site's Vercel label) or slugify(name), else that base
 * plus "-xxxx". A reserved or invalid base always gets a suffix. Throws 'slug-exhausted'.
 */
export async function chooseShopSlug(
  preferred: string | null,
  name: string,
  isTaken: (slug: string) => Promise<boolean>,
  rand: () => string = defaultRand,
): Promise<string> {
  const base = (preferred && SLUG_RE.test(preferred) ? preferred : slugifyName(name)) || 'barbershop';
  if (isValidSlug(base) && !(await isTaken(base))) return base;
  for (let i = 0; i < MAX_SUFFIX_TRIES; i++) {
    const candidate = `${base}-${rand()}`;
    if (isValidSlug(candidate) && !(await isTaken(candidate))) return candidate;
  }
  throw new Error('slug-exhausted');
}
