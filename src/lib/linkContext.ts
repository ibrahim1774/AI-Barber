import { useEffect, useState } from 'react';
import { useEntitlements, getEntitlements } from '@/lib/entitlements';
import type { LinkContext } from '@/lib/bookingChoice';
import { loadMyShop } from '@/lib/shop';
import { loadStoreSettings } from '@/lib/store/data';

/** The shop facts the publish needs to decide the Book and Shop links. Never throws: no shop on a failure. */
export async function loadLinkContext(): Promise<LinkContext> {
  const ents = getEntitlements();
  try {
    const shop = await loadMyShop();
    if (!shop) return { ents, shop: null, storeEnabled: false };
    const storeEnabled = await loadStoreSettings(shop.id).then((s) => s.storeEnabled).catch(() => false);
    return { ents, shop, storeEnabled };
  } catch {
    return { ents, shop: null, storeEnabled: false };
  }
}

/** The same context for rendering (the Edit preview), refreshed when the entitlements change. */
export function useLinkContext(): LinkContext | null {
  const ents = useEntitlements();
  const [ctx, setCtx] = useState<LinkContext | null>(null);
  useEffect(() => {
    let alive = true;
    loadLinkContext().then((c) => alive && setCtx({ ...c, ents }));
    return () => {
      alive = false;
    };
  }, [ents]);
  return ctx;
}
