import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { listCustomerAppointments } from '@/lib/bookings/api';
import { groupCustomers, type Customer } from '@/lib/bookings/customers';
import { clearCustomersCache, customersCache, setCustomersCache } from '@/lib/bookings/customersCache';
import { loadMyShop, type Shop } from '@/lib/bookings/shop';

export { clearCustomersCache };

export type CustomersPhase = 'loading' | 'ready' | 'no-shop' | 'error';

export interface CustomersData {
  phase: CustomersPhase;
  shop: Shop | null;
  customers: Customer[];
  refresh(): Promise<void>;
}

/** Loads the owner's shop and derives its customers from every booking; reloads on focus. */
export function useCustomers(): CustomersData {
  const [phase, setPhase] = useState<CustomersPhase>('loading');
  const [shop, setShop] = useState<Shop | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const s = await loadMyShop();
      if (mine !== seq.current) return;
      if (!s) {
        clearCustomersCache();
        setShop(null);
        setCustomers([]);
        setPhase('no-shop');
        return;
      }
      // Cached rows are reused only once this account's own shop is known and matches; otherwise drop them.
      const c = customersCache;
      if (c && c.shopId === s.id) {
        setShop(c.shop);
        setCustomers(c.customers);
        setPhase('ready');
      } else {
        clearCustomersCache();
      }
      const rows = await listCustomerAppointments(s.id);
      if (mine !== seq.current) return;
      const list = groupCustomers(rows, new Date().toISOString());
      setCustomersCache({ shopId: s.id, shop: s, customers: list });
      setShop(s);
      setCustomers(list);
      setPhase('ready');
    } catch {
      if (mine !== seq.current) return;
      clearCustomersCache();
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

  return { phase, shop, customers, refresh };
}
