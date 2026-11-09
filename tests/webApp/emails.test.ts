import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TIER_NAME, failedPaymentEmail, resetLink, signInLink, welcomeEmail } from '../../lib/webApp/emails';

const O = 'https://www.aibarber.org';
const site = 'https://joes.vercel.app';
const ORIG_REPLY_TO = process.env.WEB_APP_REPLY_TO;
beforeEach(() => { delete process.env.WEB_APP_REPLY_TO; });
afterEach(() => { if (ORIG_REPLY_TO === undefined) delete process.env.WEB_APP_REPLY_TO; else process.env.WEB_APP_REPLY_TO = ORIG_REPLY_TO; });
describe('web app emails', () => {
  it('welcome: short subject saying what they signed up for, with site, account, sign-in and reset links, no password', () => {
    const m = welcomeEmail({ email: 'a@b.co', siteUrl: site, tier: 'website' }, O);
    expect(m.subject).toBe('Welcome! Barber plan active');
    expect(m.text).toContain('Plan: Website');
    expect(m.text).not.toContain('Custom site');
    for (const part of [site, 'a@b.co', signInLink(O), resetLink(O)]) { expect(m.html).toContain(part); expect(m.text).toContain(part); }
    expect(m.text).toContain('We never email passwords');
    expect(m.html.toLowerCase()).not.toMatch(/password:/);
  });
  it('welcome: personal fixed subject; the body names the plan', () => {
    const m = welcomeEmail({ email: 'a@b.co', firstName: 'Jake Lee', siteUrl: null, tier: 'bookings' }, O);
    expect(m.subject).toBe('Welcome Jake! Barber plan active');
    expect(m.text).toContain('Plan: Bookings');
    expect(m.text).toContain('Your plan is active: Bookings.');
    expect(welcomeEmail({ email: 'a@b.co', siteUrl: null, tier: 'store' }, O).text).toContain('Plan: Store');
  });
  it('failed payment: calm subject, headline and lead; single sign-in link on our own site (never Stripe); reply-to; text mirror', () => {
    const m = failedPaymentEmail({ email: 'a@b.co', firstName: 'Jack Smith', siteUrl: site, tier: 'website', updateUrl: 'https://invoice.stripe.com/i/x' }, O);
    expect(m.subject).toBe('Jack, about your Prime Barber plan');
    expect(m.html).toContain('Your renewal needs attention');
    expect(m.text).toContain("The renewal for your barber site hosting didn't complete. To keep your site online, sign in and open Billing to check your details.");
    expect(m.html).toContain('joes.vercel.app');
    expect(m.html.match(/href="/g)).toHaveLength(1);
    expect(m.html).toContain(`href="${signInLink(O)}"`);
    expect(m.html + m.text).not.toContain('stripe.com');
    expect(m.text).toContain(`Sign in to Prime Barber: ${signInLink(O)}`);
    for (const t of [m.subject, m.html, m.text]) expect(t).not.toMatch(/didn't go through|update (your )?card|payment method|payment failed/i);
    expect(m.html).not.toContain(resetLink(O));
    expect(m.html).not.toContain('display:none');
    expect(m.html).not.toContain('Forgot your password');
    expect(m.replyTo).toBe('support@davoxa.com');
    for (const t of [m.subject, m.html, m.text]) expect(t.toLowerCase()).not.toMatch(/lose your site|at risk|offline|urgent/);
    for (const t of [m.subject, m.text]) expect(t).not.toContain('!');
    expect(m.subject).not.toMatch(/[A-Z]{4,}/);
  });
  it('failed payment: no name falls back, reminders are labelled, no update url falls back to sign-in', () => {
    const m = failedPaymentEmail({ email: 'a@b.co', siteUrl: null, tier: 'website', reminder: 2 }, O);
    expect(m.subject).toBe('About your Prime Barber plan');
    expect(m.html).toContain(`href="${signInLink(O)}"`);
    expect(m.html.match(/href="/g)).toHaveLength(1);
    expect(m.html).toContain('Your renewal still needs attention');
  });
  it('omits the site row when there is no site yet', () => {
    expect(failedPaymentEmail({ email: 'a@b.co', siteUrl: null, tier: 'store' }, O).text).not.toContain('Site:');
  });
  it('welcome keeps the original dark layout; failed-payment uses the plain light layout', () => {
    const w = welcomeEmail({ email: 'a@b.co', siteUrl: site, tier: 'website' }, O);
    expect(w.replyTo).toBeUndefined();
    expect(w.html).toContain('Forgot your password?');
    expect(w.html).toContain('display:none');
    expect(w.html).toContain('background:#0d0d0d');
    const f = failedPaymentEmail({ email: 'a@b.co', siteUrl: site, tier: 'website' }, O);
    expect(f.html).not.toContain('#0d0d0d');
    expect(f.html).toContain('background:#ffffff');
  });
  it('plan labels match the paywall names (Website / Bookings / Store) in every mail that names the plan', () => {
    for (const [tier, label] of [['website', 'Website'], ['bookings', 'Bookings'], ['store', 'Store']] as const) {
      expect(TIER_NAME[tier]).toBe(label);
      const w = welcomeEmail({ email: 'a@b.co', siteUrl: null, tier }, O);
      expect(w.text).toContain(`Plan: ${label}`); expect(w.html).toContain(`Your plan: ${label}.`);
      expect(failedPaymentEmail({ email: 'a@b.co', siteUrl: null, tier }, O).text).toContain(`Plan: ${label}`);
      expect(w.html + w.text).not.toMatch(/Custom site/);
    }
  });
  it('welcome: live site link when known (one site link, plus the sign-in and reset links), none when unknown; no extra headers', () => {
    const w = welcomeEmail({ email: 'a@b.co', siteUrl: site, tier: 'website' }, O);
    expect(w.html.match(/href="https:\/\/joes\.vercel\.app"/g)).toHaveLength(1);
    expect(w.text).toContain(`Site: ${site}`);
    expect(w.html.match(/href="/g)).toHaveLength(3);
    const n = welcomeEmail({ email: 'a@b.co', siteUrl: null, tier: 'website' }, O);
    expect(n.text).not.toContain('Site:'); expect(n.html).not.toContain('joes'); expect(n.html.match(/href="/g)).toHaveLength(2);
    expect(w.headers).toBeUndefined();
    expect(w.html.toLowerCase()).not.toMatch(/italic|<i>|<em>|unsubscribe/);
  });
  it('welcome: never greets by a shop-style word; only the given first name', () => {
    expect(welcomeEmail({ email: 'a@b.co', firstName: null, siteUrl: null, tier: 'website' }, O).subject).toBe('Welcome! Barber plan active');
    expect(welcomeEmail({ email: 'a@b.co', firstName: '', siteUrl: null, tier: 'website' }, O).subject).toBe('Welcome! Barber plan active');
  });
  it('escapes html in the account email', () => {
    expect(welcomeEmail({ email: '<b>x</b>@y.co', siteUrl: null, tier: 'website' }, O).html).not.toContain('<b>x</b>');
  });
});
