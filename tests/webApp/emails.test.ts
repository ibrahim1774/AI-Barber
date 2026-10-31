import { describe, expect, it } from 'vitest';
import { failedPaymentEmail, resetLink, signInLink, welcomeEmail } from '../../lib/webApp/emails';

const O = 'https://www.aibarber.org';
const site = 'https://joes.vercel.app';
describe('web app emails', () => {
  it('welcome: short subject saying what they signed up for, with site, account, sign-in and reset links, no password', () => {
    const m = welcomeEmail({ email: 'a@b.co', siteUrl: site, tier: 'website' }, O);
    expect(m.subject).toBe('You signed up for website hosting');
    expect(m.subject.length).toBeLessThanOrEqual(50);
    for (const part of [site, 'a@b.co', signInLink(O), resetLink(O)]) { expect(m.html).toContain(part); expect(m.text).toContain(part); }
    expect(m.text).toContain('We never email passwords');
    expect(m.html.toLowerCase()).not.toMatch(/password:/);
  });
  it('welcome names the plan contents', () => {
    expect(welcomeEmail({ email: 'a@b.co', siteUrl: null, tier: 'bookings' }, O).subject).toBe('You signed up for website hosting + bookings');
    expect(welcomeEmail({ email: 'a@b.co', siteUrl: null, tier: 'store' }, O).subject).toMatch(/store/);
  });
  it('failed payment: concise subject warning of losing access, site shown, one button to sign in', () => {
    const m = failedPaymentEmail({ email: 'a@b.co', siteUrl: site, tier: 'website' }, O);
    expect(m.subject).toBe("Payment failed: you'll lose access to your site");
    expect(m.subject.length).toBeLessThanOrEqual(50);
    expect(m.html).toContain(site.replace('https://', ''));
    expect(m.text).toContain(site);
    expect(m.html).toContain(signInLink(O));
  });
  it('omits the site row when there is no site yet', () => {
    expect(failedPaymentEmail({ email: 'a@b.co', siteUrl: null, tier: 'store' }, O).text).not.toContain('Site:');
  });
  it('escapes html in the account email', () => {
    expect(welcomeEmail({ email: '<b>x</b>@y.co', siteUrl: null, tier: 'website' }, O).html).not.toContain('<b>x</b>');
  });
});
