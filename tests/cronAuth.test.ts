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

import { authorizedStrict } from '../lib/cronAuth.js';

describe('authorizedStrict (web-app crons)', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('secret unset: even the vercel-cron user agent is refused', () => {
    vi.stubEnv('CRON_SECRET', '');
    expect(authorizedStrict({ headers: ua })).toBe('no-secret');
  });
  it('secret set: no header, wrong bearer and different-length header are denied without throwing', () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect(authorizedStrict({ headers: {} })).toBe('denied');
    expect(authorizedStrict({ headers: ua })).toBe('denied');
    expect(authorizedStrict({ headers: { authorization: 'Bearer wrong' } })).toBe('denied');
    expect(authorizedStrict({ headers: { authorization: 'Bearer s3cret-and-more' } })).toBe('denied');
    expect(authorizedStrict({})).toBe('denied');
  });
  it('the right bearer is ok', () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect(authorizedStrict({ headers: { authorization: 'Bearer s3cret' } })).toBe('ok');
  });
});
