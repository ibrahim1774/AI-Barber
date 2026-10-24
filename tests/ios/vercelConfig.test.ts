import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8'));

describe('vercel.json', () => {
  it('iOS publish gets the same 300 s budget as web deploy-site (a deploy can take ~150 s)', () => {
    expect(cfg.functions['api/ios/publish.ts'].maxDuration).toBe(300);
    expect(cfg.functions['api/ios/publish.ts'].includeFiles).toBe('lib/ios/certs/**');
  });

  it('iOS sweep can verify with Apple (root certs bundled) and keeps its 300 s budget', () => {
    expect(cfg.functions['api/ios/sweep.ts'].maxDuration).toBe(300);
    expect(cfg.functions['api/ios/sweep.ts'].includeFiles).toBe('lib/ios/certs/**');
  });

  it('shop/plan can verify with Apple (root certs bundled), like shop/setup', () => {
    expect(cfg.functions['api/shop/plan.ts'].includeFiles).toBe('lib/ios/certs/**');
    expect(cfg.functions['api/shop/setup.ts'].includeFiles).toBe('lib/ios/certs/**');
  });

  it('custom domains: claim verifies with Apple and may republish (300 s); status verifies with Apple', () => {
    expect(cfg.functions['api/ios/domain/claim.ts'].maxDuration).toBe(300);
    expect(cfg.functions['api/ios/domain/claim.ts'].includeFiles).toBe('lib/ios/certs/**');
    expect(cfg.functions['api/ios/domain/status.ts'].includeFiles).toBe('lib/ios/certs/**');
  });

  it('the domain sweep is its own cron with its own 300 s budget (independent of the site sweep)', () => {
    expect(cfg.crons).toContainEqual({ path: '/api/ios/domain-sweep', schedule: '*/10 * * * *' });
    expect(cfg.functions['api/ios/domain-sweep.ts'].maxDuration).toBe(300);
    expect(cfg.functions['api/ios/domain-sweep.ts'].includeFiles).toBe('lib/ios/certs/**');
  });

  it('the website domain purchase and the Stripe webhook may run a domain claim (300 s)', () => {
    expect(cfg.functions['api/purchase-domain.ts'].maxDuration).toBe(300);
    expect(cfg.functions['api/stripe-webhook.ts'].maxDuration).toBe(300);
  });

  it('apple-notification bundles the certs (it now also routes the domain product)', () => {
    expect(cfg.functions['api/ios/apple-notification.ts'].includeFiles).toBe('lib/ios/certs/**');
  });

  it('/api/deploy-site gets 300 s like the other deploy paths (READY wait + domain and DNS checks after the deploy)', () => {
    expect(cfg.functions['api/deploy-site.ts'].maxDuration).toBe(300);
  });

  it('the allow-list tests\' matcher is pinned to the path-to-regexp Vercel uses', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.devDependencies['path-to-regexp-updated']).toBe('npm:path-to-regexp@6.3.0');
    const lock = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf8'));
    expect(lock.packages[''].devDependencies['path-to-regexp-updated']).toBe('npm:path-to-regexp@6.3.0');
  });

  it('admin site edits get 300 s: republish-all batches deploy several sites per call', () => {
    expect(cfg.functions['api/admin/sites.ts'].maxDuration).toBe(300);
  });
});
