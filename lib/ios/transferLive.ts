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
import { finishPendingMoves, liveMoveIntents } from './moveIntent.js';
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

/**
 * Moves the business of a purchase from `from` to `callerId`. ONLY rows owned by `from` are re-pointed
 * (never "whoever has this otid"): a shop or site of any other account is left alone. Every step is idempotent
 * and keyed on the otid, so the finisher can run it any number of times. Never deletes. Payment settings
 * (Stripe account, manual handles) move WITH the shop: it is the same person's business.
 *  1. ab_shops (ios_otid = otid, owner `from`) -> owner_id = caller
 *  2. the caller's own staff row in that shop is deactivated (user_id null) so the owner row can be re-pointed
 *  3. ab_members: the shop's owner member user_id -> caller AND ics_token rotated (the old calendar feed dies)
 *  4. sites: `from`'s rows whose deployed_url host is the purchase's slug -> caller
 * The shop's children follow the shop id. ab_push_tokens and ios_domains are untouched.
 */
export async function liveMoveBusiness(otid: string, from: string, callerId: string, slug: string | null): Promise<void> {
  const db = admin();
  const { data: shop, error: sErr } = await db.from('ab_shops').select('id, owner_id').eq('ios_otid', otid).maybeSingle();
  if (sErr) throw new Error(`ab_shops lookup failed: ${sErr.message}`);
  const sh = shop as any;
  if (sh && (sh.owner_id === from || sh.owner_id === callerId)) {
    if (sh.owner_id === from) {
      const { data: own, error: oErr } = await db.from('ab_shops').select('id').eq('owner_id', callerId).maybeSingle();
      if (oErr) throw new Error(`ab_shops owner lookup failed: ${oErr.message}`);
      if (own) throw new Error('caller already owns another shop; business not moved');
    }
    // M4: free the (shop, user) slot of the caller's old staff row first (every run; idempotent).
    const st = await db.from('ab_members').update({ active: false, user_id: null }).eq('shop_id', sh.id).eq('user_id', callerId).neq('role', 'owner');
    if (st.error) throw new Error(`ab_members staff row failed: ${st.error.message}`);
    if (sh.owner_id === from) {
      const mv = await db.from('ab_shops').update({ owner_id: callerId }).eq('id', sh.id).eq('owner_id', from);
      if (mv.error) throw new Error(`ab_shops move failed: ${mv.error.message}`);
    }
    const mm = await db.from('ab_members')
      .update({ user_id: callerId, ics_token: randomBytes(24).toString('base64url') })
      .eq('shop_id', sh.id).eq('role', 'owner').eq('user_id', from);
    if (mm.error) throw new Error(`ab_members move failed: ${mm.error.message}`);
  }

  // Sites copy (after the shop, so the more valuable data never lags behind). Only rows of this purchase's slug:
  // other drafts of the old owner (e.g. web sites) stay with them.
  if (slug) {
    const { data: rows, error: rErr } = await db.from('sites').select('id, deployed_url').eq('user_id', from);
    if (rErr) throw new Error(`sites lookup failed: ${rErr.message}`);
    const ids = siteRowIdsForSlug(rows ?? [], slug);
    if (ids.length) {
      const up = await db.from('sites').update({ user_id: callerId }).in('id', ids).eq('user_id', from);
      if (up.error) throw new Error(`sites move failed: ${up.error.message}`);
    }
  }
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
      const { data, error } = await admin().from('ab_shops').select('id').eq('ios_otid', otid).maybeSingle();
      if (error) throw new Error(`ab_shops lookup failed: ${error.message}`);
      return { hasShop: !!data };
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
    return { pending: true, finished: 0 };
  }
}
