import { afterEach, describe, expect, it, vi } from 'vitest';
import { duplicateRefundEmail, failedPaymentEmail, iosOverlapEmail } from '../../lib/webApp/emails.js';
import * as pre from './fixtures/emails.pre.js'; // the file as it was BEFORE the overlap wording change (commit 654809a7^)
import { liveIosOverlapDeps, sweepIosOverlap, type IosOverlapDeps, type OverlapRow } from '../../lib/webApp/lapse.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const input = { email: 'barber@gmail.com', siteUrl: null as string | null, tier: 'website', firstName: 'Sam' };

describe('iosOverlapEmail: today\'s email is byte-identical', () => {
  it('full subject, html and text equal the pre-change output, with and without a site, for every tier, even with the old env switch set', () => {
    vi.stubEnv('OVERLAP_EMAIL_BY_HOLDER', '1'); // the email function no longer reads it: only the sweep's decision (overlapByHolder) changes the wording
    for (const siteUrl of [null, 'https://fresh-cuts.vercel.app']) for (const tier of ['website', 'bookings', 'store']) {
      const i = { ...input, siteUrl, tier };
      expect(iosOverlapEmail(i)).toEqual(pre.iosOverlapEmail(i));
      expect(iosOverlapEmail(i, 'https://x.example')).toEqual(pre.iosOverlapEmail(i, 'https://x.example'));
    }
  });
  it('the shared template did not change for the other emails (a button is still rendered)', () => {
    expect(failedPaymentEmail(input as any)).toEqual(pre.failedPaymentEmail(input as any));
    expect(duplicateRefundEmail(input as any)).toEqual(pre.duplicateRefundEmail(input as any));
  });
  it('overlapByHolder false or absent is today\'s email', () => {
    expect(iosOverlapEmail({ ...input, overlapByHolder: false, accountEmail: 'x@y.co' })).toEqual(pre.iosOverlapEmail(input));
  });
});

describe('iosOverlapEmail new wording', () => {
  it('names the account, how to sign in incl. the emailed code, how to cancel the Apple subscription; no button; no em dash', () => {
    const m = iosOverlapEmail({ ...input, email: 'stripe@x.co', overlapByHolder: true, accountEmail: 'barber@gmail.com' });
    expect(m.subject).toBe('You now pay for Prime Barber twice');
    expect(m.text).toContain('You have a Prime Barber plan on the web, on the account barber@gmail.com, and you also bought one in the iPhone app. The app subscription adds nothing, so you are paying twice.');
    expect(m.text).toContain('So that you are not charged twice, cancel the app subscription on your iPhone: Settings, your name, Subscriptions. To ask for your money back, go to reportaproblem.apple.com.');
    expect(m.text).toContain('open the app and sign in with barber@gmail.com. If you do not remember your password, tap Email me a sign-in code and we will email you a code.');
    expect(m.text).not.toContain('Manage web plan');
    expect(m.html).not.toContain('Manage web plan');
    expect(m.text).not.toContain('stripe@x.co'); // the sign-in email is the account's own, never the send-to address
    expect(m.html + m.text).not.toMatch(/[—–]/);
  });
  it('unknown account email: "on the account" and "with" are left out, the letter still reads', () => {
    const m = iosOverlapEmail({ ...input, overlapByHolder: true, accountEmail: null });
    expect(m.text).toContain('You have a Prime Barber plan on the web, and you also bought one in the iPhone app.');
    expect(m.text).toContain('open the app and sign in. If you do not remember your password');
    expect(m.text).not.toMatch(/Account:|barber@gmail\.com/);
  });
});

describe('sweepIosOverlap: when the new wording and the owner alert apply', () => {
  const row = (): OverlapRow => ({ stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', user_id: 'u1', tier: 'website', site_slug: null });
  function deps(o: { ledger?: boolean; holder?: boolean; link?: boolean | 'absent'; state?: 'active' | 'linked' } = {}) {
    const claimed = new Set<string>();
    const d: any = {
      candidates: vi.fn(async () => [row()].filter((r) => !claimed.has(r.stripe_subscription_id))), stampChecked: vi.fn(async () => {}),
      appStoreState: vi.fn(async () => o.state ?? 'active'),
      claim: vi.fn(async (id: string) => { if (claimed.has(id)) return false; claimed.add(id); return true; }), release: vi.fn(async () => {}),
      mailCustomer: vi.fn(async () => true), mailOwner: vi.fn(async () => {}),
      holdsAppleAddress: vi.fn(async () => !!o.holder), liveApplePurchases: vi.fn(async () => 1), alert: vi.fn(async () => {}),
      accountFacts: vi.fn(async () => ({ email: 'barber@gmail.com', appleSubs: ['2000000123'], hasSite: false, ledgerAlerted: !!o.ledger })),
    };
    if (o.link !== 'absent') d.shopHasIosLink = vi.fn(async () => !!o.link);
    return d as IosOverlapDeps & Record<string, any>;
  }
  const on = (extra: Record<string, string> = {}) => { for (const [k, v] of Object.entries({ OVERLAP_EMAIL_BY_HOLDER: '1', STRIPE_REFUND_ALERTS: '1', ...extra })) vi.stubEnv(k, v); };
  const byHolder = (d: any) => d.mailCustomer.mock.calls[0]?.[1]?.byHolder;

  it('all conditions hold (no Apple address, no ios_otid link): new wording', async () => {
    on(); const d = deps(); await sweepIosOverlap(d);
    expect(byHolder(d)).toBe(true);
  });
  it('the shop has an ios_otid link and GATE_ANY_SOURCE is off: the OLD email', async () => {
    on(); const d = deps({ link: true }); await sweepIosOverlap(d);
    expect(byHolder(d)).toBe(false);
  });
  it('the shop has an ios_otid link but GATE_ANY_SOURCE=1: new wording, and the link is not even asked', async () => {
    on({ GATE_ANY_SOURCE: '1' }); const d = deps({ link: true }); await sweepIosOverlap(d);
    expect(byHolder(d)).toBe(true);
    expect(d.shopHasIosLink).not.toHaveBeenCalled();
  });
  it('an Apple address holder with OVERLAP_EMAIL_BY_HOLDER=1 and STRIPE_REFUND_ALERTS OFF: the old email (the Apple-holder check never ran)', async () => {
    on({ STRIPE_REFUND_ALERTS: '' }); const d = deps({ holder: true }); await sweepIosOverlap(d);
    expect(byHolder(d)).toBe(false);
  });
  it('an Apple address holder with STRIPE_REFUND_ALERTS on: no customer email at all, only the owner alert', async () => {
    on(); const d = deps({ holder: true }); await sweepIosOverlap(d);
    expect(d.mailCustomer).not.toHaveBeenCalled();
    expect(d.alert).toHaveBeenCalledTimes(1);
  });
  it('OVERLAP_EMAIL_BY_HOLDER off, or the link lookup unavailable: the old email', async () => {
    on({ OVERLAP_EMAIL_BY_HOLDER: '' }); const a = deps(); await sweepIosOverlap(a); expect(byHolder(a)).toBe(false);
    on(); const b = deps({ link: 'absent' }); await sweepIosOverlap(b); expect(byHolder(b)).toBe(false);
    const c = deps(); c.shopHasIosLink = vi.fn(async () => { throw new Error('db'); }); await sweepIosOverlap(c); expect(byHolder(c)).toBe(false);
  });
  it('a lapsed (linked) state never gets the new wording or a customer email', async () => {
    on(); const d = deps({ state: 'linked' }); await sweepIosOverlap(d);
    expect(d.mailCustomer).not.toHaveBeenCalled();
  });

  it('the owner alert: once per account with the account email, the Apple subscription ids and "none yet"', async () => {
    on(); const d = deps(); await sweepIosOverlap(d); await sweepIosOverlap(d);
    expect(d.mailOwner).toHaveBeenCalledTimes(1);
    expect((d.mailOwner as any).mock.calls[0][3]).toEqual(['account email: barber@gmail.com', 'Apple subscriptions: 2000000123', 'site address: none yet']);
  });
  it('the ledger already alerted (active state): no second owner alert, the customer email still goes', async () => {
    on(); const d = deps({ ledger: true }); await sweepIosOverlap(d);
    expect(d.mailCustomer).toHaveBeenCalledTimes(1); expect(d.mailOwner).not.toHaveBeenCalled();
  });
  it('NEVER skipped in the lapsed linked state, even when the ledger alerted', async () => {
    on(); const d = deps({ ledger: true, state: 'linked' }); await sweepIosOverlap(d);
    expect(d.mailOwner).toHaveBeenCalledTimes(1);
  });
});

describe('liveIosOverlapDeps over the wire', () => {
  const mk = (handler: (url: string, init: any) => any) => {
    for (const [k, v] of Object.entries({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'k', STRIPE_WEBAPP_SECRET_KEY: 'sk_test_x', RESEND_API_KEY: 'rk' })) vi.stubEnv(k, v);
    const calls: { url: string; init: any }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url, init }); const r = handler(url, init); return new Response(JSON.stringify(r?.body ?? r ?? []), { status: r?.status ?? 200 }); }));
    return calls;
  };
  const NOW = Date.now(); const FUT = new Date(NOW + 30 * 86_400_000).toISOString();
  const purchase = (id: string, env: string) => ({ original_transaction_id: id, product_id: 'com.ibrahim1774.aibarber.hosting.monthly', environment: env, expires_at: FUT, revoked_at: null, taken_down_at: null });

  it('ledgerAlerted counts only the live PRODUCTION purchases just read: the query lists exactly those ids; Sandbox only means no ledger query at all', async () => {
    const calls = mk((url) => {
      if (url.includes('/ios_purchases')) return [purchase('PROD1', 'Production'), purchase('SBX1', 'Sandbox')];
      if (url.includes('/web_app_sites')) return [];
      if (url.includes('/blocked_purchases')) return [{ original_transaction_id: 'PROD1' }];
      if (url.includes('/auth/v1/admin/users')) return { email: 'a@b.co' };
      return [];
    });
    const f = await liveIosOverlapDeps('test').accountFacts!('u1'); // test mode counts Sandbox rows as live, but only Production ids reach the ledger query
    expect(f.ledgerAlerted).toBe(true);
    const q = decodeURIComponent(calls.find((c) => c.url.includes('/blocked_purchases'))!.url);
    expect(q).toContain('original_transaction_id=in.(PROD1)');
    expect(q).not.toMatch(/SBX1|web-publish|apple-publish/);
    expect(f.appleSubs.sort()).toEqual(['PROD1', 'SBX1']);

    const calls2 = mk((url) => (url.includes('/ios_purchases') ? [purchase('SBX1', 'Sandbox')] : url.includes('/auth/v1/admin/users') ? { email: 'a@b.co' } : []));
    const f2 = await liveIosOverlapDeps('test').accountFacts!('u1');
    expect(f2.ledgerAlerted).toBe(false);
    expect(calls2.some((c) => c.url.includes('/blocked_purchases'))).toBe(false);
  });
  it('the new letter uses the account\'s own sign-in email, never the Stripe customer\'s; with no sign-in email the address is left out (still sent to the contact address)', async () => {
    const sent: any[] = [];
    mk((url, init) => {
      if (url.includes('api.resend.com')) { sent.push(JSON.parse(init.body)); return { id: 'm1' }; }
      if (url.includes('/auth/v1/admin/users')) return { status: 404, body: {} }; // the account's own email cannot be read
      if (url.includes('api.stripe.com')) return { email: 'stripe-customer@example.com' }; // contactFor falls back to this
      return [];
    });
    const d = liveIosOverlapDeps('live');
    expect(await d.mailCustomer({ stripe_subscription_id: 's', stripe_customer_id: 'cus_1', user_id: 'u1', tier: 'website', site_slug: null }, { byHolder: true })).toBe(true);
    expect(sent[0].to).toEqual(['stripe-customer@example.com']);
    expect(sent[0].text).not.toContain('stripe-customer@example.com');
    expect(sent[0].text).toContain('open the app and sign in. If you do not remember');
  });
});
