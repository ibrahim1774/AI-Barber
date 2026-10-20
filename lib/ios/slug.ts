import { randomBytes } from 'node:crypto';
import { slugify } from '../publishSite.js';

const SANDBOX_PREFIX = 'ios-test-';
const MAX_SUFFIX_TRIES = 5;
// Vercel project names max out at 52 chars once we add "-xxxx"; the base budget
// shrinks by the sandbox prefix length so the final slug always fits.
const MAX_BASE = 40;
const MAX_SLUG = 52 - 5;

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
  const room = Math.min(MAX_BASE, MAX_SLUG - prefix.length);
  const base = slugify(shopName).substring(0, room).replace(/-+$/, '') || 'barbershop';
  const first = prefix + base;
  if (!(await isTaken(first))) return first;
  for (let i = 0; i < MAX_SUFFIX_TRIES; i++) {
    const candidate = `${first}-${rand()}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error('slug-exhausted');
}

export function makeIsTaken(deps: {
  pendingExists(slug: string): Promise<boolean>;
  repoTaken(slug: string): Promise<boolean>;
  urlServes(url: string): Promise<boolean>;
}): (slug: string) => Promise<boolean> {
  return async (slug) =>
    (await deps.pendingExists(slug)) ||
    (await deps.repoTaken(slug)) ||
    (await deps.urlServes(`https://${slug}.vercel.app`));
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
