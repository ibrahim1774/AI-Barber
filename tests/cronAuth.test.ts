import { describe, it, expect, vi, afterEach } from 'vitest';
import { authorized } from '../lib/cronAuth.js';

const ua = { 'user-agent': 'vercel-cron/1.0' };

describe('cron auth', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('CRON_SECRET unset: the vercel-cron user agent is accepted, anything else is not', () => {
    vi.stubEnv('CRON_SECRET', '');
    expect(authorized({ headers: ua })).toBe(true);
    expect(authorized({ headers: { 'user-agent': 'curl/8' } })).toBe(false);
    expect(authorized({ headers: {} })).toBe(false);
  });

  it('CRON_SECRET set: only the Bearer secret is accepted; the user agent alone is refused', () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect(authorized({ headers: ua })).toBe(false);
    expect(authorized({ headers: { ...ua, authorization: 'Bearer wrong' } })).toBe(false);
    expect(authorized({ headers: { authorization: 'Bearer s3cret' } })).toBe(true);
    expect(authorized({ headers: { ...ua, authorization: 'Bearer s3cret' } })).toBe(true);
  });
});
