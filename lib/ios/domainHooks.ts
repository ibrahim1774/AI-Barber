// The ONE place a site's custom domain is switched on or off (spec 2026-10-22-custom-domains).
// lib/ios/domainFlow.ts calls onDomainLinked once the domain is attached to the site's Vercel
// project, and onDomainUnlinked once it has been removed at the end of the paid period.
//
// Each hook republishes the site. lib/publishSite.ts then runs site-subpages' refreshSiteBase,
// which derives ab_shops.site_base_url from the PROJECT's verified domains: the custom domain
// once Vercel reports its DNS correctly pointed, else the project's own *.vercel.app. So:
// - link: the base follows the domain as soon as its DNS is correct (the domain sweep republishes
//   once more at that moment, lib/ios/domainFlow.ts pass 6);
// - unlink: the domain was removed from the project first, so the base falls back to vercel.app.
// When the site is NOT republished (it shows the offline page, or has no stored copy), the base
// is still refreshed directly (`refreshBase`), so emails and payment returns never keep pointing
// at a detached domain.
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
  /**
   * Refresh the shop's public base from the project's domains without deploying (site-subpages:
   * findShopForSite + refreshSiteBase). Used only when the site is not republished.
   */
  refreshBase?(slug: string): Promise<unknown>;
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
  async function run(slug: string): Promise<HookOutcome> {
    const out = await republish(slug, deps);
    // publishSite refreshed the base itself; otherwise do it here (a lookup error throws: retried).
    if (out !== 'republished' && deps.refreshBase) await deps.refreshBase(slug);
    return out;
  }
  return {
    onDomainLinked: (slug: string, _domain: string) => run(slug),
    onDomainUnlinked: (slug: string) => run(slug),
  };
}

/** site-subpages' base refresh for a slug, without a deploy (no shop → nothing to do). */
export function makeRefreshBase(d: {
  findShop(slug: string): Promise<{ id: string } | null>;
  refreshSiteBase(input: { shopId: string; projectName: string }, deps: any): Promise<string | null>;
  siteBaseDeps: unknown;
  projectFor(slug: string): string;
}) {
  return async (slug: string) => {
    const shop = await d.findShop(slug);
    if (!shop) return null;
    return d.refreshSiteBase({ shopId: shop.id, projectName: d.projectFor(slug) }, d.siteBaseDeps);
  };
}
