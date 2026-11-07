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
  const inp = { email: 'jake@gmail.com', firstName: 'Jake Lee', shopName: "Jake's Cuts", continueUrl: `${O}/api/web-app/continue?t=TOKEN` };
  const steps = [1, 2, 3] as const;

  it('golden: named + shop, anon + no shop', () => {
    for (const s of steps) expect(signupNudgeEmail(s, inp)).toMatchSnapshot(`step ${s} named shop`);
    for (const s of steps) expect(signupNudgeEmail(s, { ...inp, firstName: null, shopName: null })).toMatchSnapshot(`step ${s} anon no shop`);
  });

  it('subjects follow the approved patterns', () => {
    expect(signupNudgeEmail(1, inp).subject).toBe("Jake, your Jake's Cuts website is saved");
    expect(signupNudgeEmail(1, { ...inp, firstName: null }).subject).toBe("Your Jake's Cuts website is saved");
    expect(signupNudgeEmail(1, { ...inp, firstName: null, shopName: null }).subject).toBe('Your website is saved');
    expect(signupNudgeEmail(2, inp).subject).toBe("Your Jake's Cuts website is still waiting");
    expect(signupNudgeEmail(3, inp).subject).toBe("Still want your Jake's Cuts website?");
  });

  it('content rules: plain letter, one link, no unsubscribe machinery, no prices, no banned words, no em dash', () => {
    for (const s of steps) for (const v of [inp, { ...inp, firstName: null, shopName: null }]) {
      const m = signupNudgeEmail(s, v);
      const all = `${m.subject}\n${m.html}\n${m.text}`;
      expect(all).not.toContain('$');
      expect(all).not.toMatch(/\b(free|urgent|act now|limited time|offer|discount)\b/i);
      expect(all).not.toMatch(/[\u2013\u2014]/);
      expect(all).not.toMatch(/tattoo/i);
      expect(all).not.toMatch(/unsubscribe/i);
      expect(all).not.toMatch(/\bbutton\b/i);
      expect(m.subject).not.toMatch(/!|[A-Z]{4,}/);
      const hrefs = [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
      expect(hrefs).toEqual([v.continueUrl]); // exactly one link, on the app origin
      expect(hrefs[0].startsWith(O)).toBe(true);
      expect(m.html).not.toMatch(/<img|<table|<td|<button|<div|bgcolor|background/i);
      expect(m.text).toContain(`Finish my website: ${v.continueUrl}`);
      expect(m.text.match(/https?:\/\//g)).toHaveLength(1);
      expect(m.headers).toBeUndefined();
      expect(m.tags).toEqual([{ name: 'kind', value: 'signup_nudge' }, { name: 'step', value: String(s) }]);
      expect(m.replyTo).toBe('support@davoxa.com');
      expect(m.from).toBe('Ibrahim from Prime Barber <support@davoxa.com>');
      expect(m.text).toContain('Ibrahim\nPrime Barber\n\nP.S. If you\'d rather not hear from me about this, just reply "stop" and I won\'t email you about it again.');
      expect(m.text.trimEnd().endsWith('again.')).toBe(true); // nothing after the P.S.
      expect(m.html).toContain('Ibrahim<br>Prime Barber');
      expect(m.html).toContain('color:#777777');
    }
  });

  it('From keeps the display name and takes the address from NUDGE_FROM > EMAIL_FROM > default', () => {
    expect(signupNudgeEmail(1, inp).from).toBe('Ibrahim from Prime Barber <support@davoxa.com>');
    process.env.WEB_APP_EMAIL_FROM = 'Prime Barber <e@x.co>';
    expect(signupNudgeEmail(1, inp).from).toBe('Ibrahim from Prime Barber <e@x.co>');
    process.env.WEB_APP_NUDGE_FROM = 'n@x.co';
    expect(signupNudgeEmail(1, inp).from).toBe('Ibrahim from Prime Barber <n@x.co>');
  });

  it('never adds a postal address line, even if an env var is set', () => {
    process.env.WEB_APP_POSTAL_ADDRESS = 'PO Box 1';
    const m = signupNudgeEmail(1, inp);
    expect(`${m.html}\n${m.text}`).not.toContain('PO Box');
    expect(m.text.trimEnd().endsWith('again.')).toBe(true);
  });

  it('escapes a hostile shop name', () => {
    const m = signupNudgeEmail(1, { ...inp, shopName: '<script>x</script>' });
    expect(m.html).not.toContain('<script>');
  });
});
