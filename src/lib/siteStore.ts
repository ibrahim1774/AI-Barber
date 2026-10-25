import Storage from 'expo-sqlite/kv-store';
import type { ShopInputs, WebsiteData } from '@/web/types';
import type { BookingPrefs, LiveLinks } from '@/lib/bookingChoice';

export interface SiteRecord {
  draftId: string;
  inputs: ShopInputs & BookingPrefs;
  data: WebsiteData;
  updatedAt: number;
  slug: string | null;
  deployedUrl: string | null;
  transactionId: string | null;
  /**
   * The signed-in account this record belongs to (set when it is synced to, adopted from or restored for
   * one). Absent: built signed out. Never sent anywhere, never tracked.
   */
  ownerUserId?: string;
  /**
   * `updatedAt` as of the last time this record matched the owner's `sites` row (pushed to it, or adopted
   * from it). Absent or older than `updatedAt`: the phone holds edits the account does not have yet.
   */
  accountSyncedAt?: number;
  /** The server's site version at the last publish / sync. Absent: an older server or record (no version info). */
  serverVersion?: number;
  editedBy?: 'owner' | 'admin';
  editedAt?: string;
  /** `updatedAt` as of the last publish or adopted server copy; later edits are unpublished. */
  syncedAt?: number;
  /** An admin edit was adopted and the barber has not been told yet: the message to show, cleared when shown. */
  noticePending?: string;
  /** The Book / Shop links the live site shows (last publish, adopted admin copy, or restore). Absent: unknown. */
  liveLinks?: LiveLinks;
}

export interface PendingPublish {
  /** null: the user paid, but the transaction id hasn't been looked up yet. */
  transactionId: string | null;
  data: WebsiteData;
  createdAt: number;
  /** The site version this data was based on; a resumed publish carries it, never a newer one. */
  baseVersion?: number;
}

const SITE_KEY = 'site.v1';
const PENDING_KEY = 'pendingPublish.v1';

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await Storage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as T) : null;
  } catch {
    return null;
  }
}

/** One site per install (one site per subscription). */
export const loadSite = () => readJson<SiteRecord>(SITE_KEY);
export const saveSite = (r: SiteRecord) => Storage.setItem(SITE_KEY, JSON.stringify(r));
export async function clearSite(): Promise<void> {
  await Storage.removeItem(SITE_KEY);
}

export const loadPendingPublish = () => readJson<PendingPublish>(PENDING_KEY);
export async function savePendingPublish(p: PendingPublish | null): Promise<void> {
  if (p === null) await Storage.removeItem(PENDING_KEY);
  else await Storage.setItem(PENDING_KEY, JSON.stringify(p));
}
