import { requireOptionalNativeModule } from 'expo';
import { Alert } from 'react-native';
import Storage from 'expo-sqlite/kv-store';
import type * as NotificationsModule from 'expo-notifications';
import { track } from '@/lib/analytics';
import { stripMarkers } from '@/lib/editable';
import { loadPendingPublish, loadSite, type SiteRecord } from '@/lib/siteStore';

/**
 * Publish reminders (Task 10b, cut for App Store 4.5.4): three local
 * notifications at 10:00, on day 1, 3 and 7 after the first one was scheduled,
 * until the site is published. The user can switch them off in Settings
 * (Publish reminders) and is told so before the system prompt. Barbers with an unpublished draft get the "finish"
 * lines; those who never generated a site get the "start" lines. Local only:
 * no push token, no APNs registration. This is the only file that touches
 * expo-notifications, so a build without its native module (the current dev
 * client) still runs, with reminders off.
 */

export type ReminderKind = 'finish' | 'start';
export interface Reminder {
  at: Date;
  title: string;
  body: string;
  kind: ReminderKind;
}

export const REMINDER_TITLE = 'Prime Barber';
export const FINISH_LINES = [
  '{Shop} is almost live ✂️ — publish your website in under a minute.',
  'Your barbershop website is ready. Tap to publish it and start getting bookings.',
  "Don't leave {Shop} offline — your site is one tap from live.",
] as const;
export const START_LINES = [
  'Build your barbershop website in 60 seconds — just paste your booking link.',
  'Your shop deserves a real website. Make yours now ✂️',
] as const;

/** 10:00 local, on day 1, 3 and 7 after the anchor (the first time reminders were scheduled). */
const SLOT_HOUR = 10;
export const REMINDER_DAYS = [1, 3, 7] as const;
export const REMINDER_COUNT = REMINDER_DAYS.length;
/** Shown once, before the system notification prompt. */
export const REMINDER_PRE_PERMISSION = 'We’ll remind you to publish your site. Turn off anytime in Settings.';
const MIN_LEAD_MS = 60 * 60 * 1000;
/** Keeps the longest line under 110 characters. */
const MAX_SHOP_CHARS = 30;

const ASKED_KEY = 'reminders.asked.v1';
/** Set on publish success and on delete: no reminders from then on. */
const STOPPED_KEY = 'reminders.stopped.v1';
/** Set when the user switches "Publish reminders" off in Settings. */
const OFF_KEY = 'reminders.off.v1';
/** Epoch ms of the first time reminders were scheduled: day 1/3/7 count from it, not from each refresh. */
const ANCHOR_KEY = 'reminders.anchor.v1';

type Notifications = typeof NotificationsModule;
type NotificationResponse = NotificationsModule.NotificationResponse;
let mod: Notifications | null | undefined;
/**
 * expo-notifications, or null when the build lacks its native module (warned
 * once). The native check comes first: a require whose module throws at load
 * is reported by Metro's guard as an uncaught error (red box) instead of
 * reaching the catch below.
 */
function notifications(): Notifications | null {
  if (mod !== undefined) return mod;
  mod = null;
  try {
    if (!requireOptionalNativeModule('ExpoPushTokenManager') || !requireOptionalNativeModule('ExpoNotificationScheduler')) {
      throw new Error('native module missing');
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = (require('expo-notifications') as Notifications | undefined) ?? null;
  } catch (e) {
    mod = null;
    console.warn('[reminders] expo-notifications is not in this build; publish reminders are off.', e);
  }
  return mod;
}

function shopName(site: SiteRecord): string | null {
  for (const raw of [site.data?.shopName, site.inputs?.shopName]) {
    const name = typeof raw === 'string' ? stripMarkers(raw).replace(/\s+/g, ' ').trim() : '';
    if (!name) continue;
    // By code point, so an emoji's surrogate pair is never split.
    const chars = Array.from(name);
    return chars.length > MAX_SHOP_CHARS ? `${chars.slice(0, MAX_SHOP_CHARS - 1).join('').trimEnd()}…` : name;
  }
  return null;
}

function fill(line: string, name: string | null): string {
  // A replacer function, so `$&` or `$$` in a shop name stay literal.
  if (name) return line.replaceAll('{Shop}', () => name);
  // "Your shop" opens a sentence; mid-sentence it reads "your shop".
  return line.replace(/^\{Shop\}/, 'Your shop').replaceAll('{Shop}', 'your shop');
}

/**
 * The reminders still ahead: 10:00 local on day 1, 3 and 7 after `anchor`
 * (default `now`), skipping any less than an hour away or already past, with
 * rotating copy. Nothing once published.
 */
export function buildReminderSchedule(now: Date, site: SiteRecord | null, anchor: Date = now): Reminder[] {
  // Published (a slug), or live per the account (a site loaded from it has a
  // URL but no slug): never "publish" reminders, also once it has lapsed.
  if (site && (site.slug != null || site.deployedUrl)) return [];
  const kind: ReminderKind = site ? 'finish' : 'start';
  const lines: readonly string[] = site ? FINISH_LINES : START_LINES;
  const name = site ? shopName(site) : null;
  const out: Reminder[] = [];
  for (const [i, days] of REMINDER_DAYS.entries()) {
    // Built from calendar fields (not +24 h) so DST changes keep 10:00 at 10:00.
    const at = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + days, SLOT_HOUR, 0, 0, 0);
    if (at.getTime() - now.getTime() < MIN_LEAD_MS) continue;
    out.push({ at, title: REMINDER_TITLE, body: fill(lines[i % lines.length], name), kind });
  }
  return out;
}

/** Our notifications' identifiers: `reminder-0` … `reminder-2`. Only these are ever cancelled. */
const ID_PREFIX = 'reminder-';

/** Cancels the pending reminders, leaving any other scheduled notification alone. */
async function cancelPending(N: Notifications): Promise<void> {
  const scheduled = await N.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if (n.identifier.startsWith(ID_PREFIX)) await N.cancelScheduledNotificationAsync(n.identifier);
  }
}

// Refreshes and cancels run one at a time, in call order: a cancel that
// arrives mid-refresh (a publish finishing) runs after it and wins.
let queue: Promise<unknown> = Promise.resolve();
function serial(fn: () => Promise<void>): Promise<void> {
  const run = queue.then(fn, fn).catch((e) => console.warn('[reminders]', e));
  queue = run;
  return run;
}

/**
 * At launch, on each return to the foreground, and after the permission
 * prompt: cancels and schedules the (up to 3) reminders still ahead. Only with permission,
 * for an unpublished user who hasn't paid; otherwise clears what is pending.
 * Never throws.
 */
/**
 * A one-off calendar trigger (UNCalendarNotificationTrigger) at the slot's
 * local wall-clock time, so 10:00 stays 10:00 after time-zone travel or a
 * clock change. The calendar trigger hands the fields to iOS DateComponents
 * as they are (unlike the yearly trigger, which adds 1), so month is 1-based.
 */
function calendarTrigger(N: Notifications, at: Date): NotificationsModule.CalendarTriggerInput {
  return {
    type: N.SchedulableTriggerInputTypes.CALENDAR,
    year: at.getFullYear(),
    month: at.getMonth() + 1,
    day: at.getDate(),
    hour: at.getHours(),
    minute: 0,
    second: 0,
    repeats: false,
  };
}

export function refreshReminders(): Promise<void> {
  return serial(async () => {
    const N = notifications();
    if (!N) return;
    const [site, pending, stopped, off, anchorRaw] = await Promise.all([
      loadSite(), loadPendingPublish(), Storage.getItem(STOPPED_KEY), Storage.getItem(OFF_KEY), Storage.getItem(ANCHOR_KEY),
    ]);
    const now = new Date();
    const stored = Number(anchorRaw);
    const anchor = anchorRaw && Number.isFinite(stored) && stored > 0 && stored <= now.getTime() ? new Date(stored) : now;
    // Paid and publishing (pendingPublish): not "unpaid", but not stopped for good either.
    // Switched off in Settings: nothing, until it is switched back on.
    const plan = stopped || off || pending ? [] : buildReminderSchedule(now, site, anchor);
    const granted = plan.length > 0 && (await N.getPermissionsAsync()).granted;
    await cancelPending(N);
    if (!granted) return;
    if (anchor === now) await Storage.setItem(ANCHOR_KEY, String(now.getTime())).catch(() => {});
    for (const [i, r] of plan.entries()) {
      await N.scheduleNotificationAsync({
        identifier: `${ID_PREFIX}${i}`,
        content: { title: r.title, body: r.body, data: { reminder: r.kind } },
        trigger: calendarTrigger(N, r.at),
      });
    }
    track('reminders_scheduled', { count: plan.length, kind: plan[0].kind });
  });
}

/**
 * Cancels every pending reminder. By default for good (publish success, a
 * payer's data deleted, account deleted): none are scheduled from then on.
 * `forGood: false` (an unpublished draft deleted) only clears them, so the
 * next refresh can schedule the start copy. Never throws.
 */
export function cancelAllReminders({ forGood = true }: { forGood?: boolean } = {}): Promise<void> {
  return serial(async () => {
    if (forGood) {
      await Storage.setItem(STOPPED_KEY, '1').catch((e) => console.warn('[reminders] could not save the stop flag:', e));
    }
    const N = notifications();
    if (N) await cancelPending(N);
  });
}

/**
 * cancelAllReminders for flows whose outcome must never depend on it
 * (publish, restore, purchase): not awaited, and a failure is only logged.
 */
export function cancelRemindersInBackground(opts?: { forGood?: boolean }): void {
  const warn = (e: unknown) => console.warn('[reminders] cancelling reminders failed:', e);
  try {
    cancelAllReminders(opts).catch(warn);
  } catch (e) {
    warn(e);
  }
}

/** True unless the user switched "Publish reminders" off in Settings. */
export async function remindersEnabled(): Promise<boolean> {
  return !(await Storage.getItem(OFF_KEY).catch(() => null));
}

export type SetRemindersResult = 'on' | 'off' | 'denied' | 'error';

/**
 * The Settings switch. Off: remembered, and every pending reminder is cancelled. On: if the system permission was
 * never given it is asked for now (after the same one-line explanation as at launch), and 'denied' tells the caller
 * to point at iOS Settings; the switch stays off then, so a relaunch agrees with what the screen showed. 'error':
 * the setting could not be saved or applied (nothing changed that the caller should show as done). Never throws.
 */
export async function setRemindersEnabled(on: boolean): Promise<SetRemindersResult> {
  try {
    if (!on) {
      await Storage.setItem(OFF_KEY, '1'); // throws: not off, say so
      await serial(async () => {
        const N = notifications();
        if (N) await cancelPending(N);
      });
      return 'off';
    }
    const N = notifications();
    if (N) {
      let perm = await N.getPermissionsAsync();
      if (!perm.granted && perm.status === 'undetermined') {
        await explainReminders();
        await Storage.setItem(ASKED_KEY, '1');
        perm = await N.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
      }
      if (!perm.granted) return 'denied'; // OFF_KEY is left as it was (off)
    }
    await Storage.removeItem(OFF_KEY);
    await refreshReminders();
    return 'on';
  } catch (e) {
    console.warn('[reminders] could not change the reminders switch:', e);
    return 'error';
  }
}

/** One line before the system prompt: what the reminders are and where to turn them off. Resolves when dismissed. */
function explainReminders(): Promise<void> {
  return new Promise((resolve) => {
    try {
      Alert.alert('Publish reminders', REMINDER_PRE_PERMISSION, [{ text: 'Continue', onPress: () => resolve() }], {
        cancelable: false,
        onDismiss: () => resolve(),
      });
    } catch {
      resolve();
    }
  });
}

/**
 * Asks for notification permission the first time only (from LaunchPrompts,
 * on the first screen after launch); after a decline it never asks again.
 * Always refreshes, so the copy matches whether a site exists yet. Only call
 * once Superwall has settled: SuperwallKit's debug build traps on a system
 * prompt before it has configured.
 */
export async function askReminderPermissionOnce(): Promise<boolean> {
  const N = notifications();
  if (!N) return false;
  let granted = false;
  try {
    let perm = await N.getPermissionsAsync();
    if (!(await Storage.getItem(ASKED_KEY))) {
      // The one-line explanation first (a kill while it shows asks again next launch), then the flag:
      // a crash mid-system-prompt still counts as asked.
      const ask = !perm.granted && perm.status === 'undetermined';
      if (ask) await explainReminders();
      await Storage.setItem(ASKED_KEY, '1');
      if (ask) {
        perm = await N.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
      }
    }
    granted = perm.granted;
  } catch (e) {
    console.warn('[reminders] permission request failed:', e);
  }
  await refreshReminders();
  return granted;
}

/** Our reminder's kind from a tap, or null for anything else. */
function kindOf(response: NotificationResponse | null | undefined): ReminderKind | null {
  const k = response?.notification?.request?.content?.data?.reminder;
  return k === 'finish' || k === 'start' ? k : null;
}

const handled = new Set<string>();
/** Tracks a reminder tap once (the launch response can also reach the listener). */
function handleResponse(response: NotificationResponse | null | undefined): ReminderKind | null {
  const kind = kindOf(response);
  if (!kind || !response) return null;
  const id = response.notification.request.identifier;
  if (handled.has(id)) return null;
  handled.add(id);
  track('reminder_opened', { kind });
  return kind;
}

/** Calls `cb` for each reminder tapped while the app runs. Returns the unsubscribe. */
export function onReminderTap(cb: (kind: ReminderKind) => void): () => void {
  const N = notifications();
  if (!N) return () => {};
  try {
    const sub = N.addNotificationResponseReceivedListener((r) => {
      const kind = handleResponse(r);
      if (kind) cb(kind);
    });
    return () => sub.remove();
  } catch (e) {
    console.warn('[reminders] tap listener failed:', e);
    return () => {};
  }
}

/** The reminder that cold-started the app, once; null otherwise. */
export function takeLaunchReminderTap(): ReminderKind | null {
  const N = notifications();
  if (!N) return null;
  try {
    const response = N.getLastNotificationResponse();
    const kind = handleResponse(response);
    if (kind) N.clearLastNotificationResponse();
    return kind;
  } catch {
    return null;
  }
}

/** Screens where a tap must not move the user: mid-import, generating, publishing. */
const IMPORT_FLOW = ['/start', '/booking-link', '/find-listing', '/manual', '/import-review', '/generating'];
const NEVER_LEAVE = ['/import-review', '/generating', '/publishing', '/live'];

export type TapRoute = { go: '/edit' | '/start' } | { wait: true } | { stay: true };

/**
 * Where a reminder tap goes: the Edit tab when a site exists, else the start
 * screen. Waits while the index is still picking the launch screen, and
 * stays put mid-publish or when already where it would go.
 */
export function routeForReminderTap(site: SiteRecord | null, pathname: string, publishing: boolean): TapRoute {
  if (pathname === '/') return { wait: true };
  if (publishing || NEVER_LEAVE.includes(pathname)) return { stay: true };
  if (site) return pathname === '/edit' ? { stay: true } : { go: '/edit' };
  return IMPORT_FLOW.includes(pathname) ? { stay: true } : { go: '/start' };
}
