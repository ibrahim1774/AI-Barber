jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } },
}));
import { OwnerApiError, shopSetup } from '@/lib/setup/ownerApi';

it('words a 400 as a plain sentence, not the bare code', async () => {
  (global as any).fetch = jest.fn().mockResolvedValue({ status: 400, text: async () => JSON.stringify({ error: 'invalid' }) });
  const e = await shopSetup({ siteId: 's', name: 'n', timezone: 'America/New_York', services: [] }).catch((x) => x);
  expect(e).toBeInstanceOf(OwnerApiError);
  expect(e.message).toBe("Some of your details couldn't be saved. Check your services and try again.");
});
