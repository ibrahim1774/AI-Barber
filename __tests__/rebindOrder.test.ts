// rebindAdoptedSite: nothing is awaited between re-reading the record and saving it (an editor save there would be overwritten).
import { rebindAdoptedSite } from '@/lib/account';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { supabase } = require('@/lib/supabase');

const UID = '11111111-2222-4333-8444-555555555555';
const rec: any = {
  draftId: 'd1', slug: null, transactionId: null, deployedUrl: 'https://fade.aibarber.org', ownerUserId: UID, updatedAt: 1,
  data: { shopName: 'Fade' },
};

it('checks the session before the final read, then reads and saves back to back', async () => {
  const log: string[] = [];
  jest.spyOn(supabase.auth, 'getSession').mockImplementation(async () => {
    log.push('session');
    return { data: { session: { user: { id: UID } } } } as never;
  });
  const store = {
    loadSite: jest.fn(async () => { log.push('load'); return { ...rec }; }),
    saveSite: jest.fn(async () => { log.push('save'); }),
  };
  const iosSite = jest.fn(async () => ({ siteId: 'fade', siteData: null, deployedUrl: 'https://fade.aibarber.org' })) as never;
  await rebindAdoptedSite({ latestTransactionId: async () => 'tx-1', iosSite, store: store as never });
  const iLoad = log.lastIndexOf('load');
  expect(log.slice(iLoad)).toEqual(['load', 'save']);
  expect(log.lastIndexOf('session')).toBeLessThan(iLoad);
});
