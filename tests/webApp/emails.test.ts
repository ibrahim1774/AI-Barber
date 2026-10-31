import { describe, expect, it } from 'vitest';
import { failedPaymentEmail, resetLink, signInLink, welcomeEmail } from '../../lib/webApp/emails';

const O = 'https://www.aibarber.org';
const site = 'https://joes.vercel.app';
describe('web app emails', () => {
  it('welcome: short subject saying what they signed up for, with site, account, sign-in and reset links, no password', () => {
    const m = welcomeEmail({ email: 'a@b.co', siteUrl: site, tier: 'website' }, O);
    expect(m.subject).toBe('You signed up for barber site hosting');
    for (const part of [site, 'a@b.co', signInLink(O), resetLink(O)]) { expect(m.html).toContain(part); expect(m.text).toContain(part); }
    expect(m.text).toContain('We never email passwords');
    expect(m.html.toLowerCase()).not.toMatch(/password:/);
  });
  it('welcome names the plan contents', () => {
    expect(welcomeEmail({ email: 'a@b.co', firstName: 'Jack', siteUrl: null, tier: 'bookings' }, O).subject).toBe('Jack, you signed up for barber booking + site plan');
    expect(welcomeEmail({ email: 'a@b.co', siteUrl: null, tier: 'store' }, O).subject).toMatch(/store/);
  });
  it('failed payment: first name + barber hosting subject, bare URL, Stripe update button, sign-in link', () => {
    const m = failedPaymentEmail({ email: 'a@b.co', firstName: 'Jack Smith', siteUrl: site, tier: 'website', updateUrl: 'https://invoice.stripe.com/i/x' }, O);
    expect(m.subject).toBe('Jack, your barber site hosting payment failed');
    expect(m.html).toContain('>joes.vercel.app<');
    expect(m.html).toContain('href="https://invoice.stripe.com/i/x"');
    expect(m.html).toContain('Update payment method');
    expect(m.html).toContain(signInLink(O));
    expect(m.text).toContain('lose your site');
  });
  it('failed payment: no name falls back, reminders are labelled, no update url falls back to sign-in', () => {
    const m = failedPaymentEmail({ email: 'a@b.co', siteUrl: null, tier: 'website', reminder: 2 }, O);
    expect(m.subject).toBe('Reminder: Your barber site hosting payment failed');
    expect(m.html).toContain(`href="${signInLink(O)}"`);
  });
  it('omits the site row when there is no site yet', () => {
    expect(failedPaymentEmail({ email: 'a@b.co', siteUrl: null, tier: 'store' }, O).text).not.toContain('Site:');
  });
  it('escapes html in the account email', () => {
    expect(welcomeEmail({ email: '<b>x</b>@y.co', siteUrl: null, tier: 'website' }, O).html).not.toContain('<b>x</b>');
  });
});
