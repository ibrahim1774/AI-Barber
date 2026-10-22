/**
 * The app's own copy makes no claim the product no longer makes: the /generating steps follow what
 * actually happened, and no screen, component or App Store-facing string mentions AI imagery, written
 * descriptions or "luxury / premium" output.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, allText, render } from '../store/render';

jest.mock('@/constants/theme', () => require('../store/themeMock'));
jest.mock('@/lib/nav', () => ({ resetTo: jest.fn() }));

import Generating from '@/app/generating';
import { generateContent } from '@/web/services/geminiService';
import { generatingSteps } from '@/lib/generatingSteps';
import { toShopSite, listingSite } from '@/lib/importer';
import * as store from '@/lib/siteStore';

const booksy = require('../fixtures/scrape-booksy.json');
const gbp = require('../fixtures/import-business.json');

describe('generatingSteps', () => {
  it('typed, nothing ticked: details, sample photos, build', async () => {
    const data = await generateContent({ shopName: 'Fade Lab', area: '', phone: '' });
    expect(generatingSteps({ inputs: {}, data })).toEqual(['Reading your details', 'Choosing sample photos', 'Building your website']);
  });

  it('typed with ticked services', async () => {
    const data = await generateContent({ shopName: 'Fade Lab', area: '', phone: '', services: [{ title: 'Haircut' }] });
    expect(generatingSteps({ inputs: {}, data })).toEqual([
      'Reading your details', 'Adding your services', 'Choosing sample photos', 'Building your website',
    ]);
  });

  it('booking page: reads the page, brings in photos and reviews, adds its services', () => {
    const r = toShopSite(booksy, 'https://booksy.com/x', 'booking');
    const steps = generatingSteps({ inputs: r.inputs, data: r.site });
    expect(steps.slice(0, 3)).toEqual(['Reading your booking page', 'Bringing in your photos and reviews', 'Adding your services']);
    expect(steps.at(-1)).toBe('Building your website');
  });

  it('Google listing with nothing ticked: no services step', () => {
    const r = listingSite({ ...gbp, _platform: 'gbp' }, undefined);
    const steps = generatingSteps({ inputs: r.inputs, data: r.site });
    expect(steps.slice(0, 2)).toEqual(['Reading your Google listing', 'Bringing in your photos and reviews']);
    expect(steps).not.toContain('Adding your services');
  });

  it('no record: just building', () => {
    expect(generatingSteps(null)).toEqual(['Building your website']);
  });
});

describe('the /generating screen', () => {
  it('shows the draft\'s real steps and none of the old claims', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const data = await (async () => {
      jest.useRealTimers();
      const d = await generateContent({ shopName: 'Fade Lab', area: '', phone: '', services: [{ title: 'Haircut' }] });
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      return d;
    })();
    await store.saveSite({ draftId: 'd', inputs: { shopName: 'Fade Lab', area: '', phone: '' }, data, updatedAt: 1, slug: null, deployedUrl: null, transactionId: null });
    const tree = await render(<Generating />);
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(400);
      });
      allText(tree).forEach((t) => seen.add(t));
    }
    const text = [...seen].join(' | ');
    for (const step of ['Reading your details…', 'Adding your services…', 'Choosing sample photos…', 'Building your website…']) {
      expect(text).toContain(step);
    }
    expect(text).toContain('Your website is saved. Opening the editor next.');
    expect(text).not.toMatch(/luxury|premium|AI imagery|descriptions|Do not close/i);
    jest.useRealTimers();
  });
});

describe('no untrue product claims in the app copy', () => {
  const root = path.join(__dirname, '../..');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (p !== path.join(root, 'src/web')) walk(p);
      } else if (/\.(tsx?|json)$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(root, 'src'));
  files.push(path.join(root, 'app.json'));
  const BANNED = /AI[- ]?(imagery|images|generated|written|copy)|custom descriptions|luxury|premium|high-end|pixel-perfect|Custom Barbershop Website/i;

  it('no AI imagery / written copy / luxury / premium claims outside src/web', () => {
    const hits: string[] = [];
    for (const f of files) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        if (BANNED.test(l)) hits.push(`${path.relative(root, f)}:${i + 1}: ${l.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('the Google path never promises imported services', () => {
    for (const f of ['src/app/start.tsx', 'src/app/find-listing.tsx']) {
      expect(fs.readFileSync(path.join(root, f), 'utf8')).not.toMatch(/services[^.\n]*imported automatically/i);
    }
  });
});
