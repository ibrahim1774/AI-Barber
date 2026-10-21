import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendPush, pushToUsers, EXPO_PUSH_URL } from '../../lib/bookings/push.js';

const tok = (i: number) => `ExponentPushToken[t${i}]`;
const okRes = (data: any[]) => ({ ok: true, status: 200, json: async () => ({ data }) });

describe('push', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  it('batches 100 per request and maps DeviceNotRegistered back to tokens by index', async () => {
    const f = vi.fn(async (_url: string, init: any) => {
      const batch = JSON.parse(init.body);
      return okRes(batch.map((m: any) => m.to === tok(3) || m.to === tok(150)
        ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
        : { status: 'ok', id: 'x' }));
    });
    const msgs = Array.from({ length: 205 }, (_, i) => ({ to: tok(i), body: 'hi', data: { kind: 'booking' } }));
    const r = await sendPush(msgs, f);
    expect(f).toHaveBeenCalledTimes(3);
    expect(f.mock.calls.map((c) => JSON.parse(c[1].body).length)).toEqual([100, 100, 5]);
    expect(f.mock.calls[0][0]).toBe(EXPO_PUSH_URL);
    expect(f.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(f.mock.calls[0][1].body)[0]).toMatchObject({ to: tok(0), body: 'hi', sound: 'default', data: { kind: 'booking' } });
    expect(r.sent).toBe(203);
    expect(r.invalidTokens).toEqual([tok(3), tok(150)]);
  });

  it('never throws: network errors and HTTP errors are logged', async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ errors: [] }) });
    const msgs = Array.from({ length: 150 }, (_, i) => ({ to: tok(i), body: 'x' }));
    await expect(sendPush(msgs, f)).resolves.toEqual({ sent: 0, invalidTokens: [] });
  });

  it('malformed tokens are not sent and are reported as invalid', async () => {
    const f = vi.fn(async () => okRes([{ status: 'ok' }]));
    const r = await sendPush([{ to: 'garbage', body: 'x' }, { to: 'ExpoPushToken[abc]', body: 'x' }], f);
    expect(JSON.parse((f.mock.calls[0] as any)[1].body)).toHaveLength(1);
    expect(r).toEqual({ sent: 1, invalidTokens: ['garbage'] });
  });

  it('pushToUsers loads tokens and deletes dead ones', async () => {
    const store = { tokensFor: vi.fn(async () => [tok(1), tok(2), tok(1)]), deleteTokens: vi.fn(async () => {}) };
    const f = vi.fn(async () => okRes([{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }]));
    const r = await pushToUsers(['u1', 'u1', 'u2'], { body: 'hi' }, store, f);
    expect(store.tokensFor).toHaveBeenCalledWith(['u1', 'u2']);
    expect(store.deleteTokens).toHaveBeenCalledWith([tok(2)]);
    expect(r.sent).toBe(1);
  });

  it('pushToUsers never throws when the store fails', async () => {
    const store = { tokensFor: vi.fn().mockRejectedValue(new Error('db')), deleteTokens: vi.fn() };
    await expect(pushToUsers(['u1'], { body: 'x' }, store)).resolves.toEqual({ sent: 0, invalidTokens: [] });
  });
});
