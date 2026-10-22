import type { WebsiteData } from '@/web/types';
import { api, type ServerVersionInfo } from '@/lib/api';
import { boundMatches } from '@/lib/website';
import * as siteStore from '@/lib/siteStore';
import type { SiteRecord } from '@/lib/siteStore';

/** Shown once after the app quietly adopts an admin edit. */
export const SYNC_NOTICE = 'Your site was updated by AI Barber support.';
/** Shown when a publish was refused because an admin edit is newer. */
export const UPDATED_ON_PUBLISH_MESSAGE =
  'Your site was just updated by AI Barber support. Review it and publish again.';
/** Added when the barber had edits that were not published yet. */
const LOST_EDITS = ' Changes you had not published yet were replaced by their version.';

/** The server's copy of a site, as GET /api/ios/site and the 409 body carry it. */
export interface ServerSite extends ServerVersionInfo {
  siteData?: WebsiteData | null;
  deployedUrl?: string | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
  return isNum(server.version) && server.editedBy === 'admin' && !!server.siteData && server.version > (local.serverVersion ?? 0);
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

/** True when the record has edits made after its last publish / adopted copy. */
export const hasUnpublishedEdits = (r: SiteRecord) => r.syncedAt != null && r.updatedAt > r.syncedAt;

let notice: string | null = null;
export function queueNotice(message: string): void {
  notice = message;
}
/** The notice to show, once. */
export function takeNotice(): string | null {
  const n = notice;
  notice = null;
  return n;
}

export type SyncResult = { kind: 'adopted'; site: SiteRecord; message: string } | { kind: 'none' };

export interface SyncDeps {
  iosSite: typeof api.iosSite;
  store: Pick<typeof siteStore, 'loadSite' | 'saveSite'>;
}

/** Adopts a server copy into the stored record; returns it and the message to tell the barber. */
export async function adoptAndSave(
  store: SyncDeps['store'], cur: SiteRecord, server: ServerSite, base: string,
): Promise<{ site: SiteRecord; message: string }> {
  const site = adoptServerCopy(cur, server);
  await store.saveSite(site);
  return { site, message: hasUnpublishedEdits(cur) ? base + LOST_EDITS : base };
}

/**
 * GET /api/ios/site for the site's transaction: if an admin edit is newer than
 * what this phone has seen, replace the local site data with the server copy
 * (the barber's Book-button prefs are kept) and queue the one-time notice.
 * Every failure is silent and returns 'none': it must never block editing.
 */
export async function syncFromServer(deps: SyncDeps, transactionId?: string | null): Promise<SyncResult> {
  try {
    const cur = await deps.store.loadSite();
    const tx = transactionId ?? cur?.transactionId;
    if (!cur || !tx) return { kind: 'none' };
    const server = await deps.iosSite(tx);
    // Another site's subscription on this phone: not ours to adopt.
    if (!boundMatches(cur, { siteId: server.siteId, deployedUrl: server.deployedUrl })) return { kind: 'none' };
    if (isNewerAdminEdit(cur, server)) {
      const { site, message } = await adoptAndSave(deps.store, cur, server, SYNC_NOTICE);
      queueNotice(message);
      return { kind: 'adopted', site, message };
    }
    // Not an admin edit (or an older server): just learn the version, keep the data.
    if (isNum(server.version) && server.version > (cur.serverVersion ?? -1)) {
      const latest = (await deps.store.loadSite()) ?? cur;
      await deps.store.saveSite({ ...latest, ...versionFields(server) });
    }
    return { kind: 'none' };
  } catch {
    return { kind: 'none' };
  }
}

/** The app's own wiring: real API and site store. */
export const syncQuietly = (transactionId?: string | null) =>
  syncFromServer({ iosSite: api.iosSite, store: siteStore }, transactionId);
