// /api/deploy-site: deploy to the target lib/deployAuth.ts authorised, and keep an app
// site's stored copy in step.
//
// The caller (api/deploy-site.ts) authorises first (lib/deployAuth.ts): the target slug and
// the iOS row (if any) come from there, never from the body. This module only:
// - refuses an app site that is taken down (its offline page is live; not a Sandbox row the
//   sweep only gate-closed) or revoked (402). Expiry is Apple's call (billing grace), made by
//   the sweep, not here;
// - deploys the HTML to the authorised target;
// - when the caller is the app site's verified owner and sent siteData, refreshes the
//   pending file in the iOS shape, so a later restore (sweep) or site lookup (app) brings
//   back these web edits. The admin's deploys never write the stored copy (admin content
//   edits go through /api/admin/sites, which keeps history and the version guard).
import type { WebsiteData } from '../../types.js';
import { deployRenderedSite, type DeployRenderedSiteInput, type DeployRenderedSiteResult } from '../deploySite.js';
import { adminVersionOf, readPendingSite, slugify, versionOf, writePendingSite, type PendingSite } from '../publishSite.js';
import { buildImageUrlMap, toPendingSiteData } from './pendingData.js';
import { stripLapsedLinks } from './tiers.js';
import type { PurchaseRow } from './purchases.js';
import type { DeployActor } from '../deployAuth.js';

export { vercelAppLabel } from '../deployAuth.js';

export interface WebDeployDeps {
  deploy(input: DeployRenderedSiteInput): Promise<DeployRenderedSiteResult>;
  writePending(slug: string, p: PendingSite): Promise<void>;
  /** The stored copy, so its version is carried forward (admin-edit sync). Absent: version restarts. */
  readPending?(slug: string): Promise<PendingSite | null>;
  /**
   * Web sites: stamp the live URL on the stored (pre-checkout) copy. The stamp is server-owned
   * (api/save-pending-site drops it and refuses a stamped copy), and it is what tells the
   * webhook and the publish sweeper the site is live.
   * - A stamped copy gets the new URL.
   * - An unstamped or missing copy is replaced by `fresh` (stamped) when given: the paid
   *   checkout's own content, so a copy anyone could write never survives the first deploy.
   * - Otherwise an unstamped copy is stamped as it is, and a missing one stays missing.
   */
  stampWebPending?(slug: string, deployedUrl: string, fresh?: PendingSite): Promise<void>;
  now(): number;
  /**
   * The sweep deploys offline pages for Sandbox purchases too (env IOS_TAKEDOWN_SANDBOX=1).
   * Without it, a Sandbox row's taken_down_at only closes the Bookings/Store gates and its
   * site stays up, so it must not block a web deploy. Default false.
   */
  takedownSandbox?: boolean;
}

/** What lib/deployAuth.ts authorised. */
export interface AuthorisedTarget {
  /** Slug to deploy to. */
  target: string;
  /** The iOS purchase bound to `target`, or null for a web site. */
  row: PurchaseRow | null;
  actor: DeployActor;
}

// Flat, not a discriminated union: this repo compiles with strictNullChecks off,
// where TS won't narrow on a boolean discriminant (see PublishOutcome).
export interface GatedDeployResult {
  blocked: boolean;
  /** Set when !blocked. */
  result?: DeployRenderedSiteResult;
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The shape checks publishFlow applies, so a stored pending file always renders. */
function renderable(sd: unknown): sd is WebsiteData {
  if (!isObj(sd)) return false;
  if (typeof sd.shopName !== 'string' || !sd.shopName.trim()) return false;
  if (!isObj(sd.hero) || !isObj(sd.about)) return false;
  if (!Array.isArray(sd.gallery) || !Array.isArray(sd.services)) return false;
  if (sd.craftImages != null && !Array.isArray(sd.craftImages)) return false;
  if (sd.staff != null && !Array.isArray(sd.staff)) return false;
  return true;
}

export async function gatedWebDeploy(
  input: Pick<DeployRenderedSiteInput, 'html' | 'css' | 'imageUrls'> & { siteData?: unknown; existingSiteId?: unknown },
  auth: AuthorisedTarget,
  deps: WebDeployDeps,
): Promise<GatedDeployResult> {
  const { siteData, existingSiteId, ...deployInput } = input;
  // Exactly the slug lib/deployAuth.ts authorised; never re-derived here.
  const slug = auth.target;
  if (!slug || slugify(slug) !== slug) throw new Error(`non-canonical deploy target: ${String(slug).slice(0, 80)}`);
  const row = auth.row;

  // A Sandbox row the sweep only gate-closed (no offline page) still has its site up: edits go
  // ahead, and taken_down_at stays as it is (the gates stay closed until Apple says active).
  const siteOffline = row?.taken_down_at != null && !(row.environment === 'Sandbox' && deps.takedownSandbox !== true);
  if (row && (siteOffline || row.revoked_at != null)) {
    console.warn(`[Deploy Site] ${slug}: iOS site taken down or revoked (${row.original_transaction_id}); refusing deploy`);
    return { blocked: true };
  }

  // Never `images` (raw uploads to {siteId}/{filename} in GCS): no browser path sends them, and
  // they would let a deploy write anywhere under the bucket.
  const result = await deps.deploy({ html: deployInput.html, css: deployInput.css, imageUrls: deployInput.imageUrls, siteId: slug });

  if (!row && deps.stampWebPending) {
    // Best effort: the site is already live. Only the paid checkout's deploy may supply the
    // copy's content (the same pendingSite shape the browser stored before checkout).
    const fresh: PendingSite | undefined = auth.actor === 'checkout' && renderable(siteData)
      ? {
          siteId: slug,
          siteData,
          imageUrlMap: isObj(deployInput.imageUrls) ? (deployInput.imageUrls as Record<string, string>) : {},
          existingSiteId: typeof existingSiteId === 'string' && existingSiteId ? existingSiteId.slice(0, 100) : null,
          timestamp: deps.now(),
        }
      : undefined;
    try {
      await deps.stampWebPending(slug, result.deploymentUrl, fresh);
    } catch (e: any) {
      console.warn(`[Deploy Site] ${slug}: deployed, but stamping the stored copy failed:`, e?.message || e);
    }
  }

  // Only the Apple-bound owner's web edit is the owner's copy. The admin's deploys never write it.
  if (row && auth.actor === 'app-owner' && siteData !== undefined) {
    // Best effort: the site is already live, and failing the request now would
    // show "Publishing Failed" for a site that deployed.
    try {
      if (!renderable(siteData)) throw new Error('siteData has an unexpected shape');
      const imageUrlMap = buildImageUrlMap(siteData);
      // The previous copy carries the version; if it can't be read, a refresh would restart the
      // version and could repeat a number the history already holds. Skip the refresh (the
      // stored copy stays as it was; the next app publish or admin edit brings it up to date).
      let previous: PendingSite | null = null;
      if (deps.readPending) {
        try {
          previous = await deps.readPending(slug);
        } catch (e: any) {
          console.warn(`[Deploy Site] ${slug}: deployed, but reading the previous pending file failed; not refreshing it:`, e?.message || e);
          return { blocked: false, result };
        }
      }
      const adminVersion = adminVersionOf(previous);
      await deps.writePending(slug, {
        siteId: slug,
        existingSiteId: null,
        // Same Book/Shop link strip as the app publish (Phase 4 tiers), by the stored product.
        // The browser HTML just deployed is left as sent; the gates stay authoritative, and
        // every later restore or republish renders from this stripped copy.
        siteData: stripLapsedLinks(toPendingSiteData(siteData, imageUrlMap), row.product_id),
        imageUrlMap,
        timestamp: deps.now(),
        deployedUrl: result.deploymentUrl,
        // A web edit is the owner's: same version bump as an app publish (lib/ios/publishFlow.ts).
        version: versionOf(previous) + 1,
        editedBy: 'owner',
        editedAt: new Date(deps.now()).toISOString(),
        ...(adminVersion ? { adminVersion } : {}),
      });
    } catch (e: any) {
      console.error(`[Deploy Site] ${slug}: deployed, but refreshing the iOS pending file failed:`, e?.message || e);
    }
  }

  return { blocked: false, result };
}

export function liveWebDeployDeps(): WebDeployDeps {
  return {
    deploy: deployRenderedSite,
    writePending: writePendingSite,
    readPending: readPendingSite,
    async stampWebPending(slug, deployedUrl, fresh) {
      const p = await readPendingSite(slug);
      if (p?.deployedUrl) {
        if (p.deployedUrl !== deployedUrl) await writePendingSite(slug, { ...p, deployedUrl });
      } else if (fresh) {
        await writePendingSite(slug, { ...fresh, deployedUrl });
      } else if (p) {
        await writePendingSite(slug, { ...p, deployedUrl });
      }
    },
    now: () => Date.now(),
    takedownSandbox: process.env.IOS_TAKEDOWN_SANDBOX === '1',
  };
}
