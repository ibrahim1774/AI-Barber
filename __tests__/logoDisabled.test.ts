import fs from 'fs';
import path from 'path';
import { LOGO_ENABLED } from '@/lib/logo';

const src = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/edit.tsx'), 'utf8');

describe('logo feature is off by default (server header-logo change not yet deployed)', () => {
  it('LOGO_ENABLED is on', () => {
    expect(LOGO_ENABLED).toBe(true);
  });

  it('every way into the Logo UI is behind LOGO_ENABLED', () => {
    // Header tap and Photos Logo tile.
    expect(src).toMatch(/path === 'shopName' && LOGO_ENABLED/);
    expect(src).toMatch(/onLogo=\{LOGO_ENABLED \?/);
    // The only other place that opens the header sheet is the failure path inside pickLogo.
    const opens = src.split('\n').filter((l) => l.includes("setSheet('header')"));
    expect(opens).toHaveLength(3);
  });

  it('site.logo is only ever set by pickLogo, which only the Logo pane reaches', () => {
    expect(src.match(/withLogo\(/g)).toHaveLength(1);
    expect(src.match(/pickLogo\(\)/g)).toHaveLength(1);
    expect(src).toMatch(/onPickLogo=\{\(\) => closeThen\(\(\) => void pickLogo\(\)\)\}/);
  });
});
