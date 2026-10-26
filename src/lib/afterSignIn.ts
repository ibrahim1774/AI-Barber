import { useCallback } from 'react';
import { Alert } from 'react-native';
import { hasLockedClaim } from '@/lib/account';
import { takeEmptyAccountNotice } from '@/lib/auth';
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
      // A paid publish is waiting for this account (the locked step's "Forgot password?" lands here): back to it.
      if (await hasLockedClaim()) {
        resetTo('/claim');
        return;
      }
      // A different account's site was taken off this phone and this account has none yet.
      const empty = takeEmptyAccountNotice();
      // Sent here by the Bookings setup (it needs an account first): go back to it.
      if (takePostAuthReturn()) {
        leave();
        if (empty) {
          Alert.alert(
            'No website in this account yet',
            empty.email ? `Build one and it will be saved to ${empty.email}.` : 'Build one and it will be saved to this account.',
          );
        }
        return;
      }
      if (empty) {
        resetTo('/start');
        Alert.alert(
          'No website in this account yet',
          empty.email
            ? `Build one and it will be saved to ${empty.email}.`
            : 'Build one and it will be saved to this account.',
        );
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
