// /api/deploy-site gate for slugs that belong to an iOS purchase.
//
// The browser publish path (services/publishService.ts) sends today's
// shop-name slug as siteId, plus the site's current deployedUrl and siteData.
// The server picks the target:
// - deployedUrl is a *.vercel.app URL whose first label is an iOS-bound slug →
//   deploy to THAT slug (a renamed shop, or a suffixed slug like
//   fade-studio-x7k2, keeps its own link);
// - otherwise siteId exactly as before (still gated if it is iOS-bound itself).
// Web (Stripe) customers have no ios_purchases row, so nothing changes for
// them, and a failed lookup always falls back to today's behaviour. Only a
// FOUND iOS row can block, and only when it is taken down or revoked: expiry
// is Apple's call (billing grace), which the sweep makes, not this endpoint.
// When an iOS deploy goes ahead and the browser sent siteData, the pending
// file is refreshed in the iOS shape, so a later restore (sweep) or site
// lookup (app) brings back these web edits, not the older app copy.
import type { WebsiteData } from '../../types.js';
import { deployRenderedSite, type DeployRenderedSiteInput, type DeployRenderedSiteResult } from '../deploySite.js';
import { slugify, writePendingSite, type PendingSite } from '../publishSite.js';
import { buildImageUrlMap, toPendingSiteData } from './pendingData.js';
import { supabasePurchases, type PurchaseRow } from './purchases.js';
import { withTimeout } from './timeout.js';

const LOOKUP_TIMEOUT_MS = 3000;

export interface WebDeployDeps {
  findBySlug(slug: string): Promise<PurchaseRow | null>;
  /** Cap on the whole lookup phase; a slow lookup fails open like an error. Default 3000. */
  lookupTimeoutMs?: number;
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

const VERCEL_APP = '.vercel.app';

/** First host label of a *.vercel.app URL, or null. */
export function vercelAppLabel(deployedUrl: unknown): string | null {
  if (typeof deployedUrl !== 'string' || !deployedUrl) return null;
  try {
    const host = new URL(deployedUrl).hostname.toLowerCase();
    if (!host.endsWith(VERCEL_APP)) return null;
    const label = host.split('.')[0];
    return label && /^[a-z0-9-]+$/.test(label) ? slugify(label) || null : null;
  } catch {
    return null;
  }
}

export async function gatedWebDeploy(
  input: DeployRenderedSiteInput & { siteData?: unknown; deployedUrl?: unknown },
  deps: WebDeployDeps,
): Promise<GatedDeployResult> {
  const { siteData, deployedUrl, ...deployInput } = input;
  const shopSlug = slugify(String(input.siteId ?? ''));

  // Defaults are today's behaviour: deploy body.siteId, no gate.
  let target = input.siteId;
  let slug = shopSlug;
  let row: PurchaseRow | null = null;
  const lookup = async (): Promise<{ row: PurchaseRow | null; slug: string } | null> => {
    const label = vercelAppLabel(deployedUrl);
    if (label && label !== shopSlug) {
      const byLabel = await deps.findBySlug(label);
      if (byLabel) return { row: byLabel, slug: label };
    }
    return shopSlug ? { row: await deps.findBySlug(shopSlug), slug: shopSlug } : null;
  };
  try {
    // Bounded: before this gate, deploy-site never touched Supabase, so a
    // degraded (slow, not failing) Supabase must not hold up web publishes.
    const found = await withTimeout(lookup(), deps.lookupTimeoutMs ?? LOOKUP_TIMEOUT_MS, 'ios_purchases lookup');
    if (found?.row) {
      row = found.row;
      slug = found.slug;
      target = found.slug === shopSlug ? input.siteId : found.slug;
    }
  } catch (e: any) {
    // Never block or redirect web customers on our own lookup failure or timeout.
    console.error(`[Deploy Site] ios_purchases lookup failed for ${shopSlug} (continuing as web):`, e?.message || e);
    row = null;
    target = input.siteId;
    slug = shopSlug;
  }

  if (row && (row.taken_down_at != null || row.revoked_at != null)) {
    console.warn(`[Deploy Site] ${slug}: iOS site taken down or revoked (${row.original_transaction_id}); refusing deploy`);
    return { blocked: true };
  }

  if (row && target !== input.siteId) {
    console.log(`[Deploy Site] ${input.siteId}: deploying to its iOS-bound project ${slug}`);
  }
  const result = await deps.deploy({ ...deployInput, siteId: target });

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
