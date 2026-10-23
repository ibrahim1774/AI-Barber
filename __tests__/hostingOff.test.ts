import { siteOffline } from '@/lib/subscriptionStatus';

const live: any = { deployedUrl: 'https://x.test' };
const draft: any = { deployedUrl: null };

describe('siteOffline (Settings "Offline" pill)', () => {
  it('a confirmed lapse is offline', () => {
    expect(siteOffline(live, 'lapsed', { known: true, hosting: true })).toBe(true);
  });
  it('known entitlements without hosting on a published site are offline too', () => {
    expect(siteOffline(live, 'unknown', { known: true, hosting: false })).toBe(true);
  });
  it('unknown entitlements or active hosting stay live', () => {
    expect(siteOffline(live, 'unknown', { known: false, hosting: false })).toBe(false);
    expect(siteOffline(live, 'active', { known: true, hosting: true })).toBe(false);
  });
  it('a draft is never offline', () => {
    expect(siteOffline(draft, 'lapsed', { known: true, hosting: false })).toBe(false);
  });
});
