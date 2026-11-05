// Where a web site's published page paths and redirects are kept: web_app_sites.published_paths (migration 027, additive, jsonb).
// Read and written by lib/publishSite.ts around a web deploy. A failure here never fails a publish (the redirects are an SEO courtesy):
//  - a read that fails means "unknown": the deploy ships without redirects and the stored record is left alone, so the next publish
//    (which compares against that older record) puts them back;
//  - a write that fails is logged; the next publish recomputes from the same older record, so nothing is lost for good.
// Before migration 027 is applied the column does not exist: the read fails, and the feature stays off (logged once).
import { parsePublishedPaths, type PublishedPaths } from './siteRedirects.js';
import { sbRest } from './webApp/webAppServer.js';

export interface PathsStore {
  /** The stored record, or null when there is none (never published with tracking). Throws when it cannot be told. */
  read(slug: string): Promise<PublishedPaths | null>;
  write(slug: string, state: PublishedPaths): Promise<void>;
}

const enc = encodeURIComponent;

export const livePathsStore: PathsStore = {
  async read(slug) {
    const rows = await sbRest(`web_app_sites?slug=eq.${enc(slug)}&select=published_paths&limit=1`);
    return parsePublishedPaths(Array.isArray(rows) ? rows[0]?.published_paths : null);
  },
  async write(slug, state) {
    await sbRest(`web_app_sites?slug=eq.${enc(slug)}`, { method: 'PATCH', body: { published_paths: state }, prefer: 'return=minimal' });
  },
};

/** The live store when the service role is configured, else null (tests, local runs): the feature is off, nothing is read or written. */
export const defaultPathsStore = (): PathsStore | null =>
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? livePathsStore : null;
