// The ab_shops columns migration 011 adds (site_base_url, site_look), read so that code
// deployed before the migration keeps working: a select naming them is retried without them
// (both then read as absent, which every caller treats as "no site": today's aibarber.org
// URLs). No imports: the bookings and store repos and lib/siteSubpages.ts use it.

export const SITE_COLS = 'site_base_url, site_look';

type PgError = { code?: string; message?: string; details?: string } | null | undefined;

/** Postgres undefined_column (42703) or PostgREST's schema-cache miss (PGRST204/PGRST200) naming a 011 column. */
export function isMissingSiteColumn(e: PgError): boolean {
  if (!e) return false;
  const text = `${e.message ?? ''} ${e.details ?? ''}`;
  const namesOne = /site_base_url|site_look/.test(text);
  return (e.code === '42703' || e.code === 'PGRST204' || e.code === 'PGRST200') && namesOne;
}

let warned = false;

/**
 * Run a read with `base, site_base_url, site_look`; if the 011 columns are missing, run it again
 * with `base` only. `run` must be a read (it may be called twice).
 */
export async function withSiteCols<R extends { error: PgError }>(base: string, run: (cols: string) => PromiseLike<R>): Promise<R> {
  const first = await run(`${base}, ${SITE_COLS}`);
  if (!isMissingSiteColumn(first.error)) return first;
  if (!warned) {
    warned = true;
    console.warn('[ab_shops] site_base_url/site_look missing (migration 011 not applied); reading shops without them');
  }
  return run(base);
}
