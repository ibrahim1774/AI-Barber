import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { loadMyShop } from '@/lib/shop';
import { groupStoreCustomers, type StoreCustomer } from '@/lib/store/customers';
import { clearStoreCustomersCache, setStoreCustomersCache, storeCustomersCache } from '@/lib/store/customersCache';
import { listAllOrders, type Order } from '@/lib/store/data';

export type StoreCustomersPhase = 'loading' | 'ready' | 'no-shop' | 'error';

export interface StoreCustomersData {
  phase: StoreCustomersPhase;
  customers: StoreCustomer[];
  orders: Order[];
  refresh(): Promise<void>;
}

/** Loads the owner's shop and derives its customers from every visible order; reloads on focus. Read-only. */
export function useStoreCustomers(): StoreCustomersData {
  const [phase, setPhase] = useState<StoreCustomersPhase>('loading');
  const [customers, setCustomers] = useState<StoreCustomer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const s = await loadMyShop();
      if (mine !== seq.current) return;
      if (!s) {
        clearStoreCustomersCache();
        setCustomers([]);
        setOrders([]);
        setPhase('no-shop');
        return;
      }
      // Cached rows are reused only once this account's own shop is known and matches; otherwise drop them.
      const c = storeCustomersCache;
      if (c && c.shopId === s.id) {
        setCustomers(c.customers);
        setOrders(c.orders);
        setPhase('ready');
      } else {
        clearStoreCustomersCache();
      }
      const rows = await listAllOrders(s.id);
      if (mine !== seq.current) return;
      const list = groupStoreCustomers(rows);
      setStoreCustomersCache({ shopId: s.id, customers: list, orders: rows });
      setCustomers(list);
      setOrders(rows);
      setPhase('ready');
    } catch {
      if (mine !== seq.current) return;
      clearStoreCustomersCache();
      // Keep what is on screen when a refresh fails; only a first load shows the error. Nothing is logged: rows hold PII.
      setPhase((p) => (p === 'ready' ? p : 'error'));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {
        seq.current++;
      };
    }, [refresh]),
  );

  return { phase, customers, orders, refresh };
}
