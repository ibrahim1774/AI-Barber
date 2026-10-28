import React from 'react';
import { allText, press, render } from '../store/render';

jest.mock('@/constants/theme', () => require('../store/themeMock'));

import { BookButtonPicker, AIBARBER_DETAIL, DOUBLE_BOOKING_NOTE, PUBLISH_NOTE } from '@/components/setup/BookButtonPicker';

const radio = (tree: any, label: string) =>
  tree.root.findAll((n: any) => n.props.accessibilityRole === 'radio' && n.props.accessibilityLabel === label && n.props.onPress)[0];

it('without an own link: one line, no choice', async () => {
  const tree = await render(<BookButtonPicker own={null} choice="aibarber" onChange={jest.fn()} />);
  expect(allText(tree)).toContain('Your Book button will use Prime Barber booking after you publish.');
  expect(radio(tree, 'Booking link')).toBeUndefined();
});

it('with an own link: two cards with the short link and detail', async () => {
  const tree = await render(<BookButtonPicker own="https://www.booksy.com/fade-lab" choice="own" onChange={jest.fn()} />);
  const t = allText(tree);
  expect(t).toContain('booksy.com/fade-lab');
  expect(t).toContain(AIBARBER_DETAIL);
  expect(t).not.toContain(DOUBLE_BOOKING_NOTE);
});

it('choosing AI Barber calls back, warns about the old app and says to publish; switching back is one tap', async () => {
  const onChange = jest.fn();
  function Host() {
    const [c, setC] = React.useState<'own' | 'aibarber' | 'call'>('own');
    return <BookButtonPicker own="https://booksy.com/x" choice={c} onChange={(v) => { onChange(v); setC(v); }} />;
  }
  const tree = await render(<Host />);
  const { act } = require('react-test-renderer');
  await act(async () => radio(tree, 'Built-in booking').props.onPress());
  expect(onChange).toHaveBeenLastCalledWith('aibarber');
  expect(allText(tree)).toContain(DOUBLE_BOOKING_NOTE);
  expect(allText(tree)).toContain(PUBLISH_NOTE);
  await act(async () => radio(tree, 'Booking link').props.onPress());
  expect(onChange).toHaveBeenLastCalledWith('own');
  expect(allText(tree)).not.toContain(DOUBLE_BOOKING_NOTE);
});
