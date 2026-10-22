import type { SiteRecord } from '@/lib/siteStore';

const adoptedListeners = new Set<(site: SiteRecord) => void>();

/** Called with the new local record whenever a newer copy is adopted (the account row, or an admin edit). Returns the unsubscribe. */
export function onSiteAdopted(cb: (site: SiteRecord) => void): () => void {
  adoptedListeners.add(cb);
  return () => {
    adoptedListeners.delete(cb);
  };
}

export function emitSiteAdopted(site: SiteRecord): void {
  adoptedListeners.forEach((l) => {
    try {
      l(site);
    } catch (e) {
      console.warn('[site] adopted listener failed:', e);
    }
  });
}
