import { describe, it, expect, afterEach, vi } from 'vitest';
import middleware, { config } from '../../middleware';

const APP = 'https://prime-barber-web.vercel.app/app/';
const run = (url: string) => {
  const u = new URL(url);
  const res = middleware(new Request(url, { headers: { host: u.host } })) as Response | undefined;
  return res?.headers.get('x-middleware-rewrite') ?? null;
};

afterEach(() => vi.unstubAllEnvs());

describe('root middleware', () => {
  it('only matches /', () => {
    expect(config.matcher).toBe('/');
  });
  it('rewrites www.primebarber.org/ to the app', () => {
    expect(run('https://www.primebarber.org/')).toBe(APP);
  });
  it('leaves legacy Stripe/sign-in returns on primebarber alone', () => {
    for (const q of ['?stripe_session=x', '?signin', '?domain_payment=success', '?session_id=1']) {
      expect(run(`https://www.primebarber.org/${q}`), q).toBeNull();
    }
  });
  it('leaves www.aibarber.org alone', () => {
    expect(run('https://www.aibarber.org/')).toBeNull();
  });
  it('pbroot=1 is ignored in production', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(run('https://prime-barber-ai.vercel.app/?pbroot=1')).toBeNull();
  });
  it('pbroot=1 rewrites on a preview', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(run('https://prime-barber-ai-git-x.vercel.app/?pbroot=1')).toBe(APP);
  });
});
