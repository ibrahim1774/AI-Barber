import type { Customer } from '@/lib/bookings/customers';
import { clearStoreCustomersCache } from '@/lib/store/customersCache';
import type { Shop } from '@/lib/bookings/shop';

// Last result, keyed by shop id. Memory only; never persisted or logged. Cleared on sign-out and data deletion.
export let customersCache: { shopId: string; shop: Shop; customers: Customer[] } | null = null;

export function setCustomersCache(c: { shopId: string; shop: Shop; customers: Customer[] }): void {
  customersCache = c;
}

export function clearCustomersCache(): void {
  customersCache = null;
  clearStoreCustomersCache();
}
