import type { WebsiteData } from '@/web/types';
import { api, type ServerVersionInfo } from '@/lib/api';
import { emitSiteAdopted } from '@/lib/siteEvents';
import * as siteStore from '@/lib/siteStore';
import type { SiteRecord } from '@/lib/siteStore';
import { withTimeout } from '@/lib/timeout';
import { boundMatches } from '@/lib/website';

/** Shown once after the app quietly adopts an admin edit. */
export const SYNC_NOTICE = 'Your site was updated by AI Barber support.';
/** Shown when a publish was refused because an admin edit is newer. */
export const UPDATED_ON_PUBLISH_MESSAGE =
  'Your site was just updated by AI Barber support. Review it and publish again.';
/** Added when the barber had edits that were not published yet. */
const LOST_EDITS = ' Changes you had not published yet were replaced by their version.';
/** A published record from before edits were tracked: we cannot tell. */
const MAYBE_LOST_EDITS = ' Any changes you had not published yet were replaced by their version.';

/** Focus / foreground syncs run at most this often; the publish-time sync is never throttled. */
export const SYNC_MIN_INTERVAL_MS = 60_000;
/** A hung network must not hold up a publish or the launch retry. */
export const SYNC_TIMEOUT_MS = 8_000;

/** The server's copy of a site, as GET /api/ios/site and the 409 body carry it. */
export interface ServerSite extends ServerVersionInfo {
  siteData?: WebsiteData | null;
  deployedUrl?: string | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Only a plain object is site data; a string, array or number from a garbled answer is never adopted. */
export function isPlainSiteData(v: unknown): v is WebsiteData {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The version fields to store from a server response; nothing for an older server. */
export function versionFields(r: ServerVersionInfo | null | undefined): Partial<SiteRecord> {
  if (!r || !isNum(r.version)) return {};
  const out: Partial<SiteRecord> = { serverVersion: r.version };
  if (r.editedBy === 'owner' || r.editedBy === 'admin') out.editedBy = r.editedBy;
  if (typeof r.editedAt === 'string') out.editedAt = r.editedAt;
  return out;
}

/** True when the server holds a newer admin edit than this record has seen. */
export function isNewerAdminEdit(local: SiteRecord, server: ServerSite): boolean {
  return isNum(server.version) && server.editedBy === 'admin' && isPlainSiteData(server.siteData) && server.version > (local.serverVersion ?? 0);
}

function inputsFromData(cur: SiteRecord['inputs'], d: WebsiteData): SiteRecord['inputs'] {
  // The barber's app-only prefs (ownBookingUrl, bookingChoice) and Book input stay as they are.
  const next = { ...cur };
  if (d.shopName) next.shopName = d.shopName;
  if (d.area) next.area = d.area;
  if (d.phone) next.phone = d.phone;
  if (d.template) next.template = d.template;
  if (d.colorTheme) next.colorTheme = d.colorTheme;
  return next;
}

/** The local record with the server's copy of the site in place of its data. Admin wins. */
export function adoptServerCopy(cur: SiteRecord, server: ServerSite): SiteRecord {
  const now = Date.now();
  return {
    ...cur,
    ...versionFields(server),
    data: server.siteData as WebsiteData,
    inputs: inputsFromData(cur.inputs, server.siteData as WebsiteData),
    deployedUrl: server.deployedUrl ?? cur.deployedUrl,
    updatedAt: now,
    syncedAt: now,
  };
}

/**
 * The editor's record with the version bookkeeping from disk (a publish of its
 * own, or a version learned), or null when nothing differs. Never from an
 * admin-edited disk copy: that arrives through a reload, and stamping its
 * version on stale editor data would let a publish overwrite the admin edit.
 */
export function withDiskVersion(cur: SiteRecord, disk: SiteRecord): SiteRecord | null {
  if (disk.editedBy === 'admin') return null;
  const same =
    cur.serverVersion === disk.serverVersion && cur.editedBy === disk.editedBy &&
    cur.editedAt === disk.editedAt && cur.syncedAt === disk.syncedAt;
  if (same) return null;
  return { ...cur, serverVersion: disk.serverVersion, editedBy: disk.editedBy, editedAt: disk.editedAt, syncedAt: disk.syncedAt };
}

/** 'yes': edits after the last publish. 'maybe': a published record from before edits were tracked. */
export function unpublishedEdits(r: SiteRecord): 'yes' | 'maybe' | 'no' {
  if (r.syncedAt != null) return r.updatedAt > r.syncedAt ? 'yes' : 'no';
  return r.slug != null ? 'maybe' : 'no';
}

export interface SyncDeps {
  iosSite: typeof api.iosSite;
  store: Pick<typeof siteStore, 'loadSite' | 'saveSite' | 'savePendingPublish'>;
}

/**
 * Adopts a server copy into the LATEST stored record (not one loaded before a
 * network call), clears any pending publish (its data is stale now), keeps the
 * notice on the record until it is shown, and tells the open screens.
 */
export async function adoptAndSave(
  store: SyncDeps['store'], base: string, server: ServerSite,
): Promise<{ site: SiteRecord; message: string } | null> {
  const cur = await store.loadSite();
  if (!cur || !isPlainSiteData(server.siteData)) return null;
  const lost = unpublishedEdits(cur);
  const message = base + (lost === 'yes' ? LOST_EDITS : lost === 'maybe' ? MAYBE_LOST_EDITS : '');
  const site = { ...adoptServerCopy(cur, server), noticePending: message };
  await store.savePendingPublish(null);
  await store.saveSite(site);
  emitSiteAdopted(site);
  return { site, message };
}

let shown = false;
/**
 * The notice to show, once: read from the record (so it survives a kill before
 * it was shown) and cleared. null when there is nothing to tell.
 */
export async function takeNotice(): Promise<string | null> {
  if (shown) return null;
  shown = true;
  try {
    const cur = await siteStore.loadSite();
    if (!cur?.noticePending) return null;
    const { noticePending, ...rest } = cur;
    await siteStore.saveSite(rest);
    return noticePending;
  } catch {
    return null;
  } finally {
    shown = false;
  }
}

export type SyncResult = { kind: 'adopted'; site: SiteRecord; message: string } | { kind: 'none' };

export interface SyncOptions {
  /** Skip when a sync ran less than this long ago. */
  throttleMs?: number;
  /** Give up on the request after this long. */
  timeoutMs?: number;
}

let inflight: Promise<SyncResult> | null = null;
let lastRun = 0;
/** Tests only. */
export function resetSyncState(): void {
  inflight = null;
  lastRun = 0;
}

async function run(deps: SyncDeps, transactionId: string | null | undefined, timeoutMs?: number): Promise<SyncResult> {
  const before = await deps.store.loadSite();
  const tx = transactionId ?? before?.transactionId;
  if (!before || !tx) return { kind: 'none' };
  const req = deps.iosSite(tx);
  const server = await (timeoutMs ? withTimeout(req, timeoutMs) : req);
  // Edits saved while the request ran: judge and replace the latest record, not the one from before.
  const cur = await deps.store.loadSite();
  if (!cur || !boundMatches(cur, { siteId: server.siteId, deployedUrl: server.deployedUrl })) return { kind: 'none' };
  if (isNewerAdminEdit(cur, server)) {
    const done = await adoptAndSave(deps.store, SYNC_NOTICE, server);
    return done ? { kind: 'adopted', ...done } : { kind: 'none' };
  }
  // Not an admin edit (or an older server): just learn the version, keep the data.
  if (isNum(server.version) && server.version > (cur.serverVersion ?? -1)) {
    await deps.store.saveSite({ ...cur, ...versionFields(server) });
  }
  return { kind: 'none' };
}

/**
 * GET /api/ios/site for the site's transaction: if an admin edit is newer than
 * what this phone has seen, replace the local site data with the server copy
 * (the barber's Book-button prefs are kept), queue the one-time notice and tell
 * the open screens. One request at a time: concurrent callers share it. Every
 * failure is silent and returns 'none': it must never block editing.
 */
export function syncFromServer(
  deps: SyncDeps, transactionId?: string | null, opts: SyncOptions = {},
): Promise<SyncResult> {
  if (inflight) return inflight;
  if (opts.throttleMs && Date.now() - lastRun < opts.throttleMs) return Promise.resolve({ kind: 'none' });
  lastRun = Date.now();
  const p = run(deps, transactionId, opts.timeoutMs)
    .catch((): SyncResult => ({ kind: 'none' }))
    .finally(() => {
      inflight = null;
    });
  inflight = p;
  return p;
}

const real: SyncDeps = { iosSite: (tx) => api.iosSite(tx), store: siteStore };

/** Launch, foreground and Edit focus: at most once a minute, quiet. */
export const syncQuietly = (transactionId?: string | null) =>
  syncFromServer(real, transactionId, { throttleMs: SYNC_MIN_INTERVAL_MS, timeoutMs: SYNC_TIMEOUT_MS });

/** Right before a publish: always, with a short timeout. */
export const syncNow = (transactionId?: string | null) =>
  syncFromServer(real, transactionId, { timeoutMs: SYNC_TIMEOUT_MS });
