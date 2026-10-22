// The ONE place a site's custom domain is switched on or off (spec 2026-10-22-custom-domains).
// lib/ios/domainFlow.ts calls onDomainLinked once the domain is attached to the site's Vercel
// project, and onDomainUnlinked once it has been removed at the end of the paid period.
//
// Each hook (1) records the site's public base URL through `setSiteBaseUrl` and (2) republishes
// the site so its emails, payment returns and Book/Shop pages use it.
//
// site-subpages (ab_shops.site_base_url, migration 011, customerBase(shop)) plugs in at
// `setSiteBaseUrl`: set ab_shops.site_base_url = 'https://{domain}' for the shop whose ios_otid is
// the purchase bound to `slug` (ios_purchases.site_slug = slug), and null on unlink, so
// customerBase(shop) falls back to the vercel.app address. Until then it is a no-op here.
//
// Republish rules mirror the admin republish (lib/admin/sites.ts): never deploy content over the
// offline page (revoked, taken down except a Sandbox row the sweep only gate-closed, or expired),
// and strip the Book/Shop links the site's CURRENT plan doesn't cover. A failed deploy throws, so
// the domain state machine retries the step.
import type { PurchaseRow } from './purchases.js';
import type { PendingSite, PublishOutcome } from '../publishSite.js';
import { stripLapsedLinks } from './tiers.js';

export interface DomainHookDeps {
  findBySlug(slug: string): Promise<PurchaseRow | null>;
  readPending(slug: string): Promise<PendingSite | null>;
  publish(slug: string, opts: { force: boolean; pending?: PendingSite }): Promise<PublishOutcome>;
  /** Where the public base URL lives (site-subpages: ab_shops.site_base_url). Absent: nothing stored. */
  setSiteBaseUrl?(slug: string, baseUrl: string | null): Promise<void>;
  now(): number;
  /** Same switch as the sweep (IOS_TAKEDOWN_SANDBOX=1). */
  takedownSandbox?: boolean;
}

export type HookOutcome = 'republished' | 'site-offline' | 'no-site' | 'no-copy';

function offline(row: PurchaseRow, deps: DomainHookDeps): boolean {
  if (row.revoked_at) return true;
  if (row.taken_down_at && !(row.environment === 'Sandbox' && deps.takedownSandbox !== true)) return true;
  if (row.expires_at && Date.parse(row.expires_at) <= deps.now()) return true;
  return false;
}

async function republish(slug: string, deps: DomainHookDeps): Promise<HookOutcome> {
  const row = await deps.findBySlug(slug);
  if (!row?.site_slug) return 'no-site';
  // The offline page stays; the next restore (sweep) publishes with the new address.
  if (offline(row, deps)) return 'site-offline';
  const pending = await deps.readPending(row.site_slug);
  if (!pending?.siteData) return 'no-copy';
  const outcome = await deps.publish(row.site_slug, {
    force: true,
    pending: { ...pending, siteData: stripLapsedLinks(pending.siteData, row.product_id) },
  });
  if (!outcome.ok) throw new Error(`publish-failed: ${outcome.reason || 'unknown'}`);
  return 'republished';
}

export function makeDomainHooks(deps: DomainHookDeps) {
  return {
    async onDomainLinked(slug: string, domain: string): Promise<HookOutcome> {
      if (deps.setSiteBaseUrl) await deps.setSiteBaseUrl(slug, `https://${domain}`);
      return republish(slug, deps);
    },
    async onDomainUnlinked(slug: string): Promise<HookOutcome> {
      if (deps.setSiteBaseUrl) await deps.setSiteBaseUrl(slug, null);
      return republish(slug, deps);
    },
  };
}
