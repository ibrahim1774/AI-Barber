import React from 'react';
import type { TourController } from '@/components/tutorial/useTour';

jest.mock('@/constants/theme', () => {
  const f = new Proxy({}, { get: () => 'System' });
  const c = new Proxy({}, { get: () => '#000' });
  return { fonts: f, colors: c };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) }));
jest.mock('@/components/tutorial/registry', () => ({
  measureTarget: jest.fn(() => Promise.resolve({ x: 0, y: 114, width: 390, height: 900 })),
}));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

const { act, create } = require('react-test-renderer');
const { StyleSheet } = require('react-native');
const { TutorialLayer } = require('@/components/tutorial/TutorialLayer');

function controller(over: Partial<TourController> = {}): TourController {
  return {
    tour: { id: 'getpaid', screen: 'getpaid', label: 'Getting paid', auto: true, steps: [{ target: 'getpaid.first', tip: 'Pick how clients pay.' }] },
    step: 0, next: jest.fn(), skip: jest.fn(), ...over,
  } as unknown as TourController;
}

async function render(c: TourController) {
  jest.useFakeTimers();
  let r: any;
  await act(async () => { r = create(<TutorialLayer controller={c} />); });
  await act(async () => { jest.advanceTimersByTime(300); });
  await act(async () => { await Promise.resolve(); });
  return r;
}
const byLabel = (r: any, label: string) => r.root.findAll((n: any) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');
afterEach(() => jest.useRealTimers());

describe('TutorialLayer with a target taller than the screen', () => {
  it('keeps the card inside the safe area and the controls reachable', async () => {
    const r = await render(controller());
    const card = r.root.findAll((n: any) => n.props.accessibilityLiveRegion === 'polite')[0];
    // the wrapper holding the card is positioned by the layer
    let wrap = card.parent;
    while (wrap && StyleSheet.flatten(wrap.props.style || {}).paddingHorizontal !== 16) wrap = wrap.parent;
    const st = StyleSheet.flatten(wrap.props.style);
    expect(st.top).toBeUndefined(); // not hanging off a top edge above the screen
    expect(st.bottom).toBeGreaterThanOrEqual(34 + 8 - 1);
    expect(byLabel(r, 'Close tour').length).toBeGreaterThan(0);
    expect(JSON.stringify(r.toJSON())).toContain('Done');
  });

  it('tapping the backdrop ends the tour', async () => {
    const c = controller();
    const r = await render(c);
    const back = byLabel(r, 'Dismiss tour');
    expect(back.length).toBeGreaterThan(0);
    act(() => back[0].props.onPress());
    expect(c.next).toHaveBeenCalled();
  });

  it('the Close button ends the tour', async () => {
    const c = controller();
    const r = await render(c);
    act(() => byLabel(r, 'Close tour')[0].props.onPress());
    expect(c.skip).toHaveBeenCalled();
  });
});
