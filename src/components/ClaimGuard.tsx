import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { usePathname, useRootNavigationState } from 'expo-router';
import { CLAIM_ALLOWED_PATHS, claimLocked } from '@/lib/claimGuard';
import { resetTo } from '@/lib/nav';

/**
 * The locked account step. A paid publish with no account (or one the server refused) means /claim and nothing
 * else: at launch, on every screen change and on return to the foreground, anything but the account step, the
 * publish overlay (it is the flow itself) and password reset is sent back. A read that fails never traps.
 */
export function ClaimGuard() {
  const navReady = useRootNavigationState()?.key != null;
  const path = usePathname();
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    if (!navReady || CLAIM_ALLOWED_PATHS.includes(path)) return;
    let stale = false;
    void claimLocked().then((locked) => {
      if (!stale && locked) resetTo('/claim');
    });
    return () => {
      stale = true;
    };
  }, [navReady, path]);

  useEffect(() => {
    if (!navReady) return;
    let last = AppState.currentState;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && last === 'background' && !CLAIM_ALLOWED_PATHS.includes(pathRef.current)) {
        void claimLocked().then((locked) => locked && resetTo('/claim'));
      }
      last = state;
    });
    return () => sub.remove();
  }, [navReady]);

  return null;
}
