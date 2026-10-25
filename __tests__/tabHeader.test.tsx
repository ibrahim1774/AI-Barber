import React from 'react';
import { Text } from 'react-native';
import { render, allText } from './store/render';

jest.mock('@/constants/theme', () => ({
  colors: new Proxy({}, { get: () => '#000' }),
  fonts: new Proxy({}, { get: () => 'System' }),
}));

import { TabHeader } from '@/components/TabHeader';

it('renders the tab title as the header and the children after it', async () => {
  const t = await render(<TabHeader title="Bookings"><Text>pill</Text></TabHeader>);
  expect(allText(t)[0]).toBe('Bookings');
  expect(allText(t)).toContain('pill');
});
