// The locked account step end to end on the real auth, publish and store code (only the network is faked).
import * as store from '@/lib/siteStore';
import type { SiteRecord } from '@/lib/siteStore';
import { ApiError } from '@/lib/api';
import { signIn, signOut } from '@/lib/auth';
import { accessToken } from '@/lib/accessToken';
import { createClaimRunner } from '@/lib/claim';
import { conflictMessage } from '@/lib/claimCopy';
import { reopenClaim } from '@/lib/claimGuard';
import { publishFlow, resumePendingPublish, type PublishDeps } from '@/lib/publish';
import type { ClaimValues } from '@/lib/claimValidation';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sb, supabase } = require('@/lib/supabase');

const data: any = {
  shopName: 'Fade', area: 'Brooklyn, NY', phone: '555',
  hero: { heading: 'Sharp', tagline: 't', imageUrl: 'https://cdn.example/h.jpg' }, about: { heading: 'A', description: ['x'], imageUrl: '' },
  services: [], gallery: [],
};
const draft = { draftId: 'd1', inputs: { shopName: 'Fade' }, data, updatedAt: 1, slug: null, deployedUrl: null, transactionId: null } as unknown as SiteRecord;
const LIVE = { siteId: 'fade', deployedUrl: 'https://fade.aibarber.org', republished: false };
const A = { id: 'user-a', email: 'a@example.com' };
const B = { id: 'user-b', email: 'b@example.com' };
const form = (email: string): ClaimValues => ({ name: 'Jo', email, phone: '5125550142', password: 'hunter22!', confirm: 'hunter22!' });

/** supabase signInWithPassword that opens a session for whoever the email names. */
function accounts() {
  supabase.auth.signInWithPassword.mockImplementation(async ({ email }: { email: string }) => {
    const user = email === A.email ? A : B;
    const session = { access_token: `tok-${user.id}`, user };
    sb.setSession(session);
    return { data: { user, session }, error: null };
  });
}

let publishes: { token: string }[];
function deps(over: Partial<PublishDeps> = {}): PublishDeps {
  return {
    hasEntitlement: async () => false,
    showPaywall: async () => 'purchased',
    latestTransactionId: async () => 'tx-1',
    // The Apple ID's purchase belongs to A: B is refused, A (and a stranger with no account yet) is not.
    iosPublish: (async (_b: unknown, token: string) => {
      publishes.push({ token });
      if (token === `tok-${B.id}`) throw new ApiError(409, 'purchase-other-account', 'x', { hint: 'a***@example.com' });
      return LIVE;
    }) as never,
    claimStart: (async () => ({ ok: true, state: 'unclaimed', claimExpiresAt: 'x' })) as never,
    accessToken,
    store,
    ...over,
  };
}

beforeEach(async () => {
  sb.reset();
  publishes = [];
  accounts();
  await store.saveSite(draft);
  await store.savePendingPublish(null);
});

function runner(d: PublishDeps) {
  return createClaimRunner({
    signup: (async (b: { email: string }) => ({ ok: true, email: b.email })) as never,
    signIn,
    finish: () => resumePendingPublish(d),
    dropSession: async () => { await supabase.auth.signOut({ scope: 'local' }); },
  });
}

test('pay signed out -> account step -> sign up -> live, and only then is the draft pushed to the account', async () => {
  const d = deps();
  expect(await publishFlow(draft, d)).toEqual({ kind: 'claim-required' });
  expect(publishes).toHaveLength(0);
  const out = await runner(d).submit('signup', form(A.email));
  expect(out).toEqual({ kind: 'live' });
  expect(publishes).toEqual([{ token: `tok-${A.id}` }]);
  expect(await store.loadPendingPublish()).toBeNull();
  expect(await store.loadSite()).toMatchObject({ slug: 'fade', transactionId: 'tx-1' });
  // onLive is the app's job (usePublishDeps); here nothing wrote the draft anywhere before the publish.
  expect(sb.upserts).toHaveLength(0);
});

test('the wrong account is refused (409), stays locked with the masked hint, and nothing leaked into it', async () => {
  const d = deps();
  await publishFlow(draft, d);
  const r = await runner(d).submit('signin', form(B.email));
  expect(r).toEqual({ kind: 'blocked', message: conflictMessage({ code: 'purchase-other-account', hint: 'a***@example.com' }) });
  expect(await store.loadPendingPublish()).toMatchObject({ state: 'conflict', conflict: { hint: 'a***@example.com' } });
  expect(sb.upserts).toHaveLength(0); // the draft never went into B's account
  expect((await store.loadSite())?.ownerUserId).toBeUndefined(); // and was never stamped as B's
});

test('"Use a different account": sign out, then a new account takes the same purchase through to live', async () => {
  const d = deps({
    iosPublish: (async (_b: unknown, token: string) => {
      publishes.push({ token });
      if (token === `tok-${B.id}`) throw new ApiError(409, 'purchase-other-account', 'x', { hint: 'a***@example.com' });
      return LIVE;
    }) as never,
  });
  await publishFlow(draft, d);
  await runner(d).submit('signin', form(B.email));
  await signOut();
  await reopenClaim();
  expect(sb.session).toBeNull();
  expect(await store.loadSite()).toMatchObject({ draftId: 'd1' }); // the draft stayed on the phone
  expect(await store.loadPendingPublish()).toMatchObject({ state: 'unclaimed' });
  // Sign in as the owner (A): no UNSAVED_OTHER_ACCOUNT dead end, and live.
  expect(await runner(d).submit('signin', form(A.email))).toEqual({ kind: 'live' });
  expect(publishes.map((p) => p.token)).toEqual([`tok-${B.id}`, `tok-${A.id}`]);
  expect(sb.upserts).toHaveLength(0);
});

test('an account that already has a site: 409 account-has-site names the slug and stays locked', async () => {
  const d = deps({ iosPublish: (async () => { throw new ApiError(409, 'account-has-site', 'x', { slug: 'old-cuts' }); }) as never });
  await publishFlow(draft, d);
  const r = await runner(d).submit('signin', form(A.email));
  expect(r).toMatchObject({ kind: 'blocked', message: expect.stringContaining('old-cuts') });
  expect(await store.loadPendingPublish()).toMatchObject({ state: 'conflict', conflict: { code: 'account-has-site', slug: 'old-cuts' } });
});

test('offline publish after sign-in: waiting, the record is kept as claiming; the retry goes live', async () => {
  let offline = true;
  const d = deps({
    iosPublish: (async (_b: unknown, token: string) => {
      publishes.push({ token });
      if (offline) throw new ApiError(0, 'network', 'offline');
      return LIVE;
    }) as never,
  });
  await publishFlow(draft, d);
  const run = runner(d);
  expect(await run.submit('signup', form(A.email))).toMatchObject({ kind: 'waiting', stage: 'publish' });
  expect(await store.loadPendingPublish()).toMatchObject({ state: 'claiming' });
  offline = false;
  expect(await run.finish()).toEqual({ kind: 'live' });
  expect(await store.loadPendingPublish()).toBeNull();
});

test('a relaunch after sign-in but before the publish confirms still finishes it (claiming + session)', async () => {
  const d = deps({ iosPublish: (async () => { throw new ApiError(503, 'temporarily-unavailable', 'x'); }) as never });
  await publishFlow(draft, d);
  await runner(d).submit('signup', form(A.email));
  expect(await store.loadPendingPublish()).toMatchObject({ state: 'claiming' });
  const relaunch = await resumePendingPublish(deps());
  expect(relaunch).toMatchObject({ kind: 'live' });
});
