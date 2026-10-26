import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { currentUserId } from '@/lib/auth';
import { useEntitlements, getEntitlements } from '@/lib/entitlements';
import type { LinkContext } from '@/lib/bookingChoice';
import { loadMyShop } from '@/lib/shop';
import { loadStoreSettings } from '@/lib/store/data';

/**
 * The shop facts the publish needs to decide the Book and Shop links. A failed lookup is "unknown"
 * (null), never "no shop": the caller then only strips what the plan lacks and keeps the site's links.
 */
export async function loadLinkContext(): Promise<LinkContext | null> {
  const ents = getEntitlements();
  // Signed out there is no shop to look up: unknown, not "no shop" (publishing works without an account).
  if (!currentUserId()) return null;
  try {
    const shop = await loadMyShop();
    if (!shop) return { ents, shop: null, storeEnabled: false };
    const storeEnabled = (await loadStoreSettings(shop.id)).storeEnabled;
    return { ents, shop, storeEnabled };
  } catch {
    return null;
  }
}

/** The previous context when the next one says the same thing (so identity-keyed memos downstream hold). */
export function keepIfSame(prev: LinkContext | null, next: LinkContext | null): LinkContext | null {
  if (prev === next) return prev;
  if (!prev || !next) return next;
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}

/**
 * The same context for rendering (the Edit preview). Reloaded when the entitlements change, when the
 * tab regains focus, and when `siteKey` (the site record's version) changes, so it never lags publish.
 */
export function useLinkContext(siteKey?: unknown): LinkContext | null {
  const ents = useEntitlements();
  const [ctx, setCtx] = useState<LinkContext | null>(null);
  const [focusN, setFocusN] = useState(0);
  useFocusEffect(useCallback(() => setFocusN((n) => n + 1), []));
  useEffect(() => {
    let alive = true;
    // Same facts as before: keep the object. A new one on every tab focus re-derived the preview data and reloaded the WebView.
    loadLinkContext().then((c) => alive && setCtx((prev) => keepIfSame(prev, c ? { ...c, ents } : null)));
    return () => {
      alive = false;
    };
  }, [ents, siteKey, focusN]);
  return ctx;
}
