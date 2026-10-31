import { describe, expect, it } from 'vitest';
import { failedPaymentEmail, resetLink, signInLink, welcomeEmail } from '../../lib/webApp/emails';

const O = 'https://www.aibarber.org';
describe('web app emails', () => {
  it('welcome carries site, email, sign-in and reset links, and no password', () => {
    const m = welcomeEmail({ email: 'a@b.co', siteUrl: 'https://joes.vercel.app', tier: 'bookings' }, O);
    for (const part of ['https://joes.vercel.app', 'a@b.co', signInLink(O), resetLink(O)]) expect(m.html).toContain(part);
    for (const part of ['https://joes.vercel.app', 'a@b.co', signInLink(O), resetLink(O)]) expect(m.text).toContain(part);
    expect(m.html.toLowerCase()).not.toMatch(/password:/);
    expect(m.text).toContain('We never email passwords');
  });
  it('failed payment email says so and links to sign-in', () => {
    const m = failedPaymentEmail({ email: 'a@b.co', siteUrl: null, tier: 'store' }, O);
    expect(m.subject).toMatch(/failed/i);
    expect(m.html).toContain(signInLink(O));
    expect(m.html).not.toContain('Your site');
  });
  it('escapes html in the email address', () => {
    expect(welcomeEmail({ email: '<b>x</b>@y.co', siteUrl: null, tier: 'website' }, O).html).not.toContain('<b>x</b>');
  });
});
