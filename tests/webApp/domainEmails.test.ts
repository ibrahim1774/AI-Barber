// The exact texts of the manual-domain mails (lib/webApp/domainEmails.ts).
import { describe, it, expect } from 'vitest';
import {
  FULFIL_PROMISE, customerLiveEmail, customerOrderedEmail, customerRefundedEmail, endedEmail, orderEmail, orderReminderEmail, orderVoidEmail,
  renewalDueEmail, type OrderFacts,
} from '../../lib/webApp/domainEmails.js';

const F: OrderFacts = {
  domain: 'freshcuts.com', slug: 'fresh-cuts', project: 'ab-fresh-cuts', liveUrl: 'https://fresh-cuts.vercel.app', customerEmail: 'shop@customer.test', shopName: 'Fresh Cuts',
  subscriptionId: 'sub_m1', stripeCustomerId: 'cus_1', testMode: false, createdAt: '2026-11-07T10:00:00.000Z', priceNote: 'available, $11.25 first year, $11.25 renewal',
  ownDetached: false, paidUntil: '2027-11-07T10:00:00.000Z', teamSlug: 'team-x',
};
const L = { live: 'https://api.example.test/api/web-app/domain-action?t=LIVE', cant: 'https://api.example.test/api/web-app/domain-action?t=CANT' };
const O = 'https://app.example.test';

describe('emails', () => {
  it('the promise wording is exactly the decided one', () => {
    expect(FULFIL_PROMISE).toBe('usually within 1 business day, up to 3 business days');
  });

  it('every mail has a text part that matches its HTML (links become anchors) and no card data', () => {
    const mails = [orderEmail(F, L), orderReminderEmail(F, L), orderVoidEmail(F, L, 'subscription'), orderVoidEmail(F, null, 'owner-removed'), endedEmail(F, L.live), renewalDueEmail(F, '2027-11-07T10:00:00.000Z'), customerOrderedEmail(F, O), customerLiveEmail(F, O), customerRefundedEmail(F, O)];
    for (const m of mails) {
      expect(m.text.length).toBeGreaterThan(40);
      expect(m.html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')).toBe(m.text);
      expect(m.text + m.html).not.toMatch(/4242|last4|card number|sk_(live|test)|whsec_/i);
    }
  });

  it('operator mails: links only when given; test mode is flagged', () => {
    expect(orderEmail(F, L).text).toContain(L.live);
    expect(orderEmail(F, L).text).toContain(L.cant);
    expect(orderEmail(F, null).text).not.toContain('domain-action');
    expect(orderEmail(F, null).text).toContain('DOMAIN_ADMIN_LINK_SECRET is not set');
    expect(orderEmail({ ...F, testMode: true }, L).text).toContain('TEST MODE');
    expect(orderEmail({ ...F, testMode: true }, L).text).toContain('dashboard.stripe.com/test/subscriptions/sub_m1');
  });

  it('exact customer texts', () => {
    expect(customerOrderedEmail(F, O).subject).toBe("We're setting up freshcuts.com");
    expect(customerOrderedEmail(F, O).text).toBe([
      "Thanks for your order. We're setting up freshcuts.com for your website by hand. This is usually within 1 business day, up to 3 business days. We'll email you again as soon as it's live.",
      '',
      'Until then your current address keeps working: https://fresh-cuts.vercel.app',
      '',
      'Your $39/year subscription renews every year until you cancel it. You can cancel or manage it here: https://app.example.test/app/domain',
      "If we can't get this exact name, we'll refund your $39 in full and you can pick another.",
      '',
      'Questions? Reply to this email.',
    ].join('\n'));
    expect(customerLiveEmail(F, O).subject).toBe('freshcuts.com is live');
    expect(customerLiveEmail(F, O).text).toBe([
      'Your website is now live at https://freshcuts.com',
      '',
      'Your previous address keeps working too: https://fresh-cuts.vercel.app',
      '',
      'Your $39/year subscription renews every year (next on 2027-11-07) until you cancel it. If you cancel, the domain keeps working until the paid year ends. Manage it here: https://app.example.test/app/domain',
      '',
      'Questions? Reply to this email.',
    ].join('\n'));
    expect(customerRefundedEmail(F, O).subject).toBe('Your $39 for freshcuts.com was refunded');
    expect(customerRefundedEmail(F, O).text).toContain('Your $39 has been refunded in full and the subscription is cancelled.');
    for (const m of [customerOrderedEmail(F, O), customerLiveEmail(F, O), customerRefundedEmail(F, O)]) expect(m.text).not.toMatch(/\/mo\b|per month|a month|monthly/i);
  });
});
