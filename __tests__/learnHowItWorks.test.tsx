import React from 'react';
import fs from 'fs';
import path from 'path';
import { allText, press, pressRow, render } from './store/render';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
let mockParams: { topic?: string } = {};
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

import LearnList from '@/app/(tabs)/settings/learn/index';
import LearnTopic from '@/app/(tabs)/settings/learn/[topic]';
import { LearnVideo } from '@/components/LearnVideo';
import { LEARN_SECTIONS, LEARN_TOPICS, nextInSection, topicsIn } from '@/lib/learnContent';
import { LEARN_VIDEOS } from '@/lib/learnVideos';
import { mockSources } from '../test/mocks/video';

const ROOT = path.join(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const hasVideo = (tree: any) => tree.root.findAll((n: any) => n.type === 'VideoView').length > 0;

beforeEach(() => {
  jest.clearAllMocks();
  mockSources.length = 0;
  mockParams = {};
});

const VIDEO_SLUGS = ['intro', 'editing', 'no-account', 'calendar', 'store', 'domain', 'notifications', 'team'] as const;
const PLACEHOLDER = /coming soon|placeholder|lorem|tbd|todo/i;

describe('Learn how it works: the list', () => {
  it('shows the four section headers in order, each with its topics and one-line descriptions', async () => {
    const tree = await render(<LearnList />);
    const text = allText(tree).join(' | ');
    expect(LEARN_SECTIONS.map((x) => x.title)).toEqual([
      'Your custom website', 'Bookings', 'Your store', 'Settings & what you can adjust',
    ]);
    let last = -1;
    for (const sec of LEARN_SECTIONS) {
      const at = text.indexOf(sec.title);
      expect(at).toBeGreaterThan(last);
      last = at;
      expect(topicsIn(sec.id).length).toBeGreaterThan(0);
    }
    for (const t of LEARN_TOPICS) {
      expect(text).toContain(t.title);
      expect(text).toContain(t.value);
    }
    expect(tree.root.findAll((n: any) => n.props?.accessibilityRole === 'header').length).toBeGreaterThanOrEqual(LEARN_SECTIONS.length);
    expect(LEARN_TOPICS[0].title).toBe('Quick tour');
  });

  it('mounts no video at all', async () => {
    const tree = await render(<LearnList />);
    expect(hasVideo(tree)).toBe(false);
    expect(mockSources).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).not.toMatch(/Play video|Replay/);
  });

  it.each(LEARN_TOPICS.map((t) => [t.slug, t.title] as const))('tapping "%s" opens its own screen', async (slug, title) => {
    await pressRow(await render(<LearnList />), title);
    expect(mockRouter.push).toHaveBeenCalledWith(`/settings/learn/${slug}`);
  });
});

describe('Learn content', () => {
  it('keeps the eight video slugs stable and unique', () => {
    const withVideo = LEARN_TOPICS.filter((t) => t.video).map((t) => t.slug);
    expect([...withVideo].sort()).toEqual([...VIDEO_SLUGS].sort());
    for (const t of LEARN_TOPICS) expect(t.video === undefined || t.video === t.slug).toBe(true);
    expect(new Set(LEARN_TOPICS.map((t) => t.slug)).size).toBe(LEARN_TOPICS.length);
  });

  it('every topic has 3 to 6 steps and a real description', () => {
    for (const t of LEARN_TOPICS) {
      expect(t.steps.length).toBeGreaterThanOrEqual(3);
      expect(t.steps.length).toBeLessThanOrEqual(6);
      expect(t.detail.length).toBeGreaterThan(10);
    }
  });

  it('has no placeholder text anywhere in the copy or the screens', () => {
    expect(JSON.stringify([LEARN_SECTIONS, LEARN_TOPICS])).not.toMatch(PLACEHOLDER);
    for (const f of ['src/app/(tabs)/settings/learn/index.tsx', 'src/app/(tabs)/settings/learn/[topic].tsx']) {
      expect(read(f)).not.toMatch(PLACEHOLDER);
    }
  });

  it('copies the in-app card wording and invents no percentage', () => {
    const text = LEARN_TOPICS.find((x) => x.slug === 'get-paid')!.steps.join(' ');
    expect(text).toContain("Prime Barber doesn't move this money");
    expect(text).toContain('Stripe charges its own processing fee on top');
    expect(text).toContain('There is no monthly fee for cards');
    expect(text).not.toMatch(/\d\s?%/);
  });
});

describe('Learn how it works: a topic screen', () => {
  it.each(LEARN_TOPICS.map((t) => t.slug))('%s resolves, shows title, description and numbered steps', async (slug) => {
    mockParams = { topic: slug };
    const tree = await render(<LearnTopic />);
    const t = LEARN_TOPICS.find((x) => x.slug === slug)!;
    expect(tree.root.findAll((n: any) => n.type === 'Redirect')).toHaveLength(0);
    const text = allText(tree).join(' | ');
    expect(text).toContain(t.title);
    expect(text).toContain(t.detail);
    t.steps.forEach((step, i) => {
      expect(text).toContain(step);
      expect(allText(tree)).toContain(String(i + 1));
    });
    expect(text).not.toMatch(PLACEHOLDER);
  });

  it.each([...VIDEO_SLUGS])('%s still mounts its own clip', async (slug) => {
    mockParams = { topic: slug };
    const tree = await render(<LearnTopic />);
    expect(mockSources).toEqual([LEARN_VIDEOS[slug]]);
    expect(hasVideo(tree)).toBe(true);
  });

  it.each(LEARN_TOPICS.filter((t) => !t.video).map((t) => t.slug))('%s has steps only: no video, no player controls', async (slug) => {
    mockParams = { topic: slug };
    const tree = await render(<LearnTopic />);
    expect(mockSources).toHaveLength(0);
    expect(hasVideo(tree)).toBe(false);
    expect(JSON.stringify(tree.toJSON())).not.toMatch(/Play video|Pause video|Replay|Sound/);
  });

  it('starts playing, muted, without looping, and the sound button unmutes', async () => {
    mockParams = { topic: 'calendar' };
    const { mockPlayer } = require('../test/mocks/video');
    const tree = await render(<LearnTopic />);
    expect(mockPlayer.play).toHaveBeenCalled();
    expect(mockPlayer.loop).toBe(false);
    expect(mockPlayer.muted).toBe(true);
    await press(tree, 'Sound off');
    expect(mockPlayer.muted).toBe(false);
    await press(tree, 'Replay');
    expect(mockPlayer.replay).toHaveBeenCalled();
  });

  describe('video tap controls', () => {
    const setup = async () => {
      mockParams = { topic: 'calendar' };
      const m = require('../test/mocks/video');
      Object.keys(m.mockHandlers).forEach((k) => delete m.mockHandlers[k]);
      m.mockPlayer.play.mockClear();
      m.mockPlayer.pause.mockClear();
      m.mockPlayer.replay.mockClear();
      const tree = await render(<LearnTopic />);
      return { m, tree };
    };
    const act = require('react-test-renderer').act;
    const byLabel = (tree: any, l: string) =>
      tree.root.findAll((n: any) => n.props?.accessibilityLabel === l && typeof n.props.onPress === 'function');
    const tap = async (tree: any, l: string) => {
      const n = byLabel(tree, l);
      if (!n.length) throw new Error(`No control labelled "${l}"`);
      await act(async () => n[0].props.onPress());
    };

    it('a tap while playing pauses, then a tap plays again, and a play badge shows when paused', async () => {
      const { m, tree } = await setup();
      m.mockPlayer.play.mockClear();
      await tap(tree, 'Pause video');
      expect(m.mockPlayer.pause).toHaveBeenCalledTimes(1);
      expect(allText(tree).join(' ')).toContain('Tap to play');
      await tap(tree, 'Play video');
      expect(m.mockPlayer.play).toHaveBeenCalledTimes(1);
      expect(m.mockPlayer.replay).not.toHaveBeenCalled();
    });

    it('a tap after the video ended replays from the start', async () => {
      const { m, tree } = await setup();
      await act(async () => m.emit('playToEnd'));
      expect(allText(tree).join(' ')).toContain('Tap to replay');
      m.mockPlayer.play.mockClear();
      await tap(tree, 'Replay video');
      expect(m.mockPlayer.replay).toHaveBeenCalledTimes(1);
      expect(m.mockPlayer.play).toHaveBeenCalled();
    });

    it('Play video, Pause video, Replay and Sound are separate controls reachable by label', async () => {
      const { tree } = await setup();
      const labels = tree.root
        .findAll((n: any) => typeof n.props?.onPress === 'function' && n.props.accessibilityLabel)
        .map((n: any) => n.props.accessibilityLabel);
      expect(labels).toEqual(expect.arrayContaining(['Pause video', 'Replay', 'Sound off, turn on']));
      await tap(tree, 'Pause video');
      expect(byLabel(tree, 'Play video').length).toBeGreaterThan(0);
      expect(byLabel(tree, 'Replay').length).toBeGreaterThan(0);
    });
  });

  it('has a visible Back (at least 44 pt) that returns to the list', async () => {
    mockParams = { topic: 'store' };
    const tree = await render(<LearnTopic />);
    expect(allText(tree)).toContain('Back');
    const back = tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Back' && typeof n.props.onPress === 'function')[0];
    expect(back.props.style.minHeight).toBeGreaterThanOrEqual(44);
    await press(tree, 'Back');
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('offers the next topic within the section, and none after the last in a section', async () => {
    mockParams = { topic: 'intro' };
    await press(await render(<LearnTopic />), 'Next: Edit text and photos');
    expect(mockRouter.replace).toHaveBeenCalledWith('/settings/learn/editing');
    for (const sec of LEARN_SECTIONS) {
      const list = topicsIn(sec.id);
      list.forEach((t, i) => expect(nextInSection(t)?.slug).toBe(list[i + 1]?.slug));
      mockParams = { topic: list[list.length - 1].slug };
      expect(allText(await render(<LearnTopic />)).join(' ')).not.toMatch(/Next:/);
    }
  });

  it('an unknown topic falls back to the list and mounts no video', async () => {
    mockParams = { topic: 'nope' };
    const tree = await render(<LearnTopic />);
    expect(tree.root.findAll((n: any) => n.type === 'Redirect')[0].props.href).toBe('/settings/learn');
    expect(hasVideo(tree)).toBe(false);
  });
});

describe('Learn videos', () => {
  it('a slot with no source renders nothing', async () => {
    const tree = await render(<LearnVideo slug="intro" source={null as unknown as number} />);
    expect(tree.toJSON()).toBeNull();
  });

  it('exactly the eight clips are registered, bundled and small', () => {
    expect(Object.keys(LEARN_VIDEOS).sort()).toEqual([...VIDEO_SLUGS].sort());
    for (const s of VIDEO_SLUGS) {
      const file = path.join(ROOT, 'assets/tutorial', `${s}.mp4`);
      expect(fs.existsSync(file)).toBe(true);
      const size = fs.statSync(file).size;
      expect(size).toBeGreaterThan(10_000);
      expect(size).toBeLessThan(3 * 1024 * 1024);
    }
    expect(read('src/lib/learnVideos.ts')).not.toMatch(/^\s*\/\/\s*\w+.*require\(/m);
  });
});

describe('Settings entry', () => {
  it('has the Learn card before Your website, no Help row, and no Tutorial section', () => {
    const src = read('src/app/(tabs)/settings/index.tsx');
    expect(src.indexOf('<LearnEntry')).toBeGreaterThan(-1);
    expect(src.indexOf('<LearnEntry')).toBeLessThan(src.indexOf('<YourWebsite'));
    expect(src).not.toContain('label="Learn how it works"');
    expect(src).toContain("'/settings/learn'");
    expect(fs.existsSync(path.join(ROOT, 'src/app/(tabs)/settings/learn.tsx'))).toBe(false);
    expect(src).not.toContain('title="Tutorial"');
    expect(src).not.toContain('TutorialEntry');
  });

  it('the old tutorial screens and their code are gone', () => {
    for (const f of ['src/app/tutorial.tsx', 'src/app/tutorial-topic.tsx', 'src/lib/tutorialTopics.ts', 'src/lib/tutorialVideos.ts',
      'src/components/tutorial/TutorialEntry.tsx', 'src/components/tutorial/TutorialVideo.tsx', 'src/app/(tabs)/settings.tsx']) {
      expect(fs.existsSync(path.join(ROOT, f))).toBe(false);
    }
    expect(fs.existsSync(path.join(ROOT, 'src/app/(tabs)/settings/_layout.tsx'))).toBe(true);
  });

  it('nothing links to /tutorial any more', () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []);
    for (const f of walk(path.join(ROOT, 'src'))) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/['"]\/tutorial(-topic)?['"]/);
  });
});
