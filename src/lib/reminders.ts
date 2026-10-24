import { requireOptionalNativeModule } from 'expo';
import Storage from 'expo-sqlite/kv-store';
import type * as NotificationsModule from 'expo-notifications';
import { track } from '@/lib/analytics';
import { stripMarkers } from '@/lib/editable';
import { loadPendingPublish, loadSite, type SiteRecord } from '@/lib/siteStore';

/**
 * Publish reminders (Task 10b): local notifications at 10:00 and 18:00 until
 * the site is published. Barbers with an unpublished draft get the "finish"
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
  "Clients are searching for barbers near you. Publish {Shop}'s website today.",
] as const;
export const START_LINES = [
  'Build your barbershop website in 60 seconds — just paste your booking link.',
  'Your shop deserves a real website. Make yours now ✂️',
] as const;

/** 10:00 and 18:00 local. 60 one-off reminders (30 days), under iOS's 64 pending. */
const SLOT_HOURS = [10, 18] as const;
const COUNT = 60;
const MIN_LEAD_MS = 60 * 60 * 1000;
/** Keeps the longest line under 110 characters. */
const MAX_SHOP_CHARS = 30;

const ASKED_KEY = 'reminders.asked.v1';
/** Set on publish success and on delete: no reminders from then on. */
const STOPPED_KEY = 'reminders.stopped.v1';

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

/** Days since the epoch for a local calendar date, so the rotation doesn't restart on each refresh. */
const dayNumber = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);

/**
 * The next 60 slots at 10:00 / 18:00 local that are at least an hour away
 * (a closer one is skipped), with rotating copy. Nothing once published.
 */
export function buildReminderSchedule(now: Date, site: SiteRecord | null): Reminder[] {
  // Published (a slug), or live per the account (a site loaded from it has a
  // URL but no slug): never "publish" reminders, also once it has lapsed.
  if (site && (site.slug != null || site.deployedUrl)) return [];
  const kind: ReminderKind = site ? 'finish' : 'start';
  const lines: readonly string[] = site ? FINISH_LINES : START_LINES;
  const name = site ? shopName(site) : null;
  const out: Reminder[] = [];
  for (let day = 0; out.length < COUNT; day++) {
    for (let s = 0; s < SLOT_HOURS.length && out.length < COUNT; s++) {
      // Built from calendar fields (not +24 h) so DST changes keep 10:00 at 10:00.
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, SLOT_HOURS[s], 0, 0, 0);
      if (at.getTime() - now.getTime() < MIN_LEAD_MS) continue;
      const slot = dayNumber(at) * SLOT_HOURS.length + s;
      out.push({ at, title: REMINDER_TITLE, body: fill(lines[slot % lines.length], name), kind });
    }
  }
  return out;
}

/** Our notifications' identifiers: `reminder-0` … `reminder-59`. Only these are ever cancelled. */
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
 * prompt: cancels and schedules the next 60 reminders. Only with permission,
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
    const [site, pending, stopped] = await Promise.all([loadSite(), loadPendingPublish(), Storage.getItem(STOPPED_KEY)]);
    // Paid and publishing (pendingPublish): not "unpaid", but not stopped for good either.
    const plan = stopped || pending ? [] : buildReminderSchedule(new Date(), site);
    const granted = plan.length > 0 && (await N.getPermissionsAsync()).granted;
    await cancelPending(N);
    if (!granted) return;
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
      // Flag first: a crash mid-prompt still counts as asked.
      await Storage.setItem(ASKED_KEY, '1');
      if (!perm.granted && perm.status === 'undetermined') {
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
