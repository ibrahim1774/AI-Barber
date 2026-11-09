import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sbRest = vi.fn();
const stripeCall = vi.fn();
vi.mock('../../lib/webApp/webAppServer.js', () => ({ sbRest: (...a: any[]) => sbRest(...a), stripeCall: (...a: any[]) => stripeCall(...a), APP_ORIGIN: () => 'https://www.aibarber.org' }));
const stamped = vi.fn(async (slug: string) => `https://ios-test-${slug}.vercel.app`);
vi.mock('../../lib/ios/siteUrlFor.js', () => ({ stampedSiteUrl: (s: string) => stamped(s) }));

import { contactFor, liveSiteUrlFor } from '../../lib/webApp/dunning';

const user = (body: any) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })));
beforeEach(() => { sbRest.mockReset(); stripeCall.mockReset(); stamped.mockClear(); process.env.SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('contactFor first name (welcome / failed-payment greeting)', () => {
  it('uses the account first name, then given/full name', async () => {
    user({ email: 'a@b.co', user_metadata: { first_name: 'Jake', full_name: 'Jake Lee' } });
    expect(await contactFor('u1', 'cus_1')).toEqual({ email: 'a@b.co', firstName: 'Jake' });
    user({ email: 'a@b.co', user_metadata: { full_name: 'Maria Lopez' } });
    expect((await contactFor('u1', 'cus_1')).firstName).toBe('Maria');
  });
  it('uses the Google identity name when user_metadata has none', async () => {
    user({ email: 'a@b.co', user_metadata: {}, identities: [{ provider: 'google', identity_data: { name: 'Sam Carter' } }] });
    expect((await contactFor('u1', 'cus_1')).firstName).toBe('Sam');
  });
  it('has no name when the account has none: the Stripe customer name (billing / shop name) is never used', async () => {
    user({ email: 'a@b.co', user_metadata: {} });
    stripeCall.mockResolvedValue({ email: 'z@z.co', name: 'E2E Cuts 201' });
    expect(await contactFor('u1', 'cus_1')).toEqual({ email: 'a@b.co', firstName: null });
    expect(stripeCall).not.toHaveBeenCalled();
  });
  it('still falls back to the Stripe customer email when the account has none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => null })));
    stripeCall.mockResolvedValue({ email: 'z@z.co', name: 'E2E Cuts 201' });
    expect(await contactFor('u1', 'cus_1')).toEqual({ email: 'z@z.co', firstName: null });
  });
});

describe('liveSiteUrlFor (welcome mail live link)', () => {
  it('uses the subscription slug first', async () => {
    expect(await liveSiteUrlFor('joes', 'u1', 'test')).toBe('https://ios-test-joes.vercel.app');
    expect(sbRest).not.toHaveBeenCalled();
  });
  it('else the user\'s published site; query is scoped to user, environment and published', async () => {
    sbRest.mockResolvedValue([{ slug: 'ios-e2e' }]);
    expect(await liveSiteUrlFor(null, 'u1', 'live')).toBe('https://ios-test-ios-e2e.vercel.app');
    const q = sbRest.mock.calls[0][0] as string;
    expect(q).toContain('user_id=eq.u1'); expect(q).toContain('environment=eq.live'); expect(q).toContain('published_at=not.is.null'); expect(q).toContain('taken_down_at=is.null');
  });
  it('null (link left out) when nothing is published, no user, or the lookup fails', async () => {
    sbRest.mockResolvedValue([]);
    expect(await liveSiteUrlFor(null, 'u1', 'test')).toBeNull();
    expect(await liveSiteUrlFor(null, null, 'test')).toBeNull();
    sbRest.mockRejectedValue(new Error('down'));
    expect(await liveSiteUrlFor(null, 'u1', 'test')).toBeNull();
  });
});
