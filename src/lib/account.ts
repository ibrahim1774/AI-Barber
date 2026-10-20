import { randomUUID } from 'expo-crypto';
import type { ShopInputs, WebsiteData } from '@/web/types';
import { track } from '@/lib/analytics';
import { api } from '@/lib/api';
import { clearOverlayFlags } from '@/lib/overlayFlags';
import { findTransactionId, publishPayload } from '@/lib/publish';
import * as siteStore from '@/lib/siteStore';
import type { SiteRecord } from '@/lib/siteStore';
import { supabase } from '@/lib/supabase';

/**
 * Upserts the local site into public.sites with the columns the web writes in
 * upsertSiteToSupabase (services/supabaseDataService.ts), so the account sees
 * it on aibarber.org too. RLS allows it for the row's own user. The app only
 * ever pushes: an iOS site is bound to the Apple transaction, not the account.
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
      site_data: data,
      deployed_url: site.deployedUrl,
      deployment_status: site.deployedUrl ? 'deployed' : 'draft',
      custom_domain: null,
      domain_order_id: null,
      updated_at: new Date().toISOString(),
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
 * `sites` row and photo folder key).
 */
export async function restore(deps: RestoreDeps): Promise<SiteRecord | null> {
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
  return record;
}

/**
 * "Delete data on this phone": the site, a pending publish and the editor's
 * per-draft flags. Published sites stay live (see the privacy page).
 */
export async function deleteLocalData(): Promise<void> {
  const site = await siteStore.loadSite();
  // Task 10b: cancel scheduled publish reminders here (cancelAllReminders()).
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
  // The user no longer exists on the server: only drop the local session.
  await supabase.auth.signOut({ scope: 'local' }).catch((e: unknown) => console.warn('[account] sign out failed:', e));
  await deleteLocalData();
  track('account_deleted');
}
