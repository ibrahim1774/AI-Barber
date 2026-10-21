import { useCallback, useEffect, useRef, useState } from 'react';
import { listOrders, type Order } from '@/lib/store/data.stub-a3b';

const PAGE = 30;

/** The shop's orders, newest first, with load-more. `refresh` reloads from the top. */
export function useOrders(shopId: string) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const first = await listOrders(shopId, { limit: PAGE });
      if (mine !== seq.current) return;
      setOrders(first);
      setMore(first.length >= PAGE);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error && e.message ? e.message : "Couldn't load your orders.");
    }
  }, [shopId]);

  useEffect(() => {
    setOrders(null);
    void refresh();
    return () => {
      seq.current++;
    };
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (!orders?.length || loadingMore) return;
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const next = await listOrders(shopId, { limit: PAGE, before: orders[orders.length - 1].createdAt });
      if (mine !== seq.current) return;
      setOrders((cur) => {
        const have = new Set((cur ?? []).map((o) => o.id));
        return [...(cur ?? []), ...next.filter((o) => !have.has(o.id))];
      });
      setMore(next.length >= PAGE);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't load more orders.");
    } finally {
      setLoadingMore(false);
    }
  }, [shopId, orders, loadingMore]);

  return { orders, error, more, loadingMore, refresh, loadMore };
}
