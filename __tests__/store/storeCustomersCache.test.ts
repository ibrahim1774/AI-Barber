import { clearCustomersCache } from '@/lib/bookings/customersCache';
import * as cache from '@/lib/store/customersCache';

describe('store customers cache', () => {
  it('is cleared by the existing sign-out hook (clearCustomersCache)', () => {
    cache.setStoreCustomersCache({ shopId: 's', customers: [], orders: [] });
    expect(cache.storeCustomersCache).not.toBeNull();
    clearCustomersCache();
    expect(cache.storeCustomersCache).toBeNull();
  });
});
