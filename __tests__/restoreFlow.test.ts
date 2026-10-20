// The words Settings and /start show after Restore purchases (one shared flow).
import { ApiError } from '@/lib/api';
import { restoreMessage } from '@/lib/restoreFlow';
import type { SiteRecord } from '@/lib/siteStore';

const site = { draftId: 'd', slug: 'fade', deployedUrl: 'https://fade.vercel.app' } as unknown as SiteRecord;

test('an active restore says both came back', () => {
  expect(restoreMessage({ site, active: true }, false)).toEqual({
    title: 'Restore purchases',
    message: 'Your subscription and your website have been restored.',
  });
});

test('an inactive subscription restores the site but says to subscribe again', () => {
  expect(restoreMessage({ site, active: false }, false)?.message).toBe(
    'We restored your website, but this subscription isn’t active — subscribe again to publish changes.',
  );
});

test('no subscription shows nothing of ours (Superwall has shown its alert)', () => {
  expect(restoreMessage(null, false)).toBeNull();
});

test('entitled but nothing loaded never ends silently', () => {
  expect(restoreMessage(null, true)?.message).toMatch(/subscription is active, but we couldn’t load your website yet/);
});

test('errors are worded per case', () => {
  expect(restoreMessage(new ApiError(404, 'no-site', 'x'), true)?.message).toMatch(/no website has been published/);
  expect(restoreMessage(new ApiError(0, 'network', 'Offline message'), false)?.message).toBe('Offline message');
  expect(restoreMessage(new ApiError(503, 'apple-unavailable', 'apple-unavailable'), false)?.message).toMatch(
    /couldn’t load your website right now/,
  );
  expect(restoreMessage(new Error('Subscriptions are not set up in this build.'), false)?.message).toBe(
    'Subscriptions are not set up in this build.',
  );
});
