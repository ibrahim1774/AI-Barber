import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { addProduct, listProducts, removeProduct, reorderProducts, updateProduct, type Product } from '@/lib/store/data';

/** The shop's active products plus the write actions; every write reloads the list. */
export function useProducts(shopId: string) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const list = await listProducts(shopId);
      if (mine !== seq.current) return;
      setProducts(list);
      setFailed(false);
    } catch {
      if (mine === seq.current) setFailed(true);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    void load();
    return () => {
      seq.current++;
    };
  }, [load]);

  /** Runs a write, reloads, and tells the barber when it fails. Resolves true on success. */
  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn();
    } catch (e) {
      console.warn('[store] product write failed', e);
      Alert.alert("Couldn't save your product", 'Check your connection and try again.');
      return false;
    }
    await load();
    return true;
  }, [load]);

  return {
    products, loading, failed, refresh: load,
    add: (p: Parameters<typeof addProduct>[1]) => run(() => addProduct(shopId, p)),
    update: (id: string, p: Parameters<typeof updateProduct>[1]) => run(() => updateProduct(id, p)),
    remove: (id: string) => run(() => removeProduct(id)),
    reorder: (ids: string[]) => run(() => reorderProducts(ids)),
  };
}
