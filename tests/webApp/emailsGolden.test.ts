// Golden snapshots: any accidental change to the exact output of a customer email fails here.
// Update with `vitest -u` only when a wording or layout change is intended.
import { afterEach, describe, expect, it } from 'vitest';
import { alertMail, duplicateRefundEmail, failedPaymentEmail, iosOverlapEmail, replyToAddress, welcomeEmail } from '../../lib/webApp/emails';
import { ownerEmailFor } from '../../lib/webApp/ownerNotify';

const O = 'https://www.aibarber.org';
const site = 'https://joes.vercel.app';
const base = { email: 'a@b.co', siteUrl: site, tier: 'bookings' };
const OWNER_EVENT = { kind: 'booking_created', customerName: 'Jake', service: 'Cut', whenShort: 'Sat 3:00 PM', whenLong: 'Saturday, October 24 at 3:00 PM' } as any;
const ORIG = process.env.WEB_APP_REPLY_TO;
afterEach(() => { if (ORIG === undefined) delete process.env.WEB_APP_REPLY_TO; else process.env.WEB_APP_REPLY_TO = ORIG; });

describe('golden email output (env unset)', () => {
  beforeEach(() => { delete process.env.WEB_APP_REPLY_TO; });
  it('welcome, every tier, with and without name and site', () => {
    expect(welcomeEmail({ ...base, firstName: 'Jake Lee' }, O)).toMatchSnapshot('bookings named');
    expect(welcomeEmail({ ...base, tier: 'website', siteUrl: null }, O)).toMatchSnapshot('website anon no site');
    expect(welcomeEmail({ ...base, tier: 'store' }, O)).toMatchSnapshot('store');
  });
  it('duplicate refund and iOS overlap', () => {
    expect(duplicateRefundEmail(base, O)).toMatchSnapshot('refund');
    expect(iosOverlapEmail(base, O)).toMatchSnapshot('ios overlap with site');
    expect(iosOverlapEmail({ ...base, siteUrl: null }, O)).toMatchSnapshot('ios overlap no site');
  });
  it('alert mail', () => {
    expect(alertMail('Subject <x>', ['line 1', 'a & b'])).toMatchSnapshot();
  });
  it('failed payment: first, reminder, no name, no site', () => {
    expect(failedPaymentEmail({ ...base, firstName: 'Jack Smith', updateUrl: 'https://invoice.stripe.com/i/x' }, O)).toMatchSnapshot('first');
    expect(failedPaymentEmail({ ...base, reminder: 2, updateUrl: 'https://invoice.stripe.com/i/x' }, O)).toMatchSnapshot('reminder no name');
    expect(failedPaymentEmail({ email: 'a@b.co', siteUrl: null, tier: 'store' }, O)).toMatchSnapshot('no site, sign-in fallback');
  });
  it('owner email', () => {
    expect(ownerEmailFor(OWNER_EVENT, 'Ibrahim', O)).toMatchSnapshot();
  });
});

describe('failed-payment html escaping', () => {
  it('escapes hostile site, tier and update url', () => {
    const m = failedPaymentEmail({ email: 'a@b.co', siteUrl: 'https://x.app/<x>"', tier: 'nope<i>', updateUrl: 'https://s.co/i?a=1&b="c' }, O);
    expect(m.html).not.toContain('<x>');
    expect(m.html).not.toContain('<i>');
    expect(m.html).toContain('href="https://s.co/i?a=1&amp;b=&quot;c"');
    expect(m.html.match(/href="/g)).toHaveLength(1);
  });
});

describe('Reply-To from WEB_APP_REPLY_TO', () => {
  it('unset or blank: support@davoxa.com on failed-payment and owner mail', () => {
    delete process.env.WEB_APP_REPLY_TO;
    expect(replyToAddress()).toBe('support@davoxa.com');
    expect(failedPaymentEmail(base, O).replyTo).toBe('support@davoxa.com');
    process.env.WEB_APP_REPLY_TO = '   ';
    expect(replyToAddress()).toBe('support@davoxa.com');
  });
  it('set: used by failed-payment and owner mail, welcome stays without one', () => {
    process.env.WEB_APP_REPLY_TO = 'help@primebarber.org';
    expect(failedPaymentEmail(base, O).replyTo).toBe('help@primebarber.org');
    const o = ownerEmailFor(OWNER_EVENT, 'Ibrahim', O);
    expect(o.replyTo).toBe('help@primebarber.org');
    expect(welcomeEmail(base, O).replyTo).toBeUndefined();
  });
});
