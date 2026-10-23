import React from 'react';
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
import type { WebsiteData } from '@/web/types';
import { ReviewsSheet } from '@/components/sections/ReviewsSheet';
import { storedRatingLine } from '@/lib/sections/reviews';

const { act, create } = require('react-test-renderer');

const site = {
  shopName: 'Jacks', area: 'Austin, TX', phone: '(512) 555-0142', template: 'luxe',
  aggregateRating: { rating: 4.8, count: 1200 }, reviewsSource: 'Booksy', reviews: [],
} as unknown as WebsiteData;

function mount() {
  let data = site;
  const onClose = jest.fn();
  const onChange = jest.fn((fn: (d: WebsiteData) => WebsiteData) => { data = fn(data); });
  let tree: any;
  act(() => { tree = create(<ReviewsSheet visible data={data} onChange={onChange} onClose={onClose} />); });
  const input = () => tree.root.find((n: any) => n.props?.accessibilityLabel === 'Rating wording' && typeof n.props?.onChangeText === 'function');
  const done = () => tree.root.find((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props?.onPress === 'function');
  return { onClose, input, done, get data() { return data; } };
}

describe('Reviews sheet: Done keeps typed wording (review S4)', () => {
  test('typing then Done, with no blur, stores the wording and closes', () => {
    const m = mount();
    act(() => { m.input().props.onChangeText('Loved by {count} clients'); });
    act(() => { m.done().props.onPress(); });
    expect(storedRatingLine(m.data)).toBe('Loved by {count} clients');
    expect(m.onClose).toHaveBeenCalledTimes(1);
  });

  test('a refused wording keeps the sheet open and stores nothing', () => {
    const m = mount();
    act(() => { m.input().props.onChangeText('Rated 5 stars'); });
    act(() => { m.done().props.onPress(); });
    expect(storedRatingLine(m.data)).toBe('');
    expect(m.onClose).not.toHaveBeenCalled();
  });

  test('Done with nothing typed just closes', () => {
    const m = mount();
    act(() => { m.done().props.onPress(); });
    expect(m.onClose).toHaveBeenCalledTimes(1);
  });
});
