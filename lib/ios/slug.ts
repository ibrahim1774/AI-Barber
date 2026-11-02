import { randomBytes } from 'node:crypto';
import { slugify } from '../publishSite.js';
import { isReservedSlug } from './reservedSlugs.js';
import { VERCEL_LABEL_MAX } from './siteAddress.js';

const SANDBOX_PREFIX = 'ios-test-';
const MAX_SUFFIX_TRIES = 5;
// Vercel serves `<slug>.vercel.app` only for the first VERCEL_LABEL_MAX chars of a project name
// (a longer name gets a truncated alias, never its full address), so every NEW slug (prefix +
// base, or prefix + base + "-xxxx") stays within that. deployToVercel's own 50-char cut is then
// never reached. Existing, longer slugs keep working: nothing here renames them.
const SUFFIX_LEN = 5; // "-xxxx"
const MAX_SLUG = VERCEL_LABEL_MAX;

function defaultRand(): string {
  const bytes = randomBytes(4);
  let out = '';
  for (const b of bytes) out += (b % 36).toString(36);
  return out;
}

/** Pick a slug no existing site/project/pending publish uses. Throws 'slug-exhausted'. */
export async function chooseSlug(
  shopName: string,
  env: 'Production' | 'Sandbox',
  isTaken: (slug: string) => Promise<boolean>,
  rand: () => string = defaultRand,
): Promise<string> {
  const prefix = env === 'Sandbox' ? SANDBOX_PREFIX : '';
  const room = MAX_SLUG - prefix.length;
  const full = slugify(shopName) || 'barbershop';
  const base = full.substring(0, room).replace(/-+$/, '') || 'barbershop';
  const first = prefix + base;
  // A reserved base (bucket folder name, UUID) is treated as taken, so it only ever gets a suffixed slug.
  // Checked on the untruncated name too: a UUID-shaped name must not slip through by being cut short.
  if (!isReservedSlug(first) && !isReservedSlug(prefix + full) && !(await isTaken(first))) return first;
  for (let i = 0; i < MAX_SUFFIX_TRIES; i++) {
    // The suffixed form must fit too: trim the base, not the suffix (which keeps it unique).
    const candidate = `${first.slice(0, MAX_SLUG - SUFFIX_LEN).replace(/-+$/, '')}-${rand()}`;
    if (!isReservedSlug(candidate) && !(await isTaken(candidate))) return candidate;
  }
  throw new Error('slug-exhausted');
}

export function makeIsTaken(deps: {
  pendingExists(slug: string): Promise<boolean>;
  repoTaken(slug: string): Promise<boolean>;
  /** Authoritative: a Vercel project with this name exists. Throws when it can't tell. */
  projectExists(slug: string): Promise<boolean>;
  urlServes(url: string): Promise<boolean>;
  /** Optional: objects already exist under `<slug>/` in the bucket (another site's or draft's folder). */
  prefixInUse?(slug: string): Promise<boolean>;
}): (slug: string) => Promise<boolean> {
  return async (slug) =>
    isReservedSlug(slug) ||
    (await deps.pendingExists(slug)) ||
    (deps.prefixInUse ? await deps.prefixInUse(slug) : false) ||
    (await deps.repoTaken(slug)) ||
    (await deps.projectExists(slug)) ||
    (await deps.urlServes(`https://${slug}.vercel.app`));
}

/**
 * True if a Vercel project with this exact name exists in the scope deployToVercel
 * deploys into (same VERCEL_TOKEN, no team parameter — lib/deploySite.ts sends none).
 * deployToVercel deploys by project NAME, so an existing project means another
 * customer's site. 200 → true, 404 → false; anything else (missing token, other
 * status, network error, 8 s timeout) THROWS so the publish fails closed (503).
 */
export async function vercelProjectExists(slug: string): Promise<boolean> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error('vercel-project-check: VERCEL_TOKEN is not set');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(slug)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: ctl.signal,
    });
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    throw new Error(`vercel-project-check: HTTP ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/** True if the URL answers 2xx (any content) within 8s; false on any error. */
export async function urlServes(url: string): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctl.signal });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
