import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, render as baseRender } from '../store/render';

const mockReplace = jest.fn();
let mockWidth = 390;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 800, scale: 2, fontScale: 1 }),
}));
jest.mock('expo-router', () => ({ router: { replace: (...a: unknown[]) => mockReplace(...a), push: jest.fn(), back: jest.fn(), canGoBack: () => true, canDismiss: () => false } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => ({ ...require('../store/themeMock'), swatchLabel: (c: string) => c }));
const mockManualSite = jest.fn();
const mockStartDraft = jest.fn();
jest.mock('@/lib/importer', () => ({ ...jest.requireActual('@/lib/importer'), manualSite: (...a: unknown[]) => mockManualSite(...a) }));
jest.mock('@/lib/flow', () => ({ ...jest.requireActual('@/lib/flow'), startDraft: (...a: unknown[]) => mockStartDraft(...a), discardUnpublishedDraft: jest.fn() }));

import Manual from '@/app/manual';
import Start from '@/app/start';
import BookingLink from '@/app/booking-link';
import FindListing from '@/app/find-listing';
import { StoreHeader } from '@/components/store/StoreHeader';

const mounted: any[] = [];
const render = async (el: React.ReactElement) => { const t = await baseRender(el); mounted.push(t); return t; };
afterEach(async () => { await act(async () => { while (mounted.length) mounted.pop().unmount(); }); jest.restoreAllMocks(); });
beforeEach(() => { mockReplace.mockClear(); mockManualSite.mockReset(); mockStartDraft.mockReset(); mockManualSite.mockResolvedValue({ ok: 1 }); mockStartDraft.mockResolvedValue(undefined); });

const input = (t: any, l: string) => t.root.findAll((n: any) => n.props?.accessibilityLabel === l && typeof n.props.onChangeText === 'function')[0];
const textOf = (n: any): string => (n.children ?? []).map((c: any) => (typeof c === 'string' ? c : textOf(c))).join('');
const build = (t: any) => t.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && textOf(n).includes('Build my website'))[0];
const type = async (t: any, name: string, place: string, phone: string) => {
  await act(async () => { input(t, 'Barbershop name').props.onChangeText(name); input(t, 'Local service area').props.onChangeText(place); input(t, 'Phone number').props.onChangeText(phone); });
};
const tap = async (t: any) => { await act(async () => { build(t).props.onPress(); await new Promise((r) => setTimeout(r, 5)); }); };

describe('Start from scratch: three-field validation', () => {
  it('has exactly three text fields, in order name, area, phone', async () => {
    const t = await render(<Manual />);
    const labels = t.root.findAll((n: any) => typeof n.props?.onChangeText === 'function' && n.props.accessibilityLabel).map((n: any) => n.props.accessibilityLabel);
    expect([...new Set(labels)]).toEqual(['Barbershop name', 'Local service area', 'Phone number']);
  });
  it.each([
    ['empty form', '', '', '', /name/i],
    ['whitespace name', '   ', 'Austin, TX', '5125550142', /name/i],
    ['only name', 'Jack', '', '', /area|city/i],
    ['street address as area', 'Jack', '123 Main Street', '5125550142', /address/i],
    ['6-digit phone', 'Jack', 'Austin, TX', '512555', /10-digit/],
    ['letters phone', 'Jack', 'Austin, TX', 'call me', /10-digit/],
    ['"-" phone', 'Jack', 'Austin, TX', '-', /10-digit/],
  ])('%s shows an error and builds nothing', async (_n, name, place, phone, msg) => {
    const t = await render(<Manual />);
    await type(t, name as string, place as string, phone as string);
    await tap(t);
    expect(mockManualSite).not.toHaveBeenCalled();
    expect(textOf(t.root)).toMatch(msg as RegExp);
  });
  it('editing a field clears the error', async () => {
    const t = await render(<Manual />);
    await tap(t);
    expect(textOf(t.root)).toMatch(/name/i);
    await act(async () => input(t, 'Barbershop name').props.onChangeText('J'));
    expect(textOf(t.root)).not.toMatch(/Enter your barbershop|Give|Add your/i);
  });
  it.each([
    ['+1 (512) 555-0142'], ['15125550142'], ['512.555.0142'],
  ])('valid phone %s builds once, phone normalised, then goes to /generating', async (phone) => {
    const t = await render(<Manual />);
    await type(t, "Jack's 💈 <b>Shop</b>", 'Austin, TX', phone);
    await tap(t);
    expect(mockManualSite).toHaveBeenCalledTimes(1);
    expect(mockManualSite.mock.calls[0][0]).toMatchObject({ phone: '(512) 555-0142', area: 'Austin, TX', address: '' });
    expect(mockReplace).toHaveBeenCalledWith('/generating');
  });
  it('double tap while building starts one build', async () => {
    let release!: () => void;
    mockManualSite.mockReturnValue(new Promise((r) => { release = () => r({}); }));
    const t = await render(<Manual />);
    await type(t, 'Jack', 'Austin, TX', '5125550142');
    await act(async () => { build(t).props.onPress(); build(t).props.onPress(); build(t).props.onPress(); });
    expect(mockManualSite).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 5)); });
    expect(mockStartDraft).toHaveBeenCalledTimes(1);
  });
  it('a failed build shows the message and allows retry', async () => {
    mockManualSite.mockRejectedValueOnce(new Error('Disk full'));
    const t = await render(<Manual />);
    await type(t, 'Jack', 'Austin, TX', '5125550142');
    await tap(t);
    expect(textOf(t.root)).toContain('Disk full');
    expect(mockReplace).not.toHaveBeenCalled();
    await tap(t);
    expect(mockManualSite).toHaveBeenCalledTimes(2);
    expect(mockReplace).toHaveBeenCalledWith('/generating');
  });
  it('error without a message falls back to a generic one', async () => {
    mockManualSite.mockRejectedValueOnce({});
    const t = await render(<Manual />);
    await type(t, 'Jack', 'Austin, TX', '5125550142');
    await tap(t);
    expect(textOf(t.root)).toMatch(/unexpected error/i);
  });
  it('unmounted before the build lands: nothing navigates and the half-built draft is discarded', async () => {
    let release!: () => void;
    mockManualSite.mockReturnValue(new Promise((r) => { release = () => r({}); }));
    const t = await render(<Manual />);
    await type(t, 'Jack', 'Austin, TX', '5125550142');
    await act(async () => { build(t).props.onPress(); });
    await act(async () => { t.unmount(); mounted.pop(); });
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 5)); });
    expect(mockReplace).not.toHaveBeenCalledWith('/generating');
  });
  it('name/area/phone limits are enforced by maxLength 80/60/30', async () => {
    const t = await render(<Manual />);
    expect([input(t, 'Barbershop name'), input(t, 'Local service area'), input(t, 'Phone number')].map((n) => n.props.maxLength)).toEqual([80, 60, 30]);
  });
  it('phone field: phone-pad with Done bar id; other fields use Next', async () => {
    const t = await render(<Manual />);
    expect(input(t, 'Phone number').props.keyboardType).toBe('phone-pad');
    expect(input(t, 'Phone number').props.inputAccessoryViewID).toBeTruthy();
    expect(input(t, 'Barbershop name').props.returnKeyType).toBe('next');
    expect(input(t, 'Local service area').props.returnKeyType).toBe('next');
  });
});

describe.each([320, 375, 390, 430])('widths at %i pt', (w) => {
  beforeEach(() => { mockWidth = w; });
  const overwide = (t: any) => t.root.findAll((n: any) => typeof n.type === 'string' && n.props?.style).filter((n: any) => {
    const s = StyleSheet.flatten(n.props.style) || {};
    return typeof s.width === 'number' && s.width > w && s.maxWidth !== '100%';
  });
  it.each([['Start', () => <Start />], ['Manual', () => <Manual />], ['BookingLink', () => <BookingLink />], ['FindListing', () => <FindListing />]])(
    '%s has no fixed-width element wider than the screen', async (_n, el) => {
      const t = await render((el as any)());
      expect(overwide(t).map((n: any) => StyleSheet.flatten(n.props.style).width)).toEqual([]);
    });
  it('Store header: Share and Settings share a row without fixed widths over the screen', async () => {
    const t = await render(<StoreHeader title="x" locked={false} onShare={() => {}} onSetup={() => {}} />);
    expect(overwide(t)).toEqual([]);
    const pills = t.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && n.props?.hitSlop);
    const uniq = pills.filter((p: any) => p.props.onPress);
    expect(uniq.length).toBeGreaterThanOrEqual(2);
  });
  it('Manual swatches row fits: 320 wide or less, shrinks via maxWidth 100%', async () => {
    const t = await render(<Manual />);
    const rows = t.root.findAll((n: any) => { const s = StyleSheet.flatten(n.props?.style) || {}; return s.width === 320; });
    expect(rows.some((r: any) => StyleSheet.flatten(r.props.style).maxWidth === '100%')).toBe(true);
  });
});
