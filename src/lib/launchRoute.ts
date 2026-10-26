import { pullSiteOnLaunch } from '@/lib/account';
import { claimLocked } from '@/lib/claimGuard';
import { homeRoute } from '@/lib/nav';
import { loadSite } from '@/lib/siteStore';
import { LOOKUP_TIMEOUT_MS, withTimeout } from '@/lib/timeout';

/**
 * Where the app opens. A paid publish with no account (or one the server refused) comes first, before anything
 * else: the locked account step. Otherwise the Edit tab once a site exists, the importer before. Without a local
 * site, a signed-in account's app-made site is loaded first (a reinstall keeps the keychain session), for a few
 * seconds at most.
 */
export async function launchRoute(): Promise<'/edit' | '/start' | '/claim'> {
  if (await claimLocked()) return '/claim';
  const local = await loadSite();
  if (local) return homeRoute(local);
  await withTimeout(pullSiteOnLaunch(), LOOKUP_TIMEOUT_MS).catch(() => null);
  return homeRoute(await loadSite());
}
