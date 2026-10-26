import React from 'react';
import fs from 'fs';
import path from 'path';
import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { allText, press, pressRow, render } from './store/render';

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(() => Promise.resolve()) }));
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
import { LEARN_SECTIONS, LEARN_TOPICS, nextInSection, topicsIn } from '@/lib/learnContent';

const ROOT = path.join(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const hasVideo = (tree: any) => tree.root.findAll((n: any) => n.type === 'VideoView').length > 0;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});

const PLACEHOLDER = /coming soon|placeholder|lorem|tbd|todo/i;

describe('Learn how it works: the list', () => {
  it('starts with the four section headers collapsed, in order, with no topic rows', async () => {
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
    for (const t of LEARN_TOPICS) expect(text).not.toContain(t.title);
    const headers = tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && n.props.accessibilityState);
    expect(headers.every((h: any) => h.props.accessibilityState.expanded === false)).toBe(true);
  });

  it('tapping a header opens its topics; opening another closes the first; tapping again collapses', async () => {
    const tree = await render(<LearnList />);
    const first = topicsIn('website')[0].title;
    const other = topicsIn('bookings')[0].title;
    await press(tree, 'Your custom website');
    for (const t of topicsIn('website')) expect(allText(tree).join(' | ')).toContain(t.title);
    expect(allText(tree).join(' | ')).not.toContain(other);
    await press(tree, 'Bookings');
    expect(allText(tree).join(' | ')).toContain(other);
    expect(allText(tree).join(' | ')).not.toContain(first);
    await press(tree, 'Bookings');
    expect(allText(tree).join(' | ')).not.toContain(other);
  });

  it('is compact: 12 to 24 topics, no subtitles, no video', async () => {
    expect(LEARN_TOPICS.length).toBeGreaterThanOrEqual(12);
    expect(LEARN_TOPICS.length).toBeLessThanOrEqual(24);
    const tree = await render(<LearnList />);
    await press(tree, 'Bookings');
    expect(hasVideo(tree)).toBe(false);
    const rows = tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && topicsIn('bookings').some((t) => t.title === n.props.accessibilityLabel));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.findAll((n: any) => n.type === 'Text').length).toBe(1);
  });

  it.each(LEARN_TOPICS.map((t) => [t.slug, t.title, t.section] as const))('tapping "%s" opens its own screen', async (slug, title, section) => {
    const tree = await render(<LearnList />);
    await press(tree, LEARN_SECTIONS.find((x) => x.id === section)!.title);
    await pressRow(tree, title);
    expect(mockRouter.push).toHaveBeenCalledWith(`/settings/learn/${slug}`);
  });
});

describe('Learn content', () => {
  it('has unique stable slugs, one-line titles, and no video fields', () => {
    expect(new Set(LEARN_TOPICS.map((t) => t.slug)).size).toBe(LEARN_TOPICS.length);
    for (const t of LEARN_TOPICS) {
      expect(t.title.length).toBeLessThanOrEqual(48);
      expect(Object.keys(t).sort()).toEqual(['detail', 'section', 'slug', 'steps', 'title']);
    }
  });

  it('every topic has a short intro and 6 to 12 small written steps', () => {
    for (const t of LEARN_TOPICS) {
      expect(t.detail.length).toBeGreaterThan(10);
      expect(t.detail.length).toBeLessThanOrEqual(110);
      expect(t.steps.length).toBeGreaterThanOrEqual(6);
      expect(t.steps.length).toBeLessThanOrEqual(12);
      for (const step of t.steps) expect(step.length).toBeLessThanOrEqual(260);
    }
  });

  it('covers every feature: payment methods, how to get paid, and each section has topics', () => {
    const slugs = LEARN_TOPICS.map((t) => t.slug);
    expect(slugs).toEqual(expect.arrayContaining(['payment-methods', 'get-paid', 'calendar', 'store', 'store-shipping', 'store-payments', 'store-orders', 'team', 'publish', 'domain', 'services-hours', 'settings-plan', 'help']));
    const pm = LEARN_TOPICS.find((t) => t.slug === 'payment-methods')!.steps.join(' ');
    for (const label of ['Customers pay when they arrive', 'Save handles', 'Connect cards with Stripe']) expect(pm).toContain(label);
  });

  it('names real tabs and buttons', () => {
    const all = LEARN_TOPICS.flatMap((t) => t.steps).join(' ');
    for (const label of ['Bookings tab', 'Set up bookings', 'Store tab', 'Settings tab', 'Publish', 'Add product', 'Mark paid', 'Add a barber']) {
      expect(all).toContain(label);
    }
  });

  it('splits the store into separate topics and ends the list with Get help', () => {
    expect(topicsIn('store').map((t) => t.title)).toEqual(['Open your shop and add products', 'Pickup and shipping', 'Payments', 'Orders and customers']);
    const last = LEARN_TOPICS[LEARN_TOPICS.length - 1];
    expect(last.title).toBe('Get help');
  });

  it('matches current behaviour: Back and resume, Move subscription, no confirm field, no videos', () => {
    const all = LEARN_TOPICS.flatMap((t) => t.steps).join(' ');
    expect(all).toContain('Back to return to the editor');
    expect(all).toContain('Move subscription to this account');
    expect(all).toContain('Restore purchases');
    expect(all).not.toMatch(/confirm (your )?password|video|\bwatch\b/i);
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

  it('no video files, components or references remain', () => {
    for (const f of ['assets/tutorial', 'src/components/LearnVideo.tsx', 'src/lib/learnVideos.ts']) {
      expect(fs.existsSync(path.join(ROOT, f))).toBe(false);
    }
    for (const f of ['src/app/(tabs)/settings/learn/[topic].tsx', 'src/lib/learnContent.ts', 'src/components/LearnEntry.tsx']) {
      expect(read(f)).not.toMatch(/LearnVideo|learnVideos|expo-video|\.mp4|video/i);
    }
  });
});

describe('Learn how it works: a topic screen', () => {
  it.each(LEARN_TOPICS.map((t) => t.slug))('%s resolves, shows title, intro and numbered steps, with no video', async (slug) => {
    mockParams = { topic: slug };
    const tree = await render(<LearnTopic />);
    const t = LEARN_TOPICS.find((x) => x.slug === slug)!;
    expect(tree.root.findAll((n: any) => n.type === 'Redirect')).toHaveLength(0);
    expect(hasVideo(tree)).toBe(false);
    const text = allText(tree).join(' | ');
    expect(text).toContain(t.title);
    expect(text).toContain(t.detail);
    t.steps.forEach((step, i) => {
      expect(text).toContain(step);
      expect(allText(tree)).toContain(String(i + 1));
    });
    expect(text).not.toMatch(PLACEHOLDER);
    expect(JSON.stringify(tree.toJSON())).not.toMatch(/Play video|Pause video|Replay|Sound/);
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
    await press(await render(<LearnTopic />), `Next: ${topicsIn('website')[1].title}`);
    expect(mockRouter.replace).toHaveBeenCalledWith(`/settings/learn/${topicsIn('website')[1].slug}`);
    for (const sec of LEARN_SECTIONS) {
      const list = topicsIn(sec.id);
      list.forEach((t, i) => expect(nextInSection(t)?.slug).toBe(list[i + 1]?.slug));
      mockParams = { topic: list[list.length - 1].slug };
      expect(allText(await render(<LearnTopic />)).join(' ')).not.toMatch(/Next:/);
    }
  });

  it('Get help shows the support page and email as tappable links', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    mockParams = { topic: 'help' };
    const tree = await render(<LearnTopic />);
    const links = tree.root.findAll((n: any) => n.type === 'Text' && n.props?.accessibilityRole === 'link' && typeof n.props.onPress === 'function');
    expect(links.map((l: any) => l.props.children)).toEqual(['https://www.aibarber.org/support', 'support@davoxa.com']);
    links[0].props.onPress();
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://www.aibarber.org/support?app=1');
    links[1].props.onPress();
    expect(open).toHaveBeenCalledWith('mailto:support@davoxa.com');
  });

  it('an unknown topic falls back to the list', async () => {
    mockParams = { topic: 'nope' };
    const tree = await render(<LearnTopic />);
    expect(tree.root.findAll((n: any) => n.type === 'Redirect')[0].props.href).toBe('/settings/learn');
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
