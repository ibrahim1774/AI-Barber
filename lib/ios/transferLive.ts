// Live wiring for transfer.ts (Supabase, Apple, Vercel). Kept apart so transfer.ts stays pure.
import { createHmac, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { makeRateLimiter, supabaseRateStore } from '../bookings/rateLimit.js';
import { serviceClient } from '../bookings/repo.js';
import { lazyDefaultVerifier, verifyDeviceTransaction } from './appleVerify.js';
import { liveBindingOwner, liveEmailOf } from './ownership.js';
import { liveUserOf } from './publishFlow.js';
import { siteRowIdsForSlug } from './removeSiteLive.js';
import { supabasePurchases } from './purchases.js';
import { finishPendingMoves, liveMoveIntents, type MoveResult } from './moveIntent.js';
import type { TransferDeps } from './transfer.js';

export const TRANSFER_LIMIT = 10; // moves (and probes) per account per window

// The STRICT shared store throws on error (no in-memory fallback): a limiter outage refuses (503).
const strictStore = supabaseRateStore(() => serviceClient());
const transferLimiter = makeRateLimiter(strictStore, Date.now, strictStore, { read: TRANSFER_LIMIT, write: TRANSFER_LIMIT }, 'transfer');

function admin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const nonEmptyHandles = (h: unknown) => !!h && typeof h === 'object' && Object.values(h as Record<string, unknown>).some((v) => v != null && String(v).trim() !== '');

/**
 * Moves the business of a purchase from `from` to `callerId`. ONLY rows owned by `from` are re-pointed
 * (never "whoever has this otid"): a shop or site of any other account is left alone. Every step is idempotent
 * and keyed on the otid, so the finisher can run it any number of times. Never deletes.
 *  1. ab_shops (ios_otid = otid, owner `from`) -> owner_id = caller, and its PAYMENT settings are cleared
 *     (stripe_account_id, stripe_charges_enabled, manual_handles) after an ab_events audit row records the old values
 *  2. the caller's own staff row in that shop is deactivated (user_id null) so the owner row can be re-pointed
 *  3. ab_members: the shop's owner member user_id -> caller AND ics_token rotated (the old calendar feed dies)
 *  4. sites: `from`'s rows for the slug (deployed_url host = slug) -> caller; plus `from`'s unpublished drafts
 *     (deployed_url null) when `from` has no other purchase
 * The shop's children follow the shop id. ab_push_tokens and ios_domains are untouched.
 */
export async function liveMoveBusiness(otid: string, from: string, callerId: string, slug: string | null): Promise<MoveResult> {
  const db = admin();
  let paymentsReset = false;
  const { data: shop, error: sErr } = await db.from('ab_shops')
    .select('id, owner_id, stripe_account_id, stripe_charges_enabled, manual_handles').eq('ios_otid', otid).maybeSingle();
  if (sErr) throw new Error(`ab_shops lookup failed: ${sErr.message}`);
  const sh = shop as any;
  if (sh && (sh.owner_id === from || sh.owner_id === callerId)) {
    const auditKey = `ios-transfer-payments:${otid}:${callerId}`;
    if (sh.owner_id === from) {
      const { data: own, error: oErr } = await db.from('ab_shops').select('id').eq('owner_id', callerId).maybeSingle();
      if (oErr) throw new Error(`ab_shops owner lookup failed: ${oErr.message}`);
      if (own) throw new Error('caller already owns another shop; business not moved');
      const hadPayments = !!sh.stripe_account_id || nonEmptyHandles(sh.manual_handles);
      if (hadPayments) {
        const ins = await db.from('ab_events').insert({
          shop_id: sh.id, kind: 'ios_transfer_payments_reset', dedupe_key: auditKey,
          payload: { from, to: callerId, stripe_account_id: sh.stripe_account_id ?? null, stripe_charges_enabled: !!sh.stripe_charges_enabled, manual_handles: sh.manual_handles ?? {} },
        });
        if (ins.error && (ins.error as any).code !== '23505') throw new Error(`payments audit failed: ${ins.error.message}`);
      }
      paymentsReset = hadPayments;
      // M4: free the (shop, user) slot of the caller's old staff row first.
      const st = await db.from('ab_members').update({ active: false, user_id: null }).eq('shop_id', sh.id).eq('user_id', callerId).neq('role', 'owner');
      if (st.error) throw new Error(`ab_members staff row failed: ${st.error.message}`);
      const mv = await db.from('ab_shops')
        .update({ owner_id: callerId, stripe_account_id: null, stripe_charges_enabled: false, manual_handles: {} })
        .eq('id', sh.id).eq('owner_id', from);
      if (mv.error) throw new Error(`ab_shops move failed: ${mv.error.message}`);
    } else {
      // Retry after the shop moved: remember whether payments were reset (audit row exists).
      const { data: a, error: aErr } = await db.from('ab_events').select('id').eq('dedupe_key', auditKey).maybeSingle();
      if (aErr) throw new Error(`payments audit lookup failed: ${aErr.message}`);
      paymentsReset = !!a;
      const st = await db.from('ab_members').update({ active: false, user_id: null }).eq('shop_id', sh.id).eq('user_id', callerId).neq('role', 'owner');
      if (st.error) throw new Error(`ab_members staff row failed: ${st.error.message}`);
    }
    const mm = await db.from('ab_members')
      .update({ user_id: callerId, ics_token: randomBytes(24).toString('base64url') })
      .eq('shop_id', sh.id).eq('role', 'owner').eq('user_id', from);
    if (mm.error) throw new Error(`ab_members move failed: ${mm.error.message}`);
  }

  // Sites copy (after the shop, so the more valuable data never lags behind).
  const { data: rows, error: rErr } = await db.from('sites').select('id, deployed_url').eq('user_id', from);
  if (rErr) throw new Error(`sites lookup failed: ${rErr.message}`);
  const ids = slug ? siteRowIdsForSlug(rows ?? [], slug) : [];
  const drafts = (rows ?? []).filter((r: any) => r.deployed_url == null).map((r: any) => r.id as string);
  if (drafts.length) {
    const { data: others, error: pErr } = await db.from('ios_purchases').select('original_transaction_id').eq('user_id', from).limit(1);
    if (pErr) throw new Error(`purchases lookup failed: ${pErr.message}`);
    if (!(others ?? []).length) ids.push(...drafts);
  }
  if (ids.length) {
    const up = await db.from('sites').update({ user_id: callerId }).in('id', ids).eq('user_id', from);
    if (up.error) throw new Error(`sites move failed: ${up.error.message}`);
  }
  return { paymentsReset };
}

export function liveTransferDeps(): TransferDeps {
  return {
    verify: lazyDefaultVerifier(),
    repo: supabasePurchases(),
    userOf: liveUserOf,
    emailOf: liveEmailOf,
    bindingOwner: liveBindingOwner,
    allow: (callerId) => transferLimiter.allow(callerId, 'write'),
    now: () => Date.now(),
    async shopSummary(otid) {
      const { data, error } = await admin().from('ab_shops').select('id, stripe_account_id, manual_handles').eq('ios_otid', otid).maybeSingle();
      if (error) throw new Error(`ab_shops lookup failed: ${error.message}`);
      const d = data as any;
      return { hasShop: !!d, hasPayments: !!d && (!!d.stripe_account_id || nonEmptyHandles(d.manual_handles)) };
    },
    async shopOf(userId) {
      const { data, error } = await admin().from('ab_shops').select('id, ios_otid').eq('owner_id', userId).maybeSingle();
      if (error) throw new Error(`ab_shops lookup failed: ${error.message}`);
      return (data as any) ?? null;
    },
    intents: liveMoveIntents(),
    moveBusiness: liveMoveBusiness,
    decodeProof: verifyDeviceTransaction,
    bundleId: process.env.APPLE_BUNDLE_ID || '',
    requireProof: /^(1|true|on|yes)$/i.test((process.env.IOS_REQUIRE_TRANSFER_PROOF || '').trim()),
    ownerToken(ownerId, otid) {
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY must be set');
      return createHmac('sha256', key).update(`ios-transfer-owner:${ownerId}:${otid}`).digest('hex').slice(0, 32);
    },
  };
}

/** Finishes this account's unfinished business moves (plan GET/refresh, publish, shop setup). Never throws. */
export async function liveFinishMoves(userId: string) {
  try {
    const purchases = supabasePurchases();
    return await finishPendingMoves(userId, {
      intents: liveMoveIntents(),
      purchase: async (otid) => purchases.get(otid),
      moveBusiness: liveMoveBusiness,
    });
  } catch (e: any) {
    console.error('[ios/move] finisher failed:', e?.message || e);
    return { pending: true, paymentsReset: false, finished: 0 };
  }
}
