/**
 * S2 (e2e pressure test): the phone pad on /manual has no Return key, so it could not be dismissed and it hid the
 * Build button. Number pads now get a Done bar (InputAccessoryView), the screen scrolls the button into view,
 * and dragging the page dismisses the keyboard.
 */
import React from 'react';
import { InputAccessoryView, Keyboard, Platform, ScrollView } from 'react-native';
import { act, render } from './store/render';

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => true, canDismiss: () => false } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => ({ ...require('./store/themeMock'), swatchLabel: (c: string) => c }));

import Manual from '@/app/manual';
import { Field } from '@/components/Field';
import { FlowInput } from '@/components/FlowParts';
import { needsDoneBar } from '@/components/KeyboardDoneBar';

const inputByLabel = (tree: any, label: string) =>
  tree.root.findAll((n: any) => n.props?.accessibilityLabel === label && typeof n.props.onChangeText === 'function')[0];

describe('needsDoneBar', () => {
  it('is for the pads with no Return key, on iOS only', () => {
    expect(needsDoneBar('phone-pad')).toBe(true);
    expect(needsDoneBar('number-pad')).toBe(true);
    expect(needsDoneBar('decimal-pad')).toBe(true);
    expect(needsDoneBar('numeric')).toBe(true);
    expect(needsDoneBar('default')).toBe(false);
    expect(needsDoneBar('email-address')).toBe(false);
    expect(needsDoneBar(undefined)).toBe(false);
  });
});

describe('/manual keyboard handling', () => {
  it('the phone field points at a Done bar whose button dismisses the keyboard', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    const tree = await render(<Manual />);
    const phone = inputByLabel(tree, 'Mobile number');
    expect(phone.props.keyboardType).toBe('phone-pad');
    const id = phone.props.inputAccessoryViewID;
    expect(typeof id).toBe('string');
    const bars = tree.root.findAllByType(InputAccessoryView).filter((n: any) => n.props.nativeID === id);
    expect(bars).toHaveLength(1);
    const done = bars[0].findAll((n: any) => n.props?.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Done')[0];
    expect(done).toBeTruthy();
    await act(async () => { done.props.onPress(); });
    expect(dismiss).toHaveBeenCalledTimes(1);
    dismiss.mockRestore();
  });

  it('text fields get no Done bar; Return moves on (name -> address -> phone -> area) and the last one dismisses', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    const tree = await render(<Manual />);
    expect(inputByLabel(tree, 'Barbershop name').props.inputAccessoryViewID).toBeUndefined();
    expect(inputByLabel(tree, 'Barbershop name').props.returnKeyType).toBe('next');
    expect(inputByLabel(tree, 'Address or city').props.returnKeyType).toBe('next');
    expect(inputByLabel(tree, 'Mobile number').props.returnKeyType).toBe('next');
    const area = inputByLabel(tree, 'Area you serve');
    expect(area.props.returnKeyType).toBe('done');
    await act(async () => { area.props.onSubmitEditing(); });
    expect(dismiss).toHaveBeenCalledTimes(1);
    dismiss.mockRestore();
  });

  it('the page scroll keeps taps working, dismisses on drag, and the Build button is measured for scrolling into view', async () => {
    const tree = await render(<Manual />);
    const scroll = tree.root.findByType(ScrollView);
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
    expect(scroll.props.keyboardDismissMode).toBe('on-drag');
    expect(typeof scroll.props.onScroll).toBe('function');
    const cta = tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Build my website' && typeof n.props.onPress === 'function');
    expect(cta.length).toBeGreaterThan(0);
  });
});

describe('Done bar on the shared inputs', () => {
  it('FlowInput and Field add it for a number pad and not for text', async () => {
    expect(Platform.OS).toBe('ios');
    const t = await render(
      <>
        <FlowInput label="A" value="" onChangeText={() => {}} keyboardType="number-pad" />
        <FlowInput label="B" value="" onChangeText={() => {}} />
        <Field tone="form" label="C" value="" onChangeText={() => {}} keyboardType="phone-pad" />
        <Field tone="form" label="D" value="" onChangeText={() => {}} />
      </>,
    );
    expect(t.root.findAllByType(InputAccessoryView)).toHaveLength(2);
    expect(inputByLabel(t, 'A').props.inputAccessoryViewID).toBeDefined();
    expect(inputByLabel(t, 'B').props.inputAccessoryViewID).toBeUndefined();
    expect(inputByLabel(t, 'C').props.inputAccessoryViewID).toBeDefined();
    expect(inputByLabel(t, 'D').props.inputAccessoryViewID).toBeUndefined();
    expect(inputByLabel(t, 'A').props.inputAccessoryViewID).not.toBe(inputByLabel(t, 'C').props.inputAccessoryViewID);
  });
});
