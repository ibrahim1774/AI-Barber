import React from 'react';
import fs from 'fs';
import path from 'path';
import { allText, press, render } from './store/render';

const mockRouter = { push: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockRouter.push(...a), back: () => mockRouter.back() } }));
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('@/components/Page', () => {
  const R = require('react');
  return { Page: ({ children }: any) => R.createElement(R.Fragment, null, children) };
});
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

import Learn from '@/app/(tabs)/settings/learn';
import { LearnVideo } from '@/components/LearnVideo';
import { LEARN_FEATURES } from '@/lib/learnContent';
import { LEARN_VIDEOS } from '@/lib/learnVideos';

const ROOT = path.join(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('Learn how it works (Settings)', () => {
  it('lists every feature and value prop', async () => {
    const text = allText(await render(<Learn />)).join(' | ');
    for (const f of LEARN_FEATURES) {
      expect(text).toContain(f.title);
      expect(text).toContain(f.value);
    }
    expect(text).toMatch(/without an account/i);
    expect(text).toMatch(/calendar/i);
    expect(text).toMatch(/domain/i);
    expect(text).toMatch(/notification/i);
    expect(text).toMatch(/team/i);
    expect(text).toMatch(/products/i);
  });

  it('every feature has a non-empty title and value', () => {
    for (const f of LEARN_FEATURES) {
      expect(f.title.trim()).not.toBe('');
      expect(f.value.trim()).not.toBe('');
    }
  });

  it('with no bundled video the slot renders nothing and the page has no "coming soon"', async () => {
    expect(Object.keys(LEARN_VIDEOS)).toEqual([]); // videos come later
    expect(allText(await render(<Learn />)).join(' ')).not.toMatch(/coming soon/i);
    expect(await render(<LearnVideo slug="intro" />)).toBeTruthy();
    const tree = await render(<LearnVideo slug="intro" />);
    expect(tree.toJSON()).toBeNull();
  });

  it('LEARN_VIDEOS keys are known slugs', () => {
    const slugs = ['intro', 'editing', 'bookings', 'store', 'payments'];
    for (const k of Object.keys(LEARN_VIDEOS)) expect(slugs).toContain(k);
  });
});

describe('Settings entry', () => {
  it('has a Learn how it works row in Help, and no Tutorial section', () => {
    const src = read('src/app/(tabs)/settings/index.tsx');
    expect(src).toContain('label="Learn how it works"');
    expect(src).toContain("'/settings/learn'");
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
