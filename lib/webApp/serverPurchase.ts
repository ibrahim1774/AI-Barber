// Server-side Purchase for a web-app subscription (Meta Conversions API + TikTok Events API), sent from the web-app Stripe
// webhook so the sale is counted even when the buyer closed the tab. The browser (src/lib/webTracking.ts, watchPaidReturn)
// sends the same Purchase with event_id = the Stripe subscription id, external_id = that id, content_id webapp-<tier>-<monthly|yearly>
// and the plan price, so Meta / TikTok dedupe the two by event_id. Same endpoints as api/stripe-webhook.ts (Meta Graph v21.0
// /events with FB_PIXEL_ID + FB_ACCESS_TOKEN) and api/tiktok-event.ts (TIKTOK_ACCESS_TOKEN).
// Live Stripe mode only, unless WEB_APP_CAPI_TEST=1. Best effort: never throws, bounded by a timeout.
import { buildUserData } from '../../api/_buildUserData.js';
import { hashEmail, hashExternalId } from '../../api/_hashPii.js';
import { PRICE_CENTS, tierForPriceId } from './stripeCore.js';

export const SERVER_PURCHASE_TIMEOUT_MS = 5_000;
export const EVENT_SOURCE_URL = 'https://www.primebarber.org/app/';
const TIKTOK_PIXEL_ID = 'D81SNARC77UATASKVG10'; // same as api/tiktok-event.ts

export interface PurchaseFacts {
  subscriptionId: string; value: number; tier: string; interval: 'month' | 'year'; group: 'base' | 'g10' | 'g20';
  contentId: string; contentName: string;
}

/** The plan facts for a subscription, from the price it is on; null when the price is not one of ours (then nothing is sent). */
export function purchaseFacts(sub: any, env: Record<string, string | undefined> = process.env): PurchaseFacts | null {
  const priceId = sub?.items?.data?.[0]?.price?.id;
  const m = typeof priceId === 'string' ? tierForPriceId(priceId, env) : null;
  if (!m || typeof sub?.id !== 'string' || !sub.id) return null;
  const cents = PRICE_CENTS[m.group]?.[m.tier]?.[m.interval];
  if (!Number.isFinite(cents)) return null;
  const NAMES: Record<string, string> = { website: 'Website', bookings: 'Bookings', store: 'Store' };
  const when = m.interval === 'month' ? 'Monthly' : 'Yearly';
  return {
    subscriptionId: sub.id, value: cents / 100, tier: m.tier, interval: m.interval, group: m.group,
    contentId: `webapp-${m.tier}-${m.interval === 'month' ? 'monthly' : 'yearly'}`,
    contentName: `aibarber.org Web App ${NAMES[m.tier] ?? m.tier} (${when})`,
  };
}

export const captureOn = (live: boolean, env: Record<string, string | undefined> = process.env) => live || env.WEB_APP_CAPI_TEST === '1';

export function metaPayload(f: PurchaseFacts, ctx: { email: string | null; userId: string | null; accessToken: string; nowSec: number; fbp?: string | null; fbc?: string | null }) {
  const userData = buildUserData({ email: ctx.email, externalId: f.subscriptionId, fbp: ctx.fbp ?? null, fbc: ctx.fbc ?? null });
  // The browser's external_id is the subscription id; the account id is added too (Meta accepts several) for better matching.
  const uid = hashExternalId(ctx.userId);
  if (uid) userData.external_id = [...(userData.external_id ?? []), uid];
  return {
    data: [{
      event_name: 'Purchase', event_time: ctx.nowSec, event_id: f.subscriptionId, action_source: 'website', event_source_url: EVENT_SOURCE_URL,
      user_data: userData,
      custom_data: {
        value: f.value, currency: 'USD', content_ids: [f.contentId], content_type: 'product', content_name: f.contentName,
        contents: [{ id: f.contentId, quantity: 1, item_price: f.value }], price_group: f.group, tier: f.tier,
      },
    }],
    access_token: ctx.accessToken,
  };
}

export function tiktokPayload(f: PurchaseFacts, ctx: { email: string | null; nowSec: number; testCode?: string }) {
  const user: Record<string, string> = {};
  const em = hashEmail(ctx.email); if (em) user.email = em;
  const eid = hashExternalId(f.subscriptionId); if (eid) user.external_id = eid;
  return {
    event_source: 'web', event_source_id: TIKTOK_PIXEL_ID, ...(ctx.testCode ? { test_event_code: ctx.testCode } : {}),
    data: [{
      event: 'Purchase', event_time: ctx.nowSec, event_id: f.subscriptionId, user,
      properties: { currency: 'USD', value: f.value, content_id: f.contentId, content_type: 'product', content_name: f.contentName, contents: [{ content_id: f.contentId, content_name: f.contentName, quantity: 1, price: f.value }], price_group: f.group },
      page: { url: EVENT_SOURCE_URL },
    }],
  };
}

export interface PurchaseResult { meta: 'sent' | 'skipped' | 'failed'; tiktok: 'sent' | 'skipped' | 'failed' }

/** Sends the Purchase to every configured platform. Never throws; every call is bounded by `timeoutMs`. */
export async function sendServerPurchase(
  sub: any, who: { email: string | null; userId: string | null }, opts: { live: boolean; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number },
): Promise<PurchaseResult> {
  const env = opts.env ?? process.env;
  const out: PurchaseResult = { meta: 'skipped', tiktok: 'skipped' };
  try {
    if (!captureOn(opts.live, env)) return out;
    const f = purchaseFacts(sub, env);
    if (!f) { console.error('[web-app purchase] price not recognised; no server Purchase'); return out; }
    const doFetch = opts.fetchImpl ?? fetch;
    const nowSec = Math.floor((opts.now ?? Date.now)() / 1000);
    const signal = () => AbortSignal.timeout(opts.timeoutMs ?? SERVER_PURCHASE_TIMEOUT_MS);
    const jobs: Promise<void>[] = [];
    const pixel = env.FB_PIXEL_ID, token = env.FB_ACCESS_TOKEN;
    if (pixel && token) {
      jobs.push((async () => {
        try {
          const r = await doFetch(`https://graph.facebook.com/v21.0/${pixel}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metaPayload(f, { ...who, accessToken: token, nowSec })), signal: signal() });
          out.meta = r.ok ? 'sent' : 'failed';
          if (!r.ok) console.error('[web-app purchase] Meta answered', r.status);
        } catch (e: any) { out.meta = 'failed'; console.error('[web-app purchase] Meta failed', e?.name || 'error'); }
      })());
    } else console.error('[web-app purchase] FB_PIXEL_ID or FB_ACCESS_TOKEN missing');
    const tt = env.TIKTOK_ACCESS_TOKEN;
    if (tt) {
      jobs.push((async () => {
        try {
          const r = await doFetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Access-Token': tt }, body: JSON.stringify(tiktokPayload(f, { email: who.email, nowSec, testCode: env.TIKTOK_TEST_EVENT_CODE })), signal: signal() });
          const j: any = await r.json().catch(() => ({}));
          out.tiktok = r.ok && j?.code === 0 ? 'sent' : 'failed';
          if (out.tiktok === 'failed') console.error('[web-app purchase] TikTok answered', r.status, j?.code);
        } catch (e: any) { out.tiktok = 'failed'; console.error('[web-app purchase] TikTok failed', e?.name || 'error'); }
      })());
    }
    await Promise.all(jobs);
  } catch (e: any) { console.error('[web-app purchase] failed', e?.message || e); }
  if (out.meta !== 'skipped' || out.tiktok !== 'skipped') console.log('[web-app purchase]', JSON.stringify({ sub: sub?.id, ...out }));
  return out;
}
