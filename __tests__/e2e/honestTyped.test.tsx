/**
 * Honest sites, typed path: the services checklist (tick + optional price) before generation.
 * Nothing ticked → no services at all; ticked → exactly those, in SERVICE_CHOICES order.
 */
import React from 'react';
import { act, allText, render } from '../store/render';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { replace: (...a: unknown[]) => mockReplace(...a), push: jest.fn(), back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => ({ ...require('../store/themeMock'), swatchLabel: (c: string) => c }));

import Manual from '@/app/manual';
import { ServiceChecklist } from '@/components/ServiceChecklist';
import { manualSite } from '@/lib/importer';
import { SERVICE_CHOICES, servicesFromPicks, setPickPrice, tickedCount, togglePick } from '@/lib/serviceChecklist';
import * as store from '@/lib/siteStore';

const SCRATCH = { shopName: 'Fade Lab', area: 'Austin, TX', address: 'Austin, TX', phone: '(512) 555-0142', colorTheme: '#f4a100' };

describe('checklist helpers', () => {
  it('the choices are the shared list, word for word', () => {
    expect(SERVICE_CHOICES).toEqual([
      'Haircut', 'Skin fade', 'Taper', 'Beard trim', 'Line up', 'Hot towel shave', 'Kids cut', 'Haircut & beard', 'Hair design', 'Color',
    ]);
  });

  it('tick, untick (price kept), typing a price ticks; output keeps the list order, bare numbers get $', () => {
    let p = togglePick({}, 'Beard trim');
    p = setPickPrice(p, 'Haircut', '25');
    p = togglePick(p, 'Taper');
    p = setPickPrice(p, 'Taper', '30+');
    expect(tickedCount(p)).toBe(3);
    expect(servicesFromPicks(p)).toEqual([{ title: 'Haircut', price: '$25' }, { title: 'Taper', price: '30+' }, { title: 'Beard trim' }]);
    p = togglePick(p, 'Haircut');
    expect(servicesFromPicks(p)?.map((s) => s.title)).toEqual(['Taper', 'Beard trim']);
    p = togglePick(p, 'Haircut');
    expect(servicesFromPicks(p)?.[0]).toEqual({ title: 'Haircut', price: '$25' });
  });

  it('nothing ticked → undefined (no Services section)', () => {
    expect(servicesFromPicks({})).toBeUndefined();
    expect(servicesFromPicks(togglePick(togglePick({}, 'Color'), 'Color'))).toBeUndefined();
  });
});

describe('manualSite', () => {
  it('no ticks: no services, no invented email', async () => {
    const { site, inputs } = await manualSite(SCRATCH);
    expect(site.services).toEqual([]);
    expect(inputs.services).toBeUndefined();
    expect(site.contact?.email ?? '').toBe('');
  });

  it('ticked services exactly, with their prices', async () => {
    const { site, inputs } = await manualSite({ ...SCRATCH, services: [{ title: 'Haircut', price: '$25' }, { title: 'Kids cut' }] });
    expect(site.services.map((s) => [s.title, s.price || ''])).toEqual([['Haircut', '$25'], ['Kids cut', '']]);
    expect(site.services.every((s) => !s.description)).toBe(true);
    expect(inputs.services).toEqual([{ title: 'Haircut', price: '$25' }, { title: 'Kids cut' }]);
  });
});

describe('ServiceChecklist', () => {
  it('is collapsed by default behind "Add your services (optional)"', async () => {
    const tree = await render(<ServiceChecklist picks={{}} onChange={() => {}} />);
    expect(allText(tree)).toContain('Add your services (optional)');
    expect(allText(tree)).not.toContain('Haircut');
  });
});

describe('the typed path, end to end', () => {
  beforeEach(async () => {
    mockReplace.mockClear();
    await store.clearSite();
  });

  const byLabel = (tree: any, label: string) =>
    tree.root.findAll((n: any) => n.props?.accessibilityLabel === label && (n.props.onPress || n.props.onChangeText))[0];

  const fillForm = async (tree: any) => {
    await act(async () => byLabel(tree, 'Barbershop name').props.onChangeText('Fade Lab'));
    await act(async () => byLabel(tree, 'Address or city').props.onChangeText('Austin, TX'));
    await act(async () => byLabel(tree, 'Mobile number').props.onChangeText('5125550142'));
  };

  it('ticks two services with a price, generates, and the draft has exactly those', async () => {
    const tree = await render(<Manual />);
    await fillForm(tree);
    await act(async () => byLabel(tree, 'Skin fade').props.onPress());
    await act(async () => byLabel(tree, 'Haircut').props.onPress());
    await act(async () => byLabel(tree, 'Haircut price').props.onChangeText('30'));
    expect(allText(tree).join(' ')).toContain('2 ticked');
    const go = tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function'
      && allText({ root: n }).join('') === 'Build my website')[0];
    await act(async () => {
      await go.props.onPress();
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(mockReplace).toHaveBeenCalledWith('/generating');
    const saved = await store.loadSite();
    expect(saved?.data.services.map((s) => [s.title, s.price || ''])).toEqual([['Haircut', '$30'], ['Skin fade', '']]);
  });

  it('with nothing ticked: a site with no services', async () => {
    const tree = await render(<Manual />);
    await fillForm(tree);
    const go = tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function'
      && allText({ root: n }).join('') === 'Build my website')[0];
    await act(async () => {
      await go.props.onPress();
      await new Promise((r) => setTimeout(r, 400));
    });
    expect((await store.loadSite())?.data.services).toEqual([]);
  });
});
