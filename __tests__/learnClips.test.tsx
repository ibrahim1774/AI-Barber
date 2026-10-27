import React from 'react';
import { act as rtAct } from 'react-test-renderer';
import { allText, render } from './store/render';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
let mockParams: { topic?: string } = {};
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-router', () => {
  const R = require('react');
  return {
    router: { push: (...a: unknown[]) => mockRouter.push(...a), back: () => mockRouter.back(), replace: (...a: unknown[]) => mockRouter.replace(...a) },
    useLocalSearchParams: () => mockParams,
    Redirect: ({ href }: { href: string }) => R.createElement('Redirect', { href }),
  };
});
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('@/components/Page', () => {
  const R = require('react');
  return { Page: ({ children }: any) => R.createElement(R.Fragment, null, children) };
});
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

import Storage from 'expo-sqlite/kv-store';
import LearnTopic from '@/app/(tabs)/settings/learn/[topic]';
import { LEARN_TOPICS } from '@/lib/learnContent';
import { CLIPS_CACHE_KEY, fetchClips, getLearnClips, parseManifest, resetLearnClips } from '@/lib/learnClips';
import { LearnVideo } from '@/components/LearnVideo';

const BASE = 'https://aibarber.org/learn-clips';
const vid = require('../test/mocks/video');
const MANIFEST = { version: 1, clips: { intro: { v: 2, bytes: 1200000, seconds: 28 } } };
const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const hasVideo = (tree: any) => tree.root.findAll((n: any) => n.type === 'VideoView').length > 0;
const stepsShown = (tree: any, slug: string) => {
  const t = LEARN_TOPICS.find((x) => x.slug === slug)!;
  const text = allText(tree).join(' | ');
  t.steps.forEach((s) => expect(text).toContain(s));
  expect(text).toContain(t.title);
};
const byLabel = (tree: any, l: string) => tree.root.findAll((n: any) => n.props?.accessibilityLabel === l && typeof n.props.onPress === 'function');
const tap = async (tree: any, l: string) => {
  const n = byLabel(tree, l);
  if (!n.length) throw new Error(`No control labelled "${l}"`);
  await rtAct(async () => n[0].props.onPress());
};

let fetchMock: jest.Mock;
beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = {};
  resetLearnClips();
  for (const k of await Storage.getAllKeys()) await Storage.removeItem(k);
  Object.keys(vid.mockHandlers).forEach((k) => delete vid.mockHandlers[k]);
  vid.mockSources.length = 0;
  fetchMock = jest.fn(() => Promise.reject(new Error('offline')));
  (global as any).fetch = fetchMock;
});

describe('parseManifest', () => {
  it('builds versioned mp4 and poster urls for each listed slug', () => {
    expect(parseManifest(MANIFEST, BASE)).toEqual({
      intro: { url: `${BASE}/intro.mp4?v=2`, poster: `${BASE}/intro.jpg?v=2` },
    });
  });
  it.each([
    ['null', null], ['a string', 'x'], ['an array', []], ['no clips', { version: 1 }], ['clips not an object', { version: 1, clips: [] }],
    ['unknown version', { version: 2, clips: { intro: { v: 1 } } }],
  ])('returns {} for %s', (_n, body) => {
    expect(parseManifest(body, BASE)).toEqual({});
  });
  it('skips bad entries and keeps the good ones', () => {
    const out = parseManifest({ version: 1, clips: { intro: { v: 1 }, '../evil': { v: 1 }, 'a/b': { v: 1 }, editing: { v: 'x' }, pages: null, publish: { v: 0 } } }, BASE);
    expect(Object.keys(out)).toEqual(['intro']);
  });
});

describe('fetchClips / getLearnClips', () => {
  it('fetches the manifest, parses it and caches the good copy', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(MANIFEST));
    const out = await fetchClips();
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/clips.json`);
    expect(out.intro.url).toBe(`${BASE}/intro.mp4?v=2`);
    expect(JSON.parse((await Storage.getItem(CLIPS_CACHE_KEY))!)).toEqual(MANIFEST);
  });
  it('offline: uses the last good cached copy', async () => {
    await Storage.setItem(CLIPS_CACHE_KEY, JSON.stringify(MANIFEST));
    expect((await fetchClips()).intro.url).toBe(`${BASE}/intro.mp4?v=2`);
  });
  it('offline with no cache: {}', async () => {
    expect(await fetchClips()).toEqual({});
  });
  it.each([
    ['a 404', () => ({ ok: false, status: 404, json: async () => ({}) })],
    ['malformed JSON', () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } })],
    ['an invalid manifest', () => okResponse({ version: 9 })],
  ])('%s: {} and nothing bad is cached', async (_n, make) => {
    fetchMock.mockResolvedValueOnce(make());
    expect(await fetchClips()).toEqual({});
    expect(await Storage.getItem(CLIPS_CACHE_KEY)).toBeNull();
  });
  it('a 404 keeps and uses the older cached copy', async () => {
    await Storage.setItem(CLIPS_CACHE_KEY, JSON.stringify(MANIFEST));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    expect((await fetchClips()).intro).toBeTruthy();
  });
  it('gives up after a short timeout instead of hanging', async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce(() => new Promise(() => {}));
      const p = fetchClips();
      await jest.advanceTimersByTimeAsync(3100);
      expect(await p).toEqual({});
    } finally {
      jest.useRealTimers();
    }
  });
  it('fetches once per session', async () => {
    fetchMock.mockResolvedValue(okResponse(MANIFEST));
    await getLearnClips();
    await getLearnClips();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('topic screen with a manifest', () => {
  it('shows the clip above the steps when the manifest lists the slug, steps still shown', async () => {
    fetchMock.mockResolvedValue(okResponse(MANIFEST));
    mockParams = { topic: 'intro' };
    const tree = await render(<LearnTopic />);
    expect(hasVideo(tree)).toBe(true);
    expect(vid.mockSources[0]).toEqual({ uri: `${BASE}/intro.mp4?v=2` });
    stepsShown(tree, 'intro');
    expect(allText(tree).join(' ')).toContain('Next:');
  });
  it('a topic the manifest does not list has no player', async () => {
    fetchMock.mockResolvedValue(okResponse(MANIFEST));
    mockParams = { topic: 'domain' };
    const tree = await render(<LearnTopic />);
    expect(hasVideo(tree)).toBe(false);
    stepsShown(tree, 'domain');
  });
  it.each([
    ['offline', () => Promise.reject(new Error('offline'))],
    ['404', () => Promise.resolve({ ok: false, status: 404, json: async () => ({}) })],
    ['malformed', () => Promise.resolve({ ok: true, status: 200, json: async () => { throw new Error('x'); } })],
  ])('manifest %s: text steps exactly as today, no player', async (_n, impl) => {
    fetchMock.mockImplementation(impl);
    mockParams = { topic: 'intro' };
    const tree = await render(<LearnTopic />);
    expect(hasVideo(tree)).toBe(false);
    stepsShown(tree, 'intro');
  });
  it('the steps render before the manifest answers (never blocked)', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    mockParams = { topic: 'intro' };
    const tree = await render(<LearnTopic />);
    expect(hasVideo(tree)).toBe(false);
    stepsShown(tree, 'intro');
  });
  it('a clip that fails to load is removed and the steps remain', async () => {
    fetchMock.mockResolvedValue(okResponse(MANIFEST));
    mockParams = { topic: 'intro' };
    const tree = await render(<LearnTopic />);
    expect(hasVideo(tree)).toBe(true);
    await rtAct(async () => vid.emit('statusChange', { status: 'error', error: { message: 'x' } }));
    expect(hasVideo(tree)).toBe(false);
    stepsShown(tree, 'intro');
  });
});

describe('LearnVideo player gating and controls', () => {
  const URI = `${BASE}/intro.mp4?v=1`;
  it('renders nothing without a uri', async () => {
    expect(hasVideo(await render(<LearnVideo uri="" />))).toBe(false);
  });
  it('plays muted and starts on the poster until ready', async () => {
    const tree = await render(<LearnVideo uri={URI} poster={`${BASE}/intro.jpg?v=1`} />);
    expect(vid.mockPlayer.muted).toBe(true);
    expect(vid.mockPlayer.play).toHaveBeenCalled();
    const img = () => tree.root.findAll((n: any) => n.props?.source?.uri === `${BASE}/intro.jpg?v=1`);
    expect(img().length).toBeGreaterThan(0);
    await rtAct(async () => vid.emit('statusChange', { status: 'readyToPlay' }));
    expect(img().length).toBe(0);
  });
  it('a tap while playing pauses, then plays again, with a play badge when paused', async () => {
    const tree = await render(<LearnVideo uri={URI} />);
    vid.mockPlayer.play.mockClear();
    await tap(tree, 'Pause video');
    expect(vid.mockPlayer.pause).toHaveBeenCalledTimes(1);
    expect(allText(tree).join(' ')).toContain('Tap to play');
    await tap(tree, 'Play video');
    expect(vid.mockPlayer.play).toHaveBeenCalledTimes(1);
  });
  it('a tap after the end replays from the start', async () => {
    const tree = await render(<LearnVideo uri={URI} />);
    await rtAct(async () => vid.emit('playToEnd'));
    expect(allText(tree).join(' ')).toContain('Tap to replay');
    vid.mockPlayer.play.mockClear();
    await tap(tree, 'Replay video');
    expect(vid.mockPlayer.replay).toHaveBeenCalledTimes(1);
    expect(vid.mockPlayer.play).toHaveBeenCalled();
  });
});
