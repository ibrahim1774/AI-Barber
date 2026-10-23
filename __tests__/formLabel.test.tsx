import React from 'react';
import { act, create } from 'react-test-renderer';
import { Field } from '@/components/Field';
import { FormLabel } from '@/components/FormLabel';
import { Text, TextInput } from 'react-native';

jest.mock('@/constants/theme', () => ({
  colors: new Proxy({}, { get: () => '#000' }),
  fonts: new Proxy({}, { get: () => 'x' }),
}));

test('tapping a Field label focuses its input', () => {
  const focus = jest.fn();
  let tree: any;
  act(() => {
    tree = create(<Field label="Name" value="" onChangeText={() => {}} tone="form" />, {
      createNodeMock: () => ({ focus }),
    });
  });
  const label = tree.root.findAllByType(Text)[0];
  const input = tree.root.findByType(TextInput).instance;
  const spy = jest.spyOn(input, 'focus');
  act(() => label.props.onPress());
  expect(spy).toHaveBeenCalledTimes(1);
});

test('FormLabel focuses the ref it is given', () => {
  const focus = jest.fn();
  const ref = React.createRef<TextInput>();
  (ref as any).current = { focus };
  let tree: any;
  act(() => { tree = create(<FormLabel input={ref}>Phone</FormLabel>); });
  act(() => tree.root.findAllByType(Text)[0].props.onPress());
  expect(focus).toHaveBeenCalled();
});
