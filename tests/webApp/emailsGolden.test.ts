// Golden snapshots: any accidental change to the exact output of a customer email fails here.
// Update with `vitest -u` only when a wording or layout change is intended.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { alertMail, duplicateRefundEmail, failedPaymentEmail, iosOverlapEmail, replyToAddress, signupNudgeEmail, welcomeEmail } from '../../lib/webApp/emails';
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

describe('signup nudge emails', () => {
  const ENV_KEYS = ['WEB_APP_REPLY_TO', 'WEB_APP_NUDGE_FROM', 'WEB_APP_EMAIL_FROM', 'WEB_APP_POSTAL_ADDRESS'] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
  const inp = { email: 'jake@gmail.com', firstName: 'Jake Lee', shopName: "Jake's Cuts", continueUrl: `${O}/api/web-app/continue?t=TOKEN`, unsubscribeUrl: `${O}/api/web-app/unsubscribe?t=UTOKEN` };
  const steps = [1, 2, 3] as const;

  it('golden: named + shop, anon + no shop, with postal address', () => {
    for (const s of steps) expect(signupNudgeEmail(s, inp)).toMatchSnapshot(`step ${s} named shop`);
    for (const s of steps) expect(signupNudgeEmail(s, { ...inp, firstName: null, shopName: null })).toMatchSnapshot(`step ${s} anon no shop`);
    process.env.WEB_APP_POSTAL_ADDRESS = 'PO Box 1, Town, ST 12345';
    expect(signupNudgeEmail(1, inp)).toMatchSnapshot('step 1 postal');
  });

  it('subjects follow the approved patterns', () => {
    expect(signupNudgeEmail(1, inp).subject).toBe("Jake, your Jake's Cuts website is saved");
    expect(signupNudgeEmail(1, { ...inp, firstName: null }).subject).toBe("Your Jake's Cuts website is saved");
    expect(signupNudgeEmail(1, { ...inp, firstName: null, shopName: null }).subject).toBe('Your website is saved');
    expect(signupNudgeEmail(2, inp).subject).toBe("Your Jake's Cuts website is still waiting");
    expect(signupNudgeEmail(3, inp).subject).toBe("Still want your Jake's Cuts website?");
  });

  it('content rules: no prices, no banned words, no em dash, one origin link, text mirrors, headers', () => {
    for (const s of steps) for (const v of [inp, { ...inp, firstName: null, shopName: null }]) {
      const m = signupNudgeEmail(s, v);
      const all = `${m.subject}\n${m.html}\n${m.text}`;
      expect(all).not.toContain('$');
      expect(all).not.toMatch(/\b(free|urgent|act now|limited time|offer|discount)\b/i);
      expect(all).not.toMatch(/[\u2013\u2014]/);
      expect(all).not.toMatch(/tattoo/i);
      expect(m.subject).not.toMatch(/!|[A-Z]{4,}/);
      const hrefs = [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
      expect(hrefs).toHaveLength(2);
      for (const h of hrefs) expect(h.startsWith(O)).toBe(true);
      expect(m.html).not.toMatch(/<img/i);
      expect(m.text).toContain(`Finish my website: ${v.continueUrl}`);
      expect(m.text).toContain(`Unsubscribe: ${v.unsubscribeUrl}`);
      expect(m.headers!['List-Unsubscribe']).toBe(`<${v.unsubscribeUrl}>, <mailto:support@davoxa.com?subject=unsubscribe>`);
      expect(m.headers!['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(m.tags).toEqual([{ name: 'kind', value: 'signup_nudge' }, { name: 'step', value: String(s) }]);
      expect(m.replyTo).toBe('support@davoxa.com');
      expect(m.text).toContain('Ibrahim\nPrime Barber');
    }
  });

  it('postal line only when configured; sender chain NUDGE_FROM > EMAIL_FROM > default', () => {
    expect(signupNudgeEmail(1, inp).text).not.toContain('PO Box');
    process.env.WEB_APP_POSTAL_ADDRESS = 'PO Box 1';
    expect(signupNudgeEmail(1, inp).text).toContain('Prime Barber, PO Box 1');
    expect(signupNudgeEmail(1, inp).html).toContain('Prime Barber, PO Box 1');
    expect(signupNudgeEmail(1, inp).from).toBe('Prime Barber <support@davoxa.com>');
    process.env.WEB_APP_EMAIL_FROM = 'E <e@x.co>';
    expect(signupNudgeEmail(1, inp).from).toBe('E <e@x.co>');
    process.env.WEB_APP_NUDGE_FROM = 'N <n@x.co>';
    expect(signupNudgeEmail(1, inp).from).toBe('N <n@x.co>');
  });

  it('escapes a hostile shop name', () => {
    const m = signupNudgeEmail(1, { ...inp, shopName: '<script>x</script>' });
    expect(m.html).not.toContain('<script>');
  });
});
