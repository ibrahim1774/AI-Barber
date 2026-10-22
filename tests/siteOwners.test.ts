import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { canClaim, recordCheckoutOwner, recordCheckoutOwnerIfFirst, supabaseSiteOwners, webOwnerDecision, type SiteOwnerRow, type SiteOwnerStore } from '../lib/siteOwners.js';
import { authorizeDeploy, type CheckoutProof, type DeployAuthDeps } from '../lib/deployAuth.js';
import { deploySite, type DeploySiteDeps } from '../api/deploy-site.js';
import { checkoutSlugAllowed, type CheckoutGuardDeps } from '../lib/checkoutGuard.js';

const NOW = 1_800_000_000_000;
const A = '3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const SESSION = 'cs_live_a1B2c3D4e5F6g7H8i9J0';

/** In-memory site_owners with the live store's conditional writes. */
function memStore(rows: SiteOwnerRow[] = []): SiteOwnerStore & { rows: Map<string, SiteOwnerRow> } {
  const m = new Map(rows.map((r) => [r.slug, { ...r }]));
  return {
    rows: m,
    get: vi.fn(async (s: string) => (m.has(s) ? { ...m.get(s)! } : null)),
    insertIfAbsent: vi.fn(async (r: SiteOwnerRow) => (m.has(r.slug) ? false : (m.set(r.slug, { ...r }), true))),
    claim: vi.fn(async (s: string, uid: string, email: string, at: string) => {
      const r = m.get(s);
      if (!r || r.user_id || r.claim_email !== email) return false;
      Object.assign(r, { user_id: uid, claimed_at: at });
      return true;
    }),
    upsert: vi.fn(async (r: SiteOwnerRow) => { m.set(r.slug, { ...r }); }),
  };
}
const owned = (slug: string, user: string): SiteOwnerRow => ({ slug, user_id: user, claim_email: null, source: 'checkout', checkout_session_id: null });
const pending = (slug: string, email: string): SiteOwnerRow => ({ slug, user_id: null, claim_email: email, source: 'checkout', checkout_session_id: SESSION });
const userA = { id: A, email: 'barber@example.com', emailConfirmed: true };

afterEach(() => vi.restoreAllMocks());

describe('webOwnerDecision (the one owner predicate)', () => {
  it('no row → no-owner; the owner → owner; anyone else → not-owner', async () => {
    const s = memStore([owned('fresh-cuts', A)]);
    expect(await webOwnerDecision('other', userA, s)).toBe('no-owner');
    expect(await webOwnerDecision('fresh-cuts', userA, s)).toBe('owner');
    expect(await webOwnerDecision('Fresh Cuts', { id: B, email: 'b@example.com', emailConfirmed: true }, s)).toBe('not-owner');
  });

  it('an unclaimed row is claimed by a CONFIRMED, exactly matching email (case-insensitive), once', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const s = memStore([pending('fresh-cuts', 'barber@example.com')]);
    expect(await webOwnerDecision('fresh-cuts', { ...userA, email: 'Barber@Example.com' }, s, () => NOW)).toBe('owner');
    expect(s.rows.get('fresh-cuts')).toMatchObject({ user_id: A, claimed_at: new Date(NOW).toISOString() });
    // Now owned: another confirmed account with the same email can't take it.
    expect(await webOwnerDecision('fresh-cuts', { id: B, email: 'barber@example.com', emailConfirmed: true }, s)).toBe('not-owner');
  });

  it('an unconfirmed or different email never claims (the row stays "no owner yet")', async () => {
    const s = memStore([pending('fresh-cuts', 'barber@example.com')]);
    expect(await webOwnerDecision('fresh-cuts', { ...userA, emailConfirmed: false }, s)).toBe('no-owner');
    expect(await webOwnerDecision('fresh-cuts', { ...userA, emailConfirmed: undefined }, s)).toBe('no-owner');
    expect(await webOwnerDecision('fresh-cuts', { ...userA, email: 'barber@example.co' }, s)).toBe('no-owner');
    expect(await webOwnerDecision('fresh-cuts', { ...userA, email: 'xbarber@example.com' }, s)).toBe('no-owner');
    expect(s.rows.get('fresh-cuts')!.user_id).toBeNull();
    expect(canClaim({ user_id: null, claim_email: null }, userA)).toBe(false);
  });

  it('a lost claim race answers with whoever won', async () => {
    const s = memStore([pending('fresh-cuts', 'barber@example.com')]);
    s.claim = vi.fn(async () => { s.rows.get('fresh-cuts')!.user_id = B; return false; });
    expect(await webOwnerDecision('fresh-cuts', userA, s)).toBe('not-owner');
  });
});

describe('recordCheckoutOwner (first paid checkout)', () => {
  it('the signed-in buyer whose confirmed email is the checkout email becomes the owner', async () => {
    const s = memStore();
    expect(await recordCheckoutOwner('Fresh Cuts', { user: userA, checkoutEmail: ' BARBER@example.com ', sessionId: SESSION }, s))
      .toMatchObject({ slug: 'fresh-cuts', user_id: A, claim_email: null, source: 'checkout', checkout_session_id: SESSION });
  });

  it('otherwise the checkout email is stored to be claimed (unconfirmed, other email, or not signed in)', async () => {
    for (const user of [{ ...userA, emailConfirmed: false }, { ...userA, email: 'other@example.com' }, null]) {
      const s = memStore();
      expect(await recordCheckoutOwner('fresh-cuts', { user, checkoutEmail: 'barber@example.com' }, s))
        .toMatchObject({ user_id: null, claim_email: 'barber@example.com' });
    }
  });

  it('never replaces an existing owner; nothing is written without an email', async () => {
    const s = memStore([owned('fresh-cuts', B)]);
    expect(await recordCheckoutOwner('fresh-cuts', { user: userA, checkoutEmail: 'barber@example.com' }, s)).toBeNull();
    expect(s.rows.get('fresh-cuts')!.user_id).toBe(B);
    expect(await recordCheckoutOwner('new-shop', { checkoutEmail: 'not an email' }, s)).toBeNull();
    expect(s.rows.has('new-shop')).toBe(false);
  });
});

describe('authorizeDeploy with the owner list (lib/deployAuth.ts web rule)', () => {
  const users: Record<string, { id: string; email: string; emailConfirmed: boolean }> = {
    'a-jwt': userA, 'b-jwt': { id: B, email: 'b@example.com', emailConfirmed: true },
  };
  const deps = (store: SiteOwnerStore, over: Partial<DeployAuthDeps> = {}): DeployAuthDeps => ({
    userOf: async (t) => users[t] ?? null,
    findBySlug: async () => null,
    checkoutSession: async () => null,
    // The interim rule would let B in: B's `sites` row claims the URL.
    webClaimants: async () => [B],
    storedStamp: async () => 'https://fresh-cuts.vercel.app',
    projectExists: async () => true,
    siteOwners: store,
    now: () => NOW,
    ...over,
  });
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  it('an owned site: its owner deploys (no `sites` claim needed); anyone else is 403 even with a `sites` claim', async () => {
    quiet();
    const store = memStore([owned('fresh-cuts', A)]);
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', authorization: 'Bearer a-jwt' }, deps(store))).toMatchObject({ ok: true, actor: 'web-user', userId: A });
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', authorization: 'Bearer b-jwt' }, deps(store))).toEqual({ ok: false, status: 403, error: 'not-authorized' });
  });

  it('no owner row yet: the interim `sites` rule decides (B claims it → ok, A does not → 403)', async () => {
    quiet();
    const store = memStore();
    expect((await authorizeDeploy({ siteId: 'fresh-cuts', authorization: 'Bearer b-jwt' }, deps(store))).ok).toBe(true);
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', authorization: 'Bearer a-jwt' }, deps(store))).toEqual({ ok: false, status: 403, error: 'not-authorized' });
  });

  it('an unclaimed row: the buyer\'s confirmed email claims it and deploys; an outage fails closed (503)', async () => {
    quiet();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = memStore([pending('fresh-cuts', 'barber@example.com')]);
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', authorization: 'Bearer a-jwt' }, deps(store))).toMatchObject({ ok: true, userId: A });
    expect(store.rows.get('fresh-cuts')!.user_id).toBe(A);
    const down = memStore();
    down.get = async () => { throw new Error('db down'); };
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', authorization: 'Bearer a-jwt' }, deps(down))).toEqual({ ok: false, status: 503, error: 'temporarily-unavailable' });
  });

  it('a checkout is never proof against the owner list: a foreign session on an owned site is 403 (or the signed-in rules); the owner row\'s own session still replays', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const proof: CheckoutProof = { paid: true, status: 'complete', mode: 'subscription', siteId: 'fresh-cuts', app: 'aibarber', created: Math.floor(NOW / 1000) - 60, email: 'x@example.com' };
    const OTHER_SESSION = 'cs_live_zzzzzzzzzzzzzzzzzzzz';
    const store = memStore([{ ...owned('fresh-cuts', A), checkout_session_id: SESSION }]);
    const d = deps(store, { checkoutSession: async () => proof });
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: OTHER_SESSION }, d)).toEqual({ ok: false, status: 403, error: 'checkout-not-valid' });
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: OTHER_SESSION, authorization: 'Bearer b-jwt' }, d)).toEqual({ ok: false, status: 403, error: 'not-authorized' });
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: OTHER_SESSION, authorization: 'Bearer a-jwt' }, d)).toMatchObject({ ok: true, actor: 'web-user', userId: A });
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: SESSION }, d))
      .toMatchObject({ ok: true, actor: 'checkout', checkout: { sessionId: SESSION, email: 'x@example.com' } });
    // An unclaimed row and an admin row (no session) block a foreign session too; an outage is 503.
    expect((await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: OTHER_SESSION }, deps(memStore([pending('fresh-cuts', 'a@b.co')]), { checkoutSession: async () => proof }))).status).toBe(403);
    expect((await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: SESSION }, deps(memStore([{ ...owned('fresh-cuts', A), source: 'admin' }]), { checkoutSession: async () => proof }))).status).toBe(403);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = memStore();
    down.get = async () => { throw new Error('db down'); };
    expect(await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: SESSION }, deps(down, { checkoutSession: async () => proof }))).toEqual({ ok: false, status: 503, error: 'temporarily-unavailable' });
  });
});

describe('checkout creation refuses an already-published slug except for its owner (lib/checkoutGuard.ts)', () => {
  const guardDeps = (live: { stamp?: string | null; project?: boolean }, store = memStore([owned('fresh-cuts', A)])): CheckoutGuardDeps => ({
    storedStamp: async () => live.stamp ?? null, projectExists: async () => live.project ?? false,
    userOf: async (t) => (t === 'a-jwt' ? userA : t === 'b-jwt' ? { id: B, email: 'b@example.com', emailConfirmed: true } : t === 'admin-jwt' ? { id: 'adm', email: 'ibrahim3709@gmail.com' } : null),
    siteOwners: store, now: () => NOW,
  });
  it('a new slug is open to anyone; a published one only to its owner or the admin; lookups fail closed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await checkoutSlugAllowed('Fresh Cuts', undefined, guardDeps({}))).toEqual({ ok: true, slug: 'fresh-cuts' });
    for (const live of [{ stamp: 'https://fresh-cuts.vercel.app' }, { project: true }]) {
      expect(await checkoutSlugAllowed('fresh-cuts', undefined, guardDeps(live))).toEqual({ ok: false, status: 409, error: 'site-published' });
      expect(await checkoutSlugAllowed('fresh-cuts', 'Bearer b-jwt', guardDeps(live))).toMatchObject({ ok: false, status: 409 });
      expect(await checkoutSlugAllowed('fresh-cuts', 'Bearer a-jwt', guardDeps(live))).toMatchObject({ ok: true });
      expect(await checkoutSlugAllowed('fresh-cuts', 'Bearer admin-jwt', guardDeps(live))).toMatchObject({ ok: true });
    }
    expect(await checkoutSlugAllowed('fresh-cuts', undefined, { ...guardDeps({}), projectExists: async () => { throw new Error('vercel down'); } }))
      .toEqual({ ok: false, status: 503, error: 'temporarily-unavailable' });
    expect(await checkoutSlugAllowed('!!!', undefined, guardDeps({}))).toMatchObject({ ok: false, status: 400 });
  });
});

describe('/api/deploy-site records the owner at the checkout deploy', () => {
  const res = () => { const r: any = { statusCode: 0, body: null, setHeader() {}, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; }, end() { return this; } }; return r; };
  const proof: CheckoutProof = { paid: true, status: 'complete', mode: 'subscription', siteId: 'fresh-cuts', app: 'aibarber', created: Math.floor(Date.now() / 1000) - 60, email: 'Barber@Example.com' };
  const handlerDeps = (store: SiteOwnerStore, user: unknown = null, live: { stamp?: string | null; project?: boolean } = {}): DeploySiteDeps => ({
    auth: {
      userOf: async () => user as any, findBySlug: async () => null, checkoutSession: async () => proof, webClaimants: async () => [],
      storedStamp: async () => live.stamp ?? null, projectExists: async () => live.project ?? false, siteOwners: store, now: () => Date.now(),
    },
    deploy: {
      deploy: async (i) => ({ deploymentUrl: `https://${i.siteId}.vercel.app`, uploadedImages: {} }),
      writePending: async () => {}, now: () => Date.now(),
    },
    limiter: { allow: async () => true },
  });

  it('not signed in: the checkout email is stored to be claimed', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const store = memStore();
    const r = res();
    await deploySite({ method: 'POST', body: { siteId: 'fresh-cuts', html: '<h1/>', checkoutSessionId: SESSION }, headers: {} }, r, handlerDeps(store));
    expect(r.statusCode).toBe(200);
    expect(store.rows.get('fresh-cuts')).toMatchObject({ user_id: null, claim_email: 'barber@example.com', source: 'checkout', checkout_session_id: SESSION });
  });

  it('signed in with the confirmed checkout email: that account owns it; a failing owner write never fails the deploy', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = memStore();
    const r = res();
    await deploySite({ method: 'POST', body: { siteId: 'fresh-cuts', html: '<h1/>', checkoutSessionId: SESSION }, headers: { authorization: 'Bearer t' } }, r, handlerDeps(store, userA));
    expect(store.rows.get('fresh-cuts')).toMatchObject({ user_id: A, claim_email: null });
    const broken = memStore();
    broken.insertIfAbsent = async () => { throw new Error('db down'); };
    const r2 = res();
    await deploySite({ method: 'POST', body: { siteId: 'fresh-cuts', html: '<h1/>', checkoutSessionId: SESSION }, headers: {} }, r2, handlerDeps(broken));
    expect(r2.statusCode).toBe(200);
  });
});

describe('a checkout naming an ALREADY-LIVE site records no owner (it could be a stranger paying for someone else\'s slug)', () => {
  const res = () => { const r: any = { statusCode: 0, body: null, setHeader() {}, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; }, end() { return this; } }; return r; };
  const proof: CheckoutProof = { paid: true, status: 'complete', mode: 'subscription', siteId: 'fresh-cuts', app: 'aibarber', created: Math.floor(Date.now() / 1000) - 60, email: 'stranger@example.com' };
  const depsFor = (store: SiteOwnerStore, live: { stamp?: string | null; project?: boolean }): DeploySiteDeps => ({
    auth: {
      userOf: async () => null, findBySlug: async () => null, checkoutSession: async () => proof, webClaimants: async () => [],
      storedStamp: async () => live.stamp ?? null, projectExists: async () => live.project ?? false, siteOwners: store, now: () => Date.now(),
    },
    deploy: { deploy: async (i) => ({ deploymentUrl: `https://${i.siteId}.vercel.app`, uploadedImages: {} }), writePending: async () => {}, now: () => Date.now() },
    limiter: { allow: async () => true },
  });

  it.each([[{ stamp: 'https://fresh-cuts.vercel.app' }], [{ project: true }]])('deploy-site: unowned but live (%j) → no row', async (live) => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const store = memStore();
    const r = res();
    await deploySite({ method: 'POST', body: { siteId: 'fresh-cuts', html: '<h1/>', checkoutSessionId: SESSION }, headers: {} }, r, depsFor(store, live));
    expect(r.statusCode).toBe(200); // the 7-day checkout proof still deploys, as before
    expect(store.rows.size).toBe(0);
  });

  it('the webhook helper: a live slug (stamp or project) or a failed check records nothing; a new one records the checkout email', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = memStore();
    const input = { checkoutEmail: 'buyer@example.com', sessionId: SESSION };
    expect(await recordCheckoutOwnerIfFirst('fresh-cuts', input, store, { storedStamp: async () => 'https://x.vercel.app', projectExists: async () => false })).toBeNull();
    expect(await recordCheckoutOwnerIfFirst('fresh-cuts', input, store, { storedStamp: async () => null, projectExists: async () => true })).toBeNull();
    expect(await recordCheckoutOwnerIfFirst('fresh-cuts', input, store, { storedStamp: async () => { throw new Error('gcs down'); }, projectExists: async () => false })).toBeNull();
    expect(store.rows.size).toBe(0);
    expect(await recordCheckoutOwnerIfFirst('fresh-cuts', input, store, { storedStamp: async () => null, projectExists: async () => false }))
      .toMatchObject({ slug: 'fresh-cuts', claim_email: 'buyer@example.com', user_id: null });
  });

  it('authorizeDeploy reports firstPublish from the state BEFORE the deploy', async () => {
    const base: DeployAuthDeps = {
      userOf: async () => null, findBySlug: async () => null, checkoutSession: async () => proof, webClaimants: async () => [],
      storedStamp: async () => null, projectExists: async () => false, now: () => Date.now(),
    };
    expect((await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: SESSION }, base)).checkout).toMatchObject({ firstPublish: true });
    expect((await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: SESSION }, { ...base, projectExists: async () => true })).checkout).toMatchObject({ firstPublish: false });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await authorizeDeploy({ siteId: 'fresh-cuts', checkoutSessionId: SESSION }, { ...base, storedStamp: async () => { throw new Error('x'); } })).checkout).toMatchObject({ firstPublish: false });
  });
});

describe('supabaseSiteOwners: migration 013 not applied', () => {
  it('a missing table reads as no owner and skips writes (the interim rule keeps working)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const missing = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.site_owners' in the schema cache" } };
    const q: any = { select: () => q, eq: () => q, is: () => q, update: () => q, upsert: () => q, maybeSingle: async () => missing, then: (f: any) => Promise.resolve(missing).then(f) };
    const store = supabaseSiteOwners({ from: () => q } as any);
    expect(await store.get('fresh-cuts')).toBeNull();
    expect(await store.insertIfAbsent(pending('fresh-cuts', 'a@b.co'))).toBe(false);
    expect(await store.claim('fresh-cuts', A, 'a@b.co', 'x')).toBe(false);
  });
});

describe('013_site_owners.sql', () => {
  const s = fs.readFileSync(path.join(__dirname, '../supabase/migrations/013_site_owners.sql'), 'utf8');
  const code = s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ').trim();
  it('one server-only table: RLS on, no policy, nothing granted to clients', () => {
    expect(code).toContain('create table if not exists public.site_owners (');
    expect(code).toContain('alter table public.site_owners enable row level security;');
    expect(code).toContain('revoke all on table public.site_owners from anon, authenticated;');
    expect(code).not.toMatch(/\bgrant\b|\bcreate policy\b/i);
    expect(code.replace(/on delete cascade/g, '')).not.toMatch(/\bdrop\b|\bdelete\b|\btruncate\b/i);
  });
  it('slug unique, the three sources, someone to own it, lower-case claim emails', () => {
    expect(code).toMatch(/slug text primary key/);
    expect(code).toContain("check (source in ('checkout', 'admin', 'backfill'))");
    expect(code).toContain('check (user_id is not null or claim_email is not null)');
    expect(code).toMatch(/claim_email = lower\(claim_email\)/);
    expect(code).toMatch(/references auth\.users \(id\) on delete cascade/);
  });
});

describe('admin: web-owner / set-web-owner (API action, CLI)', () => {
  const adminDeps = (store = memStore(), accounts: Record<string, string> = { 'barber@example.com': A }) => ({
    store,
    isAppSlug: async (s: string) => s === 'fade-lab',
    userByEmail: async (e: string) => (accounts[e] ? { id: accounts[e], email: e, emailConfirmed: true } : null),
    emailOf: async (id: string) => Object.entries(accounts).find(([, v]) => v === id)?.[0] ?? null,
    audit: vi.fn(async () => {}),
    now: () => NOW,
  });

  it('set-web-owner: an existing account owns it at once (replacing a previous owner, audited); an unknown email waits to be claimed', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { getWebOwner, setWebOwner } = await import('../lib/siteOwners.js');
    const d = adminDeps(memStore([owned('fresh-cuts', B)]));
    expect(await setWebOwner('Fresh Cuts', 'BARBER@example.com', d, 'admin@x')).toMatchObject({ ok: true, slug: 'fresh-cuts', owner: { userId: A, email: 'barber@example.com', source: 'admin' } });
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ slug: 'fresh-cuts', userId: A, previous: expect.objectContaining({ user_id: B }) }));
    expect(await setWebOwner('comped-shop', 'new@example.com', d)).toMatchObject({ owner: { userId: null, claimEmail: 'new@example.com', source: 'admin' } });
    expect(await getWebOwner('nobody', d)).toEqual({ ok: true, slug: 'nobody', owner: null });
  });

  it('refuses app (iOS) slugs, bad emails and missing slugs', async () => {
    const { setWebOwner } = await import('../lib/siteOwners.js');
    const d = adminDeps();
    expect(await setWebOwner('fade-lab', 'barber@example.com', d)).toMatchObject({ ok: false, error: 'app-site' });
    expect(await setWebOwner('fresh-cuts', 'nope', d)).toMatchObject({ ok: false, error: 'bad-request' });
    expect(await setWebOwner('', 'barber@example.com', d)).toMatchObject({ ok: false, error: 'bad-request' });
    expect(d.store.rows.size).toBe(0);
  });

  it('through /api/admin/sites (admin only) and the CLI', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { makeAdminSitesHandler } = await import('../api/admin/sites.js');
    const { memoryStore } = await import('../lib/bookings/rateLimit.js');
    const { runCli } = await import('../lib/admin/cli.js');
    const d = adminDeps();
    const core = () => ({ webOwners: d }) as any;
    const h = makeAdminSitesHandler({
      emailOf: () => async (t) => (t === 'admin' ? 'ibrahim3709@gmail.com' : t === 'user' ? 'x@example.com' : null),
      core, reads: memoryStore(), writes: memoryStore(), now: () => NOW, configured: () => true,
    });
    const call = async (body: unknown, token = 'admin') => {
      const r: any = { statusCode: 0, body: null, setHeader() {}, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
      await h({ method: 'POST', body, headers: { authorization: `Bearer ${token}` } } as any, r);
      return r;
    };
    expect((await call({ action: 'set-web-owner', slug: 'fresh-cuts', email: 'barber@example.com' }, 'user')).statusCode).toBe(403);
    expect(d.store.rows.size).toBe(0);
    expect(await call({ action: 'set-web-owner', slug: 'fresh-cuts', email: 'barber@example.com' })).toMatchObject({ statusCode: 200, body: { owner: { userId: A } } });
    expect((await call({ action: 'set-web-owner', slug: 'fade-lab', email: 'barber@example.com' })).statusCode).toBe(409);
    expect((await call({ action: 'web-owner', slug: 'fresh-cuts' })).body).toMatchObject({ ok: true, owner: { email: 'barber@example.com' } });
    const out: string[] = [];
    const io = { out: (l: string) => out.push(l), err: (l: string) => out.push(`ERR ${l}`), readFile: () => '', newRunId: () => 'r' };
    expect(await runCli(['set-web-owner', 'comped', 'new@example.com'], core, io)).toBe(0);
    expect(await runCli(['web-owner', 'comped'], core, io)).toBe(0);
    expect(out.at(-1)).toBe('comped: waiting for new@example.com to sign in with a confirmed email (admin).');
  });
});

describe('backfill planner (scripts/backfill-site-owners.mjs)', () => {
  it('site checkouts only; confirmed account -> owner, else the email to claim; owned, app and ambiguous slugs skipped', async () => {
    const { planBackfill, toBackfillSession } = await import('../lib/siteOwnersBackfill.js');
    const s = (id: string, siteId: string, email: string | null, over: Record<string, unknown> = {}) => toBackfillSession({
      id, mode: 'subscription', status: 'complete', payment_status: 'paid', metadata: { app: 'aibarber', siteId },
      customer_details: { email }, created: Number(id.replace(/\D/g, '')) || 1, ...over,
    });
    const plan = planBackfill([
      s('cs_1', 'Fresh Cuts', 'Barber@Example.com'),
      s('cs_2', 'fresh-cuts', 'barber@example.com'), // a renewal checkout, same email
      s('cs_3', 'new-shop', 'nobody@example.com'),
      s('cs_4', 'pre-registered', 'victim@example.com'),
      s('cs_5', 'two-buyers', 'a@example.com'),
      s('cs_6', 'two-buyers', 'b@example.com'),
      s('cs_7', 'already', 'x@example.com'),
      s('cs_8', 'fade-lab', 'x@example.com'),
      s('cs_9', 'domain', 'x@example.com', { mode: 'payment' }),
      s('cs_10', 'other-app', 'x@example.com', { metadata: { app: 'primehub', siteId: 'other-app' } }),
      s('cs_11', 'no-email', null),
    ], {
      accountByEmail: new Map([['barber@example.com', { id: A, emailConfirmed: true }], ['victim@example.com', { id: B, emailConfirmed: false }]]),
      owned: new Set(['already']),
      appSlugs: new Set(['fade-lab']),
    });
    expect(plan.insert).toEqual([
      { slug: 'fresh-cuts', user_id: A, claim_email: null, source: 'backfill', checkout_session_id: 'cs_1' },
      { slug: 'new-shop', user_id: null, claim_email: 'nobody@example.com', source: 'backfill', checkout_session_id: 'cs_3' },
      { slug: 'pre-registered', user_id: null, claim_email: 'victim@example.com', source: 'backfill', checkout_session_id: 'cs_4' },
    ]);
    expect(plan.skipped).toEqual([
      { slug: 'already', reason: 'already-owned' },
      { slug: 'fade-lab', reason: 'app-site' },
      { slug: 'no-email', reason: 'no-email' },
      { slug: 'two-buyers', reason: 'several-emails', detail: 'a@example.com, b@example.com' },
    ]);
    expect(plan.ignoredSessions).toBe(2);
  });
});
