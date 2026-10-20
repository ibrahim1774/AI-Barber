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
  readPendingSite,
  writePendingSite,
  type PendingSite,
  type PublishOutcome,
} from '../publishSite.js';
import { VerifyFailure, defaultVerifier, isActive, type VerifiedTx } from './appleVerify.js';
import { supabasePurchases, type PurchasesRepo } from './purchases.js';
import { chooseSlug, makeIsTaken, urlServes } from './slug.js';

export interface IosPublishInput {
  transactionId: string;
  siteData: WebsiteData;
  userId?: string | null;
}

export type IosPublishResult =
  | { status: 200; body: { siteId: string; deployedUrl: string; republished: boolean } }
  | { status: 400 | 402 | 404 | 502 | 503; body: { error: string; reason?: string } };

export type IosSiteLookupResult =
  | { status: 200; body: { siteId: string; deployedUrl: string | null; siteData: WebsiteData | null; active: boolean } }
  | { status: 404 | 503; body: { error: string } };

export interface PublishDeps {
  verify(transactionId: string): Promise<VerifiedTx>;
  repo: PurchasesRepo;
  isTaken(slug: string): Promise<boolean>;
  writePending(slug: string, p: PendingSite): Promise<void>;
  publish(slug: string, opts: { force: boolean }): Promise<PublishOutcome>;
  readPending(slug: string): Promise<PendingSite | null>;
  now(): number;
}

const MAX_BODY_BYTES = 3 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isHttp = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Image slots that already hold an http(s) URL, keyed the way the renderer/deployer expects. */
export function buildImageUrlMap(sd: WebsiteData): Record<string, string> {
  const map: Record<string, string> = {};
  if (isHttp(sd.hero?.imageUrl)) map.hero = sd.hero.imageUrl;
  if (isHttp(sd.about?.imageUrl)) map.about = sd.about.imageUrl;
  (sd.gallery || []).forEach((u, i) => { if (isHttp(u)) map[`gallery${i}`] = u; });
  (sd.craftImages || []).forEach((u, i) => { if (isHttp(u)) map[`craft${i}`] = u; });
  (sd.staff || []).forEach((s, i) => { if (isHttp(s?.photo)) map[`staff${i}`] = s.photo; });
  return map;
}

/** Same transform as GeneratedWebsite.tsx preparePendingSite: 'uploaded' markers, service images cleared. */
export function toPendingSiteData(sd: WebsiteData, map: Record<string, string>): WebsiteData {
  return {
    ...sd,
    hero: { ...sd.hero, imageUrl: map['hero'] ? 'uploaded' : '' },
    about: { ...sd.about, imageUrl: map['about'] ? 'uploaded' : '' },
    gallery: (sd.gallery || []).map((_, i) => (map[`gallery${i}`] ? 'uploaded' : '')),
    craftImages: (sd.craftImages || []).map((_, i) => (map[`craft${i}`] ? 'uploaded' : '')),
    services: (sd.services || []).map((s) => ({ ...s, imageUrl: '' })),
    staff: (sd.staff || []).map((s, i) => ({
      ...s,
      photo: map[`staff${i}`] ? 'uploaded' : (s?.photo?.startsWith?.('http') ? s.photo : ''),
    })),
  };
}

/** Inverse of toPendingSiteData for the image slots: 'uploaded' markers back to real URLs. */
function restoreImageUrls(sd: WebsiteData, map: Record<string, string>): WebsiteData {
  const back = (v: string | undefined, key: string) => (v === 'uploaded' ? map[key] || '' : v);
  return {
    ...sd,
    hero: sd.hero ? { ...sd.hero, imageUrl: back(sd.hero.imageUrl, 'hero') } : sd.hero,
    about: sd.about ? { ...sd.about, imageUrl: back(sd.about.imageUrl, 'about') } : sd.about,
    gallery: (sd.gallery || []).map((v, i) => back(v, `gallery${i}`)),
    craftImages: sd.craftImages ? sd.craftImages.map((v, i) => back(v, `craft${i}`)) : sd.craftImages,
    staff: sd.staff ? sd.staff.map((s, i) => ({ ...s, photo: back(s.photo, `staff${i}`) })) : sd.staff,
  };
}

const VERIFY_STATUS = { 'not-found': 404, 'bad-bundle': 400, 'bad-product': 400, 'apple-unavailable': 503 } as const;

function validInput(input: unknown): input is IosPublishInput {
  if (!isObj(input)) return false;
  const { transactionId, siteData, userId } = input;
  if (typeof transactionId !== 'string' || !transactionId.trim()) return false;
  if (!isObj(siteData) || typeof siteData.shopName !== 'string' || !siteData.shopName.trim()) return false;
  // Shape checks for everything the pending transform and renderers touch, so
  // a malformed payload is a 400 before anything is verified or written.
  if (!isObj(siteData.hero) || !isObj(siteData.about)) return false;
  if (!Array.isArray(siteData.gallery) || !Array.isArray(siteData.services)) return false;
  if (siteData.craftImages != null && !Array.isArray(siteData.craftImages)) return false;
  if (siteData.staff != null && !Array.isArray(siteData.staff)) return false;
  if (userId != null && typeof userId !== 'string') return false;
  return true;
}

/** True if any string value, at any depth, is a data: URL (inline image bytes). */
function hasDataUrl(v: unknown): boolean {
  if (typeof v === 'string') return /^\s*data:/i.test(v);
  if (Array.isArray(v)) return v.some(hasDataUrl);
  if (isObj(v)) return Object.values(v).some(hasDataUrl);
  return false;
}

const badRequest = { status: 400 as const, body: { error: 'bad-request' } };
const unavailable = { status: 503 as const, body: { error: 'temporarily-unavailable' } };

export async function runIosPublish(input: IosPublishInput, deps: PublishDeps): Promise<IosPublishResult> {
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

  let tx: VerifiedTx;
  try {
    tx = await deps.verify(input.transactionId.trim());
  } catch (e) {
    if (e instanceof VerifyFailure) return { status: VERIFY_STATUS[e.code], body: { error: e.code } };
    console.error('[ios/publish] verify threw unexpectedly:', (e as Error)?.message || e);
    return { status: 503, body: { error: 'apple-unavailable' } };
  }
  if (!isActive(tx, deps.now())) return { status: 402, body: { error: 'subscription-inactive' } };

  // Every repo call is keyed on Apple's originalTransactionId, never the
  // transactionId the app sent (renewals have new transactionIds).
  const otid = tx.originalTransactionId;
  try {
    const row = await deps.repo.upsertVerified(tx);

    // Unauthenticated, best-effort account link: never blocks a paid publish.
    if (typeof input.userId === 'string' && UUID_RE.test(input.userId)) {
      await deps.repo.setUser(otid, input.userId).catch((e) =>
        console.warn(`[ios/publish] ${otid}: setUser failed (ignored):`, e?.message || e));
    }

    // "republished" means the site was live before; any bound slug is force-deployed.
    const republished = !!row.published_at;
    let slug: string;
    let force: boolean;
    let previous: PendingSite | null = null;
    if (row.site_slug) {
      // Bound slug is permanent, whatever the shop is now called.
      slug = row.site_slug;
      force = true;
      previous = await deps.readPending(slug);
    } else {
      force = false;
      let candidate: string;
      try {
        candidate = await chooseSlug(sd.shopName, tx.environment, deps.isTaken);
      } catch (e) {
        if ((e as Error)?.message === 'slug-exhausted') return { status: 503, body: { error: 'slug-exhausted' } };
        throw e;
      }
      if (await deps.repo.bindSlug(otid, candidate)) {
        slug = candidate;
      } else {
        // A concurrent request for this purchase bound first: publish onto its slug.
        const again = await deps.repo.get(otid);
        if (!again?.site_slug) return { status: 503, body: { error: 'slug-bind-failed' } };
        slug = again.site_slug;
      }
    }

    const pending: PendingSite = {
      siteId: slug,
      existingSiteId: null,
      siteData: pendingData,
      imageUrlMap,
      timestamp: deps.now(),
    };
    // Keep the last live URL so a failed redeploy doesn't lose it for the site lookup.
    if (previous?.deployedUrl) pending.deployedUrl = previous.deployedUrl;
    await deps.writePending(slug, pending);

    const outcome = await deps.publish(slug, { force });
    if (!outcome.ok) {
      console.error(`[ios/publish] ${slug}: publish failed (${outcome.reason}) ${outcome.error || ''}`);
      return { status: 502, body: { error: 'publish-failed', reason: outcome.reason } };
    }

    // The site is live. If stamping fails, the sweeper reconciles it (its
    // publish is idempotent); a 503 here would only make the app redeploy.
    await deps.repo.markPublished(otid).catch((e) =>
      console.error(`[ios/publish] ${slug}: live but markPublished failed:`, e?.message || e));

    return { status: 200, body: { siteId: slug, deployedUrl: outcome.deployedUrl, republished } };
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
    return {
      status: 200,
      body: {
        siteId: row.site_slug,
        deployedUrl: pending?.deployedUrl || null,
        siteData: pending?.siteData ? restoreImageUrls(pending.siteData, pending.imageUrlMap || {}) : null,
        active: isActive(tx, deps.now()),
      },
    };
  } catch (e) {
    console.error(`[ios/site] ${tx.originalTransactionId}: unexpected error:`, (e as Error)?.message || e);
    return unavailable;
  }
}

/** Real dependencies for the api/ios/* handlers. */
export function liveDeps(): PublishDeps {
  const repo = supabasePurchases();
  // Lazy: defaultVerifier() throws when Apple env vars are missing, and that
  // must surface as a mapped 503, not an uncaught 500.
  let verifier: ((id: string) => Promise<VerifiedTx>) | undefined;
  return {
    verify: (id) => {
      try {
        verifier ??= defaultVerifier();
      } catch (e) {
        return Promise.reject(e);
      }
      return verifier(id);
    },
    repo,
    // Pending file and repo are authoritative: their errors propagate (→ 503).
    // urlServes fails open (false) on network errors by design.
    isTaken: makeIsTaken({
      pendingExists: async (s) => (await readPendingSite(s)) !== null,
      repoTaken: (s) => repo.slugTaken(s),
      urlServes,
    }),
    writePending: writePendingSite,
    publish: (slug, opts) => publishSite(slug, opts),
    readPending: readPendingSite,
    now: () => Date.now(),
  };
}
