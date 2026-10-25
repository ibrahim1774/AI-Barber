import type { Order } from '@/lib/store/data';
import type { StoreCustomer } from '@/lib/store/customers';

// Last result, keyed by shop id. Memory only; never persisted or logged. Cleared with the Bookings customers cache
// (sign-out, account switch, data deletion).
export let storeCustomersCache: { shopId: string; customers: StoreCustomer[]; orders: Order[] } | null = null;

export function setStoreCustomersCache(c: { shopId: string; customers: StoreCustomer[]; orders: Order[] }): void {
  storeCustomersCache = c;
}

export function clearStoreCustomersCache(): void {
  storeCustomersCache = null;
}
