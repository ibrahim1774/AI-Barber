import React from 'react';
import fs from 'fs';
import path from 'path';
import Storage from 'expo-sqlite/kv-store';
import { generateContent } from '@/web/services/geminiService';
import { startDraft } from '@/lib/flow';
import { clearSite, saveSite } from '@/lib/siteStore';
import { nextOverlay } from '@/lib/overlayFlags';
import {
  hasTourSeen, markTourSeen, requestTour, resetTourRequestForTests, takeTourRequest, tourFlagKey, TOUR_ORDER, TOURS,
} from '@/components/tutorial/tours';
import { placeTip } from '@/components/tutorial/place';
import { useTour, type TourController } from '@/components/tutorial/useTour';

const { act, create } = require('react-test-renderer');

const SRC = path.join(__dirname, '..', 'src');
const SCREEN_FILES: Record<string, string[]> = {
  edit: ['components/PublishBar.tsx', 'app/(tabs)/edit.tsx'], // the Change-image pill's target is registered by the screen that owns the preview
  bookings: ['app/(tabs)/bookings.tsx', 'components/bookings/Fab.tsx'],
  store: ['app/(tabs)/store.tsx'],
  getpaid: ['app/get-paid.tsx'],
};
const read = (f: string) => fs.readFileSync(path.join(SRC, f), 'utf8');

describe('tour definitions', () => {
  it('are short: the Edit tour at most 5 steps, the others at most 4', () => {
    for (const id of TOUR_ORDER) expect(TOURS[id].steps.length).toBeLessThanOrEqual(id === 'edit' ? 5 : 4);
    expect(TOURS.edit.steps[0].target).toBe('edit.publish'); // the old launch guide's Publish step comes first
  });

  it('every pointed-at target is registered by its screen', () => {
    for (const id of TOUR_ORDER) {
      const tour = TOURS[id];
      const source = SCREEN_FILES[tour.screen].map(read).join('\n');
      for (const step of tour.steps) {
        if (step.target === null) continue; // a centred tip on purpose
        const registered = source.includes(`useTutorialTarget('${step.target}')`) || source.includes(`target="${step.target}"`);
        expect({ tour: id, target: step.target, registered }).toEqual({ tour: id, target: step.target, registered: true });
      }
    }
  });

  it('Settings lists the five tours in order, each with a label', () => {
    expect(TOUR_ORDER.map((id) => TOURS[id].label)).toEqual([
      'Editing your site', 'Taking bookings', 'Selling products', 'Getting paid', 'Publishing',
    ]);
  });

  it('the old launch guide is gone and Settings has a Tutorial section before Help', () => {
    expect(fs.existsSync(path.join(SRC, 'components/LaunchGuide.tsx'))).toBe(false);
    const settings = read('app/(tabs)/settings.tsx');
    expect(settings.indexOf('title="Tutorial"')).toBeGreaterThan(0);
    expect(settings.indexOf('title="Tutorial"')).toBeLessThan(settings.indexOf('title="Help"'));
  });
});

describe('tour flags', () => {
  const site = () => generateContent({ shopName: 'Fresh Cuts', area: '', phone: '' });

  it('are per install, not per draft', async () => {
    expect(tourFlagKey('bookings')).toBe('tutorial:bookings:v1');
    expect(await hasTourSeen('bookings')).toBe(false);
    await markTourSeen('bookings');
    expect(await hasTourSeen('bookings')).toBe(true);
  });

  it('survive a new draft id', async () => {
    await clearSite();
    const first = await startDraft({ inputs: { shopName: 'A', area: '', phone: '' }, site: await site() });
    await markTourSeen('store');
    await clearSite();
    const second = await startDraft({ inputs: { shopName: 'B', area: '', phone: '' }, site: await site() });
    expect(second.draftId).not.toBe(first.draftId);
    expect(await hasTourSeen('store')).toBe(true);
  });

  it('a seen Edit tour means a later draft does not get the guide overlay', async () => {
    await clearSite();
    const rec = await startDraft({ inputs: { shopName: 'C', area: '', phone: '', importedFrom: 'booking' }, site: await site() });
    await saveSite(rec);
    await Storage.removeItem(tourFlagKey('edit'));
    expect(await nextOverlay(rec)).toBe('guide');
    await markTourSeen('edit');
    expect(await nextOverlay(rec)).toBeNull();
  });

  it('an unreadable flag reads as unseen and an unwritable one does not throw', async () => {
    jest.spyOn(Storage, 'getItem').mockRejectedValueOnce(new Error('locked'));
    expect(await hasTourSeen('getpaid')).toBe(false);
    jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('full'));
    await expect(markTourSeen('getpaid')).resolves.toBeUndefined();
  });
});

describe('replay requests', () => {
  beforeEach(resetTourRequestForTests);
  it('are taken once, by the right screen only', () => {
    requestTour('publishing');
    expect(takeTourRequest('bookings')).toBeNull();
    expect(takeTourRequest('edit')).toBe('publishing');
    expect(takeTourRequest('edit')).toBeNull();
  });
});

describe('useTour', () => {
  let ctl: TourController;
  function Probe(props: { auto?: any; ready?: boolean; ignoreFlag?: boolean; screen?: any; onDone?: any }) {
    ctl = useTour(props.screen ?? 'bookings', props);
    return null;
  }
  const mount = async (props: React.ComponentProps<typeof Probe>) => {
    let r: any;
    await act(async () => {
      r = create(React.createElement(Probe, props));
    });
    return r;
  };
  beforeEach(async () => {
    resetTourRequestForTests();
    await Storage.removeItem(tourFlagKey('bookings'));
    await Storage.removeItem(tourFlagKey('edit'));
  });

  it('opens once when unseen, steps through, sets the flag on the last Next', async () => {
    const onDone = jest.fn();
    await mount({ auto: 'bookings', ready: true, onDone });
    expect(ctl.tour?.id).toBe('bookings');
    expect(ctl.step).toBe(0);
    await act(async () => ctl.next());
    expect(ctl.step).toBe(1);
    await act(async () => ctl.next());
    await act(async () => ctl.next());
    expect(ctl.tour).toBeNull();
    expect(onDone).toHaveBeenCalledWith('bookings');
    expect(await hasTourSeen('bookings')).toBe(true);
  });

  it('Skip also sets the flag, and a second mount does not auto-show', async () => {
    await mount({ auto: 'bookings', ready: true });
    await act(async () => ctl.skip());
    expect(ctl.tour).toBeNull();
    await mount({ auto: 'bookings', ready: true });
    expect(ctl.tour).toBeNull();
  });

  it('waits for ready', async () => {
    const r = await mount({ auto: 'bookings', ready: false });
    expect(ctl.tour).toBeNull();
    await act(async () => r.update(React.createElement(Probe, { auto: 'bookings', ready: true })));
    expect(ctl.tour?.id).toBe('bookings');
  });

  it('a replay from Settings ignores the seen flag', async () => {
    await markTourSeen('bookings');
    requestTour('bookings');
    await mount({ auto: 'bookings', ready: true });
    expect(ctl.tour?.id).toBe('bookings');
  });

  it('the Edit guide path ignores the flag when asked to', async () => {
    await markTourSeen('edit');
    await mount({ screen: 'edit', auto: 'edit', ready: true, ignoreFlag: true });
    expect(ctl.tour?.id).toBe('edit');
  });
});

describe('placeTip', () => {
  it('centres without a target, goes below when there is room and above otherwise', () => {
    expect(placeTip(null, 390, 844).centred).toBe(true);
    expect(placeTip({ x: 10, y: 100, w: 100, h: 40 }, 390, 844)).toMatchObject({ centred: false, above: false, edge: 154 });
    expect(placeTip({ x: 10, y: 760, w: 100, h: 40 }, 390, 844)).toMatchObject({ centred: false, above: true, edge: 746 });
  });
});

describe('Edit tour start condition', () => {
  const { editTourReady } = require('@/components/tutorial/tours');
  it('needs the guide overlay, a generated site and an account', () => {
    expect(editTourReady({ overlay: 'guide', hasSite: true, signedIn: true })).toBe(true);
    expect(editTourReady({ overlay: 'guide', hasSite: true, signedIn: false })).toBe(false);
    expect(editTourReady({ overlay: 'guide', hasSite: false, signedIn: true })).toBe(false);
    expect(editTourReady({ overlay: 'prompts', hasSite: true, signedIn: true })).toBe(false);
    expect(editTourReady({ overlay: null, hasSite: true, signedIn: true })).toBe(false);
  });
});
