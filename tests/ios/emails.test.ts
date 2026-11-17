import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { iosBillingEmail, iosEmailOn, iosNotLiveEmail, iosWelcomeEmail } from '../../lib/ios/emails.js';
import { billingKeyOf, onAccountCreated, onSubscriptionNotice, sweepIosNotLive, type AccountRow, type IosEmailDeps, type PurchaseLite } from '../../lib/ios/emailFlows.js';
import { NUDGE_OPT_OUT, nudgeFrom, signupNudgeEmail } from '../../lib/webApp/emails.js';
import { runSignup, type SignupDeps } from '../../lib/ios/signup.js';
import { handleAppleNotification } from '../../lib/ios/notifications.js';

const H = 3600_000;
const NOW = Date.parse('2026-12-10T12:00:00Z');
const SINCE = '2026-12-01T00:00:00Z';
const ON = { IOS_EMAIL_WELCOME: '1', IOS_EMAIL_NOT_LIVE: '1', IOS_EMAIL_BILLING: '1', IOS_EMAIL_NOT_LIVE_SINCE: SINCE, RESEND_API_KEY: 're_x' };

const purchase = (o: Partial<PurchaseLite> = {}): PurchaseLite => ({
  original_transaction_id: 'otid1', product_id: 'p', environment: 'Production', site_slug: null, user_id: null,
  expires_at: new Date(NOW + 20 * 24 * H).toISOString(), revoked_at: null, published_at: null, taken_down_at: null, removed_at: null, ...o,
});
const arow = (o: Partial<AccountRow> = {}): AccountRow => ({
  user_id: 'u1', original_transaction_id: 'otid1', signup_at: new Date(NOW - 25 * H).toISOString(),
  welcome_sent_at: null, step1_sent_at: null, step2_sent_at: null, claimed_step: null, claimed_at: null, stopped_at: null, stop_reason: null, ...o,
});

function fake(over: Partial<IosEmailDeps> & { rows?: AccountRow[]; p?: PurchaseLite | null; email?: string } = {}) {
  const sent: { to: string; subject: string; text: string; html: string; key: string }[] = [];
  const writes: string[] = [];
  const rows = over.rows ?? [];
  const billing = new Set<string>();
  const d: IosEmailDeps = {
    env: { ...ON }, now: () => NOW, sleep: async () => {},
    insertAccount: vi.fn(async (r) => { writes.push('insertAccount'); if (rows.some((x) => x.user_id === r.user_id)) return false; rows.push(arow({ ...r })); return true; }),
    markWelcome: vi.fn(async () => { writes.push('markWelcome'); }),
    activeRows: vi.fn(async () => rows.filter((r) => !r.stopped_at)),
    claim: vi.fn(async (uid, step) => { const r = rows.find((x) => x.user_id === uid); if (!r || r.stopped_at || (step === 1 ? r.step1_sent_at : r.step2_sent_at) || r.claimed_at) return null; r.claimed_at = 'c'; return { ...r }; }),
    release: vi.fn(async (uid) => { const r = rows.find((x) => x.user_id === uid); if (r) r.claimed_at = null; }),
    markSent: vi.fn(async (uid, step, _id, at) => { const r = rows.find((x) => x.user_id === uid)!; (r as any)[`step${step}_sent_at`] = at; r.claimed_at = null; }),
    stop: vi.fn(async (uid, reason, at) => { const r = rows.find((x) => x.user_id === uid)!; r.stopped_at = at; r.stop_reason = reason; }),
    stampChecked: vi.fn(async () => { writes.push('stampChecked'); }),
    adminUser: vi.fn(async () => ({ email: over.email ?? 'sam@example.com', emailConfirmedAt: 'x', createdAt: 'x', lastSignInAt: null, name: 'Sam Cutter' })),
    purchase: vi.fn(async () => (over.p === undefined ? purchase() : over.p)),
    hasPublishedSite: vi.fn(async () => false),
    isSuppressed: vi.fn(async () => false),
    siteUrl: vi.fn(async (slug) => `https://${slug}.vercel.app`),
    send: vi.fn(async (to, mail, key) => { sent.push({ to, subject: mail.subject, text: mail.text, html: mail.html, key }); return 'rid'; }),
    claimBilling: vi.fn(async (k, _u) => { const id = `${k.otid}|${k.kind}|${k.period}`; writes.push('claimBilling'); if (billing.has(id)) return false; billing.add(id); return true; }),
    markBilling: vi.fn(async () => {}),
    releaseBilling: vi.fn(async (k) => { billing.delete(`${k.otid}|${k.kind}|${k.period}`); }),
    ...over,
  } as IosEmailDeps;
  delete (over as any).rows;
  return { d, sent, writes, rows };
}
const acct = { userId: 'u1', email: 'sam@example.com', name: 'Sam Cutter', originalTransactionId: 'otid1', environment: 'Production' as const };
const notice = (o: object = {}) => ({ otid: 'otid1', type: 'DID_FAIL_TO_RENEW', environment: 'Production' as const, expiresAt: 1000, ...o });
const withUser = () => fake({ p: purchase({ user_id: 'u1' }) });

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe('switches', () => {
  it('are on only for exactly "1"', () => {
    for (const v of [undefined, '', '0', 'true', 'yes', ' 1']) expect(iosEmailOn('IOS_EMAIL_WELCOME', { IOS_EMAIL_WELCOME: v })).toBe(false);
    expect(iosEmailOn('IOS_EMAIL_WELCOME', { IOS_EMAIL_WELCOME: '1' })).toBe(true);
  });
  it('welcome off: nothing sent, no state written, nothing read', async () => {
    const { d, sent, writes } = fake(); d.env = { ...ON, IOS_EMAIL_WELCOME: '0', IOS_EMAIL_NOT_LIVE: undefined };
    expect(await onAccountCreated(d, acct)).toBe('off');
    expect(sent).toEqual([]); expect(writes).toEqual([]); expect(d.purchase).not.toHaveBeenCalled();
  });
  it('not-live off: sweep does nothing, no state written', async () => {
    const { d, sent, writes } = fake({ rows: [arow()] }); d.env = { ...ON, IOS_EMAIL_NOT_LIVE: undefined };
    expect((await sweepIosNotLive(d)).skippedReason).toBe('off');
    expect(sent).toEqual([]); expect(writes).toEqual([]); expect(d.activeRows).not.toHaveBeenCalled();
  });
  it('billing off: nothing sent, no state written, nothing read', async () => {
    const { d, sent, writes } = withUser(); d.env = { ...ON, IOS_EMAIL_BILLING: '' };
    expect(await onSubscriptionNotice(d, notice())).toBe('off');
    expect(sent).toEqual([]); expect(writes).toEqual([]); expect(d.purchase).not.toHaveBeenCalled();
  });
  it('a missing table behaves as off for all three', async () => {
    const gone = Object.assign(new Error('supabase 404'), { status: 404 });
    const a = fake({ insertAccount: async () => { throw gone; } });
    expect(await onAccountCreated(a.d, acct)).toBe('no_table'); expect(a.sent).toEqual([]);
    const b = fake({ activeRows: async () => { throw gone; } });
    expect((await sweepIosNotLive(b.d)).skippedReason).toBe('no_table');
    const c = fake({ p: purchase({ user_id: 'u1' }), claimBilling: async () => { throw gone; } });
    expect(await onSubscriptionNotice(c.d, notice())).toBe('no_table'); expect(c.sent).toEqual([]);
  });
});

describe('welcome', () => {
  it('sends once per account (a second call finds the row and sends nothing)', async () => {
    const f = fake({ rows: [] });
    expect(await onAccountCreated(f.d, acct)).toBe('sent');
    expect(await onAccountCreated(f.d, acct)).toBe('exists');
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].key).toBe('aibarber-ios:welcome:u1');
    expect(f.sent[0].subject).toBe('Welcome Sam! Barber plan active');
  });
  it('says the site is being set up when not published, and gives the address when it is', async () => {
    const a = fake({ rows: [] });
    await onAccountCreated(a.d, acct);
    expect(a.sent[0].text).toContain('being set up'); expect(a.sent[0].text).not.toContain('vercel.app');
    const b = fake({ rows: [], p: purchase({ site_slug: 'sams-cuts', published_at: new Date(NOW).toISOString() }) });
    await onAccountCreated(b.d, acct);
    expect(b.sent[0].text).toContain('https://sams-cuts.vercel.app');
    // a removed / taken-down / someone else's site is not shown
    const c = fake({ rows: [], p: purchase({ site_slug: 'x', published_at: 'y', taken_down_at: 'z' }) });
    await onAccountCreated(c.d, acct);
    expect(c.sent[0].text).not.toContain('x.vercel.app');
  });
  it('sandbox purchases get nothing and write nothing', async () => {
    const f = fake({ rows: [] });
    expect(await onAccountCreated(f.d, { ...acct, environment: 'Sandbox' })).toBe('sandbox');
    expect(f.sent).toEqual([]); expect(f.writes).toEqual([]);
  });
  it('suppressed and internal-test addresses are not mailed', async () => {
    const a = fake({ rows: [], isSuppressed: async () => true });
    expect(await onAccountCreated(a.d, acct)).toBe('suppressed'); expect(a.sent).toEqual([]);
    const b = fake({ rows: [] });
    expect(await onAccountCreated(b.d, { ...acct, email: 'ibrahim3709+qa1@gmail.com' })).toBe('suppressed'); expect(b.sent).toEqual([]);
  });
  it('a failing send never throws', async () => {
    const f = fake({ rows: [], send: async () => { throw new Error('resend 500'); } });
    await expect(onAccountCreated(f.d, acct)).resolves.toBe('error');
  });
  it('only NOT_LIVE on: the state row is written but no welcome is sent', async () => {
    const f = fake({ rows: [] }); f.d.env = { ...ON, IOS_EMAIL_WELCOME: undefined };
    await onAccountCreated(f.d, acct);
    expect(f.writes).toContain('insertAccount'); expect(f.sent).toEqual([]);
  });
});

describe('runSignup hook', () => {
  const TX = { originalTransactionId: 'otid1', transactionId: 't', productId: 'p', environment: 'Production', expiresAt: NOW + 86_400_000, revoked: false, status: 1 } as any;
  const good = { transactionId: 't', name: 'Sam Cutter', email: 'sam@example.com', phone: '5550100199', password: 'correct horse' };
  const deps = (over: Partial<SignupDeps> = {}): SignupDeps => ({ allow: async () => true, verify: async () => TX, getPurchase: async () => null, allowForPurchase: async () => true, now: () => NOW, createUser: async () => ({ exists: false, userId: 'u1' }), ...over });
  it('is called after success with the account, and the response is unchanged', async () => {
    const hook = vi.fn(async () => {});
    const r = await runSignup(good, 'ip', deps({ accountCreated: hook }));
    expect(r).toEqual({ status: 200, body: { ok: true, email: 'sam@example.com' } });
    expect(hook).toHaveBeenCalledWith({ userId: 'u1', email: 'sam@example.com', name: 'Sam Cutter', originalTransactionId: 'otid1', environment: 'Production' });
  });
  it('a slow, rejecting or throwing hook never fails or delays the signup', async () => {
    const never = vi.fn(() => new Promise<void>(() => {}));
    expect((await runSignup(good, 'ip', deps({ accountCreated: never }))).status).toBe(200);
    expect((await runSignup(good, 'ip', deps({ accountCreated: async () => { throw new Error('x'); } }))).status).toBe(200);
    expect((await runSignup(good, 'ip', deps({ accountCreated: () => { throw new Error('x'); } }))).status).toBe(200);
  });
  it('is not called for an existing email', async () => {
    const hook = vi.fn();
    expect((await runSignup(good, 'ip', deps({ createUser: async () => ({ exists: true }), accountCreated: hook }))).status).toBe(409);
    expect(hook).not.toHaveBeenCalled();
  });
});

describe('not-live sweep', () => {
  it('sends step 1 at ~24 h, once, then step 2 at ~72 h, then stops done', async () => {
    const rows = [arow()];
    const f = fake({ rows });
    expect((await sweepIosNotLive(f.d)).sent).toBe(1);
    expect(f.sent[0].key).toBe('aibarber-ios:not-live:u1:1');
    expect((await sweepIosNotLive(f.d)).sent).toBe(0); // nothing more in the same window
    expect(f.sent).toHaveLength(1);
    rows[0].signup_at = new Date(NOW - 73 * H).toISOString(); rows[0].step1_sent_at = new Date(NOW - 48 * H).toISOString();
    expect((await sweepIosNotLive(f.d)).sent).toBe(1);
    expect(f.sent[1].key).toBe('aibarber-ios:not-live:u1:2');
    expect(rows[0].stop_reason).toBe('done');
  });
  it('waits before 24 h', async () => {
    const f = fake({ rows: [arow({ signup_at: new Date(NOW - 20 * H).toISOString() })] });
    expect((await sweepIosNotLive(f.d)).sent).toBe(0);
  });
  it('never makes up a missed first mail', async () => {
    const rows = [arow({ signup_at: new Date(NOW - 80 * H).toISOString() })];
    const f = fake({ rows });
    expect((await sweepIosNotLive(f.d)).sent).toBe(0);
    expect(rows[0].stop_reason).toBe('late');
  });
  it('launch-date gate: rows from before SINCE are stopped, not mailed; no SINCE = nothing', async () => {
    const rows = [arow({ signup_at: new Date(Date.parse(SINCE) - 100 * H).toISOString() })];
    const f = fake({ rows });
    f.d.now = () => Date.parse(SINCE) - 100 * H + 30 * H;
    expect((await sweepIosNotLive(f.d)).sent).toBe(0);
    expect(rows[0].stop_reason).toBe('before_launch');
    const g = fake({ rows: [arow()] }); g.d.env = { ...ON, IOS_EMAIL_NOT_LIVE_SINCE: undefined };
    expect((await sweepIosNotLive(g.d)).skippedReason).toBe('no_since'); expect(g.sent).toEqual([]);
  });
  const stops: [string, Partial<IosEmailDeps> & { p?: PurchaseLite | null }, string][] = [
    ['site published', { p: purchase({ published_at: 'x' }) }, 'live'],
    ['published on another purchase of the account', { hasPublishedSite: async () => true }, 'live'],
    ['purchase lapsed (taken down)', { p: purchase({ taken_down_at: 'x' }) }, 'lapsed'],
    ['purchase lapsed (expired long ago)', { p: purchase({ expires_at: new Date(NOW - 5 * H).toISOString() }) }, 'lapsed'],
    ['refunded', { p: purchase({ revoked_at: 'x' }) }, 'refunded'],
    ['site removed', { p: purchase({ removed_at: 'x' }) }, 'removed'],
    ['purchase moved to another account', { p: purchase({ user_id: 'other' }) }, 'moved'],
    ['account deleted', { adminUser: async () => null }, 'deleted'],
    ['suppressed', { isSuppressed: async () => true }, 'suppressed'],
    ['internal test address', { email: 'ibrahim3709+t@gmail.com' }, 'suppressed'],
    ['sandbox purchase', { p: purchase({ environment: 'Sandbox' }) }, 'sandbox'],
  ];
  for (const [name, over, reason] of stops) {
    it(`stops and sends nothing: ${name}`, async () => {
      const rows = [arow()];
      const f = fake({ rows, ...over });
      const r = await sweepIosNotLive(f.d);
      expect(f.sent).toEqual([]); expect(r.sent).toBe(0); expect(rows[0].stop_reason).toBe(reason);
    });
  }
  it('a failed send releases the claim, sends nothing, and the next sweep can retry', async () => {
    const rows = [arow()];
    const f = fake({ rows, send: async () => { throw new Error('resend 500'); } });
    expect((await sweepIosNotLive(f.d)).errors).toBe(1);
    expect(rows[0].claimed_at).toBeNull(); expect(rows[0].stopped_at).toBeNull();
  });
  it('holds (no send, no stop) when the purchase row cannot be read yet', async () => {
    const rows = [arow()];
    const f = fake({ rows, p: null });
    await sweepIosNotLive(f.d);
    expect(f.sent).toEqual([]); expect(rows[0].stopped_at).toBeNull(); expect(rows[0].claimed_at).toBeNull();
  });
});

describe('billing', () => {
  it('keys: kind x original transaction x billing period (expiresDate); grace and non-grace share one key', () => {
    expect(billingKeyOf(notice({ subtype: 'GRACE_PERIOD' }))).toEqual({ otid: 'otid1', kind: 'renewal_failed', period: '1000' });
    expect(billingKeyOf(notice())).toEqual({ otid: 'otid1', kind: 'renewal_failed', period: '1000' });
    expect(billingKeyOf(notice({ type: 'EXPIRED' }))).toEqual({ otid: 'otid1', kind: 'expired', period: '1000' });
    expect(billingKeyOf(notice({ type: 'DID_RENEW' }))).toBeNull();
  });
  it('failed renewal: one mail per period, even with a grace-period notice followed by one without', async () => {
    const f = withUser();
    expect(await onSubscriptionNotice(f.d, notice({ subtype: 'GRACE_PERIOD' }))).toBe('sent');
    expect(await onSubscriptionNotice(f.d, notice())).toBe('duplicate');
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].key).toBe('aibarber-ios:billing:otid1:renewal_failed:1000');
    expect(f.sent[0].text).toContain('stays online');
    expect(await onSubscriptionNotice(f.d, notice({ expiresAt: 2000 }))).toBe('sent'); // next period: new mail
    expect(f.sent).toHaveLength(2);
  });
  it('expired after a failed payment (BILLING_RETRY): its own mail, once', async () => {
    const f = withUser();
    expect(await onSubscriptionNotice(f.d, notice({ type: 'EXPIRED', subtype: 'BILLING_RETRY' }))).toBe('sent');
    expect(await onSubscriptionNotice(f.d, notice({ type: 'EXPIRED', subtype: 'BILLING_RETRY' }))).toBe('duplicate');
    expect(f.sent).toHaveLength(1); expect(f.sent[0].subject).toContain('has ended');
  });
  it.each(['VOLUNTARY', 'PRICE_INCREASE', 'PRODUCT_NOT_FOR_SALE', undefined])('expired with subtype %s is silent: nothing sent, nothing read or written', async (subtype) => {
    const f = withUser();
    expect(await onSubscriptionNotice(f.d, notice({ type: 'EXPIRED', subtype }))).toBe('silent');
    expect(f.sent).toEqual([]);
    expect(f.d.claimBilling).not.toHaveBeenCalled(); expect(f.d.purchase).not.toHaveBeenCalled(); expect(f.d.adminUser).not.toHaveBeenCalled();
  });
  it('sandbox (notification or purchase row), unlinked, refunded, suppressed and internal addresses get nothing', async () => {
    const cases: [any, any][] = [
      [withUser(), { environment: 'Sandbox' }],
      [fake({ p: purchase({ user_id: 'u1', environment: 'Sandbox' }) }), {}],
      [fake({ p: purchase({ user_id: null }) }), {}],
      [fake({ p: purchase({ user_id: 'u1', revoked_at: 'x' }) }), {}],
      [fake({ p: purchase({ user_id: 'u1' }), isSuppressed: async () => true }), {}],
      [fake({ p: purchase({ user_id: 'u1' }), email: 'ibrahim3709+a@gmail.com' }), {}],
      [fake({ p: null }), {}],
    ];
    for (const [f, o] of cases) { await onSubscriptionNotice(f.d, notice(o)); expect(f.sent).toEqual([]); expect(f.d.claimBilling).not.toHaveBeenCalled(); }
  });
  it('a failing send never throws and gives the claim back', async () => {
    const f = fake({ p: purchase({ user_id: 'u1' }), send: async () => { throw new Error('resend 500'); } });
    await expect(onSubscriptionNotice(f.d, notice())).resolves.toBe('error');
    expect(f.d.releaseBilling).toHaveBeenCalled();
  });
});

describe('handleAppleNotification stays 2xx when the email step fails', () => {
  const BUNDLE = 'com.x';
  const base = (hook: any) => ({
    repo: { applyNotification: vi.fn(async () => {}) } as any, bundleId: BUNDLE, now: () => NOW,
    decodeNotification: async () => ({ notificationType: 'DID_FAIL_TO_RENEW', subtype: 'GRACE_PERIOD', data: { environment: 'Production', bundleId: BUNDLE, signedTransactionInfo: 'tx' } }),
    decodeTransaction: async () => ({ bundleId: BUNDLE, productId: 'com.ibrahim1774.aibarber.hosting.monthly', originalTransactionId: 'otid1', transactionId: 't', expiresDate: 1000 }),
    subscriptionNotice: hook,
  }) as any;
  it('passes the notice and answers 200 whatever the hook does', async () => {
    const ok = vi.fn(async () => {});
    expect((await handleAppleNotification('j', base(ok))).status).toBe(200);
    expect(ok).toHaveBeenCalledWith({ otid: 'otid1', type: 'DID_FAIL_TO_RENEW', subtype: 'GRACE_PERIOD', environment: 'Production', expiresAt: 1000 });
    expect((await handleAppleNotification('j', base(async () => { throw new Error('x'); }))).status).toBe(200);
    expect((await handleAppleNotification('j', base(() => { throw new Error('x'); }))).status).toBe(200);
    expect((await handleAppleNotification('j', base(() => new Promise(() => {})))).status).toBe(200);
  });
  it('is not called when recording the notification failed (Apple retries)', async () => {
    const hook = vi.fn(); const d = base(hook); d.repo.applyNotification = async () => { throw new Error('db'); };
    expect((await handleAppleNotification('j', d)).status).toBe(500); expect(hook).not.toHaveBeenCalled();
  });
});

describe('rendered text', () => {
  const mails = [
    iosWelcomeEmail({ firstName: 'Sam' }), iosWelcomeEmail({ firstName: null, siteUrl: 'https://sams-cuts.vercel.app' }),
    iosNotLiveEmail(1, { firstName: 'Sam' }), iosNotLiveEmail(2, { firstName: null }),
    iosBillingEmail('renewal_failed', { firstName: 'Sam' }), iosBillingEmail('renewal_failed', { graceKept: true }), iosBillingEmail('expired', { firstName: 'Sam' }),
  ];
  const urls = (s: string) => s.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
  it('only ever links to the live site address (and never the web editor or a sign-in)', () => {
    for (const m of mails) for (const u of [...urls(m.text), ...urls(m.html)]) {
      expect(u).toBe('https://sams-cuts.vercel.app');
    }
    for (const m of mails) { expect(m.text + m.html).not.toMatch(/web-app\/continue|sign-in|forgot-password|primebarber\.org|davoxa/i); }
    expect(urls(mails[1].text)).toEqual(['https://sams-cuts.vercel.app']);
  });
  it('has no price and no other company name', () => {
    for (const m of mails) {
      const all = `${m.subject}\n${m.text}\n${m.html.replace(/style="[^"]*"/g, '')}`;
      expect(all).not.toMatch(/\$|€|£|usd|price|per month|per year|\/mo\b|\/yr\b|\d+\.\d{2}/i);
      expect(all).not.toMatch(/stripe|google|paypal|venmo|zelle|superwall|revenuecat|testflight/i);
      if (!/Apple ID/.test(all)) expect(all).not.toMatch(/apple/i);
    }
  });
  it('billing mails send the barber to Apple ID subscription settings only', () => {
    for (const m of mails.slice(4)) {
      expect(m.text).toContain('Apple ID subscription settings'); expect(m.text).toMatch(/Settings.*Subscriptions/);
      expect(m.text).not.toMatch(/sign in|web app|pay online|primebarber/i);
    }
  });
  it('same footer and reply-to as the existing mail; plain subjects', () => {
    const standard = mails.filter((m) => !m.tags?.some((t) => t.value.startsWith('ios_not_live')));
    expect(standard).toHaveLength(5);
    for (const m of standard) { expect(m.text).toContain('You are getting this because you have a Prime Barber plan. Questions? Reply to this email.'); expect(m.replyTo).toBeTruthy(); expect((m as any).from).toBeUndefined(); }
    expect(mails.map((m) => m.subject)).toEqual([
      'Welcome Sam! Barber plan active', 'Welcome! Barber plan active', "Sam, your website isn't live yet", 'Your website is still waiting',
      'Sam, about your Prime Barber plan', 'About your Prime Barber plan', 'Sam, your Prime Barber plan has ended',
    ]);
  });
});

describe('not-live reminders use the web personal sender style', () => {
  const reminders = [iosNotLiveEmail(1, { firstName: 'Sam' }), iosNotLiveEmail(2, { firstName: null })];
  it('same From, reply-to, tags shape and grey reply-stop P.S. as signupNudgeEmail; no footer, no headers, no links', () => {
    const web = signupNudgeEmail(1, { email: 'a@b.c', firstName: 'Sam', continueUrl: 'https://x.test/c' });
    for (const m of reminders) {
      expect(m.from).toBe(nudgeFrom()); expect(m.from).toMatch(/^Ibrahim from Prime Barber <[^>]+>$/);
      expect(m.replyTo).toBe(web.replyTo);
      expect(m.headers).toBeUndefined();
      expect(m.text).toContain(NUDGE_OPT_OUT); expect(m.text.trimEnd().endsWith(NUDGE_OPT_OUT)).toBe(true);
      expect(m.html).toContain('<p style="color:#777777;font-size:13px">');
      expect(m.text).toContain('Ibrahim\nPrime Barber');
      expect(m.text).not.toContain('You are getting this because');
      expect(m.text + m.html).not.toMatch(/https?:\/\/|href=|unsubscribe/i);
    }
    expect(web.from).toBe(nudgeFrom());
  });
  it('From follows WEB_APP_NUDGE_FROM like the web reminders', () => {
    const prev = process.env.WEB_APP_NUDGE_FROM; process.env.WEB_APP_NUDGE_FROM = 'Someone <hi@example.test>';
    try { expect(iosNotLiveEmail(1, {}).from).toBe('Ibrahim from Prime Barber <hi@example.test>'); }
    finally { if (prev === undefined) delete process.env.WEB_APP_NUDGE_FROM; else process.env.WEB_APP_NUDGE_FROM = prev; }
  });
  it('welcome and billing mails keep the standard sender', () => {
    for (const m of [iosWelcomeEmail({}), iosBillingEmail('renewal_failed', {}), iosBillingEmail('expired', {})]) expect((m as any).from).toBeUndefined();
  });
});

describe('migration 037', () => {
  const s = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/037_ios_emails.sql'), 'utf8');
  const code = s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ');
  it('is additive: two new tables, RLS on, no policies, service role only', () => {
    expect(code).not.toMatch(/drop table|drop column|alter table public\.(?!ios_)|delete from|update public/i);
    for (const t of ['ios_account_emails', 'ios_billing_emails']) {
      expect(code).toMatch(new RegExp(`create table if not exists public\\.${t}`));
      expect(code).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
      expect(code).toMatch(new RegExp(`revoke all on public\\.${t} from anon, authenticated`));
      expect(code).toMatch(new RegExp(`grant all on public\\.${t} to service_role`));
    }
    expect(code).not.toMatch(/create policy/i);
    expect(code).toMatch(/primary key \(original_transaction_id, kind, period_key\)/);
  });
});
