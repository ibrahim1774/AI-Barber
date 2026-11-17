import { afterEach, describe, expect, it, vi } from 'vitest';
import { iosOverlapEmail } from '../../lib/webApp/emails.js';
import { sweepIosOverlap, type IosOverlapDeps, type OverlapRow } from '../../lib/webApp/lapse.js';

afterEach(() => vi.unstubAllEnvs());
const input = { email: 'barber@gmail.com', siteUrl: null, tier: 'website' };

describe('iosOverlapEmail behind OVERLAP_EMAIL_BY_HOLDER', () => {
  it('off (default): today\'s email exactly', () => {
    const m = iosOverlapEmail(input);
    expect(m.subject).toBe('You now pay for Prime Barber twice');
    expect(m.text).toContain('Your shop now runs on your App Store plan, so the web plan no longer adds anything.');
    expect(m.text).not.toContain('reportaproblem.apple.com');
  });
  it('on: names the account email, how to sign in incl. the emailed code, and how to cancel the Apple subscription', () => {
    vi.stubEnv('OVERLAP_EMAIL_BY_HOLDER', '1');
    const m = iosOverlapEmail(input);
    expect(m.subject).toBe('You now pay for Prime Barber twice');
    expect(m.text).toContain('You have a Prime Barber plan on the web, on the account barber@gmail.com, and you also bought one in the iPhone app. The app subscription adds nothing, so you are paying twice.');
    expect(m.text).toContain('So that you are not charged twice, cancel the app subscription on your iPhone: Settings, your name, Subscriptions. To ask for your money back, go to reportaproblem.apple.com.');
    expect(m.text).toContain('open the app and sign in with barber@gmail.com. If you do not remember your password, tap Email me a sign-in code and we will email you a code.');
    expect(m.html + m.text).not.toMatch(/[—–]/);
  });
});

describe('sweepIosOverlap owner alert for the double payer', () => {
  const row = (): OverlapRow => ({ stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', user_id: 'u1', tier: 'website', site_slug: null });
  function deps(o: { ledger?: boolean; facts?: boolean } = {}) {
    const claimed = new Set<string>();
    const d: IosOverlapDeps & { facts: any } = {
      candidates: vi.fn(async () => [row()].filter((r) => !claimed.has(r.stripe_subscription_id))), stampChecked: vi.fn(async () => {}),
      appStoreState: vi.fn(async () => 'active' as const),
      claim: vi.fn(async (id) => { if (claimed.has(id)) return false; claimed.add(id); return true; }), release: vi.fn(async () => {}),
      mailCustomer: vi.fn(async () => true), mailOwner: vi.fn(async () => {}),
      holdsAppleAddress: vi.fn(async () => false), liveApplePurchases: vi.fn(async () => 1), alert: vi.fn(async () => {}),
      facts: null,
    } as any;
    if (o.facts !== false) d.accountFacts = vi.fn(async () => ({ email: 'barber@gmail.com', appleSubs: ['2000000123'], hasSite: false, ledgerAlerted: !!o.ledger }));
    return d;
  }
  it('a card plan with no site and a live Apple purchase with no slug: the owner is alerted once, with the account email, both subscription ids and "none yet"', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    const d = deps();
    await sweepIosOverlap(d);
    expect(d.mailOwner).toHaveBeenCalledTimes(1);
    const [r, , , extra] = (d.mailOwner as any).mock.calls[0];
    expect(r.stripe_subscription_id).toBe('sub_1');
    expect(extra).toEqual(['account email: barber@gmail.com', 'Apple subscriptions: 2000000123', 'site address: none yet']);
    await sweepIosOverlap(d);
    expect(d.mailOwner).toHaveBeenCalledTimes(1); // once per account
    expect(d.alert).not.toHaveBeenCalled(); // the Apple-address-holder alert is not this one
  });
  it('the ledger already alerted for this account: no second owner alert (the customer email still goes)', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1');
    const d = deps({ ledger: true });
    await sweepIosOverlap(d);
    expect(d.mailCustomer).toHaveBeenCalledTimes(1);
    expect(d.mailOwner).not.toHaveBeenCalled();
  });
  it('STRIPE_REFUND_ALERTS off: the extra facts are never read and today\'s owner mail goes out unchanged', async () => {
    const d = deps();
    await sweepIosOverlap(d);
    expect(d.accountFacts).not.toHaveBeenCalled();
    expect((d.mailOwner as any).mock.calls[0][3]).toBeUndefined();
  });
  it('a failed facts lookup still alerts, without the extra lines', async () => {
    vi.stubEnv('STRIPE_REFUND_ALERTS', '1'); vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps(); d.accountFacts = vi.fn(async () => { throw new Error('db'); });
    await sweepIosOverlap(d);
    expect((d.mailOwner as any).mock.calls[0][3]).toBeUndefined();
  });
});
