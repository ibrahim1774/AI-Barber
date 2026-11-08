import { describe, it, expect } from 'vitest';
import type { CustomerRow } from '../../lib/admin/customers.js';
import { safeHttpUrl, safeStripeUrl, skippedSources, canSendReset, emailCells, filterRows, matchesQuery, planLabel, sourceBanner } from '../../lib/admin/customersView.js';

const row = (o: Partial<CustomerRow> = {}): CustomerRow => ({
  key: 'main:u1', family: 'primebarber-web', userId: 'u1', project: 'main', contactEmail: 'mike@x.com', stripeEmail: 'mike@x.com',
  accountEmail: 'mike@x.com', signupEmail: 'm2@x.com', siteUrl: 'https://fade.vercel.app', siteSlug: 'fade-lab', customDomain: null,
  phone: '+15551234567', phoneSource: 'contact', plan: 'bookings', interval: 'year', status: 'active', stripeCustomerId: 'cus_ABC',
  stripeSubscriptionId: 'sub_1', stripeCustomerUrl: null, signedUp: null, lastSignIn: null, authKind: 'password', flags: [], alsoPlans: [], ...o,
});
const F = (o: any = {}) => ({ q: '', families: new Set<any>(), noPhone: false, showTest: false, ...o });

describe('customersView', () => {
  it('search covers emails, slug, stripe id, plan and phone digits (formatted or not)', () => {
    const r = row();
    for (const q of ['mike@x', 'M2@X.COM', 'fade-lab', 'cus_abc', 'bookings', '5551234', '(555) 123-4567', 'web app', 'mike bookings']) expect(matchesQuery(r, q), q).toBe(true);
    for (const q of ['nope', '9999999']) expect(matchesQuery(r, q), q).toBe(false);
  });

  it('test rows are hidden by default; family and no-phone filters apply', () => {
    const rows = [row(), row({ key: 't', flags: ['test'] }), row({ key: 'p', family: 'primehub-pro', flags: ['no-phone'], phone: null })];
    expect(filterRows(rows, F()).map((r) => r.key)).toEqual(['main:u1', 'p']);
    expect(filterRows(rows, F({ showTest: true })).map((r) => r.key)).toEqual(['main:u1', 't', 'p']);
    expect(filterRows(rows, F({ families: new Set(['primehub-pro']) })).map((r) => r.key)).toEqual(['p']);
    expect(filterRows(rows, F({ noPhone: true })).map((r) => r.key)).toEqual(['p']);
  });

  it('email columns show "same" only when equal to the previous column', () => {
    expect(emailCells(row()).map((c) => c.same)).toEqual([false, true, true, false]);
    expect(emailCells(row({ stripeEmail: null })).map((c) => c.same)).toEqual([false, false, false, false]);
  });

  it('password reset is hidden for Pro rows and rows without a userId', () => {
    expect(canSendReset(row())).toBe(true);
    expect(canSendReset(row({ project: 'pro' }))).toBe(false);
    expect(canSendReset(row({ userId: null }))).toBe(false);
  });

  it('banner lists every source that is not ok', () => {
    expect(sourceBanner({ auth: 'ok', stripe: 'partial', pro: 'skipped', contacts: 'error' })).toEqual(['stripe: partial', 'contacts: error']);
    expect(sourceBanner({ auth: 'ok', pro: 'skipped', proStripe: 'skipped', proContacts: 'skipped' })).toEqual([]);
    expect(skippedSources({ auth: 'ok', pro: 'skipped' })).toEqual(['pro']);
  });

  it('plan label joins plan and interval', () => {
    expect(planLabel(row())).toBe('bookings · year');
    expect(planLabel(row({ interval: null }))).toBe('bookings');
    expect(planLabel(row({ plan: null }))).toBe('');
  });

  it('only http(s) site URLs become links; stripe links need a real cus_ id', () => {
    expect(safeHttpUrl('https://a.com')).toBe('https://a.com');
    expect(safeHttpUrl('HTTP://a.com')).toBe('HTTP://a.com');
    for (const u of ['javascript:alert(1)', 'data:text/html,x', 'a.com', '', null, undefined]) expect(safeHttpUrl(u as any), String(u)).toBeNull();
    expect(safeStripeUrl({ stripeCustomerId: 'cus_Ab1', stripeCustomerUrl: 'https://dashboard.stripe.com/customers/cus_Ab1' })).toBeTruthy();
    expect(safeStripeUrl({ stripeCustomerId: 'cus_Ab1', stripeCustomerUrl: 'https://dashboard.stripe.com/test/customers/cus_Ab1' })).toBeTruthy();
    expect(safeStripeUrl({ stripeCustomerId: 'x"y', stripeCustomerUrl: 'https://dashboard.stripe.com/customers/x"y' })).toBeNull();
    expect(safeStripeUrl({ stripeCustomerId: 'cus_1', stripeCustomerUrl: null })).toBeNull();
  });
});
