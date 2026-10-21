import { randomUUID } from 'expo-crypto';
import type { ShopInputs, WebsiteData } from '@/web/types';
import { resetUser, track } from '@/lib/analytics';
import { api } from '@/lib/api';
import { clearOverlayFlags } from '@/lib/overlayFlags';
import { findTransactionId, publishPayload } from '@/lib/publish';
import { cancelAllReminders, cancelRemindersInBackground } from '@/lib/reminders';
import * as siteStore from '@/lib/siteStore';
import type { SiteRecord } from '@/lib/siteStore';
import { supabase } from '@/lib/supabase';

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
    const record = site ?? (await siteStore.loadSite());
    if (!record) return;
    await syncSiteToSupabase(record, userId);
  } catch (e) {
    console.warn('[account] site sync failed:', e);
  }
}

type SiteRow = { id: string; site_data: unknown; deployed_url: string | null; updated_at: string | null };
const ROW_COLUMNS = 'id, site_data, deployed_url, updated_at';

export type PullResult = 'adopted' | 'unchanged' | null;

const adoptedListeners = new Set<(site: SiteRecord) => void>();

/** Called with the new local record whenever pullSiteFromAccount adopts one. Returns the unsubscribe. */
export function onSiteAdopted(cb: (site: SiteRecord) => void): () => void {
  adoptedListeners.add(cb);
  return () => {
    adoptedListeners.delete(cb);
  };
}

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
    const sites = supabase.from('sites');
    const { data: row, error } = local
      ? await sites.select(ROW_COLUMNS).eq('id', local.draftId).eq('user_id', userId).maybeSingle()
      : await sites
          .select(ROW_COLUMNS)
          .eq('user_id', userId)
          .eq('site_data->>source', IOS_SOURCE)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
    if (error) throw error;
    const r = row as SiteRow | null;
    if (!r || !isSiteData(r.site_data)) return 'unchanged';
    const rowAt = Date.parse(r.updated_at ?? '');
    const data = siteDataFrom(r.site_data);

    let next: SiteRecord;
    if (local) {
      if (Number.isNaN(rowAt) || !(rowAt > local.updatedAt)) return 'unchanged';
      next = {
        ...local,
        data,
        inputs: { ...local.inputs, ...inputsFrom(data) },
        deployedUrl: r.deployed_url ?? local.deployedUrl,
        updatedAt: rowAt,
      };
    } else {
      next = {
        draftId: r.id,
        inputs: inputsFrom(data),
        data,
        updatedAt: Number.isNaN(rowAt) ? Date.now() : rowAt,
        slug: null,
        deployedUrl: r.deployed_url ?? null,
        transactionId: null,
      };
    }

    // Compare and swap: an edit (or another load) since the read wins.
    const now = await siteStore.loadSite();
    const untouched = local ? now != null && now.draftId === local.draftId && now.updatedAt === local.updatedAt : now == null;
    if (!untouched) return 'unchanged';
    await siteStore.saveSite(next);
    adoptedListeners.forEach((l) => {
      try {
        l(next);
      } catch (e) {
        console.warn('[account] adopted listener failed:', e);
      }
    });
    return 'adopted';
  } catch (e) {
    console.warn('[account] loading the site from the account failed:', e);
    return null;
  }
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
 * Restore purchases → this Apple ID's active AI Barber transaction →
 * /api/ios/site → the site bound to it, saved as the one local site.
 *
 * - null: no active subscription (or the server kept no content for the site).
 * - Throws the ApiError from /api/ios/site otherwise: 404 `no-site` means
 *   subscribed but nothing published yet; network / 5xx mean try again.
 *
 * Restoring the site already on this phone keeps its local edits. Any other
 * local draft is replaced by the paid site, keeping the draft id (the
 * `sites` row and photo folder key). A null deployedUrl is kept as null: the
 * server only lacks it if the last deploy's stamp failed, and the live URL
 * comes from Vercel's alias list, so it can't safely be rebuilt here.
 */
export async function restore(deps: RestoreDeps): Promise<Restored | null> {
  await deps.restorePurchases();
  const transactionId = await findTransactionId(deps.latestTransactionId);
  if (!transactionId) return null;

  const bound = await deps.iosSite(transactionId);
  const local = await deps.store.loadSite();
  const sameSite = local != null && local.slug === bound.siteId;
  if (!sameSite && !bound.siteData) return null;

  const record: SiteRecord =
    sameSite && local
      ? { ...local, deployedUrl: bound.deployedUrl ?? local.deployedUrl, transactionId, updatedAt: Date.now() }
      : {
          draftId: local?.draftId ?? randomUUID(),
          inputs: inputsFrom(bound.siteData!),
          data: bound.siteData!,
          updatedAt: Date.now(),
          slug: bound.siteId,
          deployedUrl: bound.deployedUrl,
          transactionId,
        };
  // A pending publish is left alone: it is paid content for this same
  // subscription, and the launch retry still sends it to the bound site.
  await deps.store.saveSite(record);
  // A restored site is paid and published: no more reminders (start, Settings
  // and sign-in all restore through here). Never affects the restore.
  cancelRemindersInBackground();
  return { site: record, active: bound.active !== false };
}

/**
 * "Delete data on this phone": the site, a pending publish and the editor's
 * per-draft flags. Published sites stay live (see the privacy page).
 */
export async function deleteLocalData(): Promise<void> {
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
  await api.deleteAccount(token);
  try {
    // The user no longer exists on the server: only drop the local session.
    await supabase.auth.signOut({ scope: 'local' }).catch((e: unknown) => console.warn('[account] sign out failed:', e));
    await deleteLocalData();
  } finally {
    // The account is gone whatever happens locally: no more reminders.
    await cancelAllReminders();
    // The event first, so it is still recorded against the deleted user; then PostHog forgets them.
    track('account_deleted');
    resetUser();
  }
}
