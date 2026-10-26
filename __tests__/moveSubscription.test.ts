// "Move subscription to this account": every branch of the engine, with the server's exact shapes.
import { ApiError } from '@/lib/api';
import {
  MOVE_ERROR, moveConfirmMessage, moveErrorMessage, moveSubscription, type MoveDeps,
} from '@/lib/moveSubscription';
import { CLAIMED_SIGNED_OUT_MESSAGE, conflictMessage, otherAccountPlanMessage, restoreOtherAccountMessage } from '@/lib/claimCopy';
import { restoreMessage } from '@/lib/restoreFlow';

const confirmRequired = (over: Record<string, unknown> = {}) =>
  new ApiError(409, 'confirm-required', 'x', { error: 'confirm-required', ownerHint: 'a***@gmail.com', hasLiveSite: true, siteUrl: 'https://x.aibarber.org', ...over });
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
  test('first call has no confirm, the second has confirm:true, and it succeeds', async () => {
    const d = deps();
    d.transfer.mockRejectedValueOnce(confirmRequired() as never);
    expect(await moveSubscription(d)).toEqual({ kind: 'moved', transactionId: 'tx-9' });
    expect(d.transfer.mock.calls).toEqual([['tx-9'], ['tx-9', true]]);
    expect(d.confirm).toHaveBeenCalledWith({ ownerHint: 'a***@gmail.com', hasLiveSite: true });
  });

  test('the confirm text names the masked owner and the offline consequence', () => {
    expect(moveConfirmMessage({ ownerHint: 'a***@gmail.com', hasLiveSite: true })).toBe(
      "This subscription is on another account (a***@gmail.com). Moving it here takes that account's website offline.",
    );
  });

  test('no live site on the other account: the offline sentence is left out', () => {
    const m = moveConfirmMessage({ ownerHint: 'a***@gmail.com', hasLiveSite: false });
    expect(m).toBe('This subscription is on another account (a***@gmail.com).');
    expect(m).not.toMatch(/offline/);
  });

  test('no hint from the server: no empty parentheses', () => {
    expect(moveConfirmMessage({ ownerHint: null, hasLiveSite: true })).not.toMatch(/\(/);
  });

  test('a missing hasLiveSite is treated as false (never claims a takedown it was not told about)', async () => {
    const d = deps();
    d.transfer.mockRejectedValueOnce(err(409, 'confirm-required', { ownerHint: null }) as never);
    await moveSubscription(d);
    expect(d.confirm).toHaveBeenCalledWith({ ownerHint: null, hasLiveSite: false });
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
    ['purchase-changed', err(409, 'purchase-changed'), MOVE_ERROR.purchaseChanged],
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

  test.each(cases)('%s on the confirmed call', async (_n, e, message) => {
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
