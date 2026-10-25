import React from 'react';
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
import { ButtonSheet, schedulerWarning, type ButtonSheetProps } from '@/components/ButtonSheet';

const { act, create } = require('react-test-renderer');

const base: ButtonSheetProps = {
  visible: true, kind: 'book', title: 'Book button text', text: 'Book now', defaultText: 'Book', maxLength: 24,
  book: { choice: 'own', own: 'https://booksy.com/old', status: { status: 'live', fallback: 'link' }, teamHasOwnLink: false },
  onSave: jest.fn(), onClose: jest.fn(),
};

function mount(over: Partial<ButtonSheetProps> = {}) {
  const props = { ...base, onSave: jest.fn(), onClose: jest.fn(), onOpenSetup: jest.fn(), onSeePlans: jest.fn(), ...over };
  let tree: any;
  act(() => { tree = create(<ButtonSheet {...props} />); });
  const byLabel = (l: string) => tree.root.findAll((n: any) => n.props?.accessibilityLabel === l && (typeof n.props?.onChangeText === 'function' || typeof n.props?.onPress === 'function'))[0];
  const has = (l: string) => tree.root.findAll((n: any) => n.props?.accessibilityLabel === l).length > 0;
  const texts = () => tree.root.findAll((n: any) => n.type === 'Text').map((n: any) => [].concat(n.props.children).join(''));
  const press = (title: string) => {
    const b = tree.root.find((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props?.onPress === 'function' && n.findAll((c: any) => c.type === 'Text' && [].concat(c.props.children).join('') === title).length > 0);
    act(() => { b.props.onPress(); });
  };
  return { props, tree, byLabel, has, texts, press };
}

describe('ButtonSheet', () => {
  test('Book mode shows the text, both choices and the site-wide note', () => {
    const m = mount();
    expect(m.byLabel('Button text').props.value).toBe('Book now');
    expect(m.byLabel('Booking link').props.accessibilityState.selected).toBe(true);
    expect(m.byLabel('Built-in scheduler').props.accessibilityState.selected).toBe(false);
    expect(m.texts()).toContain('Changes every Book button on your site.');
  });

  test('an http link is refused with the https message and nothing is saved', () => {
    const m = mount();
    const field = m.byLabel('Booking link address');
    act(() => { field.props.onChangeText('http://x.com'); });
    m.press('Save');
    expect(m.texts()).toContain('Use the https:// link.');
    expect(m.props.onSave).not.toHaveBeenCalled();
    expect(m.props.onClose).not.toHaveBeenCalled();
  });

  test('javascript: and data: links are refused', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x']) {
      const m = mount();
      const field = m.byLabel('Booking link address');
      act(() => { field.props.onChangeText(bad); });
      m.press('Save');
      expect(m.props.onSave).not.toHaveBeenCalled();
    }
  });

  test('a good link is saved as https with the text', () => {
    const m = mount();
    const field = m.byLabel('Booking link address');
    act(() => { field.props.onChangeText('booksy.com/x'); });
    m.press('Save');
    expect(m.props.onSave).toHaveBeenCalledWith({ text: 'Book now', book: { choice: 'own', url: 'https://booksy.com/x' } });
    expect(m.props.onClose).toHaveBeenCalled();
  });

  test('an unchanged saved link is not re-validated (text-only edit)', () => {
    const m = mount({ book: { ...base.book!, own: 'http://old.example.com/x' } });
    m.press('Save');
    expect(m.props.onSave).toHaveBeenCalledWith({ text: 'Book now', book: { choice: 'own' } });
  });

  test('choosing the scheduler saves the choice for every Book button', () => {
    const m = mount();
    act(() => { m.byLabel('Built-in scheduler').props.onPress(); });
    m.press('Save');
    expect(m.props.onSave).toHaveBeenCalledWith({ text: 'Book now', book: { choice: 'aibarber' } });
  });

  test('scheduler chosen with bookings off warns and offers Open Setup', () => {
    const m = mount({ book: { ...base.book!, status: { status: 'bookings-off', fallback: 'link' } } });
    act(() => { m.byLabel('Built-in scheduler').props.onPress(); });
    expect(m.texts().some((t: string) => t.startsWith('Bookings are off, so your Book buttons use your booking link'))).toBe(true);
    m.press('Open Setup');
    expect(m.props.onOpenSetup).toHaveBeenCalled();
  });

  test('no warning while the scheduler is not chosen or is live', () => {
    const off = mount({ book: { ...base.book!, status: { status: 'bookings-off', fallback: 'link' } } });
    expect(off.texts().some((t: string) => t.startsWith('Bookings are off'))).toBe(false);
    const live = mount({ book: { ...base.book!, choice: 'aibarber' } });
    expect(live.texts().some((t: string) => t.startsWith('Bookings are off'))).toBe(false);
  });

  test('schedulerWarning copy per cause', () => {
    expect(schedulerWarning({ status: 'bookings-off', fallback: 'none' })?.text).toContain('are hidden for now');
    expect(schedulerWarning({ status: 'no-plan', fallback: 'link' })).toEqual({ text: "Your plan doesn't include the built-in scheduler.", action: 'plans' });
    expect(schedulerWarning({ status: 'not-linked', fallback: 'link' })?.action).toBeNull();
    expect(schedulerWarning({ status: 'live', fallback: 'link' })).toBeNull();
    expect(schedulerWarning({ status: 'unknown', fallback: 'link' })).toBeNull();
  });

  test('Call mode validates the phone and has no scheduler option', () => {
    const m = mount({ kind: 'call', title: 'Call button text', text: 'Call', defaultText: 'Call', book: undefined, phone: '(512) 555-0142' });
    expect(m.has('Built-in scheduler')).toBe(false);
    const field = m.byLabel('Phone number');
    act(() => { field.props.onChangeText('tel:5551'); });
    m.press('Save');
    expect(m.texts()).toContain('Enter a phone number with 7 to 15 digits.');
    expect(m.props.onSave).not.toHaveBeenCalled();
    act(() => { m.byLabel('Phone number').props.onChangeText('+1 (512) 555-0199'); });
    m.press('Save');
    expect(m.props.onSave).toHaveBeenCalledWith({ text: 'Call', phone: '+1 (512) 555-0199' });
  });

  test('Directions mode edits the address', () => {
    const m = mount({ kind: 'directions', title: 'Directions button text', text: 'Get directions', defaultText: 'Get directions', book: undefined, address: '1 Main St' });
    expect(m.has('Built-in scheduler')).toBe(false);
    act(() => { m.byLabel('Shop address').props.onChangeText('2 Oak Ave, Austin, TX'); });
    m.press('Save');
    expect(m.props.onSave).toHaveBeenCalledWith({ text: 'Get directions', address: '2 Oak Ave, Austin, TX' });
  });

  test('Shop mode is read-only', () => {
    const m = mount({ kind: 'shop', title: 'Shop button text', text: 'Shop online', defaultText: 'Shop online', book: undefined });
    expect(m.has('Opens your online store')).toBe(true);
    expect(m.has('Booking link')).toBe(false);
    m.press('Save');
    expect(m.props.onSave).toHaveBeenCalledWith({ text: 'Shop online' });
  });

  test('inSite mode is text only', () => {
    const m = mount({ kind: 'inSite', title: 'View services button', text: 'View Services', defaultText: 'View Services', book: undefined });
    expect(m.has('Booking link')).toBe(false);
    expect(m.has('Phone number')).toBe(false);
    m.press('Save');
    expect(m.props.onSave).toHaveBeenCalledWith({ text: 'View Services' });
  });
});
