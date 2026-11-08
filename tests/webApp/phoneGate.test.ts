import { describe, it, expect } from 'vitest';
import { needsPhone } from '../../lib/webApp/phoneGate.js';

const base = { flag: true, phone: null as string | null, entitlementRows: [] as { status: string }[], hasCheckout: false };

describe('needsPhone', () => {
  it('is false when the flag is off, whatever else is true', () => {
    expect(needsPhone({ ...base, flag: false, entitlementRows: [{ status: 'active' }], hasCheckout: true })).toBe(false);
  });
  it('is true for an entitled user with no phone', () => {
    for (const status of ['active', 'trialing', 'past_due']) expect(needsPhone({ ...base, entitlementRows: [{ status }] })).toBe(true);
  });
  it('is false once a phone is on file', () => {
    expect(needsPhone({ ...base, phone: '+15552345678', entitlementRows: [{ status: 'active' }] })).toBe(false);
  });
  it('treats an empty or blank phone as missing', () => {
    expect(needsPhone({ ...base, phone: '  ', entitlementRows: [{ status: 'active' }] })).toBe(true);
    expect(needsPhone({ ...base, phone: '', entitlementRows: [{ status: 'active' }] })).toBe(true);
  });
  it('is false for a user who never paid (no entitlement, no checkout)', () => {
    expect(needsPhone(base)).toBe(false);
    expect(needsPhone({ ...base, entitlementRows: [{ status: 'canceled' }, { status: 'incomplete_expired' }] })).toBe(false);
  });
  it('is true for a just-paid user whose entitlement has not landed yet', () => {
    expect(needsPhone({ ...base, hasCheckout: true })).toBe(true);
  });
});
