import { readPendingSite } from '../publishSite.js';
import { siteUrlOf } from './siteAddress.js';

/**
 * The address to SHOW for a slug (emails, hints): the URL the deploy really resolved (the stamp on the
 * stored copy) when there is one, else the computed fallback. The computed form for a long slug is
 * Vercel's truncated alias, which could belong to another project, so the stamp is preferred.
 * Display only: never an ownership signal. Never throws.
 */
export async function stampedSiteUrl(slug: string): Promise<string> {
  try {
    const raw = (await readPendingSite(slug))?.deployedUrl;
    if (typeof raw === 'string') {
      const u = new URL(raw.trim());
      if (u.protocol === 'https:' && u.hostname.endsWith('.vercel.app')) return u.origin;
    }
  } catch { /* fall through to the computed address */ }
  return siteUrlOf(slug);
}
