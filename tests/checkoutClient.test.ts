import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) } } }));

import { authHeaders, checkoutErrorMessage, payFirstPlaceholderSlug, payFirstSiteSlug, toSlug } from '../services/checkoutClient';
import { slugify } from '../lib/publishSite';

describe('services/checkoutClient (re-review R1)', () => {
  it('pay-first: every purchase gets its own placeholder (never the shared sample slug), canonical', () => {
    const a = payFirstPlaceholderSlug('premium-cuts');
    const b = payFirstPlaceholderSlug('premium-cuts');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^premium-cuts-[a-z0-9]{8}$/);
    expect(slugify(a)).toBe(a);
  });

  it('the details step slug is the real shop name plus a short suffix, canonical', () => {
    const s = payFirstSiteSlug("Jack's  Cuts & Co.");
    expect(s).toMatch(/^jacks-cuts-co-[a-z0-9]{4}$/);
    expect(slugify(s)).toBe(s);
    expect(toSlug('x'.repeat(80))).toBe(slugify('x'.repeat(80)));
  });

  it('409 site-owned reads "That name is taken"; other errors pass through', () => {
    expect(checkoutErrorMessage(409, { error: 'site-owned' })).toMatch(/^That name is taken — pick another/);
    expect(checkoutErrorMessage(500, { error: 'boom' })).toBe('boom');
  });

  it('sends the signed-in bearer', async () => {
    expect(await authHeaders()).toEqual({ Authorization: 'Bearer tok' });
  });
});
