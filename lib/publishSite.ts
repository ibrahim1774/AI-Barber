// Publish a paid site, server-side, without the customer's browser.
//
// Until now the only code that could build and deploy a site ran in the
// buyer's tab after it returned from Stripe. Checkout is ui_mode=embedded, so
// that return is a top-level redirect: close the tab, lock the phone, or lose
// the redirect inside Instagram's in-app browser and the charge lands while
// nothing is ever built. Two customers hit exactly that on 2026-08-10 — the
// logs show the webhook firing and then no verify-stripe-session, no
// deploy-site, ever.
//
// The pending payload (siteData + imageUrlMap) is already written to GCS
// BEFORE checkout opens, so everything needed to build the site is on the
// server the whole time. This turns that into an actual publish.
//
// Callers: api/stripe-webhook (on payment) and api/publish-sweeper (the
// every-10-minutes reconciler). Both can fire for the same site, so this is
// idempotent by design — see alreadyLive().
import { Storage } from '@google-cloud/storage';
import type { WebsiteData } from '../types';
import { deployRenderedSite } from './deploySite.js';
import { renderSiteBundle, type RenderedSite, type RenderSiteOptions } from './render/site.js';
import type { SiteFile } from './render/pages.js';
import { isAwaitingDetails, isPayFirstPlan } from './payFirst.js';
import { vercelProjectExists } from './ios/slug.js';
import type { SiteOwnerStore } from './siteOwners.js';
import {
  findShopForSite, liveSiteBaseDeps, refreshSiteBase, withSubpageLinks,
  type SiteBaseDeps, type SiteShop, type SiteSubpages,
} from './siteSubpages.js';

export type SiteEditor = 'owner' | 'admin';

export interface PendingSite {
  siteId: string;
  siteData: WebsiteData;
  imageUrlMap?: Record<string, string>;
  existingSiteId?: string | null;
  deployedUrl?: string;
  timestamp?: number;
  /**
   * App sites only. Bumped on every content write: an iOS (or web editor) publish by the
   * owner, or an admin edit (lib/admin/sites.ts). Absent on copies stored before versioning
   * (read as 0). Never goes backwards: a rollback is a new, higher version.
   */
  version?: number;
  editedBy?: SiteEditor;
  /** ISO time of the write that produced `version`. */
  editedAt?: string;
  /** The version of the last admin edit, carried forward by owner publishes (409 guard). */
  adminVersion?: number;
  /** Admin edit note (audit). */
  note?: string;
  /**
   * /custom-15 pay-first (re-review R1): on the checkout's placeholder copy, the slug the details
   * step picked; on that slug's copy, `movedFrom` names the placeholder. The webhook and the
   * sweeper (which only know the checkout's siteId) follow it only when both sides agree.
   */
  movedTo?: string;
  movedFrom?: string;
}

/** Stored version of a pending copy; 0 when absent (stored before versioning). */
export function versionOf(p: Pick<PendingSite, 'version'> | null | undefined): number {
  const v = p?.version;
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0;
}

/** Version of the last admin edit in this copy's lineage; 0 when none. */
export function adminVersionOf(p: Pick<PendingSite, 'version' | 'editedBy' | 'adminVersion'> | null | undefined): number {
  if (!p) return 0;
  const carried = typeof p.adminVersion === 'number' && p.adminVersion > 0 ? p.adminVersion : 0;
  return Math.max(carried, p.editedBy === 'admin' ? versionOf(p) : 0);
}

/** Extra deploys of a newer stored copy after the first (I2). */
export const MAX_REDEPLOYS = 3;
/** The same, on request paths (review fix round 1, finding 9). */
export const REQUEST_MAX_REDEPLOYS = 1;

export type PublishFailure = 'no-backup' | 'bad-backup' | 'deploy-failed' | 'awaiting-details';

// Flat rather than a discriminated union: this repo compiles with
// strictNullChecks off, and without it TS won't narrow on an `ok: true | false`
// discriminant, so every caller ends up fighting the type instead of using it.
export interface PublishOutcome {
  ok: boolean;
  siteId: string;
  /** Set when ok. */
  deployedUrl?: string;
  /** Set when ok — true means it was already serving and nothing was deployed. */
  alreadyLive?: boolean;
  /**
   * Set when ok: this call made the site's FIRST publish (a non-forced deploy of a copy with no
   * server stamp). The webhook and the sweeper record the owner then (the browser path would
   * have). `siteId` is the slug actually published (a pay-first move's target).
   */
  firstPublish?: boolean;
  /** Set when !ok. */
  reason?: PublishFailure;
  error?: string;
}

/**
 * The canonical slug: the GCS key, the Vercel project name and every authorisation lookup.
 * Idempotent (slugify(slugify(x)) === slugify(x)): dashes are trimmed again AFTER the cut at 50.
 * Before, a 50-character cut could end on a dash, and slugifying that again dropped it, so
 * `S + '-zzz'` was checked as `S-` but deployed to `S` (hotfix review, finding 1).
 */
export const slugify = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50)
    .replace(/-+$/, '');

/** The GCS bucket holding pending-sites/ (and the admin history copies). */
export function bucket() {
  const credentialsJson = process.env.GCP_SERVICE_ACCOUNT_JSON || process.env.GCS_CREDENTIALS;
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!credentialsJson || !bucketName) throw new Error('GCS credentials or bucket not configured');
  const credentials = JSON.parse(credentialsJson);
  return new Storage({ credentials, projectId: credentials.project_id }).bucket(bucketName);
}

/** Read the pre-checkout backup written by api/save-pending-site. */
export async function readPendingSite(siteId: string): Promise<PendingSite | null> {
  const file = bucket().file(`pending-sites/${slugify(siteId)}.json`);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buf] = await file.download();
  try {
    return (JSON.parse(buf.toString('utf-8')) || {}).data || null;
  } catch {
    return null;
  }
}

// ─── compare-and-set on the stored copy (e2e I1) ───
//
// Every writer of pending-sites/{slug}.json (iOS publish, admin edits, the sweep's link strip,
// the deploy stamp, the owner's web edit) used to read, change and write with no precondition,
// so two writers inside one read→write window silently lost one write and reused its version.
// Now a writer reads the copy WITH its GCS generation and writes with ifGenerationMatch; a 412
// means someone else wrote in between, and the writer re-reads and decides again
// (casPending). Generation 0 means "the object must not exist" (a create).

/** The stored copy and the GCS generation it was read at (0 = no object). */
export interface VersionedPending {
  pending: PendingSite | null;
  /** null when the reader can't tell (an injected fake without generations): the write is unconditional. */
  generation: number | null;
}

/** A conditional write lost: the stored copy changed since it was read. */
export class PendingConflictError extends Error {
  readonly code = 412;
  constructor(slug: string) {
    super(`pending-sites/${slug}.json changed since it was read`);
  }
}

/**
 * A failed GCS precondition, in every shape the SDK produces: ApiError { code: 412 } (simple
 * upload, finalize) or GaxiosError { status / response.status: 412 } with no code (a resumable
 * upload's session start, measured with @google-cloud/storage 7.18).
 */
export function isPreconditionFailed(e: unknown): boolean {
  const x = e as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null;
  return [x?.code, x?.status, x?.response?.status].some((v) => v === 412 || v === '412');
}

export const isPendingConflict = (e: unknown): boolean => e instanceof PendingConflictError || isPreconditionFailed(e);

const isNotFound = (e: unknown) => {
  const code = (e as { code?: unknown })?.code;
  return code === 404 || code === '404';
};

/**
 * The stored copy with its generation. The bytes are read from exactly that generation, so the
 * pair is consistent; if it was replaced between the two calls (404 on the old generation),
 * read again.
 */
export async function readPendingVersioned(siteId: string): Promise<VersionedPending> {
  const path = `pending-sites/${slugify(siteId)}.json`;
  for (let attempt = 0; attempt < 5; attempt++) {
    let meta: { generation?: unknown };
    try {
      [meta] = await bucket().file(path).getMetadata();
    } catch (e) {
      if (isNotFound(e)) return { pending: null, generation: 0 };
      throw e;
    }
    const generation = Number(meta?.generation);
    if (!Number.isFinite(generation) || generation <= 0) throw new Error(`${path}: no generation in the object metadata`);
    let buf: Buffer;
    try {
      [buf] = await bucket().file(path, { generation }).download();
    } catch (e) {
      if (isNotFound(e)) continue; // replaced (or deleted) since the metadata read
      throw e;
    }
    try {
      return { pending: (JSON.parse(buf.toString('utf-8')) || {}).data || null, generation };
    } catch {
      return { pending: null, generation };
    }
  }
  throw new Error(`${path} kept changing while it was read`);
}

/**
 * Write the pending-site backup (same format api/save-pending-site writes). With
 * `ifGeneration`, only if the object is still at that generation (0: only if it does not
 * exist); otherwise PendingConflictError.
 */
export async function writePendingSite(siteId: string, pending: PendingSite, opts: { ifGeneration?: number | null } = {}): Promise<void> {
  const safe = slugify(siteId);
  const payload = JSON.stringify({ siteId: safe, savedAt: Date.now(), data: pending });
  try {
    await bucket().file(`pending-sites/${safe}.json`).save(payload, {
      contentType: 'application/json',
      // A small JSON body: one multipart request (a precondition failure is a plain 412 ApiError).
      resumable: false,
      metadata: { cacheControl: 'private, max-age=0, no-store' },
      ...(opts.ifGeneration != null ? { preconditionOpts: { ifGenerationMatch: opts.ifGeneration } } : {}),
    });
  } catch (e) {
    if (opts.ifGeneration != null && isPendingConflict(e)) throw new PendingConflictError(safe);
    throw e;
  }
}

/** Read / write of the stored copy, as each writer's deps provide it. */
export interface PendingIO {
  readPending(slug: string): Promise<PendingSite | null>;
  writePending(slug: string, p: PendingSite, opts?: { ifGeneration?: number | null }): Promise<void>;
  /** Absent (older injected fakes): reads carry no generation and writes are unconditional. */
  readPendingVersioned?(slug: string): Promise<VersionedPending>;
}

export type CasDecision<T> = { write: PendingSite; result?: T } | { stop: T };

export interface CasOutcome<T> {
  /** Set when a write landed. */
  written?: PendingSite;
  /** The copy the landed write (or the stop) was decided on. */
  previous: PendingSite | null;
  /** From the decision (`result` of the write, or the `stop` value). */
  result?: T;
  /** Every attempt lost (the copy kept changing). Nothing was written. */
  exhausted?: boolean;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Compare-and-set on pending-sites/{slug}.json: read (with generation), `decide` on the
 * current copy, write conditionally; on a lost race re-read and decide again, at most
 * `attempts` times. `decide` may run more than once and must not assume its earlier answer
 * landed. A 412 whose fresh copy is exactly what was being written counts as written (a
 * transport retry of a write that had already landed).
 */
export async function casPending<T = void>(
  slug: string,
  io: PendingIO,
  decide: (current: PendingSite | null) => CasDecision<T> | Promise<CasDecision<T>>,
  attempts = 5,
): Promise<CasOutcome<T>> {
  let previous: PendingSite | null = null;
  for (let i = 0; i < attempts; i++) {
    const cur: VersionedPending = io.readPendingVersioned
      ? await io.readPendingVersioned(slug)
      : { pending: await io.readPending(slug), generation: null };
    previous = cur.pending;
    const d = await decide(cur.pending);
    if ('stop' in d) return { previous, result: d.stop };
    try {
      if (cur.generation != null) await io.writePending(slug, d.write, { ifGeneration: cur.generation });
      else await io.writePending(slug, d.write);
      return { written: d.write, previous, result: d.result };
    } catch (e) {
      if (!isPendingConflict(e)) throw e;
      const fresh = io.readPendingVersioned ? (await io.readPendingVersioned(slug)).pending : await io.readPending(slug);
      if (sameJson(fresh, d.write)) return { written: d.write, previous, result: d.result };
      console.warn(`[pending] ${slug}: the stored copy changed while it was being written (attempt ${i + 1}/${attempts}); deciding again`);
    }
  }
  return { previous, exhausted: true };
}

/** The live GCS store as a PendingIO. */
export const gcsPendingIO: PendingIO = {
  readPending: readPendingSite,
  writePending: writePendingSite,
  readPendingVersioned,
};

/**
 * Stamp the live URL onto the backup so recovery paths can find it.
 *
 * A deploy takes minutes, and the stored copy can be replaced meanwhile (a phone publish,
 * an admin edit). So the stamp goes onto a FRESH read, and only when that copy is still the
 * one this deploy started from (same version and timestamp); a newer copy is left alone
 * (its own publish stamps it). A missing copy is recreated as before (web recovery).
 * Compare-and-set: a write landing between the read and the stamp is never overwritten.
 */
export async function stampDeployedUrl(siteId: string, pending: PendingSite, deployedUrl: string, io: PendingIO = gcsPendingIO) {
  const slug = slugify(siteId);
  const r = await casPending(slug, io, (fresh) => {
    if (!fresh) return { write: { ...pending, deployedUrl } };
    if (fresh.version !== pending.version || fresh.timestamp !== pending.timestamp) {
      console.log(`[Publish] ${slug}: stored copy changed during the deploy; not stamping the older one`);
      return { stop: undefined };
    }
    if (fresh.deployedUrl === deployedUrl) return { stop: undefined };
    return { write: { ...fresh, deployedUrl } };
  });
  if (r.exhausted) console.warn(`[Publish] ${slug}: the stored copy kept changing; not stamped this time`);
}

// Every page these renderers produce carries this meta tag. Nothing else does,
// which makes it the marker for "this URL is a site WE built".
const OURS_MARKER = 'name="published-at"';

/**
 * Is this site already serving OUR page for this customer?
 *
 * Two things had to be right here, and each was learned from real data:
 *
 * 1. The URL is the authority, not the stamp. The stamp is only written on a
 *    successful publish, so a site can be live with no stamp
 *    (manuel-the-barber was exactly that) and trusting the stamp alone would
 *    redeploy a working site.
 *
 * 2. A 200 is not enough, and neither is a stamp. `https://{slug}.vercel.app`
 *    may belong to a stranger who took that name first — asr.vercel.app is
 *    live, is not ours, and the pending backup even has it STAMPED. Calling
 *    that "already live" marks the customer done while pointing at someone
 *    else's website, and they never get a site at all.
 *
 * The check is the marker, not the shop name. Name matching looked obvious and
 * is wrong in both directions: too weak for short names (with punctuation
 * stripped, "ASR" matches inside ordinary prose like "...has resources..."),
 * and actively dangerous when a customer renames their shop after publishing —
 * the name would no longer match, we'd redeploy the ORIGINAL pre-checkout
 * payload, and their edits would be overwritten with stale content.
 *
 * Anything that isn't a clean answer counts as not-live: publishing twice is
 * cheap, and not publishing at all is the bug this whole change exists to fix.
 */
async function alreadyLive(url: string | undefined | null): Promise<boolean> {
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    if (resp.status < 200 || resp.status >= 400) return false;
    return (await resp.text()).includes(OURS_MARKER);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Render a stored (pending-shape) copy to the pages that get deployed: `index.html` (the home page)
 * first, then one file per page that has data behind it (lib/render/site.ts). Throws when the renderer
 * can't handle the data: admin saves and the iOS publish call it first as a dry render.
 *
 * The renderers want 'has-image' markers where an image exists; the real URLs live in imageUrlMap and are
 * substituted into the {{placeholders}} during deploy. Page eligibility (a gallery of the barber's own
 * photos) is decided on those real URLs. `opts` carries the public base, when known, for canonical links
 * and the sitemap.
 */
export function renderPending(
  pending: Pick<PendingSite, 'siteData' | 'imageUrlMap'>,
  opts: Pick<RenderSiteOptions, 'customDomain' | 'siteBaseUrl'> = {},
): SiteFile[] {
  return renderPendingBundle(pending, opts).pages;
}

/** renderPending() with the sitemap. */
export function renderPendingBundle(
  pending: Pick<PendingSite, 'siteData' | 'imageUrlMap'>,
  opts: Pick<RenderSiteOptions, 'customDomain' | 'siteBaseUrl'> = {},
): RenderedSite {
  return renderSiteBundle(pending.siteData, { ...opts, imageUrls: pending.imageUrlMap || {} });
}

/**
 * Build and deploy the site behind `siteId`. Safe to call repeatedly: if the
 * site is already serving, this returns that URL without touching Vercel.
 * `opts.force` skips that check and redeploys regardless.
 */
/**
 * The same rules authorizeDeploy applies to a browser pay-first rename, for the server's follow
 * (both pointers come from the unauthenticated save-pending-site): the target is brand-new (no
 * stamp, no Vercel project), no other session owns it, and this purchase binds no other slug.
 * Any lookup failure refuses.
 */
async function payFirstMoveAllowed(
  placeholder: string,
  target: string,
  moved: PendingSite,
  opts: { projectExists?: (slug: string) => Promise<boolean>; siteOwners?: SiteOwnerStore; sessionId?: string | null },
): Promise<boolean> {
  const refuse = (why: string) => { console.warn(`[Publish] ${placeholder}: pay-first move to ${target} refused (${why})`); return false; };
  if (moved.deployedUrl) return refuse('target already published');
  try {
    if (await (opts.projectExists ?? vercelProjectExists)(target)) return refuse('target has a Vercel project');
    if (opts.siteOwners) {
      const row = await opts.siteOwners.get(target);
      if (row && (!opts.sessionId || row.checkout_session_id !== opts.sessionId)) return refuse('target is owned by another session');
      if (opts.sessionId && opts.siteOwners.slugsForSession) {
        const bound = await opts.siteOwners.slugsForSession(opts.sessionId);
        if (bound.some((s) => s !== placeholder && s !== target)) return refuse('this purchase already published another site');
      }
    }
  } catch (e: any) {
    return refuse(`lookup failed: ${e?.message || e}`);
  }
  return true;
}

export async function publishSite(
  siteId: string,
  opts: {
    force?: boolean;
    /**
     * Deploy this copy instead of the stored one (admin republish deploys the stored copy with
     * the tier link strip applied, without writing the strip back). The stored copy is not changed
     * beyond the deployedUrl stamp.
     */
    pending?: PendingSite;
    /**
     * Applied to a FRESH stored copy when the deploy has to be redone because the copy changed
     * meanwhile (see below). Admin republish passes its tier link strip, so a redeploy of a
     * newer copy gets the same treatment as the snapshot. Default: deploy the fresh copy as is.
     */
    transform?: (p: PendingSite) => PendingSite;
    /**
     * Extra deploys of a newer stored copy after the first (I2). Default MAX_REDEPLOYS (sweeps,
     * webhook); the request paths (/api/ios/publish, /api/admin/sites) pass REQUEST_MAX_REDEPLOYS
     * so a request never runs more than two deploys (every writer deploys its own copy anyway).
     */
    maxRedeploys?: number;
    /**
     * The checkout plan, when the caller knows it (webhook, sweeper). A pay-first plan
     * (/custom-15) only publishes a copy whose details were confirmed after payment.
     */
    plan?: string | null;
    /**
     * The shop behind this site slug (lib/siteSubpages.ts findShopForSite): its deploys carry
     * the /book and /shop rewrites. Injectable for tests.
     */
    findShop?: (siteSlug: string) => Promise<SiteShop | null>;
    /** Where the shop's public base URL and look are stored after the deploy. Injectable for tests. */
    siteBase?: SiteBaseDeps;
    /** Does a Vercel project with this name exist? Throws when it can't tell. Injectable for tests. */
    projectExists?: (slug: string) => Promise<boolean>;
    /** The web owner list, for the pay-first move rules (with sessionId). Absent: those two rules are skipped. */
    siteOwners?: SiteOwnerStore;
    /** The checkout session behind this publish (webhook, sweeper): the pay-first purchase whose binding is checked. */
    sessionId?: string | null;
    /** Internal: a followed pay-first move is never followed again. */
    noFollow?: boolean;
  } = {},
): Promise<PublishOutcome> {
  const safe = slugify(siteId);
  if (!safe) return { ok: false, reason: 'bad-backup', siteId, error: 'Invalid siteId' };

  let pending: PendingSite | null;
  try {
    pending = opts.pending ?? (await readPendingSite(safe));
  } catch (e: any) {
    return { ok: false, reason: 'no-backup', siteId: safe, error: e?.message };
  }
  if (!pending) return { ok: false, reason: 'no-backup', siteId: safe };
  if (!pending.siteData) return { ok: false, reason: 'bad-backup', siteId: safe };

  // /custom-15 pay-first: the details step named the real slug. Publish that one when its copy
  // points back here (both sides agree); otherwise this placeholder stays held below.
  if (!opts.pending && !opts.noFollow && pending.movedTo && isPayFirstPlan(opts.plan)) {
    const target = slugify(pending.movedTo);
    if (target && target !== safe) {
      const moved = await readPendingSite(target).catch(() => null);
      if (moved && slugify(moved.movedFrom || '') === safe && (await payFirstMoveAllowed(safe, target, moved, opts))) {
        console.log(`[Publish] ${safe}: pay-first site moved to ${target} at the details step; publishing that`);
        return publishSite(target, { ...opts, noFollow: true });
      }
      else console.warn(`[Publish] ${safe}: movedTo ${target} is not an allowed pay-first move; not following (placeholder held)`);
    }
  }

  // /custom-15 pay-first hold: the stored copy is still the sample (placeholder
  // name, no way to reach the shop). Never publish it, not even with force; the
  // barber's details step after payment writes a confirmed copy.
  if (isAwaitingDetails(pending.siteData, opts.plan)) {
    console.log(`[Publish] ${safe}: awaiting the barber's details (pay-first) — not publishing the sample`);
    return { ok: false, reason: 'awaiting-details', siteId: safe };
  }

  // Idempotency gate. Both the webhook and the sweeper can land on the same
  // site, and Stripe retries webhooks — none of that should mean two deploys.
  const candidate = pending.deployedUrl || `https://${safe}.vercel.app`;
  if (!opts.force && (await alreadyLive(candidate))) {
    console.log(`[Publish] ${safe} already live at ${candidate} — nothing to do`);
    if (!pending.deployedUrl) {
      // Live but never stamped (the browser path died right after deploying).
      await stampDeployedUrl(safe, pending, candidate).catch(() => {});
    }
    return { ok: true, deployedUrl: candidate, alreadyLive: true, siteId: safe };
  }

  // Site subpages: a site whose slug has a shop serves /book and /shop on its own domain.
  // A deploy that can't tell must not guess: shipping without the rewrites would break the
  // pages, manage links in sent emails and Stripe returns on the barber's domain. So a failed
  // lookup fails the publish for any site; the callers' sweeps (and the next publish) retry.
  let shop: SiteShop | null = null;
  try {
    shop = await (opts.findShop ?? findShopForSite)(safe);
  } catch (e: any) {
    console.error(`[Publish] ${safe}: shop lookup failed (${e?.message || e}); not deploying, will be retried`);
    return { ok: false, reason: 'deploy-failed', siteId: safe, error: `shop lookup failed: ${e?.message || e}` };
  }
  const subpages: SiteSubpages | null = shop ? { mode: 'full', shopSlug: shop.slug } : null;

  // Was this slug brand-new before the deploy (no stamp AND no Vercel project)? Only then may a
  // server publish record an owner; an unstamped legacy site with a live project must not. A
  // failed lookup says no.
  let firstPublish = false;
  if (!opts.force && !pending.deployedUrl) {
    try {
      firstPublish = !(await (opts.projectExists ?? vercelProjectExists)(safe));
    } catch (e: any) {
      console.warn(`[Publish] ${safe}: project lookup failed; not reporting a first publish:`, e?.message || e);
    }
  }

  // Best effort: a failed read just means no canonical links and no sitemap on this publish.
  let storedBase: string | null = null;
  if (shop) {
    try { storedBase = (await (opts.siteBase ?? liveSiteBaseDeps).readBase?.(shop.id)) ?? null; }
    catch (e: any) { console.warn(`[Publish] ${safe}: reading the stored site base failed (${e?.message || e}); no canonical links this time`); }
  }

  try {
    // A deploy takes minutes, and the stored copy can be replaced meanwhile (a phone publish,
    // an admin edit, a sweep strip). Whichever deploy FINISHES last is what stays live, so an
    // older render finishing after a newer one would leave stale content up with nothing to
    // redeploy it (e2e I2). After each deploy the stored copy is read again; if it is not the
    // copy just rendered (version or timestamp moved), the fresh copy is deployed too. Bounded:
    // each round only starts because a newer write landed, and that writer deploys as well.
    // (Chosen over serialising deploys per slug: no lease table, no lock held across a
    // minutes-long deploy that a killed function would leave behind.)
    let current: PendingSite = pending;
    let deploymentUrl = '';
    let projectName: string | undefined;
    for (let round = 0; ; round++) {
      const csd = current.siteData;
      // The links are normalised for this deploy only; the stored copy keeps what the owner saved.
      // The public base is only known from a previous deploy (ab_shops.site_base_url); with none, the
      // pages ship without canonical links and without a sitemap on this publish.
      const rendered = renderPendingBundle({ ...current, siteData: withSubpageLinks(csd, !!subpages) }, { siteBaseUrl: storedBase });
      const html = rendered.pages[0].html;
      console.log(`[Publish] ${safe}: rendered ${rendered.pages.length} page${rendered.pages.length === 1 ? '' : 's'}, ${html.length} bytes of home (template=${csd.template || 'luxe'})${round ? ` (redeploy ${round}: the stored copy changed)` : ''}, deploying...`);
      const out = await deployRenderedSite({ siteId: safe, html, pages: rendered.pages, sitemap: rendered.sitemap, imageUrls: current.imageUrlMap || {}, subpages });
      deploymentUrl = out.deploymentUrl;
      projectName = out.projectName;
      if (round >= (opts.maxRedeploys ?? MAX_REDEPLOYS)) break;
      let fresh: PendingSite | null = null;
      try {
        fresh = await readPendingSite(safe);
      } catch (e: any) {
        console.warn(`[Publish] ${safe}: deployed, but re-reading the stored copy failed (${e?.message || e}); not checking for a newer copy`);
      }
      if (!fresh?.siteData || (fresh.version === current.version && fresh.timestamp === current.timestamp)) break;
      if (isAwaitingDetails(fresh.siteData, opts.plan)) break;
      current = opts.transform ? opts.transform(fresh) : fresh;
    }
    await stampDeployedUrl(safe, current, deploymentUrl).catch((e) =>
      console.warn(`[Publish] ${safe}: deployed but stamping the backup failed:`, e?.message),
    );
    if (shop) {
      // Customer-facing URLs (Stripe returns, emails) follow the site's domain from now on.
      // Best effort: the site is live; until this lands they keep the previous base.
      await refreshSiteBase(
        { shopId: shop.id, projectName: projectName || safe, siteData: current.siteData, imageUrlMap: current.imageUrlMap || {} },
        opts.siteBase ?? liveSiteBaseDeps,
      ).catch((e) => console.warn(`[Publish] ${safe}: live, but storing the shop's site URL failed:`, e?.message || e));
    }
    console.log(`[Publish] ${safe}: LIVE at ${deploymentUrl}`);
    return { ok: true, deployedUrl: deploymentUrl, alreadyLive: false, siteId: safe, firstPublish };
  } catch (e: any) {
    console.error(`[Publish] ${safe}: deploy failed:`, e?.message || e);
    return { ok: false, reason: 'deploy-failed', siteId: safe, error: e?.message || String(e) };
  }
}
