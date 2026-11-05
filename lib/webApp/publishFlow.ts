// Web app publish (POST /api/web-app/publish). A Stripe web-app subscription entitles one site slug,
// bound in web_app_sites (never in ios_purchases, never in web_app_entitlements). The request and
// response shapes mirror POST /api/ios/publish so the web app can reuse the iOS app's screens:
//   200 { siteId, deployedUrl, republished, version, editedBy, editedAt }
//   409 { error:'site-updated', site }   400 bad-request   401 unauthorized
//   402 subscription-inactive | 403 app-store-account (not web-entitled but an App Store subscriber)            502 publish-failed   503 temporarily-unavailable | slug-exhausted | slug-bind-failed
//   409 { error:'slug-owned' }           (the slug belongs to another account / an older checkout)
import type { WebsiteData } from '../../types.js';
import type { SiteFile } from '../render/pages.js';
import {
  publishSite, REQUEST_MAX_REDEPLOYS, renderPending, bucket, readPendingSite, readPendingVersioned, writePendingSite,
  adminVersionOf, casPending, versionOf, type PendingSite, type PublishOutcome, type SiteEditor, type VersionedPending,
} from '../publishSite.js';
import { chooseSlug, makeIsTaken, urlServes, vercelProjectExists } from '../ios/slug.js';
import { buildImageUrlMap, toPendingSiteData } from '../ios/pendingData.js';
import { stripLapsedLinks } from '../ios/tiers.js';
import { isDraftLogoFolder, logoProblem, configuredBucket } from '../logoUrl.js';
import { seoProblem } from '../render/seoText.js';
import { MAX_BODY_BYTES, hasDataUrl, isObj, restoreImageUrls, validSiteData, validationProblem } from '../ios/siteShape.js';
import { supabasePurchases } from '../ios/purchases.js';
import { normEmail, supabaseSiteOwners, type SiteOwnerRow, type SiteOwnerStore } from '../siteOwners.js';
import { isEntitledStatus, keyMode, type EntitlementRow, type Interval, type Tier } from './stripeCore.js';
import { callerFrom, sbRest, stripeCall } from './webAppServer.js';
import { appStoreStateOf, type AppStoreState } from './appStoreGuard.js';

export { webAppEntitlementsOn } from './webAppServer.js';

/** Local copy of the tier -> iOS-style product id mapping (tierOf() reads these ids). 'website' is the hosting product. */
export const webProductId = (tier: Tier, interval: Interval): string =>
  `com.ibrahim1774.aibarber.${tier === 'website' ? 'hosting' : tier}.${interval === 'year' ? 'yearly' : 'monthly'}`;

export interface WebSiteRow {
  slug: string;
  stripe_subscription_id: string;
  user_id: string;
  environment: 'live' | 'test';
  published_at: string | null;
  taken_down_at: string | null;
  removed_at: string | null;
}

export interface WebPublishDeps {
  environment: 'live' | 'test';
  assertCurrent?(): Promise<void>;
  /** The signed-in account behind the Authorization header (null = invalid; throws on an outage). */
  userOf(authorization: unknown): Promise<{ id: string; email: string | null } | null>;
  /** The user's newest ENTITLED web subscription in this environment, or null. */
  entitlementOf(userId: string): Promise<EntitlementRow | null>;
  /** Read-only: is this (not web-entitled) caller an App Store subscriber? Only asked when the caller is not entitled; an error falls back to 402. */
  appStoreState?(userId: string): Promise<AppStoreState>;
  sites: {
    /** The user's bound site in this environment (newest), or null. */
    byUser(userId: string, env: 'live' | 'test'): Promise<WebSiteRow | null>;
    get(slug: string): Promise<WebSiteRow | null>;
    /** Insert unless the slug has a row. True when inserted. */
    insertIfAbsent(row: { slug: string; stripe_subscription_id: string; user_id: string; environment: 'live' | 'test' }): Promise<boolean>;
    /** Remove a never-published binding we just made (lost an ownership race). */
    releaseUnpublished(slug: string): Promise<void>;
    /** Live: stamp published_at, clear taken_down_at/removed_at, point at the current subscription. */
    markPublished(slug: string, subscriptionId: string): Promise<void>;
  };
  owners: Pick<SiteOwnerStore, 'get' | 'insertIfAbsent'>;
  isTaken(slug: string): Promise<boolean>;
  writePending(slug: string, p: PendingSite, opts?: { ifGeneration?: number | null }): Promise<void>;
  publish(slug: string, opts: { force: boolean }): Promise<PublishOutcome>;
  readPending(slug: string): Promise<PendingSite | null>;
  readPendingVersioned?(slug: string): Promise<VersionedPending>;
  render?(p: Pick<PendingSite, 'siteData' | 'imageUrlMap'>): SiteFile[];
  /** Best effort: remember the slug on the Stripe subscription metadata. */
  rememberSlug?(subscriptionId: string, slug: string): Promise<void>;
  now(): number;
}

export interface WebSiteBody {
  siteId: string;
  deployedUrl: string | null;
  siteData: WebsiteData | null;
  active: boolean;
  version: number;
  editedBy: SiteEditor | null;
  editedAt: string | null;
}

export type WebPublishResult = { status: number; body: unknown };

export const PUBLISH_CAS_ATTEMPTS = 12;
const badRequest = { status: 400, body: { error: 'bad-request' } };
const unavailable = { status: 503, body: { error: 'temporarily-unavailable' } };

export function siteBody(slug: string, pending: PendingSite | null, active: boolean): WebSiteBody {
  return {
    siteId: slug,
    deployedUrl: pending?.deployedUrl || null,
    siteData: pending?.siteData ? restoreImageUrls(pending.siteData, pending.imageUrlMap || {}) : null,
    active,
    version: versionOf(pending),
    editedBy: pending?.editedBy ?? null,
    editedAt: pending?.editedAt ?? null,
  };
}

export function validateWebSnapshot(siteData: unknown, render?: WebPublishDeps['render']) {
  if (!validSiteData(siteData) || Buffer.byteLength(JSON.stringify(siteData)) > MAX_BODY_BYTES) throw new Error('invalid_snapshot');
  const sd = siteData as WebsiteData;
  if (hasDataUrl(sd)) throw new Error('invalid_snapshot');
  let imageUrlMap: Record<string, string>;
  let pendingData: WebsiteData;
  try {
    imageUrlMap = buildImageUrlMap(sd);
    pendingData = toPendingSiteData(sd, imageUrlMap);
  } catch { throw new Error('invalid_snapshot'); }
  const problem = validationProblem(sd) ?? seoProblem(sd);
  if (problem) { console.warn(`[web-app/publish] refused before any write: ${problem}`); throw new Error('invalid_snapshot'); }
  if (sd.logo != null) {
    const logo = logoProblem(sd.logo, { bucketName: configuredBucket(), allowFolder: isDraftLogoFolder });
    if (logo) {
      console.warn(`[web-app/publish] refused before any write: ${logo}`);
      if (!logoProblem(sd.logo, { bucketName: configuredBucket() })) throw new Error('logo-folder');
      throw new Error('invalid_snapshot');
    }
  }
  try {
    (render ?? renderPending)({ siteData: pendingData, imageUrlMap });
  } catch (e) {
    console.warn(`[web-app/publish] refused before any write: the template can't render this: ${(e as Error)?.message || e}`);
    throw new Error('invalid_snapshot');
  }
  return { sd, imageUrlMap, pendingData };
}

export async function runWebPublish(
  input: { siteData?: unknown; baseVersion?: number | null },
  deps: WebPublishDeps,
  ctx: { authorization?: unknown } = {},
): Promise<WebPublishResult> {
  let raw: string;
  try { raw = JSON.stringify(input ?? null); } catch { return badRequest; }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return badRequest;
  if (!isObj(input)) return badRequest;
  const { siteData, baseVersion } = input as { siteData?: unknown; baseVersion?: unknown };
  if (!validSiteData(siteData)) return badRequest;
  if (baseVersion != null && !(Number.isInteger(baseVersion) && (baseVersion as number) >= 0)) return badRequest;
  let sd: WebsiteData, imageUrlMap: Record<string,string>, pendingData: WebsiteData;
  // Only the web endpoint and the web job reach here, so the web-origin marker (service-page text, noindex, robots.txt) is
  // stamped on the server too: an old browser tab or a client without server drafts still publishes a web site.
  try { ({ sd, imageUrlMap, pendingData } = validateWebSnapshot({ ...(siteData as object), source: 'web-app' }, deps.render)); }
  catch (e: any) { return e.message === 'logo-folder' ? { status: 400, body: { error: 'bad-request', reason: 'logo-folder' } } : badRequest; }

  try {
    // 1. Who is asking.
    let caller: { id: string; email: string | null } | null;
    try { caller = await deps.userOf(ctx.authorization); } catch { return unavailable; }
    if (!caller) return { status: 401, body: { error: 'unauthorized' } };

    // 2. A paid web subscription in this environment.
    const ent = await deps.entitlementOf(caller.id);
    if (!ent || !isEntitledStatus(ent.status) || ent.environment !== deps.environment) {
      // An App Store subscriber has nothing to pay for here: say so (409) instead of the generic 402.
      if (deps.appStoreState) {
        let st: AppStoreState = null;
        try { st = await deps.appStoreState(caller.id); } catch { st = null; }
        if (st) return { status: 403, body: { error: 'app-store-account' } };
      }
      return { status: 402, body: { error: 'subscription-inactive' } };
    }
    // 3. Tier links.
    pendingData = stripLapsedLinks(pendingData, webProductId(ent.tier, ent.billing_interval));

    await deps.assertCurrent?.();
    // 4./5. Slug + bindings.
    const existing = await deps.sites.byUser(caller.id, deps.environment);
    const wasBound = !!existing;
    const republished = !!existing?.published_at;
    let slug: string;
    let freshBind = false;
    if (existing) {
      slug = existing.slug;
    } else {
      let bound: string | null = null;
      for (let attempt = 0; attempt < 2 && !bound; attempt++) {
        let candidate: string;
        try {
          candidate = await chooseSlug(sd.shopName, deps.environment === 'live' ? 'Production' : 'Sandbox', deps.isTaken);
        } catch (e) {
          if ((e as Error)?.message === 'slug-exhausted') return { status: 503, body: { error: 'slug-exhausted' } };
          throw e;
        }
        let inserted = false;
        try {
          inserted = await deps.sites.insertIfAbsent({ slug: candidate, stripe_subscription_id: ent.stripe_subscription_id, user_id: caller.id, environment: deps.environment });
        } catch (e) {
          // A concurrent first publish by this same user bound a slug first (one live slug per user and mode,
          // migration 022): use theirs rather than creating a second site on one plan.
          const mine = await deps.sites.byUser(caller.id, deps.environment);
          if (mine) { bound = mine.slug; break; }
          throw e;
        }
        const row = await deps.sites.get(candidate);
        // Fresh only when THIS request inserted the row. A row of the same user that was already there (a simultaneous
        // publish) is shared, never released or treated as a brand-new slug.
        if (row && row.user_id === caller.id) { bound = candidate; freshBind = inserted; }
        else console.warn(`[web-app/publish] ${candidate} was bound by another account meanwhile${attempt === 0 ? '; choosing again' : ''}`);
      }
      if (!bound) return { status: 503, body: { error: 'slug-bind-failed' } };
      slug = bound;
    }

    // site_owners: bind only when free, or when the row is ours from a web-app publish. Never an old checkout's site.
    const owner = await deps.owners.get(slug);
    if (!owner) {
      if (!caller.email || !normEmail(caller.email)) return { status: 503, body: { error: 'owner-email-missing' } };
      const row: SiteOwnerRow = {
        slug, user_id: caller.id, claim_email: null, owner_email: normEmail(caller.email), source: 'checkout',
        checkout_session_id: `webapp:${ent.stripe_subscription_id}`,
      };
      await deps.owners.insertIfAbsent(row);
      const again = await deps.owners.get(slug);
      if (!again || again.user_id !== caller.id) {
        if (freshBind) await deps.sites.releaseUnpublished(slug).catch(() => {});
        return { status: 409, body: { error: 'slug-owned' } };
      }
    } else if (owner.user_id !== caller.id || (owner.checkout_session_id && !owner.checkout_session_id.startsWith('webapp:'))) {
      console.warn(`[web-app/publish] ${slug}: site_owners row belongs to another account or an older checkout; refused`);
      if (freshBind) await deps.sites.releaseUnpublished(slug).catch(() => {});
      return { status: 409, body: { error: 'slug-owned' } };
    }
    if (freshBind && deps.rememberSlug) await deps.rememberSlug(ent.stripe_subscription_id, slug).catch(() => {});

    // 6. Write the copy (compare-and-set), honouring admin versions like iOS.
    const io = { readPending: deps.readPending, writePending: deps.writePending, readPendingVersioned: deps.readPendingVersioned };
    type Refusal = { status: 409; body: { error: 'site-updated'; site: WebSiteBody } | { error: 'slug-owned' } };
    await deps.assertCurrent?.();
    const cas = await casPending<Refusal | null>(slug, io, (previous) => {
      // A slug we just bound must have no copy yet: one already there belongs to someone else (e.g. an iOS
      // publish that picked the same name in the gap). Never overwrite it.
      if (freshBind && previous !== null) return { stop: { status: 409, body: { error: 'slug-owned' } } };
      if (wasBound) {
        const lastAdmin = adminVersionOf(previous);
        if (baseVersion == null) {
          if (previous?.editedBy === 'admin' && versionOf(previous) > 0) {
            return { stop: { status: 409, body: { error: 'site-updated', site: siteBody(slug, previous, true) } } };
          }
        } else if ((baseVersion as number) < lastAdmin) {
          return { stop: { status: 409, body: { error: 'site-updated', site: siteBody(slug, previous, true) } } };
        }
      }
      const next: PendingSite = {
        siteId: slug, existingSiteId: null, siteData: pendingData, imageUrlMap, timestamp: deps.now(),
        version: versionOf(previous) + 1, editedBy: 'owner', editedAt: new Date(deps.now()).toISOString(),
      };
      const carriedAdmin = adminVersionOf(previous);
      if (carriedAdmin) next.adminVersion = carriedAdmin;
      if (previous?.deployedUrl) next.deployedUrl = previous.deployedUrl;
      return { write: next, result: null };
    }, PUBLISH_CAS_ATTEMPTS);
    if (cas.result) {
      if (freshBind && (cas.result.body as { error?: string }).error === 'slug-owned') await deps.sites.releaseUnpublished(slug).catch(() => {});
      return cas.result;
    }
    if (!cas.written) {
      return { status: 409, body: { error: 'site-updated', site: siteBody(slug, await deps.readPending(slug), true) } };
    }
    const pending = cas.written;

    await deps.assertCurrent?.();
    // 7. Deploy.
    const outcome = await deps.publish(slug, { force: wasBound });
    if (!outcome.ok) {
      console.error(`[web-app/publish] ${slug}: publish failed (${outcome.reason}) ${outcome.error || ''}`);
      return { status: 502, body: { error: 'publish-failed', reason: outcome.reason } };
    }
    // 8. Stamp (best effort; the lapse job's restore pass reconciles).
    await deps.sites.markPublished(slug, ent.stripe_subscription_id).catch((e) =>
      console.error(`[web-app/publish] ${slug}: live but markPublished failed:`, e?.message || e));

    return { status: 200, body: { siteId: slug, deployedUrl: outcome.deployedUrl, republished, version: pending.version, editedBy: 'owner', editedAt: pending.editedAt } };
  } catch (e) {
    console.error('[web-app/publish] unexpected error:', (e as Error)?.message || e);
    return unavailable;
  }
}

// ---- live wiring ----

const enc = encodeURIComponent;
const SITE_COLS = 'slug,stripe_subscription_id,user_id,environment,published_at,taken_down_at,removed_at';

export const liveWebSites = (): WebPublishDeps['sites'] => ({
  async byUser(userId, env) {
    const r = await sbRest(`web_app_sites?user_id=eq.${enc(userId)}&environment=eq.${env}&select=${SITE_COLS}&order=created_at.desc&limit=1`);
    return r?.[0] ?? null;
  },
  async get(slug) {
    const r = await sbRest(`web_app_sites?slug=eq.${enc(slug)}&select=${SITE_COLS}&limit=1`);
    return r?.[0] ?? null;
  },
  async insertIfAbsent(row) {
    const r = await sbRest('web_app_sites?on_conflict=slug', { method: 'POST', body: row, prefer: 'resolution=ignore-duplicates,return=representation' });
    return Array.isArray(r) && r.length > 0;
  },
  async releaseUnpublished(slug) {
    await sbRest(`web_app_sites?slug=eq.${enc(slug)}&published_at=is.null`, { method: 'DELETE' });
  },
  async markPublished(slug, subscriptionId) {
    const now = new Date().toISOString();
    await sbRest(`web_app_sites?slug=eq.${enc(slug)}`, {
      method: 'PATCH',
      body: { published_at: now, taken_down_at: null, removed_at: null, stripe_subscription_id: subscriptionId, updated_at: now },
    });
  },
});

export async function liveEntitlementOf(userId: string, env: 'live' | 'test'): Promise<EntitlementRow | null> {
  const r = await sbRest(`web_app_entitlements?user_id=eq.${enc(userId)}&environment=eq.${env}&status=in.(active,trialing,past_due)&order=updated_at.desc&limit=1`);
  return r?.[0] ?? null;
}

export function liveWebPublishDeps(): WebPublishDeps {
  const environment = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!environment) throw new Error('STRIPE_WEBAPP_SECRET_KEY missing or unrecognised');
  const purchases = supabasePurchases();
  const owners = supabaseSiteOwners();
  const sites = liveWebSites();
  const iosTaken = makeIsTaken({
    pendingExists: async (s) => (await readPendingSite(s)) !== null,
    repoTaken: (s) => purchases.slugTaken(s),
    projectExists: vercelProjectExists,
    prefixInUse: async (s) => (await bucket().getFiles({ prefix: `${s}/`, maxResults: 1 }))[0].length > 0,
    urlServes,
  });
  return {
    environment,
    userOf: callerFrom,
    entitlementOf: (uid) => liveEntitlementOf(uid, environment),
    appStoreState: (uid) => appStoreStateOf(uid, environment),
    sites,
    owners,
    isTaken: async (s) => (await iosTaken(s)) || !!(await owners.get(s)) || !!(await sites.get(s)),
    writePending: writePendingSite,
    publish: (slug, opts) => publishSite(slug, { ...opts, maxRedeploys: REQUEST_MAX_REDEPLOYS }),
    readPending: readPendingSite,
    readPendingVersioned,
    rememberSlug: async (subId, slug) => { await stripeCall(`subscriptions/${enc(subId)}`, { 'metadata[site_slug]': slug }); },
    now: () => Date.now(),
  };
}

/**
 * The caller's web-app site (the web twin of /api/ios/site): { siteId, deployedUrl, siteData, active, version... }.
 * 404 no-site when nothing is bound (or it was removed); `active` is false once the subscription is not entitled
 * or the lapse job took the site down. Same body shape as the iOS lookup so the app's status and restore code runs unchanged.
 */
export async function runWebSiteLookup(
  deps: Pick<WebPublishDeps, 'environment' | 'userOf' | 'sites' | 'readPending'> & { subscriptionOf(userId: string): Promise<{ status: string } | null> },
  ctx: { authorization?: unknown },
): Promise<WebPublishResult> {
  let caller: { id: string } | null;
  try { caller = await deps.userOf(ctx.authorization); } catch { return { status: 503, body: { error: 'temporarily-unavailable' } }; }
  if (!caller) return { status: 401, body: { error: ctx.authorization ? 'unauthorized' : 'auth-required' } };
  try {
    const site = await deps.sites.byUser(caller.id, deps.environment);
    if (!site || site.removed_at) return { status: 404, body: { error: 'no-site' } };
    const sub = await deps.subscriptionOf(caller.id);
    const active = !!sub && isEntitledStatus(sub.status) && !site.taken_down_at;
    return { status: 200, body: siteBody(site.slug, await deps.readPending(site.slug), active) };
  } catch (e) {
    console.error('[web-app/site] lookup failed:', (e as Error)?.message || e);
    return { status: 503, body: { error: 'temporarily-unavailable' } };
  }
}
