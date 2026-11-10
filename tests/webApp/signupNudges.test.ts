import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { liveSignupNudgeDeps, scheduleMs, sweepSignupNudges, HOUR, type NudgeRow, type SignupNudgeDeps, type AdminUser, type SignedUpUser, enrollSignups, isInternalTestEmail, resendWhy } from '../../lib/webApp/signupNudges.js';
import { verifyContinueToken } from '../../lib/webApp/nudgeToken.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const SINCE = '2026-11-01T00:00:00Z';
const SECRET = 'nudge-secret';
const ENV = { WEB_APP_NUDGES: '1', WEB_APP_NUDGES_SINCE: SINCE, WEB_APP_NUDGE_SECRET: SECRET, RESEND_API_KEY: 'k' };
const ago = (ms: number) => new Date(NOW - ms).toISOString();

interface World {
  now: number;
  rows: Map<string, NudgeRow>;
  drafts: string[];
  users: Map<string, AdminUser | null | Error>;
  draft: Record<string, any>;
  flags: Record<string, any>;
  sent: { to: string; key: string; subject: string; text: string }[];
  calls: string[];
  sendFails: boolean;
  signups: SignedUpUser[];
}
const user = (o: Partial<AdminUser> = {}): AdminUser => ({ email: 'jake@gmail.com', emailConfirmedAt: ago(10 * HOUR), createdAt: ago(2 * HOUR), lastSignInAt: ago(2 * HOUR), name: 'Jake Lee', ...o });
const row = (uid: string, o: Partial<NudgeRow> = {}): NudgeRow => ({ user_id: uid, environment: 'test', signup_at: ago(2 * HOUR), email: 'jake@gmail.com', step1_sent_at: null, step2_sent_at: null, step3_sent_at: null, claimed_step: null, claimed_at: null, stopped_at: null, stop_reason: null, ...o });

function make(w: Partial<World> = {}) {
  const world: World = { now: NOW, rows: new Map(), drafts: [], users: new Map(), draft: {}, flags: {}, sent: [], calls: [], sendFails: false, signups: [], ...w };
  const f = (k: string, d: any = false) => async (_u: string) => { world.calls.push(k); const v = world.flags[k]; if (v instanceof Error) throw v; return v ?? d; };
  const deps: SignupNudgeDeps = {
    recentUsers: async () => world.signups,
    recentDrafts: async () => world.drafts,
    nudgeRows: async (ids) => ids.map((i) => world.rows.get(i)).filter(Boolean) as NudgeRow[],
    activeRows: async () => [...world.rows.values()].filter((r) => !r.stopped_at),
    insertRow: async (r) => { world.calls.push('insert'); if (!world.rows.has(r.user_id)) world.rows.set(r.user_id, row(r.user_id, { signup_at: r.signup_at, email: r.email, stopped_at: r.stopped_at ?? null, stop_reason: r.stop_reason ?? null })); },
    claim: async (uid, step) => {
      world.calls.push('claim'); const r = world.rows.get(uid)!;
      if (world.flags.claimLost || (r as any)[`step${step}_sent_at`] || r.stopped_at || r.claimed_at) return null;
      r.claimed_step = step; r.claimed_at = 'x'; world.flags.onClaim?.(r); return { ...r };
    },
    release: async (uid, at) => { world.calls.push('release:' + at); const r = world.rows.get(uid)!; r.claimed_step = null; r.claimed_at = null; },
    markSent: async (uid, step, _id, at) => { world.calls.push('markSent'); const r = world.rows.get(uid)!; (r as any)[`step${step}_sent_at`] = at; r.claimed_at = null; },
    stop: async (uid, reason, at) => { world.calls.push('stop:' + reason); const r = world.rows.get(uid)!; r.stopped_at = at; r.stop_reason = reason; r.claimed_at = null; },
    stampChecked: async () => { world.calls.push('stamp'); },
    adminUser: async (uid) => { world.calls.push('admin'); const u = world.users.has(uid) ? world.users.get(uid)! : user(); if (u instanceof Error) throw u; return u; },
    draftInfo: async () => { world.calls.push('draft'); return world.flags.noDraft ? null : { updatedAt: ago(5 * HOUR), deployedUrl: null, shopName: "Jake's Cuts", ...world.draft }; },
    isEntitled: f('entitled'), stripePaid: async (e, u) => { world.calls.push('stripe'); const v = world.flags.stripePaid; if (v instanceof Error) throw v; return !!v; },
    appStoreState: f('appStore', null), hasIosPurchase: f('ios'), hasLegacySite: f('legacy'), isPublished: f('published'),
    hasWebSignal: async () => { world.calls.push('signal'); const v = world.flags.webSignal; if (v instanceof Error) throw v; return v ?? true; },
    isSuppressed: async (e) => { world.calls.push('suppressed'); return !!world.flags.suppressed; },
    hasMx: async () => { world.calls.push('mx'); return world.flags.mx === undefined ? true : world.flags.mx; },
    send: async (to, mail, key) => { world.calls.push('send'); if (world.sendFails) throw new Error('resend 500'); world.sent.push({ to, key, subject: mail.subject, text: mail.text }); return 'msg_' + world.sent.length; },
    now: () => world.now, sleep: async (ms) => { world.calls.push('sleep:' + ms); world.now += ms; },
  };
  return { world, deps };
}
const run = (d: SignupNudgeDeps, env: any = ENV, o: any = {}) => sweepSignupNudges(d, { mode: 'test', env, ...o });

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe('gates', () => {
  it.each([
    ['off', { ...ENV, WEB_APP_NUDGES: '' }],
    ['off', { ...ENV, WEB_APP_NUDGES: '0' }],
    ['no_since', { ...ENV, WEB_APP_NUDGES_SINCE: '' }],
    ['no_since', { ...ENV, WEB_APP_NUDGES_SINCE: 'junk' }],
    ['misconfigured', { ...ENV, WEB_APP_NUDGE_SECRET: '' }],
    ['misconfigured', { ...ENV, RESEND_API_KEY: '' }],
  ])('%s: nothing is read or sent', async (reason, env) => {
    const { world, deps } = make({ drafts: ['u1'], rows: new Map([['u1', row('u1')]]) });
    const out = await run(deps, env);
    expect(out.skippedReason).toBe(reason);
    expect(world.calls).toEqual([]);
  });
  it('a missing table (404) skips instead of throwing', async () => {
    const { deps } = make();
    deps.recentDrafts = async () => { throw Object.assign(new Error('x'), { status: 404 }); };
    expect((await run(deps)).skippedReason).toBe('no_table');
  });
});

describe('eligibility matrix (one stop/skip per row)', () => {
  const one = (w: Partial<World> = {}) => make({ rows: new Map([['u1', row('u1')]]), ...w });
  const stopped = async (w: Partial<World>, reason: string) => {
    const m = one(w); const out = await run(m.deps);
    expect(m.world.sent).toEqual([]); expect(m.world.calls).toContain('stop:' + reason); expect(out.stopped).toBe(1);
    expect(m.world.rows.get('u1')!.stopped_at).toBeTruthy();
  };
  const skipped = async (w: Partial<World>) => {
    const m = one(w); await run(m.deps);
    expect(m.world.sent).toEqual([]); expect(m.world.rows.get('u1')!.stopped_at).toBeNull(); expect(m.world.rows.get('u1')!.claimed_at).toBeNull();
    return m;
  };
  it('happy path sends step 1 once with the fixed idempotency key', async () => {
    const m = one(); const out = await run(m.deps);
    expect(out.sent).toBe(1); expect(m.world.sent[0].key).toBe('aibarber-app:nudge:u1:test:1');
    expect(m.world.sent[0].to).toBe('jake@gmail.com');
    expect(m.world.rows.get('u1')!.step1_sent_at).toBeTruthy();
  });
  it('paid in the DB', () => stopped({ flags: { entitled: true } }, 'paid'));
  it('paid only in Stripe', () => stopped({ flags: { stripePaid: true } }, 'paid'));
  it('iOS App Store active/linked', () => stopped({ flags: { appStore: 'active' } }, 'not_web'));
  it('iOS purchase row', () => stopped({ flags: { ios: true } }, 'not_web'));
  it('legacy aibarber.org site', () => stopped({ flags: { legacy: true } }, 'not_web'));
  it('published site', () => stopped({ flags: { published: true } }, 'live'));
  it('draft with a deployed url', () => stopped({ draft: { deployedUrl: 'https://x.app' } }, 'live'));
  it('suppressed address', () => stopped({ flags: { suppressed: true } }, 'suppressed'));
  it('before the launch gate', () => stopped({ users: new Map([['u1', user({ createdAt: '2026-10-20T00:00:00Z' })]]) }, 'before_launch'));
  it('deleted account (404)', () => stopped({ users: new Map([['u1', null]]) }, 'deleted'));
  it('no MX for the domain', () => stopped({ flags: { mx: false } }, 'bad_address'));
  it('older than 7 days', async () => {
    const m = make({ rows: new Map([['u1', row('u1', { signup_at: ago(8 * 24 * HOUR) })]]) });
    await run(m.deps); expect(m.world.calls).toContain('stop:expired'); expect(m.world.sent).toEqual([]);
    expect(m.world.calls).not.toContain('admin');
  });
  it('unconfirmed email and missing email: skipped, not stopped', async () => {
    await skipped({ users: new Map([['u1', user({ emailConfirmedAt: null })]]) });
    await skipped({ users: new Map([['u1', user({ email: null })]]) });
  });
  it('active in the last 30 minutes: skipped, not stopped (draft or sign-in)', async () => {
    await skipped({ draft: { updatedAt: ago(10 * 60_000) } });
    await skipped({ users: new Map([['u1', user({ lastSignInAt: ago(5 * 60_000) })]]) });
  });
  it('no draft row: still reminded, with the start-the-builder wording', async () => {
    const m = one({ flags: { noDraft: true } }); const out = await run(m.deps);
    expect(out.sent).toBe(1); expect(m.world.sent[0].subject).toBe('Your Prime Barber website');
    expect(m.world.sent[0].text).toContain('signed up'); expect(m.world.sent[0].text).not.toContain('pick up where');
    expect(m.world.sent[0].text).toContain('Start my website'); expect(m.world.sent[0].text).toMatch(/continue\?t=/);
  });
  it('no draft but active in the last 30 minutes (sign-in): still busy, skipped', async () => {
    await skipped({ flags: { noDraft: true }, users: new Map([['u1', user({ lastSignInAt: ago(5 * 60_000) })]]) });
  });
  it('no draft but paid / published / iOS: stop rules still apply', async () => {
    await stopped({ flags: { noDraft: true, entitled: true } }, 'paid');
    await stopped({ flags: { noDraft: true, published: true } }, 'live');
    await stopped({ flags: { noDraft: true, ios: true } }, 'not_web');
  });
  it('MX lookup failing (null) skips without stopping', () => skipped({ flags: { mx: null } }));
  it('admin 5xx: nothing sent, row not stopped, claim released', async () => {
    const m = await skipped({ users: new Map([['u1', new Error('admin 503')]]) });
    expect(m.world.calls.some((c) => c.startsWith('release'))).toBe(true);
  });
  it('Stripe error: nothing sent, row not stopped, claim released', async () => {
    const m = one({ flags: { stripePaid: new Error('stripe 500') } }); const out = await run(m.deps);
    expect(m.world.sent).toEqual([]); expect(m.world.rows.get('u1')!.stopped_at).toBeNull(); expect(m.world.rows.get('u1')!.claimed_at).toBeNull();
    expect(out.errors).toBe(1);
  });
  it('DB entitlement lookup error: nothing sent, not stopped', async () => {
    const m = one({ flags: { entitled: new Error('db 500') } }); await run(m.deps);
    expect(m.world.sent).toEqual([]); expect(m.world.rows.get('u1')!.stopped_at).toBeNull();
  });
  it('suppression lookup error: nothing sent, not stopped', async () => {
    const m = one(); m.deps.isSuppressed = async () => { throw new Error('db'); }; await run(m.deps);
    expect(m.world.sent).toEqual([]); expect(m.world.rows.get('u1')!.stopped_at).toBeNull();
  });
  it('the Stripe re-check runs after the claim and as the last call before the send', async () => {
    const m = one(); await run(m.deps);
    const c = m.world.calls;
    expect(c.indexOf('claim')).toBeLessThan(c.indexOf('stripe'));
    expect(c[c.indexOf('send') - 1]).toBe('stripe');
  });
  it('a send failure releases the claim and does not mark sent', async () => {
    const m = one({ sendFails: true }); const out = await run(m.deps);
    expect(m.world.rows.get('u1')!.step1_sent_at).toBeNull(); expect(m.world.rows.get('u1')!.claimed_at).toBeNull(); expect(out.sent).toBe(0); expect(out.errors).toBe(1);
  });
  it('the MX check only runs before the first mail', async () => {
    const m = make({ rows: new Map([['u1', row('u1', { signup_at: ago(30 * HOUR), step1_sent_at: ago(29 * HOUR) })]]) });
    await run(m.deps); expect(m.world.calls).not.toContain('mx'); expect(m.world.sent).toHaveLength(1);
  });
});

describe('step selection', () => {
  const stepFor = async (ageMs: number, extra: Partial<NudgeRow> = {}) => {
    const m = make({ rows: new Map([['u1', row('u1', { signup_at: ago(ageMs), ...(ageMs >= 24 * HOUR ? { step1_sent_at: ago(ageMs - HOUR) } : {}), ...extra })]]), users: new Map([['u1', user({ createdAt: ago(ageMs) })]]) });
    await run(m.deps); return m.world.sent.map((s) => s.key.split(':').pop());
  };
  it('windows: 1 h to 24 h is step 1, 24 h to 72 h step 2, 72 h to 7 d step 3', async () => {
    expect(await stepFor(30 * 60_000)).toEqual([]);
    expect(await stepFor(1 * HOUR + 60_000)).toEqual(['1']);
    expect(await stepFor(23 * HOUR)).toEqual(['1']);
    expect(await stepFor(25 * HOUR)).toEqual(['2']);
    expect(await stepFor(71 * HOUR)).toEqual(['2']);
    expect(await stepFor(73 * HOUR)).toEqual(['3']);
    expect(await stepFor(6.9 * 24 * HOUR)).toEqual(['3']);
  });
  it('a missed first mail is never made up for (first-deploy backlog): step 2 / 3 without a sent step 1 stops the row as late', async () => {
    for (const age of [30 * HOUR, 80 * HOUR]) {
      const m = make({ rows: new Map([['u1', row('u1', { signup_at: ago(age) })]]), users: new Map([['u1', user({ createdAt: ago(age) })]]) });
      const out = await run(m.deps);
      expect(m.world.sent).toEqual([]); expect(m.world.rows.get('u1')!.stop_reason).toBe('late'); expect(out.stopped).toBe(1);
      expect(m.world.calls).not.toContain('claim'); expect(m.world.calls).not.toContain('admin');
    }
  });
  it('late applies to users without a draft too', async () => {
    const m = make({ rows: new Map([['u1', row('u1', { signup_at: ago(30 * HOUR) })]]), flags: { noDraft: true } });
    await run(m.deps); expect(m.world.sent).toEqual([]); expect(m.world.rows.get('u1')!.stop_reason).toBe('late');
  });
  it('a step already sent is not sent again', async () => {
    expect(await stepFor(2 * HOUR, { step1_sent_at: ago(HOUR) })).toEqual([]);
  });
  it('minimum gaps after the previous mail: 20 h before step 2, 40 h before step 3', async () => {
    expect(await stepFor(25 * HOUR, { step1_sent_at: ago(10 * HOUR) })).toEqual([]);
    expect(await stepFor(25 * HOUR, { step1_sent_at: ago(21 * HOUR) })).toEqual(['2']);
    expect(await stepFor(73 * HOUR, { step2_sent_at: ago(30 * HOUR) })).toEqual([]);
    expect(await stepFor(73 * HOUR, { step2_sent_at: ago(41 * HOUR) })).toEqual(['3']);
  });
  it('after step 3 the row is stopped as done, nothing more is sent', async () => {
    const m = make({ rows: new Map([['u1', row('u1', { signup_at: ago(80 * HOUR), step3_sent_at: ago(HOUR) })]]) });
    await run(m.deps); expect(m.world.sent).toEqual([]); expect(m.world.rows.get('u1')!.stop_reason).toBe('done');
  });
  it('sending step 3 stops the row as done', async () => {
    const m = make({ rows: new Map([['u1', row('u1', { signup_at: ago(80 * HOUR), step1_sent_at: ago(79 * HOUR) })]]), users: new Map([['u1', user({ createdAt: ago(80 * HOUR) })]]) });
    await run(m.deps); expect(m.world.sent).toHaveLength(1); expect(m.world.rows.get('u1')!.stop_reason).toBe('done');
  });
  it('the link in the mail is a continue token bound to this user and step, on the app origin', async () => {
    const m = make({ rows: new Map([['u1', row('u1', { signup_at: ago(30 * HOUR), step1_sent_at: ago(29 * HOUR) })]]), users: new Map([['u1', user({ createdAt: ago(30 * HOUR) })]]) });
    await run(m.deps);
    const t = decodeURIComponent(/continue\?t=(\S+)/.exec(m.world.sent[0].text)![1]);
    expect(verifyContinueToken(t, { now: NOW, secret: SECRET, mode: 'test', expect: { userId: 'u1', step: 2 } }).ok).toBe(true);
    expect(verifyContinueToken(t, { now: NOW, secret: SECRET, mode: 'test', expect: { userId: 'u1', step: 1 } }).ok).toBe(false);
    expect((verifyContinueToken(t, { now: NOW, secret: SECRET, mode: 'test' }) as any).hint).toBe('j••e@gmail.com');
    expect(verifyContinueToken(t, { now: NOW, secret: SECRET, mode: 'live' })).toEqual({ ok: false, reason: 'wrong_mode' });
  });
});

describe('claims and idempotency', () => {
  it('a lost claim (concurrent sweep) sends nothing', async () => {
    const m = make({ rows: new Map([['u1', row('u1')]]), flags: { claimLost: true } });
    const out = await run(m.deps); expect(m.world.sent).toEqual([]); expect(out.skipped).toBe(1); expect(m.world.calls).not.toContain('admin');
  });
  it('two overlapping sweeps send once', async () => {
    const m = make({ rows: new Map([['u1', row('u1')]]) });
    await Promise.all([run(m.deps), run(m.deps)]);
    expect(m.world.sent).toHaveLength(1);
  });
  it('a retry after a failed send reuses the same key', async () => {
    const m = make({ rows: new Map([['u1', row('u1')]]), sendFails: true });
    await run(m.deps); m.world.sendFails = false; await run(m.deps);
    expect(m.world.sent.map((s) => s.key)).toEqual(['aibarber-app:nudge:u1:test:1']);
  });
});

describe('claim hygiene (C2 fixes)', () => {
  it('an error BEFORE the claim never releases a claim (it may be another run\'s)', async () => {
    const m = make({ rows: new Map([['u1', row('u1')]]) });
    m.deps.stampChecked = async () => { throw new Error('transient 5xx'); };
    const out = await run(m.deps);
    expect(out.errors).toBe(1); expect(m.world.calls.filter((c) => c.startsWith('release'))).toEqual([]);
  });
  it('an error after our claim releases it, naming our claim stamp', async () => {
    const m = make({ rows: new Map([['u1', row('u1')]]), flags: { stripePaid: new Error('stripe 500') } });
    await run(m.deps);
    expect(m.world.calls.filter((c) => c.startsWith('release'))).toEqual([`release:${new Date(NOW).toISOString()}`]);
  });
  it('near 24 h with no step 1 on the row: stopped late before any claim (never step 1 then step 2 minutes apart)', async () => {
    const m = make({ rows: new Map([['u1', row('u1', { signup_at: ago(24 * HOUR + 60_000) })]]), users: new Map([['u1', user({ createdAt: ago(24 * HOUR + 60_000) })]]) });
    await run(m.deps);
    expect(m.world.sent).toEqual([]); expect(m.world.rows.get('u1')!.stop_reason).toBe('late'); expect(m.world.calls).not.toContain('claim');
  });
  it('an earlier step is not sent once a later one is on the claimed row', async () => {
    const m = make({ rows: new Map([['u1', row('u1')]]), flags: { onClaim: (r: NudgeRow) => { r.step2_sent_at = ago(HOUR); } } });
    await run(m.deps); expect(m.world.sent).toEqual([]);
  });
  it('an unreadable activity timestamp counts as busy', async () => {
    const m = make({ rows: new Map([['u1', row('u1')]]), draft: { updatedAt: 'garbage' } });
    await run(m.deps); expect(m.world.sent).toEqual([]); expect(m.world.rows.get('u1')!.stopped_at).toBeNull();
  });
  it('error logs carry no provider message text', async () => {
    const m = make({ rows: new Map([['u1', row('u1')]]), flags: { stripePaid: Object.assign(new Error('Invalid email address: secret@leak.co'), { type: 'invalid_request_error' }) } });
    await run(m.deps);
    expect(JSON.stringify((console.error as any).mock.calls)).not.toMatch(/leak|Invalid email/);
  });
});

describe('enrollment', () => {
  it('a recent draft without a row gets one with signup_at from the account', async () => {
    const created = ago(5 * HOUR);
    const m = make({ drafts: ['u9'], users: new Map([['u9', user({ createdAt: created })]]) });
    const out = await run(m.deps);
    expect(out.enrolled).toBe(1); expect(m.world.rows.get('u9')!.signup_at).toBe(created);
  });
  it('before-launch and too-old (after launch) accounts are inserted already stopped', async () => {
    const m = make({ drafts: ['a', 'b'], users: new Map([['a', user({ createdAt: '2026-10-01T00:00:00Z' })], ['b', user({ createdAt: ago(9 * 24 * HOUR) })]]) });
    await run(m.deps); expect(m.world.rows.get('a')!.stop_reason).toBe('before_launch'); expect(m.world.rows.get('b')!.stop_reason).toBe('expired');
  });
  it('too old but after launch is expired', async () => {
    const m = make({ drafts: ['b'], users: new Map([['b', user({ createdAt: ago(8 * 24 * HOUR) })]]) });
    await run({ ...m.deps }, { ...ENV, WEB_APP_NUDGES_SINCE: '2026-01-01T00:00:00Z' });
    expect(m.world.rows.get('b')!.stop_reason).toBe('expired');
  });
  it('existing rows are not looked up again; a failed lookup enrolls nothing and the sweep goes on', async () => {
    const m = make({ drafts: ['x', 'y'], rows: new Map([['x', row('x', { stopped_at: ago(HOUR), stop_reason: 'live' })]]), users: new Map([['y', new Error('503')]]) });
    const out = await run(m.deps);
    expect(m.world.calls.filter((c) => c === 'admin')).toHaveLength(1); expect(out.enrolled).toBe(0); expect(out.errors).toBe(1);
  });
});

describe('caps and pacing', () => {
  const many = (n: number) => {
    const rows = new Map<string, NudgeRow>(); const users = new Map<string, AdminUser>();
    for (let i = 0; i < n; i++) { rows.set('u' + i, row('u' + i)); users.set('u' + i, user({ email: `u${i}@gmail.com` })); }
    return make({ rows, users: users as any });
  };
  it('at most 25 sends per sweep; the rest wait for the next one', async () => {
    const m = many(40); const out = await run(m.deps);
    expect(out.sent).toBe(25); expect(m.world.sent).toHaveLength(25);
    const again = await run(m.deps); expect(again.sent).toBe(15);
  });
  it('one mail per user per sweep', async () => {
    const m = many(3); await run(m.deps); await run(m.deps);
    expect(m.world.sent.map((s) => s.to).sort()).toEqual(['u0@gmail.com', 'u1@gmail.com', 'u2@gmail.com']);
  });
  it('700 ms pause between sends, none before the first', async () => {
    const m = many(3); await run(m.deps);
    expect(m.world.calls.filter((c) => c.startsWith('sleep'))).toEqual(['sleep:700', 'sleep:700']);
    expect(m.world.calls.findIndex((c) => c.startsWith('sleep'))).toBeGreaterThan(m.world.calls.indexOf('send'));
  });
});

describe('logging', () => {
  it('never logs tokens, addresses or bodies', async () => {
    const m = make({ rows: new Map([['u1', row('u1')]]), flags: { stripePaid: new Error('stripe 500') } });
    await run(m.deps); m.world.flags.stripePaid = false; await run(m.deps);
    const logged = JSON.stringify([...(console.error as any).mock.calls, ...(console.info as any).mock.calls]);
    expect(logged).not.toMatch(/jake@gmail|continue\?t=|List-Unsubscribe|Finish my website/);
  });
});

describe('schedule', () => {
  it('production default, staging override, and the override is ignored on a live key or when malformed', () => {
    const std = [1 * HOUR, 24 * HOUR, 72 * HOUR];
    expect(scheduleMs('live', {}).due).toEqual(std);
    expect(scheduleMs('test', {}).due).toEqual(std);
    expect(scheduleMs('test', { WEB_APP_NUDGE_SCHEDULE_MINUTES: '2,5,8' })).toEqual({ due: [120_000, 300_000, 480_000], overridden: true });
    expect(scheduleMs('live', { WEB_APP_NUDGE_SCHEDULE_MINUTES: '2,5,8' }).overridden).toBe(false);
    for (const bad of ['2,5', '5,2,8', 'a,b,c', '0,1,2']) expect(scheduleMs('test', { WEB_APP_NUDGE_SCHEDULE_MINUTES: bad }).overridden).toBe(false);
  });
  it('override drives the windows (and drops the minimum gaps)', async () => {
    const env = { ...ENV, WEB_APP_NUDGE_SCHEDULE_MINUTES: '2,5,8' };
    const m = make({ rows: new Map([['u1', row('u1', { signup_at: ago(6 * 60_000), step1_sent_at: ago(4 * 60_000) })]]), users: new Map([['u1', user({ createdAt: ago(6 * 60_000) })]]) });
    await run(m.deps, env); expect(m.world.sent[0].key.endsWith(':2')).toBe(true);
  });
});

describe('live deps', () => {
  it('claim is one conditional PATCH (unsent, not stopped, no fresh claim) in this mode and returns whether a row came back', async () => {
    const rest = vi.fn(async () => [{ user_id: 'u1' }]);
    const d = liveSignupNudgeDeps('test', rest as any);
    expect(await d.claim('u1', 2, '2026-11-10T12:00:00.000Z', '2026-11-10T11:45:00.000Z')).toEqual({ user_id: 'u1' });
    const [path, init] = rest.mock.calls[0] as any[];
    expect(path).toContain('user_id=eq.u1'); expect(path).toContain('environment=eq.test');
    expect(path).toContain('step2_sent_at=is.null'); expect(path).toContain('stopped_at=is.null'); expect(path).toContain('claimed_at.is.null'); expect(path).toContain('claimed_at.lt.');
    expect(init).toMatchObject({ method: 'PATCH', prefer: 'return=representation' });
    expect(await liveSignupNudgeDeps('test', (async () => []) as any).claim('u1', 1, 'a', 'b')).toBeNull();
  });
  it('release only matches OUR claim stamp', async () => {
    const rest = vi.fn(async () => null);
    await liveSignupNudgeDeps('test', rest as any).release('u1', '2026-11-10T12:00:00.000Z');
    expect((rest.mock.calls[0] as any[])[0]).toContain('claimed_at=eq.2026-11-10T12%3A00%3A00.000Z');
  });
});

describe('enrollment of every sign-up (no draft needed)', () => {
  const su = (id: string, o: Partial<AdminUser> = {}): SignedUpUser => ({ id, ...user({ createdAt: ago(3 * HOUR), ...o }) });
  it('a new account with no draft gets a row from the admin user list, without a per-user lookup', async () => {
    const m = make({ signups: [su('n1', { email: 'new@gmail.com' })] });
    const out = await run(m.deps);
    expect(out.enrolled).toBe(1); expect(m.world.rows.get('n1')!.email).toBe('new@gmail.com'); expect(m.world.rows.get('n1')!.stopped_at).toBeNull();
    expect(m.world.calls).not.toContain('admin' + ':enroll');
  });
  it('a no-draft sign-up old enough then receives step 1 (full path: enroll -> visit -> send)', async () => {
    const m = make({ signups: [su('n1', { createdAt: ago(2 * HOUR) })], flags: { noDraft: true } });
    const out = await run(m.deps);
    expect(out.enrolled).toBe(1); expect(out.sent).toBe(1); expect(m.world.sent[0].key).toBe('aibarber-app:nudge:n1:test:1');
  });
  it('before the launch gate: enrolled already stopped; too old: enrolled expired', async () => {
    const m = make({ signups: [su('a', { createdAt: ago(5 * 24 * HOUR) }), su('b', { createdAt: ago(7.5 * 24 * HOUR) })] });
    await run(m.deps, { ...ENV, WEB_APP_NUDGES_SINCE: ago(4 * 24 * HOUR) });
    expect(m.world.rows.get('a')?.stop_reason).toBe('before_launch');
    expect(m.world.rows.get('b')?.stop_reason).toBe('before_launch'); // before the gate wins over too old
    const m2 = make({ signups: [su('c', { createdAt: ago(7.5 * 24 * HOUR) })] });
    await run(m2.deps, { ...ENV, WEB_APP_NUDGES_SINCE: '2026-01-01T00:00:00Z' });
    expect(m2.world.rows.get('c')?.stop_reason).toBe('expired');
  });
  it('users older than the 8-day window are ignored', async () => {
    const m = make({ signups: [su('old', { createdAt: ago(9 * 24 * HOUR) })] });
    expect((await run(m.deps)).enrolled).toBe(0);
  });
  it('a user in both the list and the drafts is enrolled once; list users already enrolled are skipped', async () => {
    const m = make({ signups: [su('a'), su('b')], drafts: ['a'], rows: new Map([['b', row('b', { stopped_at: ago(HOUR), stop_reason: 'live' })]]) });
    const out = await run(m.deps);
    expect(out.enrolled).toBe(1); expect(m.world.calls.filter((c) => c === 'insert')).toHaveLength(1);
  });
  it('a failing user list does not stop draft-based enrollment or the sends', async () => {
    const m = make({ drafts: ['d1'], users: new Map([['d1', user({ createdAt: ago(5 * HOUR) })]]) });
    m.deps.recentUsers = async () => { throw new Error('admin lookup 503'); };
    const out = await run(m.deps);
    expect(out.enrolled).toBe(1); expect(out.errors).toBe(1);
  });
  it('stop rules still apply to enrolled no-draft users (paid in Stripe)', async () => {
    const m = make({ signups: [su('n1')], flags: { noDraft: true, stripePaid: true } });
    await run(m.deps); expect(m.world.sent).toEqual([]); expect(m.world.rows.get('n1')!.stop_reason).toBe('paid');
  });
  it('enrollSignups with since = Infinity (nudges off) enrolls everyone as stopped before_launch', async () => {
    const m = make({ signups: [su('n1')] });
    const out = await enrollSignups(m.deps, { since: Number.POSITIVE_INFINITY });
    expect(out.enrolled).toBe(1); expect(m.world.rows.get('n1')!.stop_reason).toBe('before_launch'); expect(m.world.sent).toEqual([]);
  });
});

describe('live recentUsers (admin list, newest first, bounded)', () => {
  const page = (n: number, createdAt: () => string) => ({ users: Array.from({ length: n }, (_, i) => ({ id: `u${i}`, email: `u${i}@x.co`, created_at: createdAt(), user_metadata: {} })) });
  const stubFetch = (pages: any[]) => {
    const f = vi.fn(async (u: string) => ({ ok: true, status: 200, json: async () => pages[Number(/page=(\d+)/.exec(u)![1]) - 1] ?? { users: [] } }));
    vi.stubGlobal('fetch', f); vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc');
    return f;
  };
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it('stops after a short page', async () => {
    const f = stubFetch([page(3, () => ago(HOUR))]);
    const r = await liveSignupNudgeDeps('test', vi.fn() as any).recentUsers(ago(8 * 24 * HOUR), 5);
    expect(r).toHaveLength(3); expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as any[])[0]).toContain('/auth/v1/admin/users?page=1&per_page=200');
  });
  it('keeps paging while a full page still has users inside the window, and stops at the page cap', async () => {
    const f = stubFetch([page(200, () => ago(HOUR)), page(200, () => ago(2 * HOUR)), page(200, () => ago(3 * HOUR))]);
    expect(await liveSignupNudgeDeps('test', vi.fn() as any).recentUsers(ago(8 * 24 * HOUR), 2)).toHaveLength(400);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('stops paging when a full page is entirely older than the window', async () => {
    const f = stubFetch([page(200, () => ago(20 * 24 * HOUR)), page(200, () => ago(HOUR))]);
    await liveSignupNudgeDeps('test', vi.fn() as any).recentUsers(ago(8 * 24 * HOUR), 5);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('a non-200 throws (enrollment logs it and goes on)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }))); vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc');
    await expect(liveSignupNudgeDeps('test', vi.fn() as any).recentUsers(ago(HOUR), 5)).rejects.toThrow('admin lookup 503');
  });
});

describe('web signal: iOS-app sign-ups are not reminded', () => {
  const one = (w: Partial<World> = {}) => make({ rows: new Map([['u1', row('u1')]]), ...w });
  it('no draft and no web signal: stopped as not_web, nothing sent', async () => {
    const m = one({ flags: { noDraft: true, webSignal: false } }); await run(m.deps);
    expect(m.world.sent).toEqual([]); expect(m.world.rows.get('u1')!.stop_reason).toBe('not_web');
  });
  it('no draft but a web signal (price group / customer / checkout session row): reminded', async () => {
    const m = one({ flags: { noDraft: true, webSignal: true } }); expect((await run(m.deps)).sent).toBe(1);
  });
  it('a draft is itself the signal: no extra lookup', async () => {
    const m = one(); await run(m.deps); expect(m.world.calls).not.toContain('signal'); expect(m.world.sent).toHaveLength(1);
  });
  it('a signal lookup error: nothing sent, row not stopped, claim released', async () => {
    const m = one({ flags: { noDraft: true, webSignal: new Error('db 500') } }); const out = await run(m.deps);
    expect(m.world.sent).toEqual([]); expect(m.world.rows.get('u1')!.stopped_at).toBeNull(); expect(m.world.rows.get('u1')!.claimed_at).toBeNull(); expect(out.errors).toBe(1);
  });
  it('live hasWebSignal checks price groups, drafts, customers and checkout sessions', async () => {
    const rest = vi.fn(async (p: string) => (p.startsWith('web_app_customers') ? [{ user_id: 'u1' }] : []));
    expect(await liveSignupNudgeDeps('test', rest as any).hasWebSignal('u1')).toBe(true);
    expect(rest.mock.calls.map((c: any[]) => String(c[0]).split('?')[0])).toEqual(['web_app_price_groups', 'web_app_drafts', 'web_app_customers']);
    expect(await liveSignupNudgeDeps('test', (async () => []) as any).hasWebSignal('u1')).toBe(false);
  });
});

describe('first-run production errors (400 from Stripe, 403 from Resend, QA accounts)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it('stripePaid only reads THIS mode\'s customer ids (a test-mode cus_ id against the live key made Stripe answer 400)', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_x');
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })); vi.stubGlobal('fetch', f);
    const rest = vi.fn(async () => []);
    expect(await liveSignupNudgeDeps('live', rest as any).stripePaid('a@b.co', 'u1')).toBe(false);
    const path = (rest.mock.calls[0] as any[])[0] as string;
    expect(path).toContain('web_app_customers?'); expect(path).toContain('environment=eq.live');
  });
  it('ibrahim3709+ accounts are stopped as suppressed, never mailed', async () => {
    const m = make({ rows: new Map([['u1', row('u1')]]), users: new Map([['u1', user({ email: 'ibrahim3709+pt1@gmail.com' })]]) });
    await run(m.deps);
    expect(m.world.sent).toEqual([]); expect(m.world.rows.get('u1')!.stop_reason).toBe('suppressed');
    expect(isInternalTestEmail('ibrahim3709+x@gmail.com')).toBe(true); expect(isInternalTestEmail('ibrahim3709@gmail.com')).toBe(false);
  });
  it('a failed send logs Resend\'s error name and message (200 chars, addresses blanked) so a 403 explains itself', async () => {
    const m = make({ rows: new Map([['u1', row('u1')]]) });
    m.deps.send = async () => { throw Object.assign(new Error('resend 403'), { status: 403, resendName: 'validation_error', resendMessage: 'The davoxa.com domain is not verified for jake@gmail.com' }); };
    await run(m.deps);
    const line = (console.error as any).mock.calls.find((c: any[]) => String(c[0]).includes('send failed'))!;
    expect(line.slice(1).join(' ')).toContain('403'); expect(line.join(' ')).toContain('validation_error: The davoxa.com domain is not verified for [email]');
    expect(line.join(' ')).not.toContain('jake@gmail.com');
    expect(resendWhy({ resendName: 'x', resendMessage: 'y'.repeat(500) })).toHaveLength(203);
  });
  it('sendMail keeps Resend\'s message on the error', async () => {
    vi.stubEnv('RESEND_API_KEY', 'k');
    const { sendMail } = await import('../../lib/webApp/emails.js');
    const f = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ name: 'validation_error', message: 'domain not verified' }) }));
    await expect(sendMail('a@b.co', { subject: 's', html: 'h', text: 't' } as any, f as any)).rejects.toMatchObject({ status: 403, resendName: 'validation_error', resendMessage: 'domain not verified' });
  });
});
