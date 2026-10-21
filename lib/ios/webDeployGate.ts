// /api/deploy-site gate for slugs that belong to an iOS purchase.
//
// The browser publish path (services/publishService.ts) deploys straight to a
// slug. For web (Stripe) customers nothing changes: there is no ios_purchases
// row for their slug, and a failed lookup never blocks. Only a FOUND iOS row
// can block:
// - lapsed (lapse.ts) or taken down → 402, nothing deployed, so a web edit can't
//   bring a lapsed site back online;
// - otherwise the deploy goes ahead and, when the browser sent siteData, the
//   pending file is refreshed in the iOS shape, so a later restore (sweep) or
//   site lookup (app) brings back these web edits, not the older app copy.
import type { WebsiteData } from '../../types.js';
import { deployRenderedSite, type DeployRenderedSiteInput, type DeployRenderedSiteResult } from '../deploySite.js';
import { slugify, writePendingSite, type PendingSite } from '../publishSite.js';
import { isLapsed } from './lapse.js';
import { buildImageUrlMap, toPendingSiteData } from './pendingData.js';
import { supabasePurchases, type PurchaseRow } from './purchases.js';

export interface WebDeployDeps {
  findBySlug(slug: string): Promise<PurchaseRow | null>;
  deploy(input: DeployRenderedSiteInput): Promise<DeployRenderedSiteResult>;
  writePending(slug: string, p: PendingSite): Promise<void>;
  now(): number;
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
  input: DeployRenderedSiteInput & { siteData?: unknown },
  deps: WebDeployDeps,
): Promise<GatedDeployResult> {
  const { siteData, ...deployInput } = input;
  const slug = slugify(String(input.siteId ?? ''));

  let row: PurchaseRow | null = null;
  if (slug) {
    try {
      row = await deps.findBySlug(slug);
    } catch (e: any) {
      // Never block web customers on our own lookup failure.
      console.error(`[Deploy Site] ios_purchases lookup failed for ${slug} (continuing as web):`, e?.message || e);
    }
  }

  if (row && (row.taken_down_at != null || isLapsed(row, deps.now()))) {
    console.warn(`[Deploy Site] ${slug}: iOS subscription inactive (${row.original_transaction_id}); refusing deploy`);
    return { blocked: true };
  }

  const result = await deps.deploy(deployInput);

  if (row && siteData !== undefined) {
    // Best effort: the site is already live, and failing the request now would
    // show "Publishing Failed" for a site that deployed.
    try {
      if (!renderable(siteData)) throw new Error('siteData has an unexpected shape');
      const imageUrlMap = buildImageUrlMap(siteData);
      await deps.writePending(slug, {
        siteId: slug,
        existingSiteId: null,
        siteData: toPendingSiteData(siteData, imageUrlMap),
        imageUrlMap,
        timestamp: deps.now(),
        deployedUrl: result.deploymentUrl,
      });
    } catch (e: any) {
      console.error(`[Deploy Site] ${slug}: deployed, but refreshing the iOS pending file failed:`, e?.message || e);
    }
  }

  return { blocked: false, result };
}

export function liveWebDeployDeps(): WebDeployDeps {
  let repo: ReturnType<typeof supabasePurchases> | undefined;
  return {
    findBySlug: (slug) => (repo ??= supabasePurchases()).findBySlug(slug),
    deploy: deployRenderedSite,
    writePending: writePendingSite,
    now: () => Date.now(),
  };
}
