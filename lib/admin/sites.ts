// Admin site edits: find, change, replace, republish and roll back any app customer's
// site from the server, without their phone (spec 2026-10-21-admin-site-edits).
//
// The stored copy in GCS (pending-sites/{slug}.json) is the source of truth for an app
// site. Every admin write here:
//   1. validates exactly like an app publish (lib/ios/siteShape.ts) and stores the same
//      pending shape (lib/ios/pendingData.ts),
//   2. applies the tier link rules for the purchase's current product (lib/ios/tiers.ts),
//   3. copies the previous stored copy to pending-sites-history/{slug}/{version}.json FIRST,
//   4. writes version + 1 with editedBy 'admin' (the app adopts it; an older phone publish
//      gets 409 site-updated, see lib/ios/publishFlow.ts),
//   5. redeploys the SAME slug (its own Vercel project/alias) through publishSite,
//   6. records an audit row (ab_events, best effort).
// A rollback is a replace with a history copy, written as a NEW higher version: versions
// never go backwards, so the app's comparison stays simple.
//
// Pure over injected deps (like the rest of lib/); lib/admin/live.ts wires the real ones
// for api/admin/sites.ts and scripts/admin-sites.mjs.
import type { WebsiteData } from '../../types.js';
import type { PurchaseRow } from '../ios/purchases.js';
import type { PendingSite, PublishOutcome, SiteEditor } from '../publishSite.js';
import { buildImageUrlMap, toPendingSiteData } from '../ios/pendingData.js';
import { MAX_BODY_BYTES, hasDataUrl, isObj, jsonBytes, restoreImageUrls, validSiteData } from '../ios/siteShape.js';
import { stripLapsedLinks, tierOf, type Tier } from '../ios/tiers.js';
import { PatchError, applyPatch, applySets } from './patch.js';

// ─── deps ───

export interface HistoryEntry {
  /** History key: the version ("4"), or "4-<ms>" when that version number was already kept with other content. */
  id: string;
  version: number;
  editedBy: SiteEditor | null;
  editedAt: string | null;
}

/** Progress of one republish-all run (resumable: done/failed sites are never redone). */
export interface RepublishRun {
  runId: string;
  startedAt: string;
  updatedAt: string;
  done: string[];
  failed: { slug: string; error: string }[];
}

export interface SiteStore {
  readPending(slug: string): Promise<PendingSite | null>;
  writePending(slug: string, p: PendingSite): Promise<void>;
  /**
   * Keep `p` as history for `version`; returns the id written. Never overwrites: if that version
   * is already kept with the same content it is reused, otherwise it goes to "{version}-{ms}".
   */
  writeHistory(slug: string, version: number, p: PendingSite): Promise<string>;
  /** By id ("4" or "4-1729…"). */
  readHistory(slug: string, id: string): Promise<PendingSite | null>;
  /** Newest first. */
  listHistory(slug: string): Promise<HistoryEntry[]>;
  readRun(runId: string): Promise<RepublishRun | null>;
  writeRun(runId: string, run: RepublishRun): Promise<void>;
}

export interface AuditEvent {
  action: 'update' | 'replace' | 'rollback' | 'republish';
  slug: string;
  ok: boolean;
  by?: string;
  fromVersion?: number;
  toVersion?: number;
  note?: string;
  detail?: string;
  runId?: string;
}

export interface AdminSitesDeps {
  /** Every ios_purchases row with a bound site_slug. */
  listBound(): Promise<PurchaseRow[]>;
  findBySlug(slug: string): Promise<PurchaseRow | null>;
  /** user_id → email. With ids, only those are needed. */
  emailsByUserId(ids?: string[]): Promise<Map<string, string>>;
  store: SiteStore;
  /**
   * lib/publishSite.ts publishSite: renders the stored copy (or `pending`, without storing it)
   * and deploys the slug's own project.
   */
  publish(slug: string, opts: { force: boolean; pending?: PendingSite }): Promise<PublishOutcome>;
  /** lib/publishSite.ts renderPending: the HTML a deploy would ship. Throws on unrenderable data. */
  render(p: Pick<PendingSite, 'siteData' | 'imageUrlMap'>): string;
  audit(e: AuditEvent): Promise<void>;
  now(): number;
  /** Same switch as the sweep: Sandbox takedowns only count as offline when this is on. */
  takedownSandbox?: boolean;
}

// ─── shared helpers ───

export type SiteStatus = 'live' | 'revoked' | 'taken-down' | 'unpublished' | 'expired';

function statusOf(row: PurchaseRow, now: number): SiteStatus {
  if (row.revoked_at) return 'revoked';
  if (row.taken_down_at) return 'taken-down';
  if (!row.published_at) return 'unpublished';
  if (row.expires_at && Date.parse(row.expires_at) <= now) return 'expired';
  return 'live';
}

export type OfflineReason = 'revoked' | 'taken-down' | 'expired';

/**
 * Never deploy content for these: the live site is the offline page, the purchase was
 * refunded, or the subscription has expired (a normal publish would get 402; the sweep takes
 * it down after Apple confirms). Edits are still stored and go live on restore / renewal.
 */
function offlineReason(row: PurchaseRow, deps: Pick<AdminSitesDeps, 'takedownSandbox' | 'now'>): OfflineReason | null {
  if (row.revoked_at) return 'revoked';
  if (row.taken_down_at && !(row.environment === 'Sandbox' && deps.takedownSandbox !== true)) return 'taken-down';
  if (row.expires_at && Date.parse(row.expires_at) <= deps.now()) return 'expired';
  return null;
}

const versionOf = (p: PendingSite | null | undefined): number =>
  typeof p?.version === 'number' && Number.isInteger(p.version) && p.version > 0 ? p.version : 0;

const restored = (p: PendingSite | null): WebsiteData | null =>
  p?.siteData ? restoreImageUrls(p.siteData, p.imageUrlMap || {}) : null;

const errMsg = (e: unknown) => (e as Error)?.message || String(e);

async function safeAudit(deps: AdminSitesDeps, e: AuditEvent) {
  console.log(`[admin/sites] ${e.action} ${e.slug} ok=${e.ok}` +
    (e.toVersion != null ? ` v${e.fromVersion}→v${e.toVersion}` : '') + (e.by ? ` by ${e.by}` : '') +
    (e.note ? ` note="${e.note}"` : '') + (e.detail ? ` (${e.detail})` : ''));
  try {
    await deps.audit(e);
  } catch (err) {
    console.warn(`[admin/sites] audit write failed (ignored): ${errMsg(err)}`);
  }
}

/** Run `fn` over `items` with at most `n` in flight. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const worker = async () => {
    while (i < items.length) await fn(items[i++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
}

// ─── find / get ───

export interface SiteRow {
  slug: string;
  shopName: string | null;
  email: string | null;
  transactionId: string;
  environment: string;
  productId: string;
  tier: Tier | null;
  status: SiteStatus;
  active: boolean;
  deployedUrl: string | null;
  template: string;
  publishedAt: string | null;
  version: number;
  editedBy: SiteEditor | null;
  editedAt: string | null;
}

function toRow(row: PurchaseRow, p: PendingSite | null, email: string | null, now: number): SiteRow {
  const status = statusOf(row, now);
  return {
    slug: row.site_slug!,
    shopName: p?.siteData?.shopName ?? null,
    email,
    transactionId: row.original_transaction_id,
    environment: row.environment,
    productId: row.product_id,
    tier: tierOf(row.product_id),
    status,
    active: status === 'live',
    deployedUrl: p?.deployedUrl || null,
    template: p?.siteData ? p.siteData.template || 'luxe' : '',
    publishedAt: row.published_at,
    version: versionOf(p),
    editedBy: p?.editedBy ?? null,
    editedAt: p?.editedAt ?? null,
  };
}

/**
 * App sites matching `query` (case-insensitive substring of shop name, slug, email, live
 * URL, or transaction id). Empty query lists all. Reads every stored copy, so a renamed
 * shop is found by its current name.
 */
export async function findSites(query: string, deps: AdminSitesDeps, opts: { limit?: number } = {}): Promise<SiteRow[]> {
  const q = (query || '').trim().toLowerCase();
  const rows = (await deps.listBound()).filter((r) => r.site_slug);
  const emails = await deps.emailsByUserId();
  const pendings = new Map<string, PendingSite | null>();
  await pool(rows, 16, async (r) => {
    try {
      pendings.set(r.site_slug!, await deps.store.readPending(r.site_slug!));
    } catch (e) {
      console.warn(`[admin/sites] ${r.site_slug}: reading the stored copy failed: ${errMsg(e)}`);
      pendings.set(r.site_slug!, null);
    }
  });
  const now = deps.now();
  const out = rows
    .map((r) => toRow(r, pendings.get(r.site_slug!) ?? null, (r.user_id && emails.get(r.user_id)) || null, now))
    .filter((s) => !q || [s.shopName, s.slug, s.email, s.deployedUrl, s.transactionId]
      .some((v) => typeof v === 'string' && v.toLowerCase().includes(q)))
    .sort((a, b) => (a.shopName || a.slug).localeCompare(b.shopName || b.slug));
  return out.slice(0, opts.limit ?? 500);
}

export interface SiteDetail extends SiteRow {
  siteData: WebsiteData | null;
  note: string | null;
  history: HistoryEntry[];
}

export interface GetResult {
  ok: boolean;
  error?: 'not-found';
  site?: SiteDetail;
}

/** One site: the stored siteData (real image URLs), version, and its history versions. */
export async function getSite(slug: string, deps: AdminSitesDeps): Promise<GetResult> {
  const row = await deps.findBySlug(slug);
  if (!row?.site_slug) return { ok: false, error: 'not-found' };
  const [p, history, emails] = await Promise.all([
    deps.store.readPending(row.site_slug),
    deps.store.listHistory(row.site_slug),
    row.user_id ? deps.emailsByUserId([row.user_id]) : Promise.resolve(new Map<string, string>()),
  ]);
  return {
    ok: true,
    site: {
      ...toRow(row, p, (row.user_id && emails.get(row.user_id)) || null, deps.now()),
      siteData: restored(p),
      note: p?.note ?? null,
      history,
    },
  };
}

// ─── update / replace / rollback ───

export interface UpdateInput {
  /** Merge patch: objects merge, arrays replace, null removes. */
  patch?: Record<string, unknown>;
  /** Dotted paths: { 'services.0.price': '$35' }. */
  set?: Record<string, unknown>;
  /** The whole siteData. */
  replace?: WebsiteData;
  note?: string;
  /** Refuse (conflict) unless the stored version is still this one. */
  expectedVersion?: number;
  /** Who did it (admin email, 'cli'): audit only. */
  by?: string;
}

export type UpdateError = 'not-found' | 'no-copy' | 'bad-request' | 'conflict' | 'history-failed' | 'publish-failed' | 'no-history';

export interface UpdateResult {
  ok: boolean;
  slug: string;
  error?: UpdateError;
  detail?: string;
  /** The stored version now (after a write), or the current one on conflict. */
  version?: number;
  fromVersion?: number;
  /** The new content and version are stored (also on publish-failed). */
  saved?: boolean;
  deployed?: boolean;
  deployedUrl?: string | null;
  /** Set when the site is offline: the edit is stored and goes live on restore. */
  skipped?: 'site-offline';
  offline?: OfflineReason;
  /** Links removed by the tier rules (the purchase's product doesn't cover them). */
  strippedLinks?: string[];
}

function nextSiteData(input: UpdateInput, current: WebsiteData | null): WebsiteData {
  const ops = ['patch', 'set', 'replace'].filter((k) => (input as any)[k] !== undefined);
  if (ops.length !== 1) throw new PatchError('send exactly one of patch, set or replace');
  if (input.replace !== undefined) {
    if (!isObj(input.replace)) throw new PatchError('replace must be a siteData object');
    return JSON.parse(JSON.stringify(input.replace));
  }
  if (input.patch !== undefined) return applyPatch(current, input.patch);
  return applySets(current, input.set as Record<string, unknown>);
}

function validationProblem(sd: unknown): string | null {
  if (!validSiteData(sd)) return 'siteData needs shopName, hero, about, gallery[] and services[] (craftImages/staff must be lists)';
  // Deeper than the publish shape check: these are what the renderers dereference.
  if (!isObj(sd.contact)) return 'contact must be an object ({ address, email })';
  const badService = sd.services.findIndex((x: unknown) => !isObj(x) || typeof x.title !== 'string');
  if (badService >= 0) return `services.${badService} must be an object with a text title`;
  const desc = (sd.about as any).description;
  if (!Array.isArray(desc) || desc.some((d: unknown) => typeof d !== 'string')) return 'about.description must be a list of text paragraphs';
  if (hasDataUrl(sd)) return 'inline data: images are not allowed; upload the image and use its https URL';
  if (jsonBytes(sd) > MAX_BODY_BYTES) return 'siteData is larger than 3 MB';
  return null;
}

async function write(
  slug: string,
  input: UpdateInput,
  action: 'update' | 'replace' | 'rollback',
  deps: AdminSitesDeps,
): Promise<UpdateResult> {
  const row = await deps.findBySlug(slug);
  if (!row?.site_slug) return { ok: false, slug, error: 'not-found' };
  slug = row.site_slug;
  const cur = await deps.store.readPending(slug);
  if (!cur?.siteData && input.replace === undefined) return { ok: false, slug, error: 'no-copy', detail: 'no stored copy; use replace' };
  const fromVersion = versionOf(cur);
  if (input.expectedVersion != null && input.expectedVersion !== fromVersion) {
    return { ok: false, slug, error: 'conflict', version: fromVersion, detail: `stored version is ${fromVersion}, not ${input.expectedVersion}` };
  }

  let next: WebsiteData;
  try {
    next = nextSiteData(input, restored(cur));
  } catch (e) {
    return { ok: false, slug, error: 'bad-request', detail: errMsg(e) };
  }
  const problem = validationProblem(next);
  if (problem) return { ok: false, slug, error: 'bad-request', detail: problem };

  let imageUrlMap: Record<string, string>;
  let siteData: WebsiteData;
  try {
    imageUrlMap = buildImageUrlMap(next);
    siteData = stripLapsedLinks(toPendingSiteData(next, imageUrlMap), row.product_id);
  } catch (e) {
    return { ok: false, slug, error: 'bad-request', detail: errMsg(e) };
  }
  const strippedLinks = (['bookingUrl', 'shopUrl'] as const).filter((k) => k in next && !(k in siteData));

  // Dry render: never store (or hand to the phone) what the templates can't render.
  try {
    deps.render({ siteData, imageUrlMap });
  } catch (e) {
    return { ok: false, slug, error: 'bad-request', detail: `the template can't render this: ${errMsg(e)}` };
  }

  // History first: if it can't be kept, nothing is overwritten.
  if (cur) {
    try {
      await deps.store.writeHistory(slug, fromVersion, cur);
    } catch (e) {
      return { ok: false, slug, error: 'history-failed', detail: errMsg(e) };
    }
  }

  const version = fromVersion + 1;
  const pending: PendingSite = {
    siteId: slug,
    existingSiteId: null,
    siteData,
    imageUrlMap,
    timestamp: deps.now(),
    version,
    editedBy: 'admin',
    editedAt: new Date(deps.now()).toISOString(),
    adminVersion: version,
  };
  if (cur?.deployedUrl) pending.deployedUrl = cur.deployedUrl;
  if (input.note) pending.note = String(input.note).slice(0, 500);
  await deps.store.writePending(slug, pending);

  const base = { slug, version, fromVersion, saved: true, strippedLinks };
  const audit = (ok: boolean, detail?: string) =>
    safeAudit(deps, { action, slug, ok, by: input.by, fromVersion, toVersion: version, note: pending.note, detail });

  const offline = offlineReason(row, deps);
  if (offline) {
    await audit(true, `site offline (${offline}): stored, not deployed`);
    return { ok: true, ...base, deployed: false, skipped: 'site-offline', offline, deployedUrl: pending.deployedUrl ?? null };
  }
  const outcome = await deps.publish(slug, { force: true });
  if (!outcome.ok) {
    await audit(false, `publish failed: ${outcome.reason} ${outcome.error || ''}`.trim());
    return { ok: false, ...base, error: 'publish-failed', detail: outcome.error || outcome.reason, deployed: false };
  }
  await audit(true);
  return { ok: true, ...base, deployed: true, deployedUrl: outcome.deployedUrl ?? null };
}

/** Change (patch / set) or replace a site's content and republish it. */
export function updateSite(slug: string, input: UpdateInput, deps: AdminSitesDeps): Promise<UpdateResult> {
  return write(slug, input || {}, input?.replace !== undefined ? 'replace' : 'update', deps);
}

/** Bring back the content of history entry `id` ("4" or "4-1729…"), as a new version. */
export async function rollback(
  slug: string,
  id: string | number,
  deps: AdminSitesDeps,
  opts: { by?: string; expectedVersion?: number } = {},
): Promise<UpdateResult> {
  const ref = String(id ?? '').trim();
  if (!/^\d+(-\d+)?$/.test(ref)) return { ok: false, slug, error: 'bad-request', detail: 'version must look like 4 or 4-1729000000000' };
  const h = await deps.store.readHistory(slug, ref);
  if (!h?.siteData) return { ok: false, slug, error: 'no-history', detail: `no history copy v${ref}` };
  return write(slug, { replace: restored(h)!, note: `rollback to v${ref}`, by: opts.by, expectedVersion: opts.expectedVersion }, 'rollback', deps);
}

// ─── republish ───

export interface RepublishResult {
  ok: boolean;
  slug: string;
  error?: 'not-found' | 'no-copy' | 'invalid-copy' | 'site-offline' | 'publish-failed' | 'exception';
  detail?: string;
  deployedUrl?: string | null;
  strippedLinks?: string[];
}

/** Links the product doesn't cover that a deploy of this copy would drop. */
function linksToStrip(sd: WebsiteData, productId: string): string[] {
  const stripped = stripLapsedLinks(sd, productId);
  return (['bookingUrl', 'shopUrl'] as const).filter((k) => k in sd && !(k in stripped));
}

async function republishRow(row: PurchaseRow, deps: AdminSitesDeps, by?: string, runId?: string): Promise<RepublishResult> {
  const slug = row.site_slug!;
  const off = offlineReason(row, deps);
  if (off) return { ok: false, slug, error: 'site-offline', detail: off };
  const cur = await deps.store.readPending(slug);
  if (!cur?.siteData) return { ok: false, slug, error: 'no-copy' };
  // Never deploy a copy an admin save would refuse (e.g. planted or hand-broken data).
  const problem = validationProblem(restored(cur));
  if (problem) {
    await safeAudit(deps, { action: 'republish', slug, ok: false, by, runId, detail: `invalid stored copy: ${problem}` });
    return { ok: false, slug, error: 'invalid-copy', detail: problem };
  }
  // Same tier rule as a publish: links the current product no longer covers are left out of
  // the DEPLOY. The stored copy is not changed (republish never changes content or version).
  const strippedLinks = linksToStrip(cur.siteData, row.product_id);
  const toDeploy: PendingSite = strippedLinks.length ? { ...cur, siteData: stripLapsedLinks(cur.siteData, row.product_id) } : cur;
  const outcome = await deps.publish(slug, { force: true, pending: toDeploy });
  const ok = !!outcome.ok;
  await safeAudit(deps, {
    action: 'republish', slug, ok, by, runId,
    detail: ok ? (strippedLinks.length ? `deployed without ${strippedLinks.join(',')}` : undefined) : `${outcome.reason} ${outcome.error || ''}`.trim(),
  });
  if (!ok) return { ok: false, slug, error: 'publish-failed', detail: outcome.error || outcome.reason, strippedLinks };
  return { ok: true, slug, deployedUrl: outcome.deployedUrl ?? null, strippedLinks };
}

/** Redeploy one site from its stored copy with the current templates. Content unchanged. */
export async function republish(slug: string, deps: AdminSitesDeps, by?: string): Promise<RepublishResult> {
  const row = await deps.findBySlug(slug);
  if (!row?.site_slug) return { ok: false, slug, error: 'not-found' };
  return republishRow(row, deps, by);
}

export interface RepublishAllInput {
  /** Default true: list only. */
  dryRun?: boolean;
  /** Required for a real run; reuse it to continue (done/failed sites are skipped). */
  runId?: string;
  /** Sites per call. Default 6. */
  limit?: number;
  /** Sites deployed at once. Default 2. */
  concurrency?: number;
  /** Stop starting new sites after this long. Default 150 s (functions get 300 s; one deploy can take ~120 s). */
  budgetMs?: number;
  by?: string;
}

export interface RepublishAllResult {
  dryRun: boolean;
  runId?: string;
  /** Dry run: every site a real run would republish (slug order). */
  eligible?: string[];
  skipped: { slug: string; reason: OfflineReason | 'unpublished' | 'no-copy' }[];
  /** Dry run: links each site's deploy would leave out (not covered by its plan). */
  wouldStrip?: { slug: string; links: string[] }[];
  /** Real run: this run's sites not reached by this call (call again with the same runId). */
  notReached?: string[];
  /** This call's sites. */
  results: RepublishResult[];
  /** Sites of this run still to do after this call. */
  remaining: number;
  done: boolean;
  /** Whole run so far. */
  totals: { ok: number; failed: number };
  failed: { slug: string; error: string }[];
}

/**
 * Republish every app site from its stored copy (after a template / renderer fix).
 * Batched (`limit` per call, time-boxed), resumable and idempotent per `runId`: call again
 * with the same runId until `done`. Never changes content; skips revoked, taken-down,
 * never-published and copy-less sites.
 */
export async function republishAll(input: RepublishAllInput, deps: AdminSitesDeps): Promise<RepublishAllResult> {
  const dryRun = input?.dryRun !== false;
  const startedAt = deps.now();
  const rows = (await deps.listBound()).filter((r) => r.site_slug).sort((a, b) => a.site_slug!.localeCompare(b.site_slug!));

  let run: RepublishRun | null = null;
  if (!dryRun) {
    const runId = typeof input.runId === 'string' ? input.runId.trim() : '';
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(runId)) throw new Error('republishAll: a real run needs a runId (letters, digits, - or _)');
    run = (await deps.store.readRun(runId)) ?? {
      runId, startedAt: new Date(startedAt).toISOString(), updatedAt: new Date(startedAt).toISOString(), done: [], failed: [],
    };
  }
  const finished = new Set([...(run?.done ?? []), ...(run?.failed ?? []).map((f) => f.slug)]);

  const skipped: RepublishAllResult['skipped'] = [];
  const candidates: PurchaseRow[] = [];
  for (const r of rows) {
    if (finished.has(r.site_slug!)) continue;
    const off = offlineReason(r, deps);
    if (off) skipped.push({ slug: r.site_slug!, reason: off });
    else if (!r.published_at) skipped.push({ slug: r.site_slug!, reason: 'unpublished' });
    else candidates.push(r);
  }
  // Copy-less sites can't be rendered: skip them up front. A read error leaves the site in
  // (its republish then records the failure).
  const hasCopy = new Map<string, boolean>();
  const wouldStrip: { slug: string; links: string[] }[] = [];
  await pool(candidates, 16, async (r) => {
    try {
      const p = await deps.store.readPending(r.site_slug!);
      hasCopy.set(r.site_slug!, !!p?.siteData);
      if (p?.siteData) {
        const links = linksToStrip(p.siteData, r.product_id);
        if (links.length) wouldStrip.push({ slug: r.site_slug!, links });
      }
    } catch {
      hasCopy.set(r.site_slug!, true);
    }
  });
  wouldStrip.sort((a, b) => a.slug.localeCompare(b.slug));
  const eligible = candidates.filter((r) => {
    if (hasCopy.get(r.site_slug!)) return true;
    skipped.push({ slug: r.site_slug!, reason: 'no-copy' });
    return false;
  });
  skipped.sort((a, b) => a.slug.localeCompare(b.slug));

  if (dryRun) {
    return {
      dryRun: true, eligible: eligible.map((r) => r.site_slug!), skipped, wouldStrip, results: [],
      remaining: eligible.length, done: false, totals: { ok: 0, failed: 0 }, failed: [],
    };
  }

  const rawLimit = input.limit ?? 6;
  if (!Number.isInteger(rawLimit) || rawLimit < 1) throw new Error('republishAll: limit must be a positive whole number');
  const limit = Math.min(50, rawLimit);
  const budget = input.budgetMs ?? 150_000;
  const batch = eligible.slice(0, limit);
  const results = new Map<string, RepublishResult>();
  let save = Promise.resolve();
  const record = (r: RepublishResult) => {
    results.set(r.slug, r);
    if (r.ok) run!.done.push(r.slug);
    else run!.failed.push({ slug: r.slug, error: r.error || 'exception' });
    run!.updatedAt = new Date(deps.now()).toISOString();
    const snapshot: RepublishRun = JSON.parse(JSON.stringify(run));
    save = save.then(() => deps.store.writeRun(snapshot.runId, snapshot));
    return save;
  };

  const queue = [...batch];
  const worker = async () => {
    while (queue.length) {
      if (deps.now() - startedAt >= budget) return;
      const row = queue.shift()!;
      let r: RepublishResult;
      try {
        r = await republishRow(row, deps, input.by, run!.runId);
      } catch (e) {
        r = { ok: false, slug: row.site_slug!, error: 'exception', detail: errMsg(e) };
      }
      await record(r);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(input.concurrency ?? 2, batch.length || 1)) }, worker));
  await save;

  const ordered = batch.map((r) => results.get(r.site_slug!)).filter(Boolean) as RepublishResult[];
  const notReached = eligible.map((r) => r.site_slug!).filter((slug) => !results.has(slug));
  const remaining = notReached.length;
  return {
    dryRun: false, runId: run!.runId, skipped, results: ordered, remaining, notReached, done: remaining === 0,
    totals: { ok: run!.done.length, failed: run!.failed.length }, failed: run!.failed,
  };
}
