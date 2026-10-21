import { describe, it, expect } from 'vitest';
import { GRACE_MS, isActiveRow, isLapsed } from '../../lib/ios/lapse.js';
import { offlineHtml } from '../../lib/ios/offlinePage.js';

const NOW = 1_800_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();
const r = (expires: number | null, revoked: number | null = null) => ({
  expires_at: expires == null ? null : iso(expires),
  revoked_at: revoked == null ? null : iso(revoked),
});

describe('isLapsed', () => {
  it('prefilter grace is 1 hour', () => expect(GRACE_MS).toBe(3_600_000));
  it('exactly 1 h past expiry is lapsed', () => expect(isLapsed(r(NOW - GRACE_MS), NOW)).toBe(true));
  it('1 ms short of 1 h past expiry is not lapsed yet', () => expect(isLapsed(r(NOW - GRACE_MS + 1), NOW)).toBe(false));
  it('just expired (failed card, late renewal) is not lapsed yet', () => expect(isLapsed(r(NOW - 1000), NOW)).toBe(false));
  it('long expired is lapsed', () => expect(isLapsed(r(NOW - 30 * GRACE_MS), NOW)).toBe(true));
  it('revoked is lapsed even with a future expiry', () => expect(isLapsed(r(NOW + GRACE_MS, NOW - 1), NOW)).toBe(true));
  it('null expiry and no revocation is not lapsed', () => expect(isLapsed(r(null), NOW)).toBe(false));
  it('null expiry but revoked is lapsed', () => expect(isLapsed(r(null, NOW), NOW)).toBe(true));
  it('future expiry is not lapsed', () => expect(isLapsed(r(NOW + GRACE_MS), NOW)).toBe(false));
});

describe('isActiveRow', () => {
  it('future expiry is active', () => expect(isActiveRow(r(NOW + 1), NOW)).toBe(true));
  it('expiry exactly now is not active', () => expect(isActiveRow(r(NOW), NOW)).toBe(false));
  it('past expiry is not active', () => expect(isActiveRow(r(NOW - 1), NOW)).toBe(false));
  it('revoked is not active', () => expect(isActiveRow(r(NOW + GRACE_MS, NOW - 1), NOW)).toBe(false));
  it('null expiry is not active', () => expect(isActiveRow(r(null), NOW)).toBe(false));
  it('a row between expiry and the 1 h grace is neither active nor lapsed', () => {
    const row = r(NOW - 1000);
    expect(isActiveRow(row, NOW)).toBe(false);
    expect(isLapsed(row, NOW)).toBe(false);
  });
});

describe('offlineHtml', () => {
  const html = offlineHtml();
  it('has the heading, noindex, viewport and footer link', () => {
    expect(html).toContain('This website is no longer available');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('href="https://www.aibarber.org"');
    expect(html).toContain('Built with AI Barber');
    expect(html).toContain('#0d0d0d');
    expect(html).toContain('#f4a100');
  });
  it('has no scripts, no external assets, and no published-at marker', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/src=/i);
    expect(html).not.toContain('published-at');
    // The only absolute URL is the footer link.
    expect(html.match(/https?:\/\//g)).toEqual(['https://']);
  });
});
