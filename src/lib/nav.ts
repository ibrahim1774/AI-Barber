import { router, type Href } from 'expo-router';
import { loadSite } from '@/lib/siteStore';

/**
 * Makes `href` the only screen on the stack (no swipe back into the importer
 * or the editor). Same pattern as the launch retry's jump to /live.
 */
export function resetTo(href: Href): void {
  if (router.canDismiss()) router.dismissAll();
  router.replace(href);
}

/** Back to the previous screen, else home (Dashboard with a site, the importer without). */
export function goBackOrHome(): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  void loadSite()
    .then((s) => resetTo(s ? '/dashboard' : '/start'))
    .catch(() => resetTo('/start'));
}
