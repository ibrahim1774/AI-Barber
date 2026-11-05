// Spending caps for the model: 15 calls per site and 50 per account, each per UTC day (Ibrahim, 2026-11-04). Every MODEL CALL
// counts, so the one retry of a rejected answer counts as a second call. The counters are public.ab_rate_hits through ab_rate_hit()
// (migration 006): an atomic upsert in a fixed window aligned to the epoch, swept after a day, so the table stays bounded.
// The claim-check call counts like a writing call (a normal page = 2 counted calls). A counter that cannot be read FAILS CLOSED (the caller makes no call). Nothing here ever falls back to a local count.
import { createHash } from 'node:crypto';
import type { RateLimitStore } from '../bookings/rateLimit.js';

export const SITE_CALLS_PER_DAY = 15;
export const ACCOUNT_CALLS_PER_DAY = 50;
export const DAY_MS = 86_400_000;

export class LimitStoreError extends Error { constructor() { super('limit_store_unavailable'); } }
export type LimitVerdict = 'ok' | 'site' | 'account';

export const siteCounterKey = (userId: string, draftId: string): string => `svccopy:site:${siteKeyOf(userId, draftId)}`;
export const accountCounterKey = (userId: string): string => `svccopy:acct:${createHash('sha256').update(userId).digest('hex').slice(0, 32)}`;
export const siteKeyOf = (userId: string, draftId: string): string => createHash('sha256').update(`${userId}:${draftId}`).digest('hex').slice(0, 32);

/** Counts one model call. The site counter goes first (the smaller cap, so it is the one that refuses most often), then the account's: an atomic hit cannot be refunded, so the rare account refusal still costs the site one count (accepted, review 6 NIT 1). Throws LimitStoreError when a counter fails. */
export async function takeCall(store: RateLimitStore, userId: string, draftId: string, now: number): Promise<LimitVerdict> {
  try {
    if (!(await store.hit(siteCounterKey(userId, draftId), SITE_CALLS_PER_DAY, DAY_MS, now))) return 'site';
    if (!(await store.hit(accountCounterKey(userId), ACCOUNT_CALLS_PER_DAY, DAY_MS, now))) return 'account';
    return 'ok';
  } catch {
    throw new LimitStoreError();
  }
}
