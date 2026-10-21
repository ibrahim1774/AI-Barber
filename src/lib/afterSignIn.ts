import { useCallback } from 'react';
import { Alert } from 'react-native';
import { goBackOrHome, resetTo } from '@/lib/nav';
import { useRestoreFlow } from '@/lib/restoreFlow';
import { takePostAuthReturn } from '@/lib/setup/gate';
import { loadSite } from '@/lib/siteStore';

/**
 * Where a successful sign-in goes (sign-in, and a completed password reset):
 * with a site, the Edit tab; without one, an offer (never run unasked) to
 * Restore purchases, then back (or home). `leave` replaces goBackOrHome for a
 * screen that must not go back (the reset screen, opened from a link).
 */
export function useAfterSignIn(
  leave: () => void = goBackOrHome,
): (opts?: { title?: string; message?: string }) => Promise<void> {
  const { restore } = useRestoreFlow();
  return useCallback(
    async ({ title = 'Signed in', message }: { title?: string; message?: string } = {}) => {
      // Sent here by the Bookings setup (it needs an account first): go back to it.
      if (takePostAuthReturn()) {
        leave();
        return;
      }
      const site = await loadSite().catch(() => null);
      if (site) {
        resetTo('/edit');
        // A plain sign-in says nothing; a password reset confirms itself.
        if (message) Alert.alert(title, message);
        return;
      }
      Alert.alert(title, 'Already subscribed with this Apple ID? Restore purchases to bring your website back.', [
        { text: 'Not now', style: 'cancel', onPress: leave },
        {
          text: 'Restore purchases',
          onPress: async () => {
            await restore();
            // Restored → already on the Edit tab; otherwise leave.
            if (!(await loadSite().catch(() => null))) leave();
          },
        },
      ]);
    },
    [leave, restore],
  );
}
