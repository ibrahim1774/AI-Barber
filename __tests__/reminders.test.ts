// Publish reminders: local notifications twice a day until the site is published.
// jest.config.js pins TZ to America/New_York, so the 30-day window really crosses a DST change.
import Storage from 'expo-sqlite/kv-store';
import * as analytics from '@/lib/analytics';
import * as store from '@/lib/siteStore';
import { publishFlow, type PublishDeps } from '@/lib/publish';
import { api, ApiError } from '@/lib/api';
import { deleteAccountAndData, deleteLocalData, restore, type RestoreDeps } from '@/lib/account';
import {
  askReminderPermissionOnce, buildReminderSchedule, cancelAllReminders, FINISH_LINES, onReminderTap, refreshReminders,
  routeForReminderTap, START_LINES, takeLaunchReminderTap,
} from '@/lib/reminders';
import type { SiteRecord } from '@/lib/siteStore';
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
    userId: () => null,
    ...over,
  };
}

/** Lets fire-and-forget work (the publish's reminder cancel) finish. */
const flush = () => new Promise((r) => setImmediate(r));

// 2026-10-20 09:00 local: crosses the US DST change on Nov 1 within the 30 days.
const NOW = new Date(2026, 9, 20, 9, 0, 0, 0);

beforeEach(async () => {
  nt.reset();
  await Storage.removeItem('reminders.asked.v1');
  await Storage.removeItem('reminders.stopped.v1');
  await store.clearSite();
  await store.savePendingPublish(null);
  jest.restoreAllMocks();
});

test('schedule has two reminders a day for 30 days at 10:00 and 18:00 local', () => {
  const plan = buildReminderSchedule(NOW, draft);
  expect(plan).toHaveLength(60);
  plan.forEach((r, i) => {
    expect(r.at.getHours()).toBe(i % 2 === 0 ? 10 : 18);
    expect(r.at.getMinutes()).toBe(0);
    expect(r.at.getSeconds()).toBe(0);
    const day = Math.floor(i / 2);
    const expected = new Date(2026, 9, 20 + day);
    expect([r.at.getFullYear(), r.at.getMonth(), r.at.getDate()]).toEqual([
      expected.getFullYear(), expected.getMonth(), expected.getDate(),
    ]);
    expect(r.title).toBe('AI Barber');
    expect(r.at.getTime()).toBeGreaterThan(NOW.getTime());
  });
  // The window crosses the end of US daylight time (Nov 1).
  expect(plan[0].at.getTimezoneOffset()).not.toBe(plan[59].at.getTimezoneOffset());
  // The last one is on day 30 (Nov 18 evening); under iOS's 64 pending limit.
  expect(plan[59].at.getDate()).toBe(18);
  expect(plan[59].at.getMonth()).toBe(10);
});

test('no reminders once the site is published', async () => {
  expect(buildReminderSchedule(NOW, published)).toEqual([]);
  nt.status = 'granted';
  await store.saveSite(draft);
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(60);
  await store.saveSite(published);
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(0);
});

test('start copy when there is no site, finish copy with the shop name when there is', () => {
  const start = buildReminderSchedule(NOW, null);
  expect(start).toHaveLength(60);
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
      "Clients are searching for barbers near you. Publish Fade Factory's website today.",
    ]),
  );
});

test('copy rotates and never repeats the same line twice in a row', () => {
  for (const site of [draft, null]) {
    const plan = buildReminderSchedule(NOW, site);
    for (let i = 1; i < plan.length; i++) expect(plan[i].body).not.toBe(plan[i - 1].body);
  }
  // Every finish line is used, and a refresh a day later doesn't restart at line 1.
  const today = buildReminderSchedule(NOW, draft);
  expect(new Set(today.slice(0, 4).map((r) => r.body)).size).toBe(4);
  const tomorrow = buildReminderSchedule(new Date(2026, 9, 21, 9), draft);
  expect(tomorrow[0].body).toBe(today[2].body);
  expect(FINISH_LINES).toHaveLength(4);
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
  expect(b).toContain("Clients are searching for barbers near you. Publish your shop's website today.");
  // A very long name is cut so every line stays under 110 characters.
  const long = { ...draft, data: { ...draft.data, shopName: 'X'.repeat(80) } } as SiteRecord;
  for (const r of buildReminderSchedule(NOW, long)) expect(r.body.length).toBeLessThan(110);
});

test('skips a slot less than an hour away', () => {
  const plan = buildReminderSchedule(new Date(2026, 9, 20, 9, 30), draft);
  expect(plan).toHaveLength(60);
  expect(plan[0].at.getHours()).toBe(18);
  expect(plan[0].at.getDate()).toBe(20);
  // Exactly an hour away still counts.
  expect(buildReminderSchedule(new Date(2026, 9, 20, 17, 0), draft)[0].at.getHours()).toBe(18);
  // After 18:00 the first reminder is tomorrow morning.
  const late = buildReminderSchedule(new Date(2026, 9, 20, 21, 0), draft);
  expect([late[0].at.getDate(), late[0].at.getHours()]).toEqual([21, 10]);
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

test('a granted permission schedules at once, and later asks only refresh', async () => {
  const spy = jest.spyOn(analytics, 'track');
  expect(await askReminderPermissionOnce()).toBe(true);
  expect(nt.requests).toBe(1);
  expect(nt.scheduled).toHaveLength(60);
  expect(nt.scheduled[0].content.data).toEqual({ reminder: 'start' });
  // A one-off calendar trigger at the local wall-clock time (iOS months are 1-based).
  const first = buildReminderSchedule(new Date(), null)[0].at;
  expect(nt.scheduled[0].identifier).toBe('reminder-0');
  expect(nt.scheduled[59].identifier).toBe('reminder-59');
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
  expect(spy).toHaveBeenCalledWith('reminders_scheduled', { count: 60, kind: 'start' });
  // Site generated: closing the LaunchGuide doesn't ask again but switches to finish copy.
  await store.saveSite(draft);
  expect(await askReminderPermissionOnce()).toBe(true);
  expect(nt.requests).toBe(1);
  expect(nt.scheduled).toHaveLength(60);
  expect(nt.scheduled.every((r: any) => r.content.data.reminder === 'finish')).toBe(true);
});

test('publish success cancels reminders', async () => {
  nt.status = 'granted';
  await store.saveSite(draft);
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(60);
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
  expect(nt.scheduled).toHaveLength(60);
});

test('deleting an unpublished draft clears its reminders; start copy can follow', async () => {
  nt.status = 'granted';
  await store.saveSite(draft);
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(60);
  await deleteLocalData();
  // The shop-name "finish" reminders are gone at once.
  expect(nt.scheduled).toHaveLength(0);
  expect(await store.loadSite()).toBeNull();
  // Unpaid, no site: the next foreground schedules the start copy.
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(60);
  expect(nt.scheduled.every((r: any) => r.content.data.reminder === 'start')).toBe(true);
});

test("deleting a payer's data cancels reminders for good", async () => {
  nt.status = 'granted';
  await store.saveSite({ ...draft, transactionId: 'tx-1' });
  await refreshReminders();
  expect(nt.scheduled).toHaveLength(60);
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
  expect(nt.scheduled).toHaveLength(61);
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
  expect(nt.scheduled).toHaveLength(60);
  const deps: RestoreDeps = {
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
  expect(nt.scheduled).toHaveLength(60);
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
