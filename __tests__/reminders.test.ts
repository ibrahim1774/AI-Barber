// Publish reminders: local notifications twice a day until the site is published.
// jest.config.js pins TZ to America/New_York, so the 30-day window really crosses a DST change.
import { Alert } from 'react-native';
import Storage from 'expo-sqlite/kv-store';
import * as analytics from '@/lib/analytics';
import * as store from '@/lib/siteStore';
import { publishFlow, type PublishDeps } from '@/lib/publish';
import { api, ApiError } from '@/lib/api';
import { deleteAccountAndData, deleteLocalData, restore as restoreRaw, type Restored, type RestoreDeps } from '@/lib/account';
import {
  askReminderPermissionOnce, buildReminderSchedule, cancelAllReminders, FINISH_LINES, onReminderTap, refreshReminders,
  REMINDER_PRE_PERMISSION, remindersEnabled, routeForReminderTap, setRemindersEnabled, START_LINES, takeLaunchReminderTap,
} from '@/lib/reminders';
import type { SiteRecord } from '@/lib/siteStore';

/** restore() narrowed to a restored site: these tests are signed in with an active site to bring back. */
const restore = async (d: RestoreDeps) => (await restoreRaw(d)) as Restored | null;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { nt } = require('expo-notifications');

const M = '⁣'; // editor marker character

const draft = {
  draftId: 'd1',
  inputs: { shopName: 'Fade Inputs' },
  data: {
    shopName: `Fade${M} Factory`,
    area: 'Brooklyn, NY',
    phone: '555',
    hero: { heading: 'Sharp', tagline: 't', imageUrl: '' },
    about: { heading: 'About', description: ['one'], imageUrl: '' },
    services: [],
    gallery: [],
  },
  updatedAt: 1,
  slug: null,
  deployedUrl: null,
  transactionId: null,
} as unknown as SiteRecord;
const published = { ...draft, slug: 'fade-factory', deployedUrl: 'https://fade-factory.aibarber.org' } as SiteRecord;

const LIVE = { siteId: 'fade-factory', deployedUrl: 'https://fade-factory.aibarber.org', republished: false };
function publishDeps(over: Partial<PublishDeps> = {}): PublishDeps {
  return {
    hasEntitlement: jest.fn(async () => true),
    showPaywall: jest.fn(async () => 'purchased' as const),
    latestTransactionId: jest.fn(async () => 'tx-1'),
    iosPublish: jest.fn(async () => LIVE),
    store,
    accessToken: async () => 'tok',
    claimStart: jest.fn(async () => ({ ok: true as const, state: 'unclaimed' as const, claimExpiresAt: '2026-11-25T00:00:00.000Z' })),
    ...over,
  };
}

/** Lets fire-and-forget work (the publish's reminder cancel) finish. */
const flush = () => new Promise((r) => setImmediate(r));

// 2026-10-20 09:00 local: crosses the US DST change on Nov 1 within the 30 days.
const NOW = new Date(2026, 9, 20, 9, 0, 0, 0);
let alertSpy: jest.SpyInstance;

beforeEach(async () => {
  nt.reset();
  await Storage.removeItem('reminders.asked.v1');
  await Storage.removeItem('reminders.stopped.v1');
  await Storage.removeItem('reminders.off.v1');
  await Storage.removeItem('reminders.anchor.v1');
  await store.clearSite();
  await store.savePendingPublish(null);
  jest.restoreAllMocks();
  // The pre-permission line: pressing its only button continues to the system prompt.
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, btns) => btns?.[btns.length - 1]?.onPress?.());
});

test('schedule is three reminders at 10:00 local, on day 1, 3 and 7', () => {
  const plan = buildReminderSchedule(NOW, draft);
  expect(plan).toHaveLength(3);
  expect(plan.map((r) => [r.at.getMonth(), r.at.getDate(), r.at.getHours(), r.at.getMinutes(), r.at.getSeconds()])).toEqual([
    [9, 21, 10, 0, 0],
    [9, 23, 10, 0, 0],
    [9, 27, 10, 0, 0],
  ]);
  for (const r of plan) {
    expect(r.title).toBe('Prime Barber');
    expect(r.at.getTime()).toBeGreaterThan(NOW.getTime());
  }
});

test('days count from the anchor, so a later refresh does not push them out; past ones are dropped', () => {
  const anchor = NOW;
  // Day 4 after the anchor: only day 7 is still ahead.
  const later = buildReminderSchedule(new Date(2026, 9, 24, 9), draft, anchor);
  expect(later.map((r) => r.at.getDate())).toEqual([27]);
  // After day 7 nothing is left: no nagging for ever.
  expect(buildReminderSchedule(new Date(2026, 9, 28, 9), draft, anchor)).toEqual([]);
  // Day 7 crosses the end of US daylight time (Nov 1) when started on Oct 26: still 10:00.
  const dst = buildReminderSchedule(new Date(2026, 9, 26, 9), draft);
  expect(dst.map((r) => [r.at.getMonth(), r.at.getDate(), r.at.getHours()])).toEqual([[9, 27, 10], [9, 29, 10], [10, 2, 10]]);
});

test('no reminders once the site is published', async () => {
  expect(buildReminderSchedule(NOW, published)).toEqual([]);
  nt.status = 'granted';
  await store.saveSite(draft);
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(3);
  await store.saveSite(published);
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(0);
});

test('no reminders for a live site loaded from the account (URL, no slug), lapsed or not', async () => {
  const adopted = { ...draft, deployedUrl: 'https://fade-factory.aibarber.org' } as SiteRecord;
  expect(buildReminderSchedule(NOW, adopted)).toEqual([]);
  nt.status = 'granted';
  await store.saveSite(adopted);
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(0);
});

test('start copy when there is no site, finish copy with the shop name when there is', () => {
  const start = buildReminderSchedule(NOW, null);
  expect(start).toHaveLength(3);
  for (const r of start) {
    expect(r.kind).toBe('start');
    expect(START_LINES).toContain(r.body);
  }
  const finish = buildReminderSchedule(NOW, draft);
  for (const r of finish) {
    expect(r.kind).toBe('finish');
    expect(r.body).not.toContain('{Shop}');
    expect(r.body).not.toContain(M);
    expect(r.body.length).toBeLessThan(110);
  }
  const bodies = new Set(finish.map((r) => r.body));
  expect(bodies).toEqual(
    new Set([
      'Fade Factory is almost live ✂️ — publish your website in under a minute.',
      'Your barbershop website is ready. Tap to publish it and start getting bookings.',
      "Don't leave Fade Factory offline — your site is one tap from live.",
    ]),
  );
});

test('copy rotates and never repeats the same line twice in a row', () => {
  for (const site of [draft, null]) {
    const plan = buildReminderSchedule(NOW, site);
    for (let i = 1; i < plan.length; i++) expect(plan[i].body).not.toBe(plan[i - 1].body);
  }
  // Every finish line is used once.
  const today = buildReminderSchedule(NOW, draft);
  expect(new Set(today.map((r) => r.body)).size).toBe(3);
  expect(FINISH_LINES).toHaveLength(3);
  // No promotional "clients are searching" copy.
  expect([...FINISH_LINES, ...START_LINES].join(' ')).not.toMatch(/searching/i);
});

test('{Shop} falls back to the inputs, then to "Your shop"', () => {
  const fromInputs = { ...draft, data: { ...draft.data, shopName: ` ${M} ` } } as SiteRecord;
  const a = buildReminderSchedule(NOW, fromInputs).map((r) => r.body);
  expect(a).toContain('Fade Inputs is almost live ✂️ — publish your website in under a minute.');
  const none = { ...draft, data: { ...draft.data, shopName: '' }, inputs: { shopName: '' } } as unknown as SiteRecord;
  const b = buildReminderSchedule(NOW, none).map((r) => r.body);
  expect(b).toContain('Your shop is almost live ✂️ — publish your website in under a minute.');
  // Mid-sentence the fallback is lower case.
  expect(b).toContain("Don't leave your shop offline — your site is one tap from live.");
  // A very long name is cut so every line stays under 110 characters.
  const long = { ...draft, data: { ...draft.data, shopName: 'X'.repeat(80) } } as SiteRecord;
  for (const r of buildReminderSchedule(NOW, long)) expect(r.body.length).toBeLessThan(110);
});

test('skips a reminder less than an hour away', () => {
  const anchor = new Date(2026, 9, 20, 9, 0);
  // 09:30 on day 1 is 30 minutes before the 10:00 reminder: skipped.
  const plan = buildReminderSchedule(new Date(2026, 9, 21, 9, 30), draft, anchor);
  expect(plan.map((r) => r.at.getDate())).toEqual([23, 27]);
  // Exactly an hour away still counts.
  expect(buildReminderSchedule(new Date(2026, 9, 21, 9, 0), draft, anchor)).toHaveLength(3);
});

test('permission is asked once', async () => {
  nt.answer = 'denied';
  await store.saveSite(draft);
  expect(await askReminderPermissionOnce()).toBe(false);
  expect(nt.requests).toBe(1);
  expect(await askReminderPermissionOnce()).toBe(false);
  expect(nt.requests).toBe(1);
  // Declined: nothing is scheduled, now or on a later foreground.
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(0);
});

test('the system prompt is preceded by the one-line explanation, once', async () => {
  nt.answer = 'granted';
  const order: string[] = [];
  alertSpy.mockImplementation((_t, _m, btns) => { order.push('line'); btns?.[btns.length - 1]?.onPress?.(); });
  const req = jest.spyOn(require('expo-notifications'), 'requestPermissionsAsync');
  req.mockImplementation(async () => { order.push('system'); return { granted: true, status: 'granted' } as never; });
  await askReminderPermissionOnce();
  expect(order).toEqual(['line', 'system']);
  expect(alertSpy.mock.calls[0][1]).toBe("We\u2019ll remind you to publish your site. Turn off anytime in Settings.");
  expect(REMINDER_PRE_PERMISSION).toBe(alertSpy.mock.calls[0][1]);
  await askReminderPermissionOnce();
  expect(alertSpy).toHaveBeenCalledTimes(1);
});

test('no explanation line when permission was already decided', async () => {
  nt.status = 'granted';
  await askReminderPermissionOnce();
  expect(alertSpy).not.toHaveBeenCalled();
});

test('the anchor is set at the first schedule and kept, so days 1/3/7 do not slide', async () => {
  nt.status = 'granted';
  await refreshReminders();
  const first = Number(await Storage.getItem('reminders.anchor.v1'));
  expect(first).toBeGreaterThan(0);
  await refreshReminders();
  expect(Number(await Storage.getItem('reminders.anchor.v1'))).toBe(first);
  // An anchor 5 days old: only day 7 is still ahead.
  await Storage.setItem('reminders.anchor.v1', String(Date.now() - 5 * 86_400_000));
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(1);
});

test('Publish reminders switch: off cancels and stays off; on schedules again', async () => {
  nt.status = 'granted';
  await store.saveSite(draft);
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(3);
  expect(await remindersEnabled()).toBe(true);
  expect(await setRemindersEnabled(false)).toBe('off');
  expect(nt.scheduled).toHaveLength(0);
  expect(await remindersEnabled()).toBe(false);
  // Launch / foreground refreshes respect it.
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(0);
  await askReminderPermissionOnce();
  expect(nt.scheduled).toHaveLength(0);
  expect(await setRemindersEnabled(true)).toBe('on');
  expect(await remindersEnabled()).toBe(true);
  expect(nt.scheduled).toHaveLength(3);
});

test('switching on with notifications denied asks the caller to point at iOS Settings', async () => {
  nt.status = 'denied';
  expect(await setRemindersEnabled(true)).toBe('denied');
  expect(nt.scheduled).toHaveLength(0);
});

test('L3: denied on a switch-on leaves the switch off, so a relaunch agrees', async () => {
  await setRemindersEnabled(false);
  nt.status = 'denied';
  expect(await setRemindersEnabled(true)).toBe('denied');
  expect(await remindersEnabled()).toBe(false);
});

test('L3: a storage failure is an error, not "denied" or a silent "off"', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const set = jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('disk'));
  expect(await setRemindersEnabled(false)).toBe('error');
  set.mockRestore();
  nt.status = 'granted';
  const rm = jest.spyOn(Storage, 'removeItem').mockRejectedValueOnce(new Error('disk'));
  expect(await setRemindersEnabled(true)).toBe('error');
  rm.mockRestore();
});

test('switching off leaves notifications that are not reminders alone', async () => {
  nt.status = 'granted';
  nt.scheduled.push({ identifier: 'other-1', content: { title: 'x' }, trigger: null });
  await refreshReminders();
  await setRemindersEnabled(false);
  expect(nt.scheduled.map((r: any) => r.identifier)).toEqual(['other-1']);
});

test('a granted permission schedules at once, and later asks only refresh', async () => {
  const spy = jest.spyOn(analytics, 'track');
  expect(await askReminderPermissionOnce()).toBe(true);
  expect(nt.requests).toBe(1);
  expect(nt.scheduled).toHaveLength(3);
  expect(nt.scheduled[0].content.data).toEqual({ reminder: 'start' });
  // A one-off calendar trigger at the local wall-clock time (iOS months are 1-based).
  const first = buildReminderSchedule(new Date(), null)[0].at;
  expect(nt.scheduled[0].identifier).toBe('reminder-0');
  expect(nt.scheduled[2].identifier).toBe('reminder-2');
  expect(nt.scheduled[3]).toBeUndefined();
  expect(nt.scheduled[0].trigger).toEqual({
    type: 'calendar',
    year: first.getFullYear(),
    month: first.getMonth() + 1,
    day: first.getDate(),
    hour: first.getHours(),
    minute: 0,
    second: 0,
    repeats: false,
  });
  expect(spy).toHaveBeenCalledWith('reminders_scheduled', { count: 3, kind: 'start' });
  // Site generated: closing the LaunchGuide doesn't ask again but switches to finish copy.
  await store.saveSite(draft);
  expect(await askReminderPermissionOnce()).toBe(true);
  expect(nt.requests).toBe(1);
  expect(nt.scheduled).toHaveLength(3);
  expect(nt.scheduled.every((r: any) => r.content.data.reminder === 'finish')).toBe(true);
});

test('publish success cancels reminders', async () => {
  nt.status = 'granted';
  await store.saveSite(draft);
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(3);
  const out = await publishFlow(draft, publishDeps());
  expect(out.kind).toBe('live');
  await flush();
  expect(nt.scheduled).toHaveLength(0);
});

test('a refresh racing a publish still ends with nothing scheduled', async () => {
  nt.status = 'granted';
  await store.saveSite(draft);
  const refresh = refreshReminders();
  await publishFlow(draft, publishDeps());
  await refresh;
  await flush();
  expect(nt.scheduled).toHaveLength(0);
});

test('a failing cancel never affects the publish', async () => {
  nt.status = 'granted';
  await store.saveSite(draft);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const notifications = require('expo-notifications');
  const spy = jest.spyOn(notifications, 'getAllScheduledNotificationsAsync').mockRejectedValue(new Error('boom'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const out = await publishFlow(draft, publishDeps());
  expect(out.kind).toBe('live');
  await refreshReminders();
  spy.mockRestore();
  warn.mockRestore();
});

test('paid but not yet live: no "publish your site" reminders', async () => {
  nt.status = 'granted';
  await store.saveSite(draft);
  await refreshReminders();
  await store.savePendingPublish({ transactionId: 'tx-1', data: draft.data, createdAt: Date.now() });
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(0);
  // The pending publish dropped (unconfirmed): reminders come back.
  await store.savePendingPublish(null);
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(3);
});

test('deleting an unpublished draft clears its reminders; start copy can follow', async () => {
  nt.status = 'granted';
  await store.saveSite(draft);
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(3);
  await deleteLocalData();
  // The shop-name "finish" reminders are gone at once.
  expect(nt.scheduled).toHaveLength(0);
  expect(await store.loadSite()).toBeNull();
  // Unpaid, no site: the next foreground schedules the start copy.
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(3);
  expect(nt.scheduled.every((r: any) => r.content.data.reminder === 'start')).toBe(true);
});

test("deleting a payer's data cancels reminders for good", async () => {
  nt.status = 'granted';
  await store.saveSite({ ...draft, transactionId: 'tx-1' });
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(3);
  await deleteLocalData();
  expect(nt.scheduled).toHaveLength(0);
  // No site now, but no "start" reminders either.
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(0);
});

test('deleting the account cancels reminders for good', async () => {
  nt.status = 'granted';
  await store.saveSite(draft);
  await refreshReminders();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { sb } = require('@/lib/supabase');
  sb.setSession({ access_token: 'access-123', user: { id: 'u1', email: 'b@example.com' } });
  jest.spyOn(api, 'deleteAccount').mockResolvedValue(undefined);
  await deleteAccountAndData();
  expect(nt.scheduled).toHaveLength(0);
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(0);
});

test('cancelAllReminders stops later refreshes', async () => {
  nt.status = 'granted';
  await cancelAllReminders();
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(0);
});

test('tap routing: the Edit tab with a site, start without, never mid-publish or before launch routing', () => {
  expect(routeForReminderTap(draft, '/settings', false)).toEqual({ go: '/edit' });
  expect(routeForReminderTap(draft, '/sign-in', false)).toEqual({ go: '/edit' });
  // Old links (the Dashboard redirect) still land on the Edit tab.
  expect(routeForReminderTap(draft, '/dashboard', false)).toEqual({ go: '/edit' });
  expect(routeForReminderTap(null, '/settings', false)).toEqual({ go: '/start' });
  expect(routeForReminderTap(null, '/dashboard', false)).toEqual({ go: '/start' });
  // Launch: the index is still choosing a screen.
  expect(routeForReminderTap(draft, '/', false)).toEqual({ wait: true });
  // Already there, mid-import, or mid-publish: stay.
  expect(routeForReminderTap(draft, '/edit', false)).toEqual({ stay: true });
  expect(routeForReminderTap(null, '/start', false)).toEqual({ stay: true });
  expect(routeForReminderTap(null, '/booking-link', false)).toEqual({ stay: true });
  expect(routeForReminderTap(null, '/generating', false)).toEqual({ stay: true });
  // The review after an import: the draft is saved, but a tap must not skip the review.
  expect(routeForReminderTap(draft, '/import-review', false)).toEqual({ stay: true });
  expect(routeForReminderTap(draft, '/publishing', false)).toEqual({ stay: true });
  expect(routeForReminderTap(draft, '/settings', true)).toEqual({ stay: true });
});

test('a tap is tracked once with its kind; other notifications are ignored', async () => {
  const spy = jest.spyOn(analytics, 'track');
  const taps: string[] = [];
  const unsub = onReminderTap((kind) => taps.push(kind));
  const r = nt.tap({ reminder: 'finish' });
  // The same response again (e.g. also the launch response) is not a second tap.
  for (const l of [...nt.listeners]) l(r);
  expect(await takeLaunchReminderTap()).toBeNull();
  nt.tap({ other: true });
  expect(taps).toEqual(['finish']);
  expect(spy.mock.calls.filter((c) => c[0] === 'reminder_opened')).toEqual([['reminder_opened', { kind: 'finish' }]]);
  unsub();
});

const coldResponse = (identifier: string) => ({
  actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
  notification: { date: 1, request: { identifier, content: { data: { reminder: 'start' } }, trigger: null } },
});

test('a cold start from a reminder is picked up once', async () => {
  const spy = jest.spyOn(analytics, 'track');
  nt.lastResponse = coldResponse('cold-1');
  expect(await takeLaunchReminderTap()).toBe('start');
  expect(nt.lastResponse).toBeNull();
  expect(await takeLaunchReminderTap()).toBeNull();
  expect(spy).toHaveBeenCalledWith('reminder_opened', { kind: 'start' });
});

test('without the native module everything is a quiet no-op', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await jest.isolateModulesAsync(async () => {
    jest.doMock('expo-notifications', () => {
      throw new Error("Cannot find native module 'ExpoNotificationScheduler'");
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const r = require('@/lib/reminders');
    expect(await r.askReminderPermissionOnce()).toBe(false);
    await r.refreshReminders();
    await r.cancelAllReminders();
    expect(await r.takeLaunchReminderTap()).toBeNull();
    r.onReminderTap(() => {})();
  });
  expect(warn).toHaveBeenCalledTimes(1);
  // Not marked as asked: the next build with the module still asks.
  expect(await Storage.getItem('reminders.asked.v1')).toBeNull();
});

test('a build without the native module never even loads expo-notifications', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const load = jest.fn();
  await jest.isolateModulesAsync(async () => {
    jest.doMock('expo', () => ({ requireOptionalNativeModule: () => null }));
    jest.doMock('expo-notifications', () => {
      load();
      return {};
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const r = require('@/lib/reminders');
    expect(await r.askReminderPermissionOnce()).toBe(false);
    await r.refreshReminders();
    expect(await r.takeLaunchReminderTap()).toBeNull();
  });
  expect(load).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledTimes(1);
});

test('cancelling leaves notifications that are not reminders alone', async () => {
  nt.status = 'granted';
  await store.saveSite(draft);
  nt.scheduled.push({ identifier: 'other-1', content: { title: 'x' }, trigger: null });
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(4);
  await cancelAllReminders();
  expect(nt.scheduled.map((r: any) => r.identifier)).toEqual(['other-1']);
});

test('shop names with $ patterns or emoji are kept as typed', () => {
  const dollars = { ...draft, data: { ...draft.data, shopName: "$& $$ $` Cuts" } } as SiteRecord;
  expect(buildReminderSchedule(NOW, dollars).map((r) => r.body)).toContain(
    "$& $$ $` Cuts is almost live ✂️ — publish your website in under a minute.",
  );
  // 28 letters then an emoji (a surrogate pair) across the cut: never half an emoji.
  const emoji = { ...draft, data: { ...draft.data, shopName: `${'A'.repeat(28)}💈💈 Shop` } } as SiteRecord;
  const body = buildReminderSchedule(NOW, emoji).map((r) => r.body).find((b) => b.endsWith('under a minute.'))!;
  expect(body.startsWith(`${'A'.repeat(28)}💈… is almost live`)).toBe(true);
  expect(body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
});

test('a restore cancels reminders for good', async () => {
  nt.status = 'granted';
  await store.saveSite(draft);
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(3);
  const deps: RestoreDeps = {
    accessToken: async () => 'tok',
    restorePurchases: jest.fn(async () => undefined),
    latestTransactionId: jest.fn(async () => 'tx-9'),
    iosSite: jest.fn(async () => ({
      siteId: 'fade-factory',
      deployedUrl: 'https://fade-factory.aibarber.org',
      siteData: draft.data,
      active: true,
    })) as unknown as RestoreDeps['iosSite'],
    store,
  };
  const res = await restore(deps);
  expect(res?.site.slug).toBe('fade-factory');
  await flush();
  expect(nt.scheduled).toHaveLength(0);
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(0);
});

test('a purchase pauses reminders at once, even while the publish is still pending', async () => {
  nt.status = 'granted';
  await store.saveSite(draft);
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(3);
  const out = await publishFlow(
    draft,
    publishDeps({
      hasEntitlement: jest.fn(async () => false),
      iosPublish: jest.fn(async () => {
        throw new ApiError(503, 'temporarily-unavailable', 'later');
      }),
    }),
  );
  expect(out.kind).toBe('pending');
  await flush();
  expect(nt.scheduled).toHaveLength(0);
});
