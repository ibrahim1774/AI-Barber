// The account step's engine: sign up / sign in, then the pending publish with the new session.
import { ApiError } from '@/lib/api';
import { OFFLINE } from '@/lib/auth';
import { WAITING_MESSAGE, createClaimRunner, type ClaimDeps } from '@/lib/claim';
import type { PublishOutcome } from '@/lib/publish';
import type { ClaimValues } from '@/lib/claimValidation';

const v: ClaimValues = { name: ' Jo Barber ', email: ' Jo@Example.com ', phone: '(512) 555-0142', password: 'hunter22!', confirm: 'hunter22!' };
const LIVE: PublishOutcome = { kind: 'live', url: 'https://x.aibarber.org', republished: false };
const rej = (status: number, code: string, body?: unknown) => jest.fn(async () => { throw new ApiError(status, code, code, body); });

function setup(over: Partial<ClaimDeps> = {}) {
  const deps = {
    signup: jest.fn(async (b: { email: string }) => ({ ok: true as const, email: b.email.trim().toLowerCase() })),
    transactionId: jest.fn(async () => 'tx-9'),
    signIn: jest.fn(async () => {}),
    finish: jest.fn(async (): Promise<PublishOutcome | null> => LIVE),
    dropSession: jest.fn(async () => {}),
    ...over,
  } as unknown as ClaimDeps & { signup: jest.Mock; signIn: jest.Mock; finish: jest.Mock; dropSession: jest.Mock };
  return { deps, runner: createClaimRunner(deps) };
}

describe('sign up', () => {
  test('creates the account (trimmed, E.164), signs in with the returned email, then publishes: live', async () => {
    const { deps, runner } = setup();
    expect(await runner.submit('signup', v)).toEqual({ kind: 'live' });
    expect(deps.signup).toHaveBeenCalledWith({ name: 'Jo Barber', email: 'Jo@Example.com', phone: '+15125550142', password: 'hunter22!', transactionId: 'tx-9' });
    expect(deps.signIn).toHaveBeenCalledWith('jo@example.com', 'hunter22!');
    expect(deps.signup.mock.invocationCallOrder[0]).toBeLessThan(deps.signIn.mock.invocationCallOrder[0]);
    expect(deps.signIn.mock.invocationCallOrder[0]).toBeLessThan(deps.finish.mock.invocationCallOrder[0]);
  });

  test('an invalid form sends nothing and returns every inline error', async () => {
    const { deps, runner } = setup();
    const r = await runner.submit('signup', { ...v, name: '', phone: '12', confirm: 'nope' });
    expect(r).toMatchObject({ kind: 'invalid', errors: { name: expect.any(String), phone: expect.any(String), confirm: expect.any(String) } });
    expect(deps.signup).not.toHaveBeenCalled();
    expect(deps.signIn).not.toHaveBeenCalled();
  });

  test('email exists -> email-exists with the email kept; nothing signed in, nothing published', async () => {
    const { deps, runner } = setup({ signup: rej(409, 'email-exists') as never });
    expect(await runner.submit('signup', v)).toEqual({ kind: 'email-exists', email: 'Jo@Example.com' });
    expect(deps.signIn).not.toHaveBeenCalled();
    expect(deps.finish).not.toHaveBeenCalled();
  });

  test.each([
    [400, 'bad-request', { field: 'phone' }, { kind: 'field', field: 'phone' }],
    [400, 'bad-request', { field: 'email' }, { kind: 'field', field: 'email' }],
    [400, 'bad-request', { field: 'name' }, { kind: 'field', field: 'name' }],
    [400, 'weak-password', { minLength: 8 }, { kind: 'field', field: 'password' }],
    [429, 'rate-limited', undefined, { kind: 'error' }],
    [503, 'temporarily-unavailable', undefined, { kind: 'error' }],
    [500, 'http-500', undefined, { kind: 'error' }],
  ])('signup %i %s stays on the form with words', async (status, code, body, expected) => {
    const { deps, runner } = setup({ signup: rej(status, code, body) as never });
    const r = await runner.submit('signup', v);
    expect(r).toMatchObject(expected);
    expect(deps.finish).not.toHaveBeenCalled();
  });

  test('the sign-up sends the verified purchase transactionId; without one nothing is created (waiting)', async () => {
    const none = setup({ transactionId: jest.fn(async () => null) as never });
    expect(await none.runner.submit('signup', v)).toMatchObject({ kind: 'waiting', stage: 'account' });
    expect(none.deps.signup).not.toHaveBeenCalled();
  });

  test.each([
    [402, 'subscription-inactive', undefined, { kind: 'inactive' }],
    [409, 'purchase-in-use', undefined, { kind: 'blocked' }],
    [409, 'purchase-claimed', undefined, { kind: 'blocked' }],
    [429, 'signup-limit', undefined, { kind: 'error', message: expect.stringMatching(/Too many accounts/) }],
  ])('signup %i %s: the purchase refusals are worded and stop before sign-in', async (status, code, body, expected) => {
    const { deps, runner } = setup({ signup: rej(status, code, body) as never });
    expect(await runner.submit('signup', v)).toMatchObject(expected);
    expect(deps.signIn).not.toHaveBeenCalled();
    expect(deps.finish).not.toHaveBeenCalled();
  });

  test('offline while creating the account: waiting, locked; the retry creates it once', async () => {
    const { deps, runner } = setup();
    deps.signup.mockRejectedValueOnce(new ApiError(0, 'network', 'offline'));
    expect(await runner.submit('signup', v)).toEqual({ kind: 'waiting', message: WAITING_MESSAGE, stage: 'account' });
    expect(await runner.submit('signup', v)).toEqual({ kind: 'live' });
    expect(deps.signup).toHaveBeenCalledTimes(2);
  });

  test('the account was created but sign-in went offline: the retry only signs in (a second sign up would be 409)', async () => {
    const { deps, runner } = setup();
    deps.signIn.mockRejectedValueOnce(new Error(OFFLINE));
    expect(await runner.submit('signup', v)).toMatchObject({ kind: 'waiting', stage: 'account' });
    expect(await runner.submit('signup', v)).toEqual({ kind: 'live' });
    expect(deps.signup).toHaveBeenCalledTimes(1);
    expect(deps.signIn).toHaveBeenCalledTimes(2);
  });

  test('changing the password after a created account does sign up again with the new one (the old one stays unused)', async () => {
    const { deps, runner } = setup();
    deps.signIn.mockRejectedValueOnce(new Error(OFFLINE));
    await runner.submit('signup', v);
    await runner.submit('signup', { ...v, password: 'another-pass1', confirm: 'another-pass1' });
    expect(deps.signup).toHaveBeenCalledTimes(2);
  });

  test('registration is tracked once, on the account being created', async () => {
    const analytics = require('@/lib/analytics');
    const spy = jest.spyOn(analytics, 'trackRegistration');
    const { runner } = setup();
    await runner.submit('signup', v);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    await setup().runner.submit('signin', v);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('sign in (the toggle inside the same locked step)', () => {
  test('signs in and publishes without creating an account', async () => {
    const { deps, runner } = setup();
    expect(await runner.submit('signin', { ...v, name: '', phone: '', confirm: '' })).toEqual({ kind: 'live' });
    expect(deps.signup).not.toHaveBeenCalled();
    expect(deps.signIn).toHaveBeenCalledWith('Jo@Example.com', 'hunter22!');
  });
  test('wrong password: the auth sentence, no publish', async () => {
    const { deps, runner } = setup({ signIn: jest.fn(async () => { throw new Error("That email and password don't match."); }) as never });
    expect(await runner.submit('signin', v)).toEqual({ kind: 'error', message: "That email and password don't match." });
    expect(deps.finish).not.toHaveBeenCalled();
  });
});

describe('after the account exists', () => {
  test('409 from publish is blocked with the server words; the session stays for "use a different account"', async () => {
    const { runner } = setup({ finish: jest.fn(async () => ({ kind: 'blocked', message: 'belongs to a***@gmail.com' })) as never });
    expect(await runner.submit('signup', v)).toEqual({ kind: 'blocked', message: 'belongs to a***@gmail.com' });
  });
  test('offline during the publish: waiting; finish() retries it', async () => {
    const finish = jest.fn()
      .mockResolvedValueOnce({ kind: 'pending', message: 'x', offline: true })
      .mockResolvedValueOnce(LIVE);
    const { runner } = setup({ finish: finish as never });
    expect(await runner.submit('signup', v)).toEqual({ kind: 'waiting', message: WAITING_MESSAGE, stage: 'publish' });
    expect(await runner.finish()).toEqual({ kind: 'live' });
  });
  test('a server error (5xx) shows its words, not "waiting"', async () => {
    const { runner } = setup({ finish: jest.fn(async () => ({ kind: 'pending', message: 'Your payment went through. We are finishing.' })) as never });
    expect(await runner.submit('signup', v)).toEqual({ kind: 'error', message: 'Your payment went through. We are finishing.' });
  });
  test('402 -> inactive; an admin edit or nothing pending -> moved-on', async () => {
    expect(await setup({ finish: jest.fn(async () => ({ kind: 'inactive' })) as never }).runner.submit('signup', v)).toMatchObject({ kind: 'inactive' });
    expect(await setup({ finish: jest.fn(async () => null) as never }).runner.submit('signup', v)).toEqual({ kind: 'moved-on' });
    expect(await setup({ finish: jest.fn(async () => ({ kind: 'site-updated', message: 'm' })) as never }).runner.submit('signup', v)).toEqual({ kind: 'moved-on' });
  });
  test('the server not accepting the session ends it and asks for a fresh sign-in', async () => {
    const { deps, runner } = setup({ finish: jest.fn(async () => ({ kind: 'claim-required' })) as never });
    expect(await runner.finish()).toMatchObject({ kind: 'error' });
    expect(deps.dropSession).toHaveBeenCalled();
  });
  test('a thrown publish (bad request) is an error on the form, never a crash', async () => {
    const { runner } = setup({ finish: rej(400, 'bad-request') as never });
    expect(await runner.submit('signup', v)).toMatchObject({ kind: 'error' });
  });
});

test('double tap: a second submit while one runs shares it, so the account is created once', async () => {
  let release!: () => void;
  const { deps, runner } = setup({
    signup: jest.fn(() => new Promise((r) => { release = () => r({ ok: true, email: 'jo@example.com' }); })) as never,
  });
  const a = runner.submit('signup', v);
  const b = runner.submit('signup', v);
  await Promise.resolve(); await Promise.resolve(); // the purchase id is read first
  release();
  expect(await a).toEqual({ kind: 'live' });
  expect(await b).toEqual({ kind: 'live' });
  expect(deps.signup).toHaveBeenCalledTimes(1);
  expect(deps.finish).toHaveBeenCalledTimes(1);
  // and a later tap runs again
  expect(await runner.finish()).toEqual({ kind: 'live' });
  expect(deps.finish).toHaveBeenCalledTimes(2);
});
