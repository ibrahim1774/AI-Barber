import React from 'react';
const { act, create } = require('react-test-renderer');
import { Switch, Text, TextInput } from 'react-native';

jest.mock('@/constants/theme', () => ({
  colors: new Proxy({}, { get: () => '#000' }),
  fonts: new Proxy({}, { get: () => 'x' }),
}));

import { Input, ToggleRow } from '@/components/setup/ui';

test('tapping an Input caption focuses it', () => {
  let tree: any;
  act(() => { tree = create(<Input title="Name" label="Name" value="" onChangeText={() => {}} />); });
  const input = tree.root.findByType(TextInput).instance;
  const spy = jest.spyOn(input, 'focus');
  act(() => tree.root.findAllByType(Text)[0].props.onPress());
  expect(spy).toHaveBeenCalledTimes(1);
});

test('tapping the ToggleRow text flips the switch', () => {
  const change = jest.fn();
  let tree: any;
  act(() => { tree = create(<ToggleRow label="Sold out" value={false} onValueChange={change} />); });
  const label = tree.root.findAllByType(Text)[0];
  let n = label.parent;
  while (n && typeof n.props.onPress !== 'function') n = n.parent;
  act(() => n.props.onPress());
  expect(change).toHaveBeenCalledWith(true);
  expect(tree.root.findByType(Switch).props.accessibilityLabel).toBe('Sold out');
});

test('numeric inputs point at the Done bar', () => {
  let tree: any;
  act(() => { tree = create(<Input label="Price" value="" keyboardType="decimal-pad" onChangeText={() => {}} />); });
  expect(tree.root.findByType(TextInput).props.inputAccessoryViewID).toBeTruthy();
});
