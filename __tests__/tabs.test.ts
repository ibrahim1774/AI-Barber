// The two-tab home (Task 10c): where launch goes, what the Settings tab's
// "Your website" shows, and the Settings → Edit publish hand-off.
import React from 'react';
// No @types for react-test-renderer here; require keeps it untyped.
const { act, create } = require('react-test-renderer');
import { homeRoute } from '@/lib/nav';
import { requestPublish, takePublishRequest } from '@/lib/publishRequest';
import { websiteView } from '@/lib/website';
import type { SiteRecord } from '@/lib/siteStore';

const mockRedirects: string[] = [];
jest.mock('expo-router', () => ({
  router: { canDismiss: () => false, dismissAll: jest.fn(), replace: jest.fn(), canGoBack: () => false },
  Redirect: ({ href }: { href: string }) => {
    mockRedirects.push(href);
    return null;
  },
}));

// The theme pulls in the font packages, which need native modules.
jest.mock('@/constants/theme', () => ({ colors: { bg: '#0d0d0d' } }));

let mockStored: SiteRecord | null = null;
jest.mock('@/lib/siteStore', () => ({ loadSite: async () => mockStored }));

const site = (over: Partial<SiteRecord> = {}): SiteRecord =>
  ({
    draftId: 'd1',
    inputs: { shopName: 'Input Name' },
    data: { shopName: 'Fade Lab' },
    updatedAt: 1,
    slug: null,
    deployedUrl: null,
    transactionId: null,
    ...over,
  }) as unknown as SiteRecord;

beforeEach(() => {
  mockRedirects.length = 0;
  mockStored = null;
});

async function renderIndex() {
  const Index = require('@/app/index').default;
  await act(async () => {
    create(React.createElement(Index));
  });
}

test('index routes to the Edit tab when a site exists', async () => {
  mockStored = site();
  await renderIndex();
  expect(mockRedirects).toEqual(['/edit']);
  expect(homeRoute(site())).toBe('/edit');
});

test('index routes to /start without a site', async () => {
  await renderIndex();
  expect(mockRedirects).toEqual(['/start']);
  expect(homeRoute(null)).toBe('/start');
});

test('settings tab shows the live URL when published and "Not published yet" otherwise', () => {
  expect(websiteView(site({ slug: 'fade-lab', deployedUrl: 'https://fade-lab.vercel.app' }))).toEqual({
    name: 'Fade Lab',
    url: 'https://fade-lab.vercel.app',
    host: 'fade-lab.vercel.app',
    live: true,
    offline: false,
    status: 'Live',
  });
  expect(websiteView(site())).toEqual({
    name: 'Fade Lab',
    url: null,
    host: null,
    live: false,
    offline: false,
    status: 'Not published yet',
  });
});

test('a lapsed published site shows "Offline" instead of the live actions', () => {
  const view = websiteView(site({ slug: 'fade-lab', deployedUrl: 'https://fade-lab.vercel.app' }), true);
  expect(view).toMatchObject({ live: false, offline: true, status: 'Offline', host: 'fade-lab.vercel.app' });
  // A never-published draft is never offline.
  expect(websiteView(site(), true)).toMatchObject({ live: false, offline: false, status: 'Not published yet' });
});

test('the website name falls back to the inputs, then a generic name', () => {
  expect(websiteView(site({ data: { shopName: '' } as any })).name).toBe('Input Name');
  expect(websiteView(site({ data: { shopName: '' } as any, inputs: { shopName: '' } as any })).name).toBe(
    'Your barbershop',
  );
});

test('a publish request from Settings is taken once', () => {
  expect(takePublishRequest()).toBe(false);
  requestPublish();
  expect(takePublishRequest()).toBe(true);
  expect(takePublishRequest()).toBe(false);
});
