import { randomUUID } from 'expo-crypto';
import type { ShopInputs, WebsiteData } from '@/web/types';
import { adoptServerCopy, isNewerAdminEdit, isPlainSiteData, versionFields } from '@/lib/adminSync';
import { resetUser, track } from '@/lib/analytics';
import { api, ApiError } from '@/lib/api';
import { clearCustomersCache } from '@/lib/bookings/customersCache';
import { clearEntitlements } from '@/lib/entitlements';
import { resetSharedPlan } from '@/lib/plan';
import { clearOverlayFlags } from '@/lib/overlayFlags';
import { accessToken } from '@/lib/accessToken';
import { SIGN_IN_TO_RESTORE_CODE } from '@/lib/claimCopy';
import { findTransactionId, publishPayload, runSerial } from '@/lib/publish';
import { linksOf } from '@/lib/bookingChoice';
import { cancelAllReminders, cancelRemindersInBackground } from '@/lib/reminders';
import { emitSiteAdopted, onSiteAdopted } from '@/lib/siteEvents';
import * as siteStore from '@/lib/siteStore';
import type { PendingPublish, SiteRecord } from '@/lib/siteStore';
import { supabase } from '@/lib/supabase';
import { boundMatches } from '@/lib/website';

/** `site_data.source` on rows the app writes. */
export const IOS_SOURCE = 'ios';

/**
 * Upserts the local site into public.sites with the columns the web writes in
 * upsertSiteToSupabase (services/supabaseDataService.ts), minus the domain
 * columns, so the account sees
 * it on aibarber.org too. RLS allows it for the row's own user. The site is
 * bound to the Apple transaction; the account row is a copy, read back by
 * pullSiteFromAccount when it was edited on the web or on another phone.
 */
export async function syncSiteToSupabase(site: SiteRecord, userId: string): Promise<void> {
  // Never write another account's site under this account's id.
  if (site.ownerUserId && site.ownerUserId !== userId) throw new Error('site belongs to another account');
  const data = publishPayload(site.data); // no editor markers, no inline data: images
  const { error } = await supabase.from('sites').upsert(
    {
      id: site.draftId,
      user_id: userId,
      company_name: data.shopName,
      industry: 'barbershop',
      service_area: data.area,
      phone: data.phone,
      brand_colour: '#f4a100',
      // `source` marks an app-made row, so a fresh install can find it again
      // (pullSiteFromAccount). It is stripped again when a row is adopted.
      site_data: { ...data, source: IOS_SOURCE },
      deployed_url: site.deployedUrl,
      deployment_status: site.deployedUrl ? 'deployed' : 'draft',
      // custom_domain / domain_order_id are left out on purpose: the web
      // dashboard attaches a bought domain to this row, and a sync must not
      // wipe it (an insert leaves them null).
      // The time of the last local edit, not of this push: then the row only
      // looks newer than this phone's copy after an edit made elsewhere.
      updated_at: new Date(Number.isFinite(site.updatedAt) ? site.updatedAt : Date.now()).toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) throw error;
}

/**
 * Pushes the local site (or `site`) to the signed-in account, if there is
 * one. Best effort: logs and never throws, so it can follow a sign-in or a
 * publish without failing it.
 */
export async function syncIfSignedIn(site?: SiteRecord | null): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (!userId) return;
    // A paid claim in progress: the draft goes to the account only once the publish is confirmed (onLive), never
    // into an account the server may still refuse (409), where it would then block the right one.
    if (await hasLockedClaim()) return;
    const record = site ?? (await siteStore.loadSite());
    if (!record) return;
    await syncSiteToSupabase(record, userId);
    await stampOwner(record.draftId, userId, record.updatedAt);
  } catch (e) {
    console.warn('[account] site sync failed:', e);
  }
}

/** True while a paid publish waits on its account step (unclaimed, claiming or refused): the locked /claim state. */
export async function hasLockedClaim(): Promise<boolean> {
  return (await siteStore.loadPendingPublish().catch(() => null))?.state != null;
}

/** Marks the local record (if it is still `draftId`) as belonging to `userId`. Best effort. */
async function stampOwner(draftId: string, userId: string, syncedUpdatedAt: number): Promise<void> {
  try {
    const cur = await siteStore.loadSite();
    // accountSyncedAt is the updatedAt that was pushed, not the current one: an edit made during the push stays unsaved.
    if (cur && cur.draftId === draftId && (cur.ownerUserId !== userId || cur.accountSyncedAt !== syncedUpdatedAt)) {
      await siteStore.saveSite({ ...cur, ownerUserId: userId, accountSyncedAt: syncedUpdatedAt });
    }
  } catch (e) {
    console.warn('[account] could not mark the site owner:', e);
  }
}

type SiteRow = { id: string; site_data: unknown; deployed_url: string | null; updated_at: string | null };
const ROW_COLUMNS = 'id, site_data, deployed_url, updated_at';

export type PullResult = 'adopted' | 'unchanged' | null;

export { onSiteAdopted };

function isSiteData(v: unknown): v is WebsiteData & { source?: unknown } {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The row's site data without the app's own `source` marker (never sent to /api/ios/publish). */
function siteDataFrom(raw: WebsiteData & { source?: unknown }): WebsiteData {
  const { source: _source, ...rest } = raw;
  return rest as WebsiteData;
}

/**
 * Loads the account's copy of the site when it is newer than this phone's:
 * edited on aibarber.org, or on another phone.
 *
 * - With a local site: its own row (`id = draftId`). Adopted (site data,
 *   deployed URL) only if the row's `updated_at` is later than the local
 *   `updatedAt`; the draft id, slug and transaction stay.
 * - Without one: this user's newest app-made row (`site_data.source = 'ios'`)
 *   becomes the local site.
 *
 * A local edit made while the row was loading wins (the save is skipped).
 * Never throws: null after an error, with nothing changed.
 */
export async function pullSiteFromAccount(userId: string): Promise<PullResult> {
  try {
    const local = await siteStore.loadSite();
    // Another account's site on this phone is never adopted into (afterSession swaps it on sign-in).
    if (local?.ownerUserId && local.ownerUserId !== userId) return 'unchanged';
    const sites = supabase.from('sites');
    const { data: row, error } = local
      ? await sites.select(ROW_COLUMNS).eq('id', local.draftId).eq('user_id', userId).maybeSingle()
      : await sites
          .select(ROW_COLUMNS)
          .eq('user_id', userId)
          .eq('site_data->>source', IOS_SOURCE)
          .order('updated_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();
    if (error) throw error;
    const r = row as SiteRow | null;
    if (!r || !isSiteData(r.site_data)) return 'unchanged';
    const rowAt = Date.parse(r.updated_at ?? '');
    const data = siteDataFrom(r.site_data);

    if (local && (Number.isNaN(rowAt) || !(rowAt > local.updatedAt))) return 'unchanged';

    // Compare and swap: an edit (or another load) since the read wins.
    const cur = await siteStore.loadSite();
    if (local) {
      if (!cur || cur.draftId !== local.draftId || cur.updatedAt !== local.updatedAt) return 'unchanged';
    } else if (cur) {
      return 'unchanged';
    }

    // Built on the record as it is now: a publish that landed during the fetch
    // (slug, transaction, URL; it keeps updatedAt) is never undone.
    const next: SiteRecord = cur
      ? {
          ...cur,
          data,
          inputs: { ...cur.inputs, ...inputsFrom(data) },
          deployedUrl: r.deployed_url ?? cur.deployedUrl,
          updatedAt: rowAt,
          accountSyncedAt: rowAt,
          ownerUserId: userId,
        }
      : {
          draftId: r.id,
          inputs: inputsFrom(data),
          data,
          updatedAt: Number.isNaN(rowAt) ? Date.now() : rowAt,
          accountSyncedAt: Number.isNaN(rowAt) ? Date.now() : rowAt,
          slug: null,
          deployedUrl: r.deployed_url ?? null,
          transactionId: null,
          ownerUserId: userId,
        };
    await siteStore.saveSite(next);
    emitSiteAdopted(next);
    return 'adopted';
  } catch (e) {
    console.warn('[account] loading the site from the account failed:', e);
    return null;
  }
}

export type SwitchResult = 'same' | 'replaced' | 'cleared';

/**
 * Sign-in to `userId` on a phone whose site belongs to a different account.
 *
 * - 'same': no site, a site built signed out (legacy, no owner), or this account's own: nothing changed.
 * - 'replaced': this account's newest app-made `sites` row (else its newest web-made row, if it is plain
 *   site data) becomes the local site, wholesale (new draft id, no slug or transaction).
 * - 'cleared': the account has no site; the other account's site and pending publish are removed from the
 *   phone. Their `sites` row on the server is never touched, and nothing is written for this account.
 *
 * Throws when the lookup fails, with the phone unchanged (the caller signs out again).
 */
export const UNSAVED_OTHER_ACCOUNT =
  "This phone has unsaved changes from another account. Sign in to that account first so they're saved, or delete the data on this phone in Settings.";

export async function switchAccountSite(userId: string, isCurrent: () => boolean = () => true): Promise<SwitchResult> {
  const local = await siteStore.loadSite();
  if (!local || !local.ownerUserId || local.ownerUserId === userId) return 'same';
  // The other account's edits or paid publish exist nowhere else: never wipe them for someone else's sign-in.
  const pending = await siteStore.loadPendingPublish();
  if (pending || !((local.accountSyncedAt ?? -1) >= local.updatedAt)) throw new Error(UNSAVED_OTHER_ACCOUNT);

  const newest = (appMade: boolean) => {
    let q = supabase.from('sites').select(ROW_COLUMNS).eq('user_id', userId);
    if (appMade) q = q.eq('site_data->>source', IOS_SOURCE);
    return q.order('updated_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  };
  let res = await newest(true);
  if (res.error) throw res.error;
  // No app-made site: any plain site this account has (made on aibarber.org).
  if (!res.data) {
    res = await newest(false);
    if (res.error) throw res.error;
  }
  const r = res.data as SiteRow | null;
  const found = r && isSiteData(r.site_data) && isPlainSiteData(r.site_data) ? r : null;
  // A sign-in that timed out (or was replaced) is signed out again: it must not write anything.
  if (!isCurrent()) throw new Error('sign-in cancelled');

  await cancelAllReminders({ forGood: false }).catch(() => {});
  await clearOverlayFlags(local.draftId).catch(() => {});
  await siteStore.savePendingPublish(null);
  clearCustomersCache();
  resetSharedPlan(); // the other account's tier, entitlements and team cap
  clearEntitlements();
  if (!found) {
    await siteStore.clearSite();
    return 'cleared';
  }
  const data = siteDataFrom(found.site_data as WebsiteData & { source?: unknown });
  const rowAt = Date.parse(found.updated_at ?? '');
  const now = Date.now();
  const next: SiteRecord = {
    draftId: found.id,
    inputs: inputsFrom(data),
    data,
    updatedAt: Number.isNaN(rowAt) ? now : rowAt,
    accountSyncedAt: Number.isNaN(rowAt) ? now : rowAt,
    slug: null,
    deployedUrl: found.deployed_url ?? null,
    transactionId: null,
    syncedAt: now,
    ownerUserId: userId,
  };
  await siteStore.saveSite(next);
  emitSiteAdopted(next);
  return 'replaced';
}

/**
 * Before signing out: pushes the local site to the signed-in account and says whether it is then safe to
 * remove it from the phone (it is in the account, nothing unpublished is pending, and it is this account's).
 * Never throws.
 */
export async function pushSiteBeforeSignOut(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    const local = await siteStore.loadSite();
    if (!local) return false;
    if (!userId || (local.ownerUserId && local.ownerUserId !== userId)) return false;
    // A paid claim in progress leaves the phone as it is: nothing is pushed to (or stamped for) an account the
    // server may refuse, and the draft stays for the next account.
    if (await hasLockedClaim()) return false;
    // Sync first, so the account has the latest edits even when a paid publish is still pending.
    // A newer web edit is taken in before the push, never overwritten by this phone's older copy.
    await pullSiteFromAccount(userId);
    const fresh = (await siteStore.loadSite()) ?? local;
    await syncSiteToSupabase(fresh, userId);
    await stampOwner(fresh.draftId, userId, fresh.updatedAt);
    if (await siteStore.loadPendingPublish()) return false; // the pending publish stays on the phone
    return true;
  } catch (e) {
    console.warn('[account] final sync before sign out failed:', e);
    return false;
  }
}

/** Removes the local site after a sign-out that pushed it first (see pushSiteBeforeSignOut). */
export async function clearSiteAfterSignOut(): Promise<void> {
  const local = await siteStore.loadSite();
  if (local) await clearOverlayFlags(local.draftId).catch(() => {});
  await cancelAllReminders({ forGood: false }).catch(() => {});
  await siteStore.clearSite();
}

let launchPull: Promise<PullResult> | null = null;

/**
 * Once per launch, when a session already exists: pullSiteFromAccount for it.
 * The index awaits it (capped) when there is no local site; _layout starts it
 * in the background otherwise. Never throws.
 */
export function pullSiteOnLaunch(): Promise<PullResult> {
  if (!launchPull) {
    launchPull = (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const userId = data.session?.user?.id;
        return userId ? await pullSiteFromAccount(userId) : null;
      } catch (e) {
        console.warn('[account] launch pull failed:', e);
        return null;
      }
    })();
  }
  return launchPull;
}

/** Test only: let the next pullSiteOnLaunch run again. */
export function resetLaunchPullForTests(): void {
  launchPull = null;
}

export interface RestoreDeps {
  /** Superwall restorePurchases: syncs StoreKit. Its result proves nothing on its own. */
  restorePurchases(): Promise<unknown>;
  /** getCustomerInfo().subscriptions → pickLatestTransactionId */
  latestTransactionId(): Promise<string | null>;
  iosSite: typeof api.iosSite;
  store: typeof siteStore;
  /** Signed out: POST claim-start tells paid-unclaimed from linked-elsewhere. */
  claimStart?: typeof api.claimStart;
  /** The signed-in account's token, null when signed out. */
  accessToken?: () => Promise<string | null>;
}

function inputsFrom(d: WebsiteData): ShopInputs {
  const inputs: ShopInputs = { shopName: d.shopName ?? '', area: d.area ?? '', phone: d.phone ?? '' };
  if (d.template) inputs.template = d.template;
  if (d.colorTheme) inputs.colorTheme = d.colorTheme;
  if (d.bookingUrl) inputs.bookingUrl = d.bookingUrl;
  return inputs;
}

export interface Restored {
  site: SiteRecord;
  /** false: the content is back, but the subscription has lapsed (publishing will need a new one). */
  active: boolean;
}

/**
 * What Restore purchases leads to besides a restored site: the locked account step, or a publish into the account.
 * Neither copies a site anywhere; the caller routes (restoreFlow).
 */
export type RestoreOutcome = Restored | { claim: 'sign-up' } | { claim: 'publish' };

/**
 * Restore purchases → this Apple ID's active AI Barber transaction → what the ACCOUNT owns.
 *
 * - Signed in: /api/ios/site with the Bearer returns the site only when the purchase is linked to this account
 *   (409 purchase-other-account otherwise: thrown, nothing is saved, no site is ever copied into another account).
 *   404 no-site while unpublished content waits on this phone (a pending publish, or an unpublished draft that is
 *   this account's) resolves to `{ claim: 'publish' }`: the caller publishes it with the Bearer, which links the
 *   purchase to this account.
 * - Signed out: nothing is requested from the site endpoint. claim-start says whether the purchase is unclaimed;
 *   with content on the phone it becomes a pending 'unclaimed' publish and the answer is `{ claim: 'sign-up' }`
 *   (the locked /claim step). Linked to an account: throws `sign-in-required`.
 * - null: no active subscription.
 *
 * Restoring the site already on this phone (the same slug, or for a site loaded from the account the same live
 * link) keeps its local edits. Any other local draft is replaced by the paid site, keeping the draft id (the
 * `sites` row and photo folder key); a different live site gets a new id, so its account row is never
 * overwritten with this one. A null deployedUrl is kept as null: the server only lacks it if the last deploy's
 * stamp failed, and the live URL comes from Vercel's alias list, so it can't safely be rebuilt here.
 */
export async function restore(deps: RestoreDeps): Promise<RestoreOutcome | null> {
  await deps.restorePurchases();
  const transactionId = await findTransactionId(deps.latestTransactionId);
  if (!transactionId) return null;

  const token = await (deps.accessToken ?? accessToken)().catch(() => null);
  if (!token) return restoreSignedOut(deps, transactionId);

  let uid: string | undefined;
  try {
    uid = (await supabase.auth.getSession()).data.session?.user?.id;
  } catch {
    /* the session can't be read: left unowned */
  }
  let answer: Awaited<ReturnType<typeof api.iosSite>>;
  try {
    answer = await deps.iosSite(transactionId);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && e.code === 'no-site' && (await claimableContent(deps.store, uid, transactionId))) {
      return { claim: 'publish' };
    }
    throw e;
  }
  // A garbled copy (not a plain object) counts as no content.
  const bound = isPlainSiteData(answer.siteData) ? answer : { ...answer, siteData: null };
  const local = await deps.store.loadSite();
  // The same slug, or (a site loaded from the account, no slug yet) the same
  // live link: either way the local copy is this site, maybe newer than the
  // last publish (web edits), so it is kept rather than replaced.
  const sameSite = local != null && boundMatches(local, bound);
  if (!sameSite && !bound.siteData) return null;

  const now = Date.now();
  // A signed-in account's own, different site must never be overwritten: the new site gets its own id.
  // Only a never-owned, unpublished draft keeps its id (photo folder key); anything an account owns gets a new row.
  const keepDraftId = !!local && !local.deployedUrl && !local.ownerUserId;
  const record: SiteRecord =
    sameSite && local
      ? {
          // A newer admin edit replaces the local copy; otherwise local edits are kept.
          ...(isNewerAdminEdit(local, bound) ? adoptServerCopy(local, bound) : local),
          slug: bound.siteId,
          deployedUrl: bound.deployedUrl ?? local.deployedUrl,
          transactionId,
          updatedAt: now,
          syncedAt: now,
          ...versionFields(bound),
          ...(bound.siteData ? { liveLinks: linksOf(bound.siteData) } : {}),
        }
      : {
          draftId: keepDraftId && local ? local.draftId : randomUUID(),
          inputs: inputsFrom(bound.siteData!),
          data: bound.siteData!,
          updatedAt: now,
          syncedAt: now,
          slug: bound.siteId,
          deployedUrl: bound.deployedUrl,
          transactionId,
          ...versionFields(bound),
          liveLinks: linksOf(bound.siteData),
        };
  // A pending publish is left alone: it is paid content for this same
  // subscription, and the launch retry still sends it to the bound site.
  // A restored site belongs to the account signed in now.
  if (uid) record.ownerUserId = uid;
  await deps.store.saveSite(record);
  // A restored site is paid and published: no more reminders (start, Settings
  // and sign-in all restore through here). Never affects the restore.
  cancelRemindersInBackground();
  return { site: record, active: bound.active !== false };
}

/**
 * Content this phone can publish into the signed-in account to claim a paid, unpublished subscription: a pending
 * publish, else an unpublished draft that is not another account's (saved as a pending publish).
 */
async function claimableContent(store: typeof siteStore, uid: string | undefined, transactionId: string): Promise<boolean> {
  const pending = await store.loadPendingPublish().catch(() => null);
  if (pending) return pending.state !== 'conflict';
  const local = await store.loadSite().catch(() => null);
  // A site pulled from the account is live (deployedUrl) even though it has no slug of its own: never republished here.
  if (!local || local.slug != null || local.deployedUrl || (local.ownerUserId && local.ownerUserId !== uid)) return false;
  // No state: an ordinary publish, so a 409 from the server stops with its words and never locks the app.
  await store.savePendingPublish({
    transactionId, data: publishPayload(local.data), createdAt: Date.now(), baseVersion: local.serverVersion,
  });
  return true;
}

async function restoreSignedOut(deps: RestoreDeps, transactionId: string): Promise<RestoreOutcome | null> {
  const claimStart = deps.claimStart ?? api.claimStart;
  let hasSite = false;
  try {
    await claimStart(transactionId);
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.code === 'purchase-has-site') hasSite = true;
    else if (e instanceof ApiError && e.status === 409) throw new ApiError(401, SIGN_IN_TO_RESTORE_CODE, 'Sign in to restore.');
    else throw e;
  }
  const pending = await deps.store.loadPendingPublish().catch(() => null);
  const local = await deps.store.loadSite().catch(() => null);
  const data = pending?.data ?? (local ? publishPayload(local.data) : null);
  if (!data) {
    // A legacy site lives under this Apple ID but nothing here can publish into an account: sign in to its owner.
    if (hasSite) throw new ApiError(401, SIGN_IN_TO_RESTORE_CODE, 'Sign in to restore.');
    throw new ApiError(404, 'no-site', 'No website yet.');
  }
  const { conflict: _drop, ...rest } = pending ?? {
    transactionId, data, createdAt: Date.now(), baseVersion: local?.serverVersion,
  } as PendingPublish;
  await deps.store.savePendingPublish({ ...rest, transactionId: rest.transactionId ?? transactionId, state: 'unclaimed' });
  return { claim: 'sign-up' };
}

/**
 * "Delete data on this phone": the site, a pending publish and the editor's
 * per-draft flags. Phone only: a published site stays live until it is taken
 * offline (takeWebsiteOffline).
 */
export async function deleteLocalData(): Promise<void> {
  clearCustomersCache();
  const site = await siteStore.loadSite();
  // Both delete paths come through here. A payer (published, or paid and
  // publishing) gets no more reminders; an unpublished draft's "finish"
  // reminders (with its shop name) go, and the start copy can follow.
  const paid = site?.slug != null || site?.transactionId != null || (await siteStore.loadPendingPublish()) != null;
  await cancelAllReminders({ forGood: paid });
  if (site) await clearOverlayFlags(site.draftId);
  await siteStore.savePendingPublish(null);
  await siteStore.clearSite();
}

/**
 * In-app account deletion (App Store 5.1.1(v)): the server deletes the user
 * and their `sites` rows first; only then is this phone signed out and
 * cleared. A failure throws and leaves everything as it was.
 */
export async function deleteAccountAndData(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in to delete your account.');
  // The server only removes sites whose purchase is linked to this account. A site published signed out and
  // never linked would stay live while the phone forgets it, so take it offline first by its own transaction.
  const local = await siteStore.loadSite().catch(() => null);
  if (local?.transactionId) {
    try {
      await api.takeSiteOffline(local.transactionId, token, local.slug);
    } catch (e) {
      // Nothing bound / someone else's / a different site: not ours to remove. Anything else: stop, nothing is cleared.
      if (!(e instanceof ApiError && (e.status === 404 || e.status === 403 || e.status === 409))) throw e;
    }
  }
  await api.deleteAccount(token);
  try {
    // The user no longer exists on the server: only drop the local session.
    await supabase.auth.signOut({ scope: 'local' }).catch((e: unknown) => console.warn('[account] sign out failed:', e));
    await deleteLocalData();
  } finally {
    // The account is gone whatever happens locally: no more reminders.
    await cancelAllReminders();
    clearCustomersCache();
    // The event first, so it is still recorded against the deleted user; then PostHog forgets them.
    track('account_deleted');
    resetUser();
  }
}

/**
 * "Take my website offline" (App Store 5.1.1(v), no account needed): the server verifies the Apple
 * transaction (the same proof publish uses), takes the bound site offline and deletes its copy and
 * photos. Only after the server says yes is the site cleared from this phone. A failure throws and
 * leaves everything as it was.
 */
export async function takeWebsiteOffline(
  transactionId: string | null | undefined,
  /** The site shown on the phone. Given: the purchase must be bound to this very site, or nothing is removed. */
  site?: Pick<SiteRecord, 'draftId' | 'slug' | 'deployedUrl'> | null,
): Promise<void> {
  const tx = (transactionId ?? '').trim();
  if (!tx) throw new ApiError(404, 'no-site', 'We couldn’t find your subscription. Restore purchases first.');
  // In the publish queue: a pending paid publish or launch retry finishes first, so it cannot land after the removal.
  return runSerial(async () => {
    let token: string | undefined;
    let userId: string | undefined;
    try {
      const session = (await supabase.auth.getSession()).data.session;
      token = session?.access_token;
      userId = session?.user?.id;
    } catch {
      token = undefined;
    }
    let expectedSlug: string | undefined;
    if (site) {
      if (token) {
        // Same check publish makes: take down exactly the site on screen, never another one on this Apple ID.
        const bound = await api.iosSite(tx); // Bearer sent by api; throws no-site / 409 / network: nothing is removed
        if (!boundMatches(site, bound)) {
          throw new ApiError(409, 'site-mismatch', 'This Apple ID’s website is not the one shown on this phone.');
        }
        expectedSlug = bound.siteId;
      } else {
        // Signed out the site lookup needs an account, so the phone's own slug is the check (the server answers
        // 409 site-mismatch for any other site). A site with no slug of its own cannot be proven: nothing is removed.
        if (!site.slug) throw new ApiError(409, 'site-mismatch', 'This Apple ID’s website is not the one shown on this phone.');
        expectedSlug = site.slug;
      }
    }
    await api.takeSiteOffline(tx, token, expectedSlug);
    // The server said yes: the site is offline. A local cleanup failure must not turn that into an error.
    track('site_taken_offline');
    if (site && userId) {
      // The account's copy would otherwise be re-adopted on the next launch, as a "live" site.
      try {
        const { error } = await supabase.from('sites').delete().eq('id', site.draftId).eq('user_id', userId);
        if (error) console.warn('[account] could not remove the account copy of the site:', error);
      } catch (e) {
        console.warn('[account] could not remove the account copy of the site:', e);
      }
    }
    try {
      await deleteLocalData();
    } catch (e) {
      console.warn('[account] site is offline but clearing this phone failed:', e);
      // The essentials, one by one, so the phone returns to a fresh start and a new site can be published.
      await siteStore.savePendingPublish(null).catch(() => {});
      await siteStore.clearSite().catch(() => {});
    }
  });
}
