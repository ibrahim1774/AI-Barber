import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { listCustomerAppointments } from '@/lib/bookings/api';
import { groupCustomers, type Customer } from '@/lib/bookings/customers';
import { loadMyShop, type Shop } from '@/lib/bookings/shop';

export type CustomersPhase = 'loading' | 'ready' | 'no-shop' | 'error';

export interface CustomersData {
  phase: CustomersPhase;
  shop: Shop | null;
  customers: Customer[];
  refresh(): Promise<void>;
}

// Last result, keyed by shop id, so the detail screen renders at once. Memory only; never persisted or logged.
let cache: { shopId: string; shop: Shop; customers: Customer[] } | null = null;

/** Loads the owner's shop and derives its customers from every booking; reloads on focus. */
export function useCustomers(): CustomersData {
  const [phase, setPhase] = useState<CustomersPhase>(cache ? 'ready' : 'loading');
  const [shop, setShop] = useState<Shop | null>(cache?.shop ?? null);
  const [customers, setCustomers] = useState<Customer[]>(cache?.customers ?? []);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const s = await loadMyShop();
      if (mine !== seq.current) return;
      if (!s) {
        cache = null;
        setShop(null);
        setCustomers([]);
        setPhase('no-shop');
        return;
      }
      const rows = await listCustomerAppointments(s.id);
      if (mine !== seq.current) return;
      const list = groupCustomers(rows, new Date().toISOString());
      cache = { shopId: s.id, shop: s, customers: list };
      setShop(s);
      setCustomers(list);
      setPhase('ready');
    } catch {
      if (mine !== seq.current) return;
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
