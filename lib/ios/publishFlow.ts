// iOS publish path: an App Store subscription, verified with Apple, entitles
// exactly one site slug. The first publish picks a slug nobody else uses and
// binds it to the purchase; every later publish (rename, edits) redeploys that
// same slug. Nobody without a currently active subscription for the purchase
// can change the site.
//
// Pure flow over injected deps so it is testable without Apple, Supabase, GCS
// or Vercel; liveDeps() wires the real ones for the api/ios/* handlers.
import type { WebsiteData } from '../../types.js';
import {
  publishSite,
  renderPending,
  readPendingSite,
  readPendingVersioned,
  writePendingSite,
  adminVersionOf,
  casPending,
  versionOf,
  type PendingSite,
  type PublishOutcome,
  type SiteEditor,
  type VersionedPending,
} from '../publishSite.js';
import { VerifyFailure, isActive, lazyDefaultVerifier, type VerifiedTx } from './appleVerify.js';
import { supabasePurchases, type PurchasesRepo } from './purchases.js';
import { createClient } from '@supabase/supabase-js';
import { chooseSlug, makeIsTaken, urlServes, vercelProjectExists } from './slug.js';
import { buildImageUrlMap, toPendingSiteData } from './pendingData.js';
import { stripLapsedLinks } from './tiers.js';
import { MAX_BODY_BYTES, hasDataUrl, isObj, restoreImageUrls, validSiteData, validationProblem } from './siteShape.js';

export { buildImageUrlMap, toPendingSiteData };

export interface IosPublishInput {
  transactionId: string;
  siteData: WebsiteData;
  userId?: string | null;
  /**
   * The server `version` the app's copy was last synced to (GET-equivalent POST /api/ios/site,
   * or a publish response). Older than the last admin edit → 409 site-updated. Absent on app
   * builds from before versioning: those still publish (logged).
   */
  baseVersion?: number | null;
}

/** The stored site as the app sees it: the site lookup body, and `site` in a 409 site-updated. */
export interface IosSiteBody {
  siteId: string;
  deployedUrl: string | null;
  siteData: WebsiteData | null;
  active: boolean;
  /** Bumped on every stored write (owner publish or admin edit). 0 = stored before versioning. */
  version: number;
  editedBy: SiteEditor | null;
  /** ISO time of the write that produced `version`. */
  editedAt: string | null;
}

export type IosPublishResult =
  | {
      status: 200;
      body: { siteId: string; deployedUrl: string; republished: boolean; version: number; editedBy: SiteEditor; editedAt: string };
    }
  | { status: 409; body: { error: 'site-updated'; site: IosSiteBody } }
  | { status: 400 | 402 | 404 | 502 | 503; body: { error: string; reason?: string } };

export type IosSiteLookupResult =
  | { status: 200; body: IosSiteBody }
  | { status: 404 | 503; body: { error: string } };

export interface PublishDeps {
  verify(transactionId: string): Promise<VerifiedTx>;
  repo: PurchasesRepo;
  isTaken(slug: string): Promise<boolean>;
  /** With `ifGeneration`: compare-and-set (throws a 412 PendingConflictError when the copy changed). */
  writePending(slug: string, p: PendingSite, opts?: { ifGeneration?: number | null }): Promise<void>;
  publish(slug: string, opts: { force: boolean }): Promise<PublishOutcome>;
  readPending(slug: string): Promise<PendingSite | null>;
  /** The stored copy with its GCS generation (compare-and-set). Absent: unconditional writes (older fakes). */
  readPendingVersioned?(slug: string): Promise<VersionedPending>;
  /**
   * The Supabase account behind a bearer token (null when the token is not valid; throws on an
   * outage). The only way a publish links the purchase to an account (e2e I6). Absent: no link.
   */
  userOf?(token: string): Promise<{ id: string } | null>;
  /** Dry render before storing (lib/publishSite.ts renderPending). Throws on unrenderable data. */
  render?(p: Pick<PendingSite, 'siteData' | 'imageUrlMap'>): string;
  now(): number;
}

/**
 * Phone publishes racing each other (a tap storm, a retry) re-decide on the fresh copy; each
 * attempt is a new version. Bounded: past this the publish answers 409 site-updated.
 */
export const PUBLISH_CAS_ATTEMPTS = 12;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The lookup / 409 body for a stored copy. */
function siteBody(slug: string, pending: PendingSite | null, active: boolean): IosSiteBody {
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

const VERIFY_STATUS = { 'not-found': 404, 'bad-bundle': 400, 'bad-product': 400, 'apple-unavailable': 503 } as const;

function validInput(input: unknown): input is IosPublishInput {
  if (!isObj(input)) return false;
  const { transactionId, siteData, userId, baseVersion } = input;
  if (typeof transactionId !== 'string' || !transactionId.trim()) return false;
  // Shape checks for everything the pending transform and renderers touch, so
  // a malformed payload is a 400 before anything is verified or written.
  if (!validSiteData(siteData)) return false;
  if (userId != null && typeof userId !== 'string') return false;
  if (baseVersion != null && !(Number.isInteger(baseVersion) && baseVersion >= 0)) return false;
  return true;
}

const badRequest = { status: 400 as const, body: { error: 'bad-request' } };
const unavailable = { status: 503 as const, body: { error: 'temporarily-unavailable' } };

/** Request context that is not part of the JSON body. */
export interface IosPublishContext {
  /** The Authorization header (Bearer <Supabase access token>), if the app sent one. */
  authorization?: unknown;
}

const bearer = (h: unknown): string => {
  const v = Array.isArray(h) ? h[0] : h;
  return (typeof v === 'string' ? v : '').replace(/^Bearer\s+/i, '').trim();
};

export async function runIosPublish(input: IosPublishInput, deps: PublishDeps, ctx: IosPublishContext = {}): Promise<IosPublishResult> {
  // Size + data-URL checks before anything else: the app must upload images
  // first and send URLs, never inline base64.
  let raw: string;
  try {
    raw = JSON.stringify(input ?? null);
  } catch {
    return badRequest;
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return badRequest;
  if (!validInput(input)) return badRequest;
  const sd = input.siteData;
  if (hasDataUrl(sd)) return badRequest;
  // Build the pending payload up front: any shape problem surfaces here as a
  // 400, never after a slug has been bound.
  let imageUrlMap: Record<string, string>;
  let pendingData: WebsiteData;
  try {
    imageUrlMap = buildImageUrlMap(sd);
    pendingData = toPendingSiteData(sd, imageUrlMap);
  } catch {
    return badRequest;
  }
  // Same checks and dry render as an admin save (e2e I3): the stored copy is replaced BEFORE
  // the deploy renders it, so data the templates can't render (no contact, about.description
  // as a string from an old build, ...) would destroy the last good copy. Refused here, before
  // Apple is asked and before anything is written.
  const problem = validationProblem(sd);
  if (problem) {
    console.warn(`[ios/publish] refused before any write: ${problem}`);
    return badRequest;
  }
  try {
    (deps.render ?? renderPending)({ siteData: pendingData, imageUrlMap });
  } catch (e) {
    console.warn(`[ios/publish] refused before any write: the template can't render this: ${(e as Error)?.message || e}`);
    return badRequest;
  }

  let tx: VerifiedTx;
  // When Apple was asked: a revocation stored before this is superseded by an active answer.
  const checkedAt = deps.now();
  try {
    tx = await deps.verify(input.transactionId.trim());
  } catch (e) {
    if (e instanceof VerifyFailure) return { status: VERIFY_STATUS[e.code], body: { error: e.code } };
    console.error('[ios/publish] verify threw unexpectedly:', (e as Error)?.message || e);
    return { status: 503, body: { error: 'apple-unavailable' } };
  }
  if (!isActive(tx, deps.now())) return { status: 402, body: { error: 'subscription-inactive' } };
  // Phase 4 tiers, server-side so old app builds can't bypass it: the AI Barber Book link
  // needs the bookings entitlement and the Shop link the store one, by the verified
  // (latest) product. Any of the six products may publish.
  pendingData = stripLapsedLinks(pendingData, tx.productId);

  // Every repo call is keyed on Apple's originalTransactionId, never the
  // transactionId the app sent (renewals have new transactionIds).
  const otid = tx.originalTransactionId;
  try {
    const row = await deps.repo.upsertVerified(tx, { checkedAt });

    // Account link (e2e I6). The body's userId is never trusted: anyone with the transaction id
    // could name any account and re-point the purchase, locking the real owner out of
    // /api/shop/plan and /api/shop/setup (409 purchase-in-use). Only a verified Supabase bearer
    // links, and only a purchase with no account yet (conditional in SQL); an existing owner is
    // changed only by the relink rules in /api/shop/plan. Best effort: never blocks a paid publish.
    const token = bearer(ctx.authorization);
    if (token && deps.userOf && deps.repo.setUserIfUnlinked) {
      try {
        const user = await deps.userOf(token);
        if (user?.id && UUID_RE.test(user.id)) {
          const linked = await deps.repo.setUserIfUnlinked(otid, user.id);
          if (!linked && row.user_id && row.user_id !== user.id) {
            console.warn(`[ios/publish] ${otid}: already linked to another account; not re-pointed`);
          }
        }
      } catch (e: any) {
        console.warn(`[ios/publish] ${otid}: account link failed (ignored):`, e?.message || e);
      }
    } else if (typeof input.userId === 'string' && input.userId) {
      console.log(`[ios/publish] ${otid}: body userId ignored (only a verified bearer links an account)`);
    }

    // "republished" means the site was live before; any bound slug is force-deployed.
    const republished = !!row.published_at;
    let slug: string;
    let force: boolean;
    const wasBound = !!row.site_slug;
    if (row.site_slug) {
      // Bound slug is permanent, whatever the shop is now called.
      slug = row.site_slug;
      force = true;
    } else {
      force = false;
      // Two attempts (e2e M10): when another purchase binds the same name at the same moment,
      // the loser (still unbound) picks again inside this request (the taken name now shows as
      // taken, so it gets a suffix) instead of answering 503 for the app to retry.
      let bound: string | null = null;
      for (let attempt = 0; attempt < 2 && !bound; attempt++) {
        let candidate: string;
        try {
          candidate = await chooseSlug(sd.shopName, tx.environment, deps.isTaken);
        } catch (e) {
          if ((e as Error)?.message === 'slug-exhausted') return { status: 503, body: { error: 'slug-exhausted' } };
          throw e;
        }
        if (await deps.repo.bindSlug(otid, candidate)) {
          bound = candidate;
          break;
        }
        // A concurrent request for THIS purchase bound first: publish onto its slug.
        const again = await deps.repo.get(otid);
        if (again?.site_slug) bound = again.site_slug;
        else console.warn(`[ios/publish] ${otid}: ${candidate} was bound by another purchase meanwhile${attempt === 0 ? '; choosing again' : ''}`);
      }
      if (!bound) return { status: 503, body: { error: 'slug-bind-failed' } };
      slug = bound;
    }

    // Compare-and-set on the stored copy (e2e I1): read it with its generation, decide, write
    // only if nobody wrote in between. A lost race re-reads and decides again on the fresh copy:
    // an admin edit that landed meanwhile is caught by the same 409 rule as one that landed
    // before (the phone gets the server copy to adopt; nothing is overwritten), while another
    // owner publish of this purchase (a tap storm, a retry) is simply the copy this one builds
    // on, as the next version. Version numbers are never reused.
    const io = { readPending: deps.readPending, writePending: deps.writePending, readPendingVersioned: deps.readPendingVersioned };
    type Refusal = { status: 409; body: { error: 'site-updated'; site: IosSiteBody } };
    const cas = await casPending<Refusal | null>(slug, io, (previous) => {
      if (wasBound) {
        // Admin edits (lib/admin/sites.ts) must never be silently overwritten by a phone that
        // missed the sync: a publish based on a copy older than the last admin edit is refused
        // with the server copy so the app can adopt it. Only after Apple verified the caller.
        const lastAdmin = adminVersionOf(previous);
        if (input.baseVersion == null) {
          // No baseVersion (an app record from before versioning) counts as 0: refused only while
          // the stored copy itself is an admin edit. A copy with no version never refuses.
          console.warn(`[ios/publish] ${slug}: publish without baseVersion; stored v${versionOf(previous)} by ${previous?.editedBy || 'unknown'}`);
          if (previous?.editedBy === 'admin' && versionOf(previous) > 0) {
            console.warn(`[ios/publish] ${slug}: no baseVersion over admin v${versionOf(previous)}: site-updated`);
            return { stop: { status: 409, body: { error: 'site-updated', site: siteBody(slug, previous, true) } } };
          }
        } else if (input.baseVersion < lastAdmin) {
          console.warn(`[ios/publish] ${slug}: baseVersion ${input.baseVersion} < admin v${lastAdmin}: site-updated`);
          return { stop: { status: 409, body: { error: 'site-updated', site: siteBody(slug, previous, true) } } };
        }
      }
      const next: PendingSite = {
        siteId: slug,
        existingSiteId: null,
        siteData: pendingData,
        imageUrlMap,
        timestamp: deps.now(),
        version: versionOf(previous) + 1,
        editedBy: 'owner',
        editedAt: new Date(deps.now()).toISOString(),
      };
      // Carried forward so a stale phone is still refused after the owner adopted the admin edit.
      const carriedAdmin = adminVersionOf(previous);
      if (carriedAdmin) next.adminVersion = carriedAdmin;
      // Keep the last live URL so a failed redeploy doesn't lose it for the site lookup.
      if (previous?.deployedUrl) next.deployedUrl = previous.deployedUrl;
      return { write: next, result: null };
    }, PUBLISH_CAS_ATTEMPTS);
    if (cas.result) return cas.result;
    if (!cas.written) {
      // The copy kept changing under this publish: hand the app the latest copy to adopt.
      console.warn(`[ios/publish] ${slug}: the stored copy kept changing; site-updated`);
      return { status: 409, body: { error: 'site-updated', site: siteBody(slug, await deps.readPending(slug), true) } };
    }
    const pending = cas.written;

    const outcome = await deps.publish(slug, { force });
    if (!outcome.ok) {
      console.error(`[ios/publish] ${slug}: publish failed (${outcome.reason}) ${outcome.error || ''}`);
      return { status: 502, body: { error: 'publish-failed', reason: outcome.reason } };
    }

    // The site is live. If stamping fails, the sweeper reconciles it (its
    // publish is idempotent); a 503 here would only make the app redeploy.
    await deps.repo.markPublished(otid).catch((e) =>
      console.error(`[ios/publish] ${slug}: live but markPublished failed:`, e?.message || e));

    // A bound slug was just force-redeployed with real content, so it no longer
    // shows the offline page (the resubscribe path). Cleared on every bound
    // republish, not only when the row we read had the flag: a sweep takedown
    // can land between that read and this deploy. Best effort: if it fails, the
    // sweep's restore pass redeploys the same content and clears it.
    if (force) {
      await deps.repo.clearTakenDown(otid).catch((e) =>
        console.error(`[ios/publish] ${slug}: live but clearTakenDown failed:`, e?.message || e));
    }

    return { status: 200, body: { siteId: slug, deployedUrl: outcome.deployedUrl, republished, version: pending.version, editedBy: 'owner', editedAt: pending.editedAt } };
  } catch (e) {
    console.error(`[ios/publish] ${otid}: unexpected error:`, (e as Error)?.message || e);
    return unavailable;
  }
}

export async function runIosSiteLookup(
  transactionId: string,
  deps: Pick<PublishDeps, 'verify' | 'repo' | 'readPending' | 'now'>,
): Promise<IosSiteLookupResult> {
  let tx: VerifiedTx;
  try {
    tx = await deps.verify(transactionId);
  } catch (e) {
    if (e instanceof VerifyFailure) {
      return { status: e.code === 'apple-unavailable' ? 503 : 404, body: { error: e.code } };
    }
    console.error('[ios/site] verify threw unexpectedly:', (e as Error)?.message || e);
    return { status: 503, body: { error: 'apple-unavailable' } };
  }
  try {
    const row = await deps.repo.get(tx.originalTransactionId);
    if (!row?.site_slug) return { status: 404, body: { error: 'no-site' } };
    const pending = await deps.readPending(row.site_slug);
    return { status: 200, body: siteBody(row.site_slug, pending, isActive(tx, deps.now())) };
  } catch (e) {
    console.error(`[ios/site] ${tx.originalTransactionId}: unexpected error:`, (e as Error)?.message || e);
    return unavailable;
  }
}

/** Real dependencies for the api/ios/* handlers. */
export function liveDeps(): PublishDeps {
  const repo = supabasePurchases();
  return {
    // Lazy: defaultVerifier() throws when Apple env vars are missing, and that
    // must surface as a mapped 503, not an uncaught 500.
    verify: lazyDefaultVerifier(),
    repo,
    // Pending file, repo and Vercel project lookup are authoritative: their errors
    // propagate (→ 503). urlServes fails open (false) on network errors by design.
    isTaken: makeIsTaken({
      pendingExists: async (s) => (await readPendingSite(s)) !== null,
      repoTaken: (s) => repo.slugTaken(s),
      projectExists: vercelProjectExists,
      urlServes,
    }),
    writePending: writePendingSite,
    publish: (slug, opts) => publishSite(slug, opts),
    readPending: readPendingSite,
    readPendingVersioned,
    userOf: liveUserOf,
    now: () => Date.now(),
  };
}

/** A Supabase access token's user (service role). Invalid / expired token: null; outage: throws. */
async function liveUserOf(token: string): Promise<{ id: string } | null> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  const { data, error } = await createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).auth.getUser(token);
  if (error) {
    const status = (error as any).status;
    if (typeof status === 'number' && status >= 400 && status < 500) return null;
    throw new Error(`auth.getUser failed: ${error.message}`);
  }
  return data?.user ? { id: data.user.id } : null;
}
