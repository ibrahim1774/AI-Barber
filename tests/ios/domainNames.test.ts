import { describe, it, expect } from 'vitest';
import { MAX_PRICE_USD, candidateDomains, eligiblePrice, isComDomain, normalizeLabel } from '../../lib/ios/domainNames.js';

describe('normalizeLabel', () => {
  it.each([
    ['Fresh Cuts', 'freshcuts'],
    ['  FRESH-cuts  ', 'fresh-cuts'],
    ["Joe's Barbershop", 'joesbarbershop'],
    ['https://www.freshcuts.com/', 'freshcuts'],
    ['freshcuts.com', 'freshcuts'],
    ['Fresh & Clean', 'freshandclean'],
    ['--edge--', 'edge'],
    ['a--b', 'a-b'],
    ['Café Cuts', 'cafecuts'],
  ])('%s → %s', (q, out) => expect(normalizeLabel(q)).toBe(out));

  it.each([[''], ['  '], ['ab'], ['!!!'], [null], [42], ['x'.repeat(200)]])('rejects %s', (q) => {
    expect(normalizeLabel(q as any)).toBeNull();
  });

  it('cuts at 63 characters without ending on a dash', () => {
    const l = normalizeLabel('a'.repeat(62) + '-bcd');
    expect(l!.length).toBeLessThanOrEqual(63);
    expect(l!.endsWith('-')).toBe(false);
  });

  it('never yields a punycode-style label (xn--, or -- at positions 3-4)', () => {
    expect(normalizeLabel('xn--abc')).not.toMatch(/^..--/);
  });
});

describe('isComDomain', () => {
  it.each(['freshcuts.com', 'fresh-cuts.com', 'abc.com', 'a1b.com'])('accepts %s', (d) => expect(isComDomain(d)).toBe(true));
  it.each(['freshcuts.net', 'FreshCuts.com', '-fresh.com', 'fresh-.com', 'fr--esh.com', 'xn--abc.com', 'www.fresh.com', 'ab.com', '', 'fresh cuts.com', 'fresh.com.evil'])('rejects %s', (d) => expect(isComDomain(d)).toBe(false));
});

describe('candidateDomains', () => {
  it('the exact name first, then a few close .com suggestions, no duplicates', () => {
    const c = candidateDomains('freshcuts');
    expect(c[0]).toBe('freshcuts.com');
    expect(new Set(c).size).toBe(c.length);
    expect(c.length).toBeGreaterThan(1);
    expect(c.length).toBeLessThanOrEqual(6);
    expect(c.every(isComDomain)).toBe(true);
  });

  it('does not add "barber" twice', () => {
    expect(candidateDomains('joesbarber')).not.toContain('joesbarberbarber.com');
  });

  it('every suggestion fits in a label', () => {
    expect(candidateDomains('a'.repeat(63)).every(isComDomain)).toBe(true);
  });
});

describe('eligiblePrice', () => {
  it('cap is $15', () => expect(MAX_PRICE_USD).toBe(15));
  it.each([
    [{ purchasePrice: 11.25, renewalPrice: 11.25 }, true],
    [{ purchasePrice: 15, renewalPrice: 15 }, true],
    [{ purchasePrice: 15.01, renewalPrice: 11 }, false],
    [{ purchasePrice: 11, renewalPrice: 99 }, false],
    [{ purchasePrice: '11.25', renewalPrice: 11.25 }, false],
    [{ purchasePrice: 11.25 }, false],
    [{ purchasePrice: 0, renewalPrice: 0 }, false],
    [{ purchasePrice: NaN, renewalPrice: 1 }, false],
    [null, false],
  ])('%j → %s', (p, ok) => expect(eligiblePrice(p as any)).toBe(ok));
});
