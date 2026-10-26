// Live wiring for transfer.ts (Supabase, Apple, Vercel). Kept apart so transfer.ts stays pure.
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { makeRateLimiter, supabaseRateStore } from '../bookings/rateLimit.js';
import { serviceClient } from '../bookings/repo.js';
import { lazyDefaultVerifier } from './appleVerify.js';
import { liveBindingOwner, liveEmailOf } from './ownership.js';
import { liveUserOf } from './publishFlow.js';
import { liveRemoveDeps } from './removeSiteLive.js';
import { supabasePurchases } from './purchases.js';
import type { TransferDeps } from './transfer.js';

export const TRANSFER_LIMIT = 10; // moves (and probes) per account per window

// The STRICT shared store throws on error (no in-memory fallback): a limiter outage refuses (503).
const strictStore = supabaseRateStore(() => serviceClient());
const transferLimiter = makeRateLimiter(strictStore, Date.now, strictStore, { read: TRANSFER_LIMIT, write: TRANSFER_LIMIT }, 'transfer');

export function liveTransferDeps(): TransferDeps {
  const remove = liveRemoveDeps();
  return {
    verify: lazyDefaultVerifier(),
    repo: supabasePurchases(),
    userOf: liveUserOf,
    emailOf: liveEmailOf,
    bindingOwner: liveBindingOwner,
    allow: (callerId) => transferLimiter.allow(callerId, 'write'),
    // Only the existing offline deploy: no markRemoved / releaseDomains / deleteContent (nothing is deleted).
    takedown: { deployOffline: remove.deployOffline, now: remove.now },
    ownerToken(ownerId, otid) {
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY must be set');
      return createHmac('sha256', key).update(`ios-transfer-owner:${ownerId}:${otid}`).digest('hex').slice(0, 32);
    },
    async detachShop(otid, callerId) {
      const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
      const { error } = await createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
        .from('ab_shops').update({ ios_otid: null }).eq('ios_otid', otid).neq('owner_id', callerId);
      if (error) throw new Error(`ab_shops detach failed: ${error.message}`);
    },
  };
}
