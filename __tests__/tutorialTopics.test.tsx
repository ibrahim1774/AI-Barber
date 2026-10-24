import React from 'react';
import fs from 'fs';
import path from 'path';
import { allText, hasButton, press, render } from './store/render';

const mockRouter = { push: jest.fn(), navigate: jest.fn() };
let mockSlug: string | undefined;
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockRouter.push(...a), navigate: (...a: unknown[]) => mockRouter.navigate(...a) },
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, []),
  useNavigation: () => ({ setOptions: () => {} }),
  useLocalSearchParams: () => ({ slug: mockSlug }),
}));
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('@/components/Page', () => {
  const R = require('react');
  return { Page: ({ children }: any) => R.createElement(R.Fragment, null, children) };
});
jest.mock('@/components/Icons', () => ({ ChevronRightIcon: () => null, ExternalLinkIcon: () => null, ArrowRight: () => null }));
jest.mock('@/lib/nav', () => ({ goBackOrHome: jest.fn() }));

import Tutorial from '@/app/tutorial';
import TutorialTopicScreen from '@/app/tutorial-topic';
import { TutorialEntry } from '@/components/tutorial/TutorialEntry';
import { TutorialVideo } from '@/components/tutorial/TutorialVideo';
import { resetTourRequestForTests, takeTourRequest } from '@/components/tutorial/tours';
import { TUTORIAL_TOPICS } from '@/lib/tutorialTopics';
import { TUTORIAL_VIDEOS } from '@/lib/tutorialVideos';

const SLUGS = ['site-editing', 'bookings', 'store', 'adding-products', 'getting-paid'];

beforeEach(() => {
  mockRouter.push.mockClear();
  mockRouter.navigate.mockClear();
  resetTourRequestForTests();
});

describe('Settings entry', () => {
  it('is the first thing in Settings, above Your website and Account', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/settings.tsx'), 'utf8');
    const body = src.slice(src.indexOf('<Page title="Settings"'));
    const entry = body.indexOf('<TutorialEntry');
    expect(entry).toBeGreaterThan(0);
    expect(entry).toBeLessThan(body.indexOf('<YourWebsite'));
    expect(entry).toBeLessThan(body.indexOf('<Section title="Account"'));
    expect(body).toContain('<Section title="Tutorial">'); // the arrow replays stay reachable
  });

  it('shows the title, a New tag and a subtitle, and opens the list on tap', async () => {
    const onPress = jest.fn();
    const tree = await render(<TutorialEntry onPress={onPress} />);
    const text = allText(tree);
    expect(text).toContain('Learn how it works');
    expect(text).toContain('New');
    expect(text.some((t: string) => t.length > 20)).toBe(true);
    await press(tree, 'Learn how it works' + text.filter((t: string) => t !== 'Learn how it works').join(''));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('Tutorial list', () => {
  it('lists the five topics and opens one', async () => {
    const tree = await render(<Tutorial />);
    const text = allText(tree);
    for (const t of ['Site editing', 'Bookings', 'Your store', 'Adding products', 'Getting paid']) expect(text).toContain(t);
    const row = tree.root.find((n: any) => n.props?.accessibilityLabel === 'Adding products' && n.props.onPress);
    row.props.onPress();
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/tutorial-topic', params: { slug: 'adding-products' } });
  });
});

describe('Topic screens', () => {
  it.each(SLUGS)('%s renders its numbered captions, the placeholder and the arrows button', async (slug) => {
    mockSlug = slug;
    const topic = TUTORIAL_TOPICS.find((t) => t.slug === slug)!;
    const tree = await render(<TutorialTopicScreen />);
    const text = allText(tree);
    topic.steps.forEach((s, i) => {
      expect(text).toContain(s);
      expect(text).toContain(String(i + 1));
    });
    expect(text).toContain('Video coming soon');
    expect(hasButton(tree, 'Show me with arrows')).toBe(true);
  });

  it('Show me with arrows requests the tour and opens its screen (Adding products reuses the store tour)', async () => {
    mockSlug = 'adding-products';
    const tree = await render(<TutorialTopicScreen />);
    await press(tree, 'Show me with arrows');
    expect(mockRouter.navigate).toHaveBeenCalledWith('/store');
    expect(takeTourRequest('store')).toBe('store');
  });

  it('an unknown topic does not crash', async () => {
    mockSlug = 'nope';
    const tree = await render(<TutorialTopicScreen />);
    expect(allText(tree)).toContain('That topic isn’t available.');
  });
});

describe('TutorialVideo', () => {
  it('shows the placeholder with no file', async () => {
    const tree = await render(<TutorialVideo source={undefined} />);
    expect(allText(tree)).toContain('Video coming soon');
  });

  it('with a file, tap toggles play and Replay restarts it, slowly', async () => {
    const { mockPlayer } = require('../test/mocks/video');
    const tree = await render(<TutorialVideo source={1} />);
    expect(mockPlayer.playbackRate).toBeLessThan(1);
    await press(tree, 'Tap to play');
    expect(mockPlayer.play).toHaveBeenCalled();
    await press(tree, 'Replay');
    expect(mockPlayer.replay).toHaveBeenCalled();
  });
});

describe('content and files', () => {
  it('has exactly the five slugs, with steps', () => {
    expect(TUTORIAL_TOPICS.map((t) => t.slug)).toEqual(SLUGS);
    for (const t of TUTORIAL_TOPICS) expect(t.steps.length).toBeGreaterThanOrEqual(4);
  });

  it('every mp4 in assets/tutorial is registered, and every registration has a file', () => {
    const dir = path.join(__dirname, '..', 'assets', 'tutorial');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mp4')).map((f) => f.replace('.mp4', '')).sort();
    expect(Object.keys(TUTORIAL_VIDEOS).sort()).toEqual(files);
  });

  it('keeps to the honest-copy rule', () => {
    const all = TUTORIAL_TOPICS.flatMap((t) => [t.title, t.blurb, ...t.steps]).join(' ');
    expect(all).not.toMatch(/premium|ai-powered|revolutionary|seamless/i);
  });
});
