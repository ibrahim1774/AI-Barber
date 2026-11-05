// Where a web site's published page paths and redirects are kept: web_app_sites.published_paths (migration 027, additive, jsonb).
// Read and written by lib/publishSite.ts around a web deploy.
//  - A read that cannot be told (network error, timeout, 5xx) is retried once by the caller and then FAILS the web publish with a retryable
//    error: shipping a vercel.json without the redirects that are already live would turn every old service URL into a 404.
//  - Before migration 027 is applied the column does not exist (PostgREST answers 400): no record can exist either, so a 400 reads as
//    "no record" and the feature stays inert (the write then matches nothing or fails, and is logged on every qualifying publish).
//  - A write that fails, times out or matches no row is logged; the publish is already live and the next one recomputes from the older record.
//  - A first write (no record read) only lands on a row whose column is still null, so a record this code does not understand (a future
//    version) is never overwritten after a rollback.
import { parsePublishedPaths, type PublishedPaths } from './siteRedirects.js';
import { sbRest } from './webApp/webAppServer.js';

export interface PathsStore {
  /** The stored record, or null when there is none (never published with tracking). Throws when it cannot be told. */
  read(slug: string): Promise<PublishedPaths | null>;
  /** `prev` is what read() returned. Resolves false when no row was updated (row missing, or a record that is not understood is there). */
  write(slug: string, state: PublishedPaths, prev: PublishedPaths | null): Promise<boolean | void>;
}

/** Longest one Supabase call of the store may take. */
export const PATHS_STORE_TIMEOUT_MS = 5000;

const enc = encodeURIComponent;

export const livePathsStore: PathsStore = {
  async read(slug) {
    try {
      const rows = await sbRest(`web_app_sites?slug=eq.${enc(slug)}&select=published_paths&limit=1`, { timeoutMs: PATHS_STORE_TIMEOUT_MS });
      return parsePublishedPaths(Array.isArray(rows) ? rows[0]?.published_paths : null);
    } catch (e: any) {
      if (e?.status === 400) return null; // the column is not there yet (migration 027): nothing was ever recorded
      throw e;
    }
  },
  async write(slug, state, prev) {
    const guard = prev ? '' : '&published_paths=is.null';
    const rows = await sbRest(`web_app_sites?slug=eq.${enc(slug)}${guard}&select=slug`, { method: 'PATCH', body: { published_paths: state }, prefer: 'return=representation', timeoutMs: PATHS_STORE_TIMEOUT_MS });
    return Array.isArray(rows) && rows.length > 0;
  },
};

/** The live store when the service role is configured, else null (tests, local runs): the feature is off, nothing is read or written. */
export const defaultPathsStore = (): PathsStore | null =>
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? livePathsStore : null;
