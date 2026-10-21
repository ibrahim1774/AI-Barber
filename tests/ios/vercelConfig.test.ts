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
});
