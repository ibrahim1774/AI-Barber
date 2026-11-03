import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { newCheckoutMethodParams } from '../lib/checkoutPaymentMethods';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });
afterEach(() => vi.unstubAllEnvs());

describe('new PrimeHub checkouts use the "no Cash App Pay" payment method configuration', () => {
  it('passes the configured pmc, and nothing when unset or malformed', () => {
    expect(newCheckoutMethodParams({ STRIPE_NEW_CHECKOUT_PMC: 'pmc_1UXkuqBDYfWlyCVaR652SJnC' })).toEqual({ payment_method_configuration: 'pmc_1UXkuqBDYfWlyCVaR652SJnC' });
    expect(newCheckoutMethodParams({})).toEqual({});
    expect(newCheckoutMethodParams({ STRIPE_NEW_CHECKOUT_PMC: ' ' })).toEqual({});
    expect(newCheckoutMethodParams({ STRIPE_NEW_CHECKOUT_PMC: 'cashapp' })).toEqual({});
  });

  it('every PrimeHub new-subscription checkout uses it; never the removed/too-new params', () => {
    for (const f of ['api/create-checkout-session.ts', 'api/web-app/checkout.ts', 'lib/webDomains.ts']) {
      expect(readFileSync(f, 'utf8'), f).toMatch(/newCheckoutMethodParams\(\)/);
    }
    for (const f of [...walk('api'), ...walk('lib')].filter((f) => !f.endsWith('checkoutPaymentMethods.ts'))) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/excluded_payment_method_types/);
      // existing subscriptions untouched: nothing edits configurations or subscription payment settings
      expect(src, f).not.toMatch(/\/payment_method_configurations/);
      expect(src, f).not.toMatch(/payment_settings\]?\[payment_method_types/);
    }
  });
});
