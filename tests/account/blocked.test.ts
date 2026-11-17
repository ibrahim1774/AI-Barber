import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportBlocked, resetFallbackAlerts, type BlockedDeps, type BlockedInfo, type Stamp } from '../../lib/account/blocked.js';
import { blockedPurchaseEmail, OTHER_APPLE_ID_TEXT, WEB_ACCOUNT_TEXT } from '../../lib/account/blockedEmails.js';

const UID = '11111111-1111-4111-8111-111111111111';
const info = (over: Partial<BlockedInfo> = {}): BlockedInfo => ({ otid: '2000000123', uid: UID, reason: 'web-account', slug: 'cuts', environment: 'Production', email: true, where: 'ios/publish', ...over });

function fakeDeps(o: { missing?: boolean; sendFails?: number; alertFails?: number; email?: string | null } = {}) {
  const rows = new Map<string, { reason: string; alerted_at: string | null; emailed_at: string | null }>();
  const sent: { to: string; subject: string; text: string; key: string; from?: string }[] = [];
  const alerts: { subject: string; lines: string[] }[] = [];
  let sendFails = o.sendFails ?? 0, alertFails = o.alertFails ?? 0;
  const k = (otid: string, uid: string) => `${otid}|${uid}`;
  const miss = () => { if (o.missing) throw Object.assign(new Error('404'), { status: 404 }); };
  const deps: BlockedDeps = {
    now: () => Date.now(),
    async record(otid, uid, reason) { miss(); if (rows.has(k(otid, uid))) return false; rows.set(k(otid, uid), { reason, alerted_at: null, emailed_at: null }); return true; },
    async claim(field: Stamp, otid, uid, stamp) { const r = rows.get(k(otid, uid))!; if (r[field]) return false; r[field] = stamp; return true; },
    async release(field: Stamp, otid, uid, stamp) { const r = rows.get(k(otid, uid))!; if (r[field] === stamp) r[field] = null; },
    adminUser: async () => ({ email: o.email === undefined ? 'barber@gmail.com' : o.email, name: 'Sam', emailConfirmedAt: null, createdAt: null, lastSignInAt: null }),
    isSuppressed: async () => false,
    send: async (to, mail, key) => { if (sendFails-- > 0) throw new Error('resend 500'); sent.push({ to, subject: mail.subject, text: mail.text, key, from: mail.from }); return 'id1'; },
    alert: async (subject, lines) => { if (alertFails-- > 0) throw new Error('resend 500'); alerts.push({ subject, lines }); },
  };
  return { deps, rows, sent, alerts };
}

describe('reportBlocked', () => {
  beforeEach(() => resetFallbackAlerts());
  it('records, alerts once and emails once per (purchase, account), however many times it is reported', async () => {
    const f = fakeDeps();
    for (let i = 0; i < 4; i++) await reportBlocked(info(), f.deps);
    expect(f.rows.size).toBe(1);
    expect(f.alerts).toHaveLength(1);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].key).toBe(`one-site:blocked:2000000123:${UID}`);
  });
  it('two reports at once still send one email and one alert', async () => {
    const f = fakeDeps();
    await Promise.all([reportBlocked(info(), f.deps), reportBlocked(info(), f.deps), reportBlocked(info(), f.deps)]);
    expect(f.sent).toHaveLength(1);
    expect(f.alerts).toHaveLength(1);
  });
  it('another purchase of the same account is its own pair', async () => {
    const f = fakeDeps();
    await reportBlocked(info(), f.deps);
    await reportBlocked(info({ otid: '2000000999' }), f.deps);
    expect(f.sent).toHaveLength(2);
  });
  it('ALERT mode (email:false) alerts and records but never sends an email', async () => {
    const f = fakeDeps();
    await reportBlocked(info({ email: false }), f.deps);
    expect(f.alerts).toHaveLength(1);
    expect(f.sent).toHaveLength(0);
    expect(f.rows.get(`2000000123|${UID}`)!.emailed_at).toBeNull();
  });
  it('a Sandbox purchase is alerted but never emailed', async () => {
    const f = fakeDeps();
    await reportBlocked(info({ environment: 'Sandbox' }), f.deps);
    expect(f.alerts).toHaveLength(1);
    expect(f.sent).toHaveLength(0);
  });
  it('a mixed account gets the alert only', async () => {
    const f = fakeDeps();
    await reportBlocked(info({ reason: 'mixed' }), f.deps);
    expect(f.alerts).toHaveLength(1);
    expect(f.sent).toHaveLength(0);
  });
  it('a failed send releases the claim, so a later report can still send it once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fakeDeps({ sendFails: 1 });
    await reportBlocked(info(), f.deps);
    expect(f.sent).toHaveLength(0);
    expect(f.rows.get(`2000000123|${UID}`)!.emailed_at).toBeNull();
    await reportBlocked(info(), f.deps);
    await reportBlocked(info(), f.deps);
    expect(f.sent).toHaveLength(1);
    expect(f.alerts).toHaveLength(1);
  });
  it('a failed alert releases its claim and is retried by the next report', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fakeDeps({ alertFails: 1 });
    await reportBlocked(info(), f.deps);
    expect(f.alerts).toHaveLength(0);
    await reportBlocked(info(), f.deps);
    expect(f.alerts).toHaveLength(1);
  });
  it('an account with no email address is not claimed (nothing is lost)', async () => {
    const f = fakeDeps({ email: null });
    await reportBlocked(info(), f.deps);
    expect(f.sent).toHaveLength(0);
    expect(f.rows.get(`2000000123|${UID}`)!.emailed_at).toBeNull();
  });
  it('a missing ledger table: no email, no throw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fakeDeps({ missing: true });
    await expect(reportBlocked(info(), f.deps)).resolves.toBeUndefined();
    expect(f.sent).toHaveLength(0);
    expect(f.alerts).toHaveLength(1); // the owner is still told, best effort
    expect(f.alerts[0].lines.join('\n')).toMatch(/no email was sent/);
  });
  it('the no-ledger fallback alert is limited to one per account per hour (in memory)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fakeDeps({ missing: true });
    await reportBlocked(info(), f.deps); await reportBlocked(info({ otid: 'other' }), f.deps);
    expect(f.alerts).toHaveLength(1);
    await reportBlocked(info({ uid: '22222222-2222-4222-8222-222222222222' }), f.deps);
    expect(f.alerts).toHaveLength(2);
  });
  it('an unwritable ledger (not just a missing table) also alerts and never emails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fakeDeps();
    f.deps.record = async () => { throw Object.assign(new Error('500'), { status: 500 }); };
    await reportBlocked(info(), f.deps);
    expect(f.alerts).toHaveLength(1);
    expect(f.sent).toHaveLength(0);
  });
  it('never throws, whatever fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fakeDeps();
    f.deps.record = async () => { throw new Error('db down'); };
    f.deps.alert = async () => { throw new Error('mail down'); };
    await expect(reportBlocked(info(), f.deps)).resolves.toBeUndefined();
  });
});

describe('the barber email', () => {
  it('web account text is the plan\'s, word for word', () => {
    expect(WEB_ACCOUNT_TEXT).toBe("You bought a Prime Barber subscription in the iPhone app, but your account's website was made on primebarber.org, so the new subscription was not used. Nothing changed on your website. To stop being charged, cancel it on your iPhone: Settings, your name, Subscriptions. To ask for your money back, go to reportaproblem.apple.com. If your web plan has ended, renew it at primebarber.org.");
    expect(OTHER_APPLE_ID_TEXT).toBe('Your website belongs to the subscription you first bought with a different Apple ID. This new subscription was not used. Resubscribe with that Apple ID, or reply to this email and we will move your website for you.');
  });
  it('is a plain letter on the standard sender: no em dash, no extra links, no From override', () => {
    for (const reason of ['web-account', 'other-apple-id'] as const) {
      const m = blockedPurchaseEmail(reason);
      expect(m.from).toBeUndefined();
      expect(m.headers).toBeUndefined();
      expect(m.subject + m.text + m.html).not.toMatch(/[—–]/);
      expect(m.html).not.toMatch(/<a /);
      expect(m.text).toBe(reason === 'web-account' ? WEB_ACCOUNT_TEXT : OTHER_APPLE_ID_TEXT);
    }
  });
});
