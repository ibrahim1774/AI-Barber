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

export const REMINDER_TITLE = 'AI Barber';
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
/** expo-notifications, or null when the build lacks its native module (warned once). */
function notifications(): Notifications | null {
  if (mod !== undefined) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('expo-notifications') as Notifications;
  } catch (e) {
    mod = null;
    console.warn('[reminders] expo-notifications is not in this build; publish reminders are off.', e);
  }
  return mod;
}

function shopName(site: SiteRecord): string | null {
  for (const raw of [site.data?.shopName, site.inputs?.shopName]) {
    const name = typeof raw === 'string' ? stripMarkers(raw).replace(/\s+/g, ' ').trim() : '';
    if (name) return name.length > MAX_SHOP_CHARS ? `${name.slice(0, MAX_SHOP_CHARS - 1).trimEnd()}…` : name;
  }
  return null;
}

function fill(line: string, name: string | null): string {
  if (name) return line.replaceAll('{Shop}', name);
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
  if (site && site.slug != null) return [];
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
export function refreshReminders(): Promise<void> {
  return serial(async () => {
    const N = notifications();
    if (!N) return;
    const [site, pending, stopped] = await Promise.all([loadSite(), loadPendingPublish(), Storage.getItem(STOPPED_KEY)]);
    // Paid and publishing (pendingPublish): not "unpaid", but not stopped for good either.
    const plan = stopped || pending ? [] : buildReminderSchedule(new Date(), site);
    const granted = plan.length > 0 && (await N.getPermissionsAsync()).granted;
    await N.cancelAllScheduledNotificationsAsync();
    if (!granted) return;
    for (const r of plan) {
      await N.scheduleNotificationAsync({
        content: { title: r.title, body: r.body, data: { reminder: r.kind } },
        trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: r.at },
      });
    }
    track('reminders_scheduled', { count: plan.length, kind: plan[0].kind });
  });
}

/**
 * Publish success and data/account deletion: cancels every pending reminder
 * and schedules none from then on. Never throws.
 */
export function cancelAllReminders(): Promise<void> {
  return serial(async () => {
    await Storage.setItem(STOPPED_KEY, '1').catch((e) => console.warn('[reminders] could not save the stop flag:', e));
    await notifications()?.cancelAllScheduledNotificationsAsync();
  });
}

/**
 * Asks for notification permission the first time only (LaunchGuide close,
 * or the first tap out of the start screen); after a decline it never asks
 * again. Always refreshes, so the copy matches whether a site exists yet.
 * Never call at launch: SuperwallKit's debug build traps on a system prompt
 * before it has configured.
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
    if (response && kindOf(response)) N.clearLastNotificationResponse();
    return kind;
  } catch {
    return null;
  }
}

/** Screens where a tap must not move the user: mid-import, generating, publishing. */
const IMPORT_FLOW = ['/start', '/booking-link', '/find-listing', '/manual', '/generating'];
const NEVER_LEAVE = ['/generating', '/publishing', '/live'];

export type TapRoute = { go: '/editor' | '/start' } | { wait: true } | { stay: true };

/**
 * Where a reminder tap goes: the editor when a site exists, else the start
 * screen. Waits while the index is still picking the launch screen, and
 * stays put mid-publish or when already where it would go.
 */
export function routeForReminderTap(site: SiteRecord | null, pathname: string, publishing: boolean): TapRoute {
  if (pathname === '/') return { wait: true };
  if (publishing || NEVER_LEAVE.includes(pathname)) return { stay: true };
  if (site) return pathname === '/editor' ? { stay: true } : { go: '/editor' };
  return IMPORT_FLOW.includes(pathname) ? { stay: true } : { go: '/start' };
}
