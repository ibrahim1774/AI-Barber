// "Move subscription to this account": every branch of the engine, with the server's exact shapes.
import { ApiError } from '@/lib/api';
import {
  MOVE_ERROR, moveConfirmMessage, moveErrorMessage, moveSubscription, type MoveDeps,
} from '@/lib/moveSubscription';
import { CLAIMED_SIGNED_OUT_MESSAGE, conflictMessage, otherAccountPlanMessage, restoreOtherAccountMessage } from '@/lib/claimCopy';
import { restoreMessage } from '@/lib/restoreFlow';

const confirmRequired = (over: Record<string, unknown> = {}) =>
  new ApiError(409, 'confirm-required', 'x', { error: 'confirm-required', ownerHint: 'a***@gmail.com', hasLiveSite: true, hasShop: true, ownerToken: 'tok-1', siteUrl: 'https://x.aibarber.org', ...over });
const err = (status: number, code: string, body: Record<string, unknown> = {}) => new ApiError(status, code, 'x', { error: code, ...body });

type TestDeps = MoveDeps & { transfer: jest.Mock; confirm: jest.Mock };
function deps(over: Partial<MoveDeps> = {}): TestDeps {
  return {
    transfer: jest.fn(async () => ({ moved: true, linked: true })),
    transactionId: jest.fn(async () => 'tx-9'),
    confirm: jest.fn(async () => true),
    ...over,
  } as TestDeps;
}

describe('confirm-required, then Move here', () => {
  test('first call has no confirm, the second has confirm:true, and it succeeds (no proof: old call shapes)', async () => {
    const d = deps();
    d.transfer.mockRejectedValueOnce(confirmRequired() as never);
    expect(await moveSubscription(d)).toEqual({ kind: 'moved', transactionId: 'tx-9' });
    expect(d.transfer.mock.calls).toEqual([['tx-9'], ['tx-9', true, 'tok-1']]);
    expect(d.confirm).toHaveBeenCalledWith({ ownerHint: 'a***@gmail.com', hasLiveSite: true, hasShop: true });
  });

  const M = (hasLiveSite: boolean, hasShop: boolean, ownerHint: string | null = 'a***@gmail.com') => moveConfirmMessage({ ownerHint, hasLiveSite, hasShop });
  test('everything exists: the exact Revision 2 copy', () => {
    expect(M(true, true)).toBe(
      'This subscription, your website, bookings and store are on another account (a***@gmail.com). Moving it here moves all of that to this account, and that account will be left empty.',
    );
  });
  test('only the items that exist are named', () => {
    expect(M(true, false)).toBe('This subscription and your website are on another account (a***@gmail.com). Moving it here moves all of that to this account, and that account will be left empty.');
    expect(M(false, true)).toBe('This subscription, bookings and store are on another account (a***@gmail.com). Moving it here moves all of that to this account, and that account will be left empty.');
    const none = M(false, false);
    expect(none).toBe('This subscription is on another account (a***@gmail.com). Moving it here moves just the subscription to this account.');
    expect(none).not.toMatch(/website|bookings|store|offline|empty/);
    for (const m of [M(true, true), M(true, false), M(false, true), none]) expect(m).not.toMatch(/offline/);
  });
  test('no hint from the server: no empty parentheses', () => {
    expect(M(true, true, null)).not.toMatch(/\(/);
  });

  test('a missing hasLiveSite / hasShop is treated as false (never claims what it was not told about)', async () => {
    const d = deps();
    d.transfer.mockRejectedValueOnce(err(409, 'confirm-required', { ownerHint: null }) as never);
    await moveSubscription(d);
    expect(d.confirm).toHaveBeenCalledWith({ ownerHint: null, hasLiveSite: false, hasShop: false });
  });
});

describe('in-progress, shop refusal', () => {
  test('payments no longer reset: confirm copy never mentions it and results carry no paymentsReset', async () => {
    expect(moveConfirmMessage({ ownerHint: 'a***@gmail.com', hasLiveSite: true, hasShop: true })).not.toMatch(/payment/);
    const d = deps();
    d.transfer.mockRejectedValueOnce(confirmRequired({ hasPayments: true }) as never).mockResolvedValueOnce({ moved: true, linked: true });
    expect(await moveSubscription(d)).toEqual({ kind: 'moved', transactionId: 'tx-9' });
    expect(d.confirm).toHaveBeenCalledWith({ ownerHint: 'a***@gmail.com', hasLiveSite: true, hasShop: true });
  });
  test('move-in-progress (503 and 409) gets the finishing sentence', () => {
    const want = 'Your subscription move is still finishing. Open Bookings or Store, or tap Move subscription again, then try again in a moment.';
    expect(moveErrorMessage(err(503, 'move-in-progress'))).toBe(want);
    expect(moveErrorMessage(err(409, 'move-in-progress'))).toBe(want);
  });
  test("account-has-site reason 'shop' vs 'site'", () => {
    const shop = "This account already has its own Bookings or Store set up, so it can't take another business. Use a different account.";
    expect(moveErrorMessage(err(409, 'account-has-site', { reason: 'shop', slug: '' }))).toBe(shop);
    expect(conflictMessage({ code: 'account-has-site', slug: '', reason: 'shop' })).toBe(shop);
    expect(moveErrorMessage(err(409, 'account-has-site', { reason: 'site' }))).toBe(MOVE_ERROR.accountHasSite);
    expect(conflictMessage({ code: 'account-has-site', slug: 'x' })).toMatch(/live website/);
  });
  test('shop setup 503 move-in-progress surfaces the finishing sentence (not the generic 5xx line)', async () => {
    jest.resetModules();
    jest.doMock('@/lib/accessToken', () => ({ accessToken: async () => 'tok' }));
    const { call } = require('@/lib/setup/ownerApi');
    const spy = jest.spyOn(global, 'fetch' as never).mockResolvedValue({ status: 503, ok: false, text: async () => '{"error":"move-in-progress"}', json: async () => ({ error: 'move-in-progress' }) } as never);
    await expect(call('POST', '/api/shop/setup', {})).rejects.toThrow(/subscription move is still finishing/);
    spy.mockRestore();
  });
});

describe('Apple proof', () => {
  const proof = { jws: 'eyJ.signed.jws', originalTransactionId: 'tx-9' };
  test('sent with the probe and with the confirmed call', async () => {
    const d = deps({ proof: jest.fn(async () => proof) });
    d.transfer.mockRejectedValueOnce(confirmRequired() as never);
    expect(await moveSubscription(d)).toEqual({ kind: 'moved', transactionId: 'tx-9' });
    expect(d.transfer.mock.calls).toEqual([['tx-9', undefined, undefined, 'eyJ.signed.jws'], ['tx-9', true, 'tok-1', 'eyJ.signed.jws']]);
    expect(d.proof).toHaveBeenCalledTimes(2);
  });
  test("the proof's originalTransactionId wins over a different pending id", async () => {
    const d = deps({ proof: jest.fn(async () => ({ jws: 'j', originalTransactionId: 'tx-REAL' })) });
    expect(await moveSubscription(d)).toEqual({ kind: 'moved', transactionId: 'tx-REAL' });
    expect(d.transfer.mock.calls).toEqual([['tx-REAL', undefined, undefined, 'j']]);
  });
  test('null proof or a throwing reader: transfer still works without it', async () => {
    const d1 = deps({ proof: jest.fn(async () => null) });
    expect(await moveSubscription(d1)).toEqual({ kind: 'moved', transactionId: 'tx-9' });
    expect(d1.transfer.mock.calls).toEqual([['tx-9']]);
    const d2 = deps({ proof: jest.fn(async () => { throw new Error('boom'); }) });
    expect(await moveSubscription(d2)).toEqual({ kind: 'moved', transactionId: 'tx-9' });
    expect(d2.transfer.mock.calls).toEqual([['tx-9']]);
  });
  test('default reader is the native wrapper, which is null without the module (jest)', async () => {
    const d = deps();
    delete (d as Partial<MoveDeps>).proof;
    await moveSubscription(d);
    expect(d.transfer.mock.calls).toEqual([['tx-9']]);
  });
  test.each([['proof-required', 400], ['proof-invalid', 403], ['proof-invalid', 401]])('%s (%i): the Apple sentence', async (code, status) => {
    const d = deps();
    d.transfer.mockRejectedValueOnce(err(status, code) as never);
    const r = await moveSubscription(d);
    expect(r).toEqual({ kind: 'error', message: MOVE_ERROR.proof });
    expect(MOVE_ERROR.proof).toBe(
      "We couldn't confirm this subscription with Apple on this phone. Open Settings, tap your name, then Subscriptions to check it is active, then try again.",
    );
  });
  test('proof-invalid on the confirmed call too', async () => {
    const d = deps();
    d.transfer.mockRejectedValueOnce(confirmRequired() as never).mockRejectedValueOnce(err(403, 'proof-invalid') as never);
    expect(await moveSubscription(d)).toEqual({ kind: 'error', message: MOVE_ERROR.proof });
  });
});

describe('Cancel', () => {
  test('changes nothing: no second call', async () => {
    const d = deps({ confirm: jest.fn(async () => false) });
    d.transfer.mockRejectedValueOnce(confirmRequired() as never);
    expect(await moveSubscription(d)).toEqual({ kind: 'cancelled' });
    expect(d.transfer).toHaveBeenCalledTimes(1);
    expect(d.transfer).toHaveBeenCalledWith('tx-9');
  });
});

describe('success without a confirm', () => {
  test('an unlinked or already-mine purchase (moved:false) is a success and never asks', async () => {
    const d = deps();
    d.transfer.mockResolvedValueOnce({ moved: false, linked: true });
    expect(await moveSubscription(d)).toEqual({ kind: 'moved', transactionId: 'tx-9' });
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.transfer).toHaveBeenCalledTimes(1);
  });
});

describe('errors: one friendly sentence each', () => {
  const cases: [string, ApiError, string][] = [
    ['account-has-site', err(409, 'account-has-site', { slug: 'old-cuts' }), MOVE_ERROR.accountHasSite],
    ['subscription-inactive', err(402, 'subscription-inactive'), MOVE_ERROR.inactive],
    ['subscription-inactive (revoked)', err(402, 'subscription-inactive', { reason: 'revoked' }), MOVE_ERROR.inactive],
    ['offline', new ApiError(0, 'network', "Couldn't reach Prime Barber"), MOVE_ERROR.offline],
    ['503 temporarily-unavailable', err(503, 'temporarily-unavailable'), MOVE_ERROR.offline],
    ['401 unauthorized', err(401, 'unauthorized'), MOVE_ERROR.signIn],
    ['429 rate-limited', err(429, 'rate-limited'), MOVE_ERROR.rateLimited],
    ['purchase-other-account', err(409, 'purchase-other-account', { hint: 'a***@x.com' }), MOVE_ERROR.otherAccount],
    ['not-found', err(404, 'not-found'), MOVE_ERROR.generic],
  ];

  test.each(cases)('%s on the first call', async (_n, e, message) => {
    const d = deps();
    d.transfer.mockRejectedValueOnce(e as never);
    expect(await moveSubscription(d)).toEqual({ kind: 'error', message });
    expect(d.confirm).not.toHaveBeenCalled();
  });

  test('purchase-changed on the confirmed call: re-probes once and confirms again with the NEW owner token', async () => {
    const d = deps();
    d.transfer
      .mockRejectedValueOnce(confirmRequired() as never)
      .mockRejectedValueOnce(err(409, 'purchase-changed') as never)
      .mockRejectedValueOnce(confirmRequired({ ownerHint: 'b***@x.com', ownerToken: 'tok-2' }) as never)
      .mockResolvedValueOnce({ moved: true, linked: true });
    expect(await moveSubscription(d)).toEqual({ kind: 'moved', transactionId: 'tx-9' });
    expect(d.confirm).toHaveBeenNthCalledWith(2, { ownerHint: 'b***@x.com', hasLiveSite: true, hasShop: true });
    expect(d.transfer).toHaveBeenLastCalledWith('tx-9', true, 'tok-2');
  });

  test('purchase-changed twice: stops with the friendly line (no loop)', async () => {
    const d = deps();
    d.transfer.mockRejectedValue(confirmRequired() as never);
    d.transfer.mockRejectedValueOnce(confirmRequired() as never).mockRejectedValueOnce(err(409, 'purchase-changed') as never)
      .mockRejectedValueOnce(confirmRequired() as never).mockRejectedValueOnce(err(409, 'purchase-changed') as never);
    expect(await moveSubscription(d)).toEqual({ kind: 'error', message: MOVE_ERROR.purchaseChanged });
    expect(d.transfer).toHaveBeenCalledTimes(4);
  });

  test.each(cases.filter((c) => c[0] !== 'purchase-changed'))('%s on the confirmed call', async (_n, e, message) => {
    const d = deps();
    d.transfer.mockRejectedValueOnce(confirmRequired() as never).mockRejectedValueOnce(e as never);
    expect(await moveSubscription(d)).toEqual({ kind: 'error', message });
    expect(d.transfer).toHaveBeenCalledTimes(2);
  });

  test('a non-API throw is the generic sentence', () => {
    expect(moveErrorMessage(new Error('boom'))).toBe(MOVE_ERROR.generic);
  });

  test('no purchase id yet: nothing is sent', async () => {
    const d = deps({ transactionId: jest.fn(async () => null) });
    expect(await moveSubscription(d)).toEqual({ kind: 'error', message: MOVE_ERROR.noPurchase });
    expect(d.transfer).not.toHaveBeenCalled();
  });
});

describe('the dead-end messages now say the subscription is tied to the Apple ID', () => {
  test.each([
    ['publish conflict', conflictMessage({ code: 'purchase-other-account', hint: 'a***@gmail.com' })],
    ['restore', restoreOtherAccountMessage('a***@gmail.com')],
    ['tab lock', otherAccountPlanMessage('a***@gmail.com')],
    ['signed out', CLAIMED_SIGNED_OUT_MESSAGE],
  ])('%s', (_n, m) => {
    expect(m).toMatch(/tied to the Apple ID/);
    expect(m).toMatch(/another Prime Barber account|already belongs to a Prime Barber account/);
  });

  test('Restore offers the move for this refusal only', () => {
    const e = new ApiError(409, 'purchase-other-account', 'x', { hint: 'a***@gmail.com', ownerHint: 'a***@gmail.com', hasLiveSite: true });
    expect(restoreMessage(e, false)).toMatchObject({ movable: true });
    expect(restoreMessage(new ApiError(402, 'subscription-inactive', 'x'), false)?.movable).toBeUndefined();
  });
});

describe('api.transfer sends the owner token back', () => {
  test('confirm:true carries ownerToken; the probe does not', async () => {
    jest.resetModules();
    jest.doMock('@/lib/accessToken', () => ({ accessToken: async () => 'bearer' }));
    const { api } = require('@/lib/api');
    const fetchMock = jest.fn(async () => ({ status: 200, ok: true, text: async () => '{"moved":true,"linked":true}' }));
    (global as any).fetch = fetchMock;
    await api.transfer('tx', undefined);
    await api.transfer('tx', true, 'tok-1');
    const bodies = (fetchMock.mock.calls as any[]).map((c) => JSON.parse(c[1].body));
    expect(bodies).toEqual([{ transactionId: 'tx' }, { transactionId: 'tx', confirm: true, ownerToken: 'tok-1' }]);
  });
});

describe('transaction id is a site product, never the domain', () => {
  test('latest-id picker ignores the domain subscription; the engine sends the proof id', async () => {
    const { pickLatestTransactionId, PRODUCT_IDS } = require('@/lib/publish');
    expect(PRODUCT_IDS).not.toContain('com.ibrahim1774.aibarber.domain.yearly');
    expect(PRODUCT_IDS).toHaveLength(6);
    expect(pickLatestTransactionId([
      { productId: 'com.ibrahim1774.aibarber.hosting.yearly', transactionId: 'site', purchaseDate: '2026-01-01T00:00:00Z', isActive: true },
      { productId: 'com.ibrahim1774.aibarber.domain.yearly', transactionId: 'domain', purchaseDate: '2026-06-01T00:00:00Z', isActive: true },
    ])).toBe('site');
  });
});
