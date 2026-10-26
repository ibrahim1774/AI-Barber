// Live wiring for transfer.ts (Supabase, Apple, Vercel). Kept apart so transfer.ts stays pure.
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { makeRateLimiter, supabaseRateStore } from '../bookings/rateLimit.js';
import { serviceClient } from '../bookings/repo.js';
import { lazyDefaultVerifier, verifyDeviceTransaction } from './appleVerify.js';
import { liveBindingOwner, liveEmailOf } from './ownership.js';
import { liveUserOf } from './publishFlow.js';
import { siteRowIdsForSlug } from './removeSiteLive.js';
import { supabasePurchases } from './purchases.js';
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
 * Moves the business of a purchase to `callerId`. Every step is idempotent and keyed on the otid / slug
 * (the previous owner is not needed), so a retry finishes what an earlier attempt did not. Never deletes.
 *  1. sites (account-level copy of the slug's site): user_id -> caller
 *  2. ab_shops (ios_otid = otid): owner_id -> caller. If the caller already owns another shop (one per
 *     owner) the shop is NOT moved; it is only detached from the purchase (ios_otid = null)
 *  3. ab_members: the shop's owner member user_id -> caller
 * Children of the shop (members, services, availability, time off, appointments, products, orders,
 * order items, events) follow the shop id and need no change. ab_push_tokens and ios_domains are untouched.
 */
export async function liveMoveBusiness(otid: string, callerId: string, slug: string | null): Promise<void> {
  const db = admin();
  if (slug) {
    const { data, error } = await db.from('sites').select('id, deployed_url').neq('user_id', callerId)
      .ilike('deployed_url', `%${slug}.vercel.app%`);
    if (error) throw new Error(`sites lookup failed: ${error.message}`);
    const ids = siteRowIdsForSlug(data ?? [], slug);
    if (ids.length) {
      const up = await db.from('sites').update({ user_id: callerId }).in('id', ids).neq('user_id', callerId);
      if (up.error) throw new Error(`sites move failed: ${up.error.message}`);
    }
  }
  const { data: shop, error: sErr } = await db.from('ab_shops').select('id, owner_id').eq('ios_otid', otid).maybeSingle();
  if (sErr) throw new Error(`ab_shops lookup failed: ${sErr.message}`);
  if (!shop) return;
  if ((shop as any).owner_id !== callerId) {
    const { data: own, error: oErr } = await db.from('ab_shops').select('id').eq('owner_id', callerId).maybeSingle();
    if (oErr) throw new Error(`ab_shops owner lookup failed: ${oErr.message}`);
    if (own) {
      const d = await db.from('ab_shops').update({ ios_otid: null }).eq('id', (shop as any).id).eq('ios_otid', otid);
      if (d.error) throw new Error(`ab_shops detach failed: ${d.error.message}`);
      return;
    }
    const mv = await db.from('ab_shops').update({ owner_id: callerId }).eq('id', (shop as any).id).neq('owner_id', callerId);
    if (mv.error) throw new Error(`ab_shops move failed: ${mv.error.message}`);
  }
  const mm = await db.from('ab_members').update({ user_id: callerId }).eq('shop_id', (shop as any).id).eq('role', 'owner').neq('user_id', callerId);
  if (mm.error) throw new Error(`ab_members move failed: ${mm.error.message}`);
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
    async hasShop(otid) {
      const { data, error } = await admin().from('ab_shops').select('id').eq('ios_otid', otid).maybeSingle();
      if (error) throw new Error(`ab_shops lookup failed: ${error.message}`);
      return !!data;
    },
    async shopOf(userId) {
      const { data, error } = await admin().from('ab_shops').select('id, ios_otid').eq('owner_id', userId).maybeSingle();
      if (error) throw new Error(`ab_shops lookup failed: ${error.message}`);
      return (data as any) ?? null;
    },
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
