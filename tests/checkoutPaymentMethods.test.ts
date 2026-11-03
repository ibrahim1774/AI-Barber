import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { EXCLUDED_NEW_CHECKOUT_METHODS, excludedMethodParams } from '../lib/checkoutPaymentMethods';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });

describe('new PrimeHub checkouts leave out Cash App Pay', () => {
  it('excludes exactly cashapp', () => {
    expect(EXCLUDED_NEW_CHECKOUT_METHODS).toEqual(['cashapp']);
    expect(excludedMethodParams()).toEqual({ 'excluded_payment_method_types[0]': 'cashapp' });
  });

  it('the old-site plan checkout passes the exclusion on its session', () => {
    const src = readFileSync('api/create-checkout-session.ts', 'utf8');
    expect(src).toMatch(/for \(const \[k, v\] of Object\.entries\(excludedMethodParams\(\)\)\) params\.append\(k, v\);/);
  });

  it('existing subscriptions are untouched: nothing edits account payment method configs, invoice settings or subscription payment settings', () => {
    for (const f of [...walk('api'), ...walk('lib')]) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/payment_method_configurations/);
      expect(src, f).not.toMatch(/payment_settings\]?\[payment_method_types/);
    }
  });
});
