import React from 'react';
import { render, press, hasButton, allText } from './render';

jest.mock('@/constants/theme', () => ({
  colors: new Proxy({}, { get: () => '#000' }),
  fonts: new Proxy({}, { get: () => 'System' }),
}));

import { StoreHeader } from '@/components/store/StoreHeader';

describe('StoreHeader', () => {
  it('shows labelled Share and Settings buttons that fire their callbacks', async () => {
    const onShare = jest.fn();
    const onSetup = jest.fn();
    const t = await render(<StoreHeader title="Shop" locked={false} onShare={onShare} onSetup={onSetup} />);
    await press(t, 'Share');
    await press(t, 'Settings');
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onSetup).toHaveBeenCalledTimes(1);
  });
  it('hides Settings when locked but keeps Share', async () => {
    const t = await render(<StoreHeader title="Shop" locked onShare={() => {}} onSetup={() => {}} />);
    expect(hasButton(t, 'Share')).toBe(true);
    expect(hasButton(t, 'Settings')).toBe(false);
  });
});

describe('StoreHeader title', () => {
  it('shows "Store", never the shop name', async () => {
    const t = await render(<StoreHeader title="Jack's Barbershop" locked={false} onShare={() => {}} onSetup={() => {}} />);
    expect(allText(t)).toContain('Store');
    expect(allText(t).join(' ')).not.toContain("Jack's");
  });
  it('Bookings tab uses TabHeader and not the shop name', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/app/(tabs)/bookings.tsx'), 'utf8');
    expect(src).toContain('<TabHeader title="Bookings">');
    expect(src).not.toMatch(/accessibilityRole="header">\{shop\.name\}/);
  });
});
