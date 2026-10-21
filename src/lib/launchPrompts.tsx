import { useEffect } from 'react';
import { AppState } from 'react-native';
import { requestTrackingWhenActive } from '@/lib/analytics';
import { useSuperwallSettled } from '@/lib/paywall';
import { askReminderPermissionOnce } from '@/lib/reminders';

/** Resolves once the app is in the foreground (iOS ignores permission requests otherwise). */
export function whenActive(): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise((resolve) => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      sub.remove();
      resolve();
    });
  });
}

let started = false;

/**
 * The two launch-time system prompts, one after the other so they never
 * overlap: publish reminders (notifications) first, then App Tracking
 * Transparency. Once per process; the notification ask itself is once ever
 * (askReminderPermissionOnce keeps a flag, and refreshes the reminders: the
 * 'start' copy without a site, 'finish' with a draft). A decline is never
 * asked again and nothing is said about it.
 */
export async function runLaunchPrompts(): Promise<void> {
  if (started) return;
  started = true;
  try {
    await whenActive();
    await askReminderPermissionOnce();
  } catch (e) {
    console.warn('[launch] notification prompt failed:', e);
  }
  // A beat after the notification alert closes: iOS can drop an ATT request
  // made just as the app becomes active again. Waits for 'active' itself,
  // then starts AppsFlyer whatever the answer.
  await new Promise((r) => setTimeout(r, 600));
  requestTrackingWhenActive();
}

/** Test hook: forget that the prompts ran in this process. */
export function resetLaunchPromptsForTests(): void {
  started = false;
}

/**
 * Mounted once in _layout, so the prompts appear on whatever screen comes
 * first after the splash (/start, the Edit tab, a deep link's target). Not
 * before Superwall has settled (configured, failed, or 10 s): SuperwallKit's
 * debug build traps on a system prompt during configure.
 */
export function LaunchPrompts() {
  const settled = useSuperwallSettled();
  useEffect(() => {
    if (settled) void runLaunchPrompts();
  }, [settled]);
  return null;
}
