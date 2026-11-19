// Admin: grant or revoke the Free price group (web_app_price_groups.price_group = 'free') by email, e.g. for a legacy comped customer.
// With FREE_IS_WEB=1 a Free account with no Apple address is a WEB account for the iOS app (lib/account/kind.ts), so it sees no Apple paywall.
// Column facts (migrations 034 + 036): price_group in ('base','g10','g20','free'); `source` is free text; one row per user_id.
// Revoke only changes the group. It does not take a published site offline and does not touch site_owners.
import type { SupabaseClient } from '@supabase/supabase-js';
import { findUserByEmail, normEmail } from '../siteOwners.js';
import { accountKindReading, liveKindDeps } from '../account/kind.js';
import { keyMode } from '../webApp/stripeCore.js';
import { appStoreStateOf } from '../webApp/appStoreGuard.js';
import { sbRest } from '../webApp/webAppServer.js';

export interface FreeGrantDeps {
  /** The Stripe mode of this deployment's key ('live' = Production), or null when missing / unknown. */
  mode(): 'live' | 'test' | null;
  /** The auth account with this email, or null. */
  userByEmail(email: string): Promise<{ id: string; email: string; emailConfirmed: boolean } | null>;
  /** Production kind reading: does the account hold an Apple address (same rule as assignGroup)? Throws on a lookup error. */
  holdsAppleAddress(uid: string): Promise<boolean>;
  /** Production kind reading: does the account pay a card plan (an entitled web_app_entitlements row)? */
  hasCardPlan(uid: string): Promise<boolean>;
  /** assignGroup's Apple rule for Free: appStoreStateOf(uid, 'live') !== null (a live Apple purchase, or a shop linked to one). */
  appStoreAccount(uid: string): Promise<boolean>;
  /** The stored group, or null. Throws on a lookup error. */
  readGroup(uid: string): Promise<string | null>;
  /** Upsert the user's row (replaces an existing group). */
  writeGroup(uid: string, group: 'free' | 'base', source: string): Promise<void>;
  audit?(e: { action: 'grant-free' | 'revoke-free'; by?: string; userId: string; email: string; previous: string | null }): Promise<void>;
}

export interface FreeGrantView {
  ok: boolean;
  error?: 'bad-request' | 'not-found' | 'unconfirmed' | 'apple-address' | 'apple-account' | 'has-paid-plan' | 'has-price-group' | 'not-free' | 'not-production';
  detail?: string;
  userId?: string;
  email?: string;
  group?: 'free' | 'base';
  previous?: string | null;
}

export async function setFreeGroup(action: 'grant-free' | 'revoke-free', email: unknown, deps: FreeGrantDeps, by?: string): Promise<FreeGrantView> {
  const e = normEmail(email);
  if (!e) return { ok: false, error: 'bad-request', detail: 'a valid email is required' };
  if (deps.mode() !== 'live') return { ok: false, error: 'not-production', detail: 'only a Production (live key) deployment grants or revokes Free' };
  const user = await deps.userByEmail(e);
  if (!user) return { ok: false, error: 'not-found', detail: 'no account with that email' };
  if (!user.emailConfirmed) return { ok: false, error: 'unconfirmed', detail: 'that account has not confirmed its email' };
  const group = action === 'grant-free' ? 'free' : 'base';
  const previous = await deps.readGroup(user.id);
  if (action === 'revoke-free') {
    if (previous !== 'free') return { ok: false, error: 'not-free', detail: 'that account is not in the Free group' };
  } else {
    if (previous === 'g10' || previous === 'g20') return { ok: false, error: 'has-price-group', detail: `that account is in the ${previous} price-test group` };
    if (await deps.holdsAppleAddress(user.id)) return { ok: false, error: 'apple-address', detail: 'that account holds an Apple address: a Free site is a web site' };
    if (await deps.appStoreAccount(user.id)) return { ok: false, error: 'apple-account', detail: 'that account has a live Apple purchase or a shop linked to one' };
    if (await deps.hasCardPlan(user.id)) return { ok: false, error: 'has-paid-plan', detail: 'that account pays a card plan' };
  }
  await deps.writeGroup(user.id, group, action === 'grant-free' ? 'admin' : 'admin-revoke');
  await deps.audit?.({ action, by, userId: user.id, email: e, previous })
    .catch((err: any) => console.warn('[FreeGrant] audit write failed (ignored):', err?.message || err));
  console.log(`[FreeGrant] ${user.id}: ${group} set by ${by || 'admin'} (was ${previous ?? 'none'})`);
  return { ok: true, userId: user.id, email: e, group, previous };
}

/** Live deps (service role). `client` is the admin Supabase client; sbRest is used for the price-group table like the rest of the account code. */
export function liveFreeGrantDeps(client: SupabaseClient): FreeGrantDeps {
  const enc = encodeURIComponent;
  const noFree = { ...liveKindDeps(), isFree: undefined };
  return {
    mode: () => keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY),
    userByEmail: (email) => findUserByEmail(client, email),
    holdsAppleAddress: async (uid) => (await accountKindReading(uid, 'Production', noFree)).holdsAppleAddress,
    hasCardPlan: async (uid) => (await accountKindReading(uid, 'Production', noFree)).cardPlan,
    appStoreAccount: async (uid) => (await appStoreStateOf(uid, 'live')) !== null,
    async readGroup(uid) {
      return (await sbRest(`web_app_price_groups?user_id=eq.${enc(uid)}&select=price_group&limit=1`))?.[0]?.price_group ?? null;
    },
    async writeGroup(uid, group, source) {
      await sbRest('web_app_price_groups?on_conflict=user_id', { method: 'POST', body: { user_id: uid, price_group: group, source }, prefer: 'resolution=merge-duplicates,return=minimal' });
    },
    async audit(e) {
      const { error } = await client.from('ab_events').insert({ kind: 'admin_free_group', payload: { ...e, at: new Date().toISOString() } });
      if (error) throw new Error(error.message);
    },
  };
}
