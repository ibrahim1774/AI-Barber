import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { captureOn, EVENT_SOURCE_URL, metaPayload, purchaseFacts, sendServerPurchase, tiktokPayload } from '../../lib/webApp/serverPurchase.js';
import { PRICE_CENTS } from '../../lib/webApp/stripeCore.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ENV = {
  STRIPE_WEBAPP_PRICE_WEBSITE_MONTH: 'price_web_m', STRIPE_WEBAPP_PRICE_BOOKINGS_YEAR: 'price_book_y', STRIPE_WEBAPP_PRICE_G10_WEBSITE_MONTH: 'price_g10_web_m',
  FB_PIXEL_ID: '123', FB_ACCESS_TOKEN: 'fbtok', TIKTOK_ACCESS_TOKEN: 'tttok',
};
const sub = (price = 'price_web_m', id = 'sub_1') => ({ id, items: { data: [{ price: { id: price } }] } });
const WHO = { email: ' Jake@Gmail.com ', userId: 'user-1' };

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe('purchaseFacts', () => {
  it('value is the price of the plan + interval + group, in dollars, content ids match the browser', () => {
    expect(purchaseFacts(sub('price_web_m'), ENV)).toMatchObject({ subscriptionId: 'sub_1', value: PRICE_CENTS.base.website.month / 100, tier: 'website', interval: 'month', group: 'base', contentId: 'webapp-website-monthly', contentName: 'aibarber.org Web App Website (Monthly)' });
    expect(purchaseFacts(sub('price_book_y'), ENV)).toMatchObject({ value: PRICE_CENTS.base.bookings.year / 100, contentId: 'webapp-bookings-yearly' });
    expect(purchaseFacts(sub('price_g10_web_m'), ENV)).toMatchObject({ value: PRICE_CENTS.g10.website.month / 100, group: 'g10' });
    expect(purchaseFacts(sub('price_web_m'), ENV)!.value).toBe(19.99);
  });
  it('unknown price or missing subscription id: null (nothing is sent)', () => {
    expect(purchaseFacts(sub('price_other'), ENV)).toBeNull();
    expect(purchaseFacts({ id: 'sub_1', items: { data: [] } }, ENV)).toBeNull();
    expect(purchaseFacts({ items: { data: [{ price: { id: 'price_web_m' } }] } }, ENV)).toBeNull();
  });
});

describe('payloads', () => {
  const f = purchaseFacts(sub(), ENV)!;
  it('Meta: event_id = subscription id, USD, website, hashed email and external ids, no raw PII', () => {
    const p = metaPayload(f, { ...WHO, accessToken: 'tok', nowSec: 1_800_000_000 });
    const e = p.data[0];
    expect(e).toMatchObject({ event_name: 'Purchase', event_id: 'sub_1', action_source: 'website', event_source_url: 'https://www.primebarber.org/app/', event_time: 1_800_000_000 });
    expect(e.custom_data).toMatchObject({ value: 19.99, currency: 'USD', content_ids: ['webapp-website-monthly'], price_group: 'base', tier: 'website' });
    expect(e.user_data.em).toEqual([sha('jake@gmail.com')]);
    expect(e.user_data.external_id).toEqual([sha('sub_1'), sha('user-1')]); // the browser's external_id first
    expect(p.access_token).toBe('tok'); expect(EVENT_SOURCE_URL).toBe(e.event_source_url);
    expect(JSON.stringify(e)).not.toMatch(/Jake@|jake@|user-1"/);
  });
  it('Meta: no email still sends (external id only); fbp/fbc only when given', () => {
    const e = metaPayload(f, { email: null, userId: null, accessToken: 't', nowSec: 1 }).data[0];
    expect(e.user_data.em).toBeUndefined(); expect(e.user_data.external_id).toEqual([sha('sub_1')]); expect(e.user_data.fbp).toBeUndefined();
    expect(metaPayload(f, { email: null, userId: null, accessToken: 't', nowSec: 1, fbp: 'fb.1.2.3', fbc: 'fb.1.2.4' }).data[0].user_data).toMatchObject({ fbp: 'fb.1.2.3', fbc: 'fb.1.2.4' });
  });
  it('TikTok: Purchase with the same event_id and value, hashed identifiers', () => {
    const p = tiktokPayload(f, { email: WHO.email, nowSec: 5 });
    expect(p.data[0]).toMatchObject({ event: 'Purchase', event_id: 'sub_1', user: { email: sha('jake@gmail.com'), external_id: sha('sub_1') }, properties: { currency: 'USD', value: 19.99, content_id: 'webapp-website-monthly' } });
  });
});

describe('captureOn', () => {
  it('live only, unless WEB_APP_CAPI_TEST=1', () => {
    expect(captureOn(true, {})).toBe(true); expect(captureOn(false, {})).toBe(false); expect(captureOn(false, { WEB_APP_CAPI_TEST: '1' })).toBe(true); expect(captureOn(false, { WEB_APP_CAPI_TEST: '0' })).toBe(false);
  });
});

describe('sendServerPurchase', () => {
  const ok = () => vi.fn(async (u: string) => ({ ok: true, status: 200, json: async () => (u.includes('tiktok') ? { code: 0 } : { events_received: 1 }) }));
  it('live: posts to Meta (pixel from env) and TikTok once each', async () => {
    const fetchImpl = ok();
    const out = await sendServerPurchase(sub(), WHO, { live: true, env: ENV, fetchImpl: fetchImpl as any, now: () => 1_800_000_000_000 });
    expect(out).toEqual({ meta: 'sent', tiktok: 'sent' });
    const urls = fetchImpl.mock.calls.map((c: any[]) => c[0]);
    expect(urls).toEqual(['https://graph.facebook.com/v21.0/123/events', 'https://business-api.tiktok.com/open_api/v1.3/event/track/']);
    const meta = JSON.parse((fetchImpl.mock.calls[0] as any[])[1].body); expect(meta.data[0].event_time).toBe(1_800_000_000);
    expect((fetchImpl.mock.calls[1] as any[])[1].headers['Access-Token']).toBe('tttok');
  });
  it('test mode: nothing is sent unless WEB_APP_CAPI_TEST=1', async () => {
    const fetchImpl = ok();
    expect(await sendServerPurchase(sub(), WHO, { live: false, env: ENV, fetchImpl: fetchImpl as any })).toEqual({ meta: 'skipped', tiktok: 'skipped' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await sendServerPurchase(sub(), WHO, { live: false, env: { ...ENV, WEB_APP_CAPI_TEST: '1' }, fetchImpl: fetchImpl as any })).meta).toBe('sent');
  });
  it('unknown price: nothing is sent', async () => {
    const fetchImpl = ok();
    expect(await sendServerPurchase(sub('price_x'), WHO, { live: true, env: ENV, fetchImpl: fetchImpl as any })).toEqual({ meta: 'skipped', tiktok: 'skipped' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('no TikTok token: only Meta. No Meta env: only TikTok.', async () => {
    const a = ok(); const { TIKTOK_ACCESS_TOKEN: _t, ...noTt } = ENV;
    expect(await sendServerPurchase(sub(), WHO, { live: true, env: noTt, fetchImpl: a as any })).toEqual({ meta: 'sent', tiktok: 'skipped' });
    const b = ok(); const { FB_ACCESS_TOKEN: _f, ...noFb } = ENV;
    expect(await sendServerPurchase(sub(), WHO, { live: true, env: noFb, fetchImpl: b as any })).toEqual({ meta: 'skipped', tiktok: 'sent' });
  });
  it('failures and timeouts never throw and are reported; the two platforms are independent', async () => {
    const fetchImpl = vi.fn(async (u: string) => { if (u.includes('facebook')) throw Object.assign(new Error('t'), { name: 'TimeoutError' }); return { ok: false, status: 500, json: async () => ({ code: 40001 }) }; });
    const out = await sendServerPurchase(sub(), WHO, { live: true, env: ENV, fetchImpl: fetchImpl as any });
    expect(out).toEqual({ meta: 'failed', tiktok: 'failed' });
  });
  it('every call carries an abort signal (5 s cap)', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout'); const fetchImpl = ok();
    await sendServerPurchase(sub(), WHO, { live: true, env: ENV, fetchImpl: fetchImpl as any });
    expect(spy).toHaveBeenCalledWith(5000); expect((fetchImpl.mock.calls[0] as any[])[1].signal).toBeDefined();
  });
  it('logs carry no email, token or payload', async () => {
    await sendServerPurchase(sub(), WHO, { live: true, env: ENV, fetchImpl: (async () => ({ ok: false, status: 400, json: async () => ({}) })) as any });
    expect(JSON.stringify([...(console.error as any).mock.calls, ...(console.log as any).mock.calls])).not.toMatch(/jake|fbtok|tttok/i);
  });
});
