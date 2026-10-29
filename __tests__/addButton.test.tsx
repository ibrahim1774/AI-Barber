// Button kinds (call / booking link / built-in booking), "+ Add a button" in the preview, and removing the button.
import React from 'react';
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
import { ButtonSheet, NEEDS_BOOKINGS_PLAN, PLAN_INFO, CALL_OPTION, LINK_OPTION, type ButtonSheetProps } from '@/components/ButtonSheet';
import { bookingPrefs, linksToSend, resolveLinks, syncOwnLink, withChoice, type LinkContext } from '@/lib/bookingChoice';
import { applyButtonChange } from '@/lib/buttonChange';
import { buildPreviewHtml, needsAddButton, withAddButton } from '@/lib/editable';
import { chooserLabelKey, ctaKindOf, routeTap } from '@/lib/ctaButtons';
import { bookingsPlanRoute } from '@/lib/publishRequest';
import { parsePreviewMessage } from '@/lib/previewBridge';
import { generateContent } from '@/web/services/geminiService';
import type { SiteRecord } from '@/lib/siteStore';
import type { TemplateId, WebsiteData } from '@/web/types';

const { act, create } = require('react-test-renderer');
const OWN = 'https://booksy.com/fade-lab';
const live: LinkContext = { ents: { known: true, hosting: true, bookings: true, store: false }, shop: { slug: 's', purchaseLinked: true, bookingsEnabled: true }, storeEnabled: false };

async function site(template: TemplateId, extra: Partial<WebsiteData> = {}): Promise<WebsiteData> {
  const d = await generateContent({ shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '5125550142', services: [{ title: 'Haircut' }], template } as any);
  return { ...d, template, ...extra } as WebsiteData;
}
const rec = (data: WebsiteData, inputs: Record<string, unknown> = {}): SiteRecord => ({ draftId: 'd', inputs: inputs as any, data, updatedAt: 1, slug: null, deployedUrl: null, transactionId: null });

describe('the Call choice', () => {
  test('withChoice call removes the Book link, remembers the own link, and syncOwnLink keeps the choice', async () => {
    const r0 = rec(await site('luxe', { bookingUrl: OWN }), { ownBookingUrl: OWN, bookingChoice: 'own' });
    const r1 = withChoice(r0, 'call');
    expect(r1.data.bookingUrl).toBeUndefined();
    expect(r1.inputs.ownBookingUrl).toBe(OWN);
    const synced = syncOwnLink(r0, r1);
    expect(synced.inputs.bookingChoice).toBe('call');
    expect(synced.inputs.ownBookingCleared).toBeUndefined();
    expect(bookingPrefs(synced)).toEqual({ own: OWN, choice: 'call' });
    // switching back is one step
    expect(withChoice(synced, 'own').data.bookingUrl).toBe(OWN);
  });

  test('from the built-in scheduler too, and a live scheduler does not bring /book back', async () => {
    const r0 = withChoice(rec(await site('prime'), {}), 'aibarber');
    expect(r0.data.bookingUrl).toBe('/book');
    const r1 = syncOwnLink(r0, withChoice(r0, 'call'));
    expect(r1.inputs.bookingChoice).toBe('call');
    expect(resolveLinks(r1.data, r1.inputs, live).bookingUrl).toBeUndefined();
    expect(linksToSend(r1.data, r1.inputs, live).bookingUrl).toBeUndefined();
    expect(linksToSend(r1.data, r1.inputs, null).bookingUrl).toBeUndefined();
  });
});

describe('applyButtonChange for the Call choice', () => {
  test.each([['luxe', ['callNow']], ['prime', ['primeNavCall', 'primeCallButton']], ['euphoria', ['euNavCall']]] as [TemplateId, string[]][])(
    '%s: the text goes to the design\'s Call labels, the phone is saved, the Book link is off', async (template, keys) => {
      const r0 = rec(await site(template, { bookingUrl: OWN }), { ownBookingUrl: OWN, bookingChoice: 'own' });
      const main = { luxe: 'bookButton', prime: 'primeBookButton', euphoria: 'euBookButton' }[template];
      const r1 = applyButtonChange(r0, main, { text: 'Book Now', callText: 'Ring us', phone: '(512) 555-0199', book: { choice: 'call' } });
      for (const k of keys) expect((r1.data.labels as any)[k]).toBe('Ring us');
      expect(r1.data.phone).toBe('(512) 555-0199');
      expect(r1.data.bookingUrl).toBeUndefined();
      expect(r1.inputs.bookingChoice).toBe('call');
    });

  test('a tap on the Call stand-in opens the Book chooser on the design\'s Book label', () => {
    expect(ctaKindOf('labels.primeNavCall')?.kind).toBe('book');
    expect(ctaKindOf('labels.euNavCall')?.kind).toBe('book');
    expect(routeTap('labels.primeCallButton', { template: 'prime' })).toMatchObject({ sheet: 'button', kind: 'book' });
    expect(chooserLabelKey('prime', 'primeCallButton')).toBe('primeBookButton');
    expect(chooserLabelKey('euphoria', 'euNavCall')).toBe('euBookButton');
    expect(chooserLabelKey('luxe', 'callNow')).toBe('callNow');
  });
});

describe('+ Add a button in the preview', () => {
  test('needsAddButton: no Book link, and no Call stand-in', () => {
    expect(needsAddButton({ template: 'luxe', phone: '5125550142' } as any)).toBe(true);
    expect(needsAddButton({ template: 'prime', phone: '5125550142' } as any)).toBe(false);
    expect(needsAddButton({ template: 'euphoria', phone: '' } as any)).toBe(true);
    expect(needsAddButton({ template: 'prime', phone: '', bookingUrl: OWN } as any)).toBe(false);
    expect(needsAddButton({ template: 'luxe', bookingUrl: '/book' } as any)).toBe(false);
  });

  test.each(['luxe', 'prime', 'euphoria'] as TemplateId[])('%s: the control is in the editable preview only, on Home only, after the hero', async (template) => {
    const d = await site(template, { phone: '' });
    delete (d as any).bookingUrl;
    const editable = buildPreviewHtml(d, true);
    expect(editable).toContain('data-ab-add-button');
    expect(editable).toContain('+ Add a button');
    expect(buildPreviewHtml(d, false)).not.toContain('data-ab-add-button');
    expect(withAddButton('<section>hero</section><section>x</section>', d, { key: 'services' } as any)).not.toContain('data-ab-add-button');
    expect(buildPreviewHtml({ ...d, bookingUrl: OWN }, true)).not.toContain('data-ab-add-button');
  });

  test('the bridge accepts the tap', () => {
    expect(parsePreviewMessage(JSON.stringify({ type: 'addButton' }), {} as any, null)).toEqual({ type: 'addButton' });
  });
});

const base: ButtonSheetProps = {
  visible: true, kind: 'book', title: 'Book button text', text: 'Book Now', defaultText: 'Book Now', maxLength: 24, callText: '', callDefault: 'Call now', phone: '(512) 555-0142',
  book: { choice: 'call', own: null, status: { status: 'not-published', fallback: 'none' }, teamHasOwnLink: false, hasPlan: false },
  onSave: jest.fn(), onClose: jest.fn(),
};
function mount(over: Partial<ButtonSheetProps> = {}) {
  const props = { ...base, onSave: jest.fn(), onClose: jest.fn(), onSeePlans: jest.fn(), ...over };
  let tree: any;
  act(() => { tree = create(<ButtonSheet {...props} />); });
  const byLabel = (l: string) => tree.root.findAll((n: any) => n.props?.accessibilityLabel === l && (typeof n.props?.onChangeText === 'function' || typeof n.props?.onPress === 'function' || n.props?.accessibilityRole === 'radio'))[0];
  const texts = () => tree.root.findAll((n: any) => n.type === 'Text').map((n: any) => [].concat(n.props.children).join(''));
  const press = (title: string) => {
    const b = tree.root.find((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props?.onPress === 'function' && n.findAll((c: any) => c.type === 'Text' && [].concat(c.props.children).join('') === title).length > 0);
    act(() => { b.props.onPress(); });
  };
  return { props, byLabel, texts, press };
}

describe('the button chooser', () => {
  test('three options each with one plain sentence; built-in says "Needs the Bookings plan" without the plan but is tappable', () => {
    const m = mount();
    const t = m.texts();
    expect(t).toContain(CALL_OPTION.detail);
    expect(t).toContain(LINK_OPTION.detail);
    expect(t).toContain(NEEDS_BOOKINGS_PLAN);
    expect(m.byLabel('Built-in booking').props.accessibilityState.disabled).toBe(false);
  });

  test('no plan: tapping Built-in booking explains the plan, does not apply the choice, and Save keeps the old one', () => {
    const m = mount({ book: { ...base.book!, choice: 'own', own: OWN, hasPlan: false } });
    expect(m.texts()).not.toContain(PLAN_INFO.title);
    act(() => { m.byLabel('Built-in booking').props.onPress(); });
    const t = m.texts();
    expect(t).toContain(PLAN_INFO.title);
    expect(t).toContain(PLAN_INFO.body);
    expect(PLAN_INFO.title).toBe('Built-in booking needs the Bookings plan');
    expect(PLAN_INFO.primary).toBe('See the Bookings plan');
    expect(m.byLabel('Booking link').props.accessibilityState.selected).toBe(true);
    expect(m.byLabel('Built-in booking').props.accessibilityState.selected).toBe(false);
    m.press('Save');
    expect(m.props.onSave).toHaveBeenCalledWith(expect.objectContaining({ book: { choice: 'own' } }));
  });

  test('the primary action opens the plan flow; Close only dismisses the explanation', () => {
    const m = mount({ book: { ...base.book!, choice: 'own', own: OWN, hasPlan: false } });
    act(() => { m.byLabel('Built-in booking').props.onPress(); });
    m.press(PLAN_INFO.close);
    expect(m.texts()).not.toContain(PLAN_INFO.title);
    expect(m.props.onSeePlans).not.toHaveBeenCalled();
    expect(m.props.onClose).not.toHaveBeenCalled();
    act(() => { m.byLabel('Built-in booking').props.onPress(); });
    m.press(PLAN_INFO.primary);
    expect(m.props.onSeePlans).toHaveBeenCalledTimes(1);
    expect(m.props.onSave).not.toHaveBeenCalled();
  });

  test('where "See the Bookings plan" goes: Publish for a site never published, the bookings paywall otherwise', () => {
    expect(bookingsPlanRoute({ slug: null, deployedUrl: null }, { account: 'none' })).toBe('publish');
    expect(bookingsPlanRoute({ slug: 's', deployedUrl: 'https://x' }, { account: 'mine' })).toBe('paywall');
    expect(bookingsPlanRoute({ slug: null, deployedUrl: null }, { account: 'other' })).toBe('paywall');
  });

  test('the same from every entry point: a booking-link, Google and scratch site (the sheet only sees the plan)', () => {
    for (const choice of ['own', 'aibarber', 'call'] as const) {
      const m = mount({ book: { ...base.book!, choice, own: choice === 'own' ? OWN : null, hasPlan: false } });
      act(() => { m.byLabel('Built-in booking').props.onPress(); });
      expect(m.texts()).toContain(PLAN_INFO.title);
      m.press(PLAN_INFO.primary);
      expect(m.props.onSeePlans).toHaveBeenCalledTimes(1);
    }
  });

  test('with the Bookings plan the built-in option is enabled and saves the choice', () => {
    const m = mount({ book: { ...base.book!, hasPlan: true } });
    expect(m.texts()).not.toContain(NEEDS_BOOKINGS_PLAN);
    act(() => { m.byLabel('Built-in booking').props.onPress(); });
    m.press('Save');
    expect(m.props.onSave).toHaveBeenCalledWith(expect.objectContaining({ book: { choice: 'aibarber' } }));
  });

  test('Call: editable label and number; the label is saved as callText', () => {
    const m = mount();
    act(() => { m.byLabel('Button text').props.onChangeText('Call now'); });
    m.press('Save');
    expect(m.props.onSave).toHaveBeenCalledWith(expect.objectContaining({ callText: 'Call now', book: { choice: 'call' } }));
  });

  test('Call with a bad number is refused', () => {
    const m = mount();
    act(() => { m.byLabel('Phone number').props.onChangeText('abc'); });
    m.press('Save');
    expect(m.props.onSave).not.toHaveBeenCalled();
  });

  test('Booking link: https only, label editable, saved with the validated link', () => {
    const m = mount();
    act(() => { m.byLabel('Booking link').props.onPress(); });
    act(() => { m.byLabel('Booking link address').props.onChangeText('http://x.com'); });
    m.press('Save');
    expect(m.props.onSave).not.toHaveBeenCalled();
    act(() => { m.byLabel('Booking link address').props.onChangeText('booksy.com/fade'); });
    act(() => { m.byLabel('Button text').props.onChangeText('Book Now'); });
    m.press('Save');
    expect(m.props.onSave).toHaveBeenCalledWith({ text: 'Book Now', book: { choice: 'own', url: 'https://booksy.com/fade' } });
  });

  test('Remove button: offered only when a Book button exists, saves the Call choice', () => {
    expect(mount().texts()).not.toContain('Remove button');
    const m = mount({ book: { ...base.book!, choice: 'own', own: OWN, hasPlan: true } });
    m.press('Remove button');
    expect(m.props.onSave).toHaveBeenCalledWith({ text: 'Book Now', book: { choice: 'call' } });
    expect(m.props.onClose).toHaveBeenCalled();
  });
});
