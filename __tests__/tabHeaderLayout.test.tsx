import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from './store/render';

let mockWidth = 390;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 800, scale: 2, fontScale: 1 }),
}));
jest.mock('@/constants/theme', () => ({
  colors: new Proxy({}, { get: () => '#000' }),
  fonts: new Proxy({}, { get: () => 'System' }),
}));

import { TabHeader } from '@/components/TabHeader';
import { HeaderButton } from '@/components/HeaderButtons';

// Widest label at 13 pt semibold is about 62 pt ("Customers"); adjustsFontSizeToFit may shrink to 75%.
const WIDEST_LABEL = 62 * 0.75;
const PILL_PADDING = 2 * 6;

describe.each([320, 375, 390, 430])('Bookings header at %i pt', (width) => {
  it('lays three pills on their own row that fit with no overflow and stay tappable', async () => {
    mockWidth = width;
    const t = await render(
      <TabHeader title="Bookings">
        <HeaderButton title="Customers" onPress={() => {}} />
        <HeaderButton title="Share" icon="share" tone="solid" onPress={() => {}} />
        <HeaderButton title="Settings" icon="gear" onPress={() => {}} />
      </TabHeader>,
    );
    const row = t.root.findByProps({ testID: 'tab-header-pills' });
    const rowStyle = StyleSheet.flatten(row.props.style);
    expect(rowStyle.flexDirection).toBe('row');
    const pills = t.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.type === 'string' || (n.props?.accessibilityRole === 'button' && n.props?.hitSlop));
    const unique = Array.from(new Set(pills.map((p: any) => p.props.hitSlop ? p : null).filter(Boolean)));
    expect(unique.length).toBeGreaterThanOrEqual(3);
    // equal share of the row: (width - 32 padding - 2 gaps of 8) / 3
    const share = (width - 32 - 16) / 3;
    expect(share).toBeGreaterThanOrEqual(WIDEST_LABEL + PILL_PADDING);
    for (const p of unique as any[]) {
      const flat = StyleSheet.flatten(typeof p.props.style === 'function' ? p.props.style({ pressed: false }) : p.props.style);
      expect(flat.flex).toBe(1);
      expect(flat.minWidth).toBe(0);
      expect(flat.height).toBeGreaterThanOrEqual(32);
      expect(p.props.hitSlop.top + p.props.hitSlop.bottom + flat.height).toBeGreaterThanOrEqual(44);
    }
    // no icons in the filled row
    expect(t.root.findAll((n: any) => n.props?.size === 16)).toHaveLength(0);
  });
});
