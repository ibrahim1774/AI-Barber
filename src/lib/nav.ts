import { router, type Href } from 'expo-router';
import { loadSite, type SiteRecord } from '@/lib/siteStore';

/** Home: the Edit tab once a site exists, the importer before. */
export function homeRoute(site: SiteRecord | null): '/edit' | '/start' {
  return site ? '/edit' : '/start';
}

/**
 * Makes `href` the only screen on the stack (no swipe back into the importer
 * or the editor). Same pattern as the launch retry's jump to /live.
 */
export function resetTo(href: Href): void {
  if (router.canDismiss()) router.dismissAll();
  router.replace(href);
}

/** Back to the previous screen, else home (the Edit tab with a site, the importer without). */
export function goBackOrHome(): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  void loadSite()
    .then((s) => resetTo(homeRoute(s)))
    .catch(() => resetTo('/start'));
}

// Set when "Update my site" (a Bookings or Store setup prompt) starts a publish: that publish's live screen
// returns to the setup screen the barber was on, not to Settings.
let returnAfterLive = false;
export const markReturnAfterLive = (): void => {
  returnAfterLive = true;
};
/** Read once when the live screen opens. */
export function takeReturnAfterLive(): boolean {
  const v = returnAfterLive;
  returnAfterLive = false;
  return v;
}

/** The live screen's Done: back to where the barber was (setup prompt), else the Settings tab. */
export function leaveLive(back: boolean): void {
  if (back && router.canGoBack()) router.back();
  else resetTo('/settings');
}
