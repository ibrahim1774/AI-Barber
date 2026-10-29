import { useDoneBar } from '@/components/KeyboardDoneBar';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Sheet, SheetAction } from '@/components/EditSheet';
import type { BookingChoice, BookTargetStatus } from '@/lib/bookingChoice';
import type { CtaKind } from '@/lib/ctaButtons';
import {
  BOOKING_LINK_ERRORS, PHONE_ERROR, normalizeAddress, normalizeBookingLink, normalizePhone,
} from '@/lib/linkRules';

export const SCHEDULER_NOTE = 'Changes every Book button on your site.';
export const DOUBLE_BOOKING = "Turn off your old booking app so clients don't double-book.";
export const PUBLISH_BUTTON_NOTE = 'Publish your site to update your Book button.';
export const TEAM_LINK_NOTE = 'Barbers with their own link in Team keep it on their card.';
export const PLAN_NOT_LINKED = 'Your booking page opens once your Prime Barber plan is active.';
export const CALL_NOTE = 'Changes your phone number everywhere on your site.';
export const DIRECTIONS_NOTE = 'Directions open Google Maps for this address.';
export const SHOP_NOTE = 'Manage your store in Store.';
export const CHOOSER_HEADING = 'What should your button do?';
export const CALL_OPTION = { label: 'Call my number', detail: 'Calls your phone number when a client taps it.' };
export const LINK_OPTION = { label: 'Booking link', detail: 'Opens your own booking page, like Booksy or Square, where clients book.' };
export const BUILTIN_OPTION = { label: 'Built-in booking', detail: 'Opens your Prime Barber booking page with deposits and reminders.' };
export const NEEDS_BOOKINGS_PLAN = 'Needs the Bookings plan';
export const PLAN_INFO = {
  title: 'Built-in booking needs the Bookings plan',
  body: 'Built-in booking lets clients book, pick a barber and pay a deposit on your own page. It is part of the Bookings plan, a monthly subscription. You will see the price before you pay.',
  primary: 'See the Bookings plan',
  close: 'Close',
};
export const REMOVE_NOTE = 'Removes your Book button. Your phone number button stays while your site has a number.';

/** What the sheet hands back on Save. `book.url`: a validated https link, null = clear it, undefined = leave it. */
export interface ButtonChange {
  text: string;
  /** Call choice only: the label of the Call button (the design's own Call labels). */
  callText?: string;
  book?: { choice: BookingChoice; url?: string | null };
  phone?: string;
  address?: string;
}

export interface ButtonSheetProps {
  visible: boolean;
  kind: CtaKind;
  /** The sheet's title, e.g. "Book button text" (the label registry's title). */
  title: string;
  text: string;
  /** The design's own wording, shown when the field is empty. */
  defaultText: string;
  maxLength?: number;
  book?: { choice: BookingChoice; own: string | null; status: BookTargetStatus; teamHasOwnLink: boolean; /** The Bookings plan is active (default true). */ hasPlan?: boolean };
  /** Book kind: the Call button's current label and the design's own wording for it. */
  callText?: string;
  callDefault?: string;
  phone?: string;
  address?: string;
  onSave(change: ButtonChange): void;
  onClose(): void;
  onDismiss?(): void;
  onOpenSetup?(): void;
  onSeePlans?(): void;
}

/** The warning under the Book options when the built-in scheduler is chosen but /book would not go out. */
export function schedulerWarning(status: BookTargetStatus): { text: string; action: 'setup' | 'plans' | null } | null {
  const tail = status.fallback === 'link' ? 'use your booking link' : 'are hidden';
  switch (status.status) {
    case 'bookings-off':
      return { text: `Bookings are off, so your Book buttons ${tail} for now. Turn on Take bookings in Setup.`, action: 'setup' };
    case 'no-plan':
      return { text: "Your plan doesn't include the built-in scheduler.", action: 'plans' };
    case 'not-published':
      return { text: 'Your Book button goes live once Bookings is set up.', action: null };
    case 'not-linked':
      return { text: PLAN_NOT_LINKED, action: null };
    default:
      return null;
  }
}

/** One sheet for every call-to-action button: its text, and the link that button reads. */
export function ButtonSheet(p: ButtonSheetProps) {
  const doneBar = useDoneBar('phone-pad');
  const [text, setText] = useState(p.text);
  const [callText, setCallText] = useState(p.callText ?? '');
  const [choice, setChoice] = useState<BookingChoice>(p.book?.choice ?? 'aibarber');
  const [link, setLink] = useState(p.book?.own ?? '');
  const [phone, setPhone] = useState(p.phone ?? '');
  const [address, setAddress] = useState(p.address ?? '');
  const [error, setError] = useState<string | null>(null);
  // Built-in booking tapped without the Bookings plan: the explanation shows, the choice is not applied.
  const [planInfo, setPlanInfo] = useState(false);
  useEffect(() => {
    if (!p.visible) return;
    setText(p.text);
    setCallText(p.callText ?? '');
    setChoice(p.book?.choice ?? 'aibarber');
    setLink(p.book?.own ?? '');
    setPhone(p.phone ?? '');
    setAddress(p.address ?? '');
    setError(null);
    setPlanInfo(false);
    // Reset only when the sheet opens or shows another button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.visible, p.kind, p.title]);

  const save = () => {
    const change: ButtonChange = { text };
    if (p.kind === 'book' && p.book) {
      const own = p.book.own;
      if (choice === 'call') {
        const r = normalizePhone(phone);
        if (!r.ok) { setError(PHONE_ERROR); return; }
        if (r.phone !== (p.phone ?? '')) change.phone = r.phone;
        change.callText = callText;
        change.book = { choice };
      } else if (choice === 'own') {
        const typed = link.trim();
        // A link already saved stays as it is when only the text changed (an older http link is not forced to change).
        if (own && typed === own.trim()) change.book = { choice };
        else {
          const r = normalizeBookingLink(typed);
          if (!r.ok) { setError(BOOKING_LINK_ERRORS[r.reason]); return; }
          change.book = { choice, url: r.url };
        }
      } else {
        change.book = { choice };
      }
    } else if (p.kind === 'call') {
      const r = normalizePhone(phone);
      if (!r.ok) { setError(PHONE_ERROR); return; }
      if (r.phone !== (p.phone ?? '')) change.phone = r.phone;
    } else if (p.kind === 'directions') {
      const r = normalizeAddress(address);
      if (!r.ok) { setError('Enter the address of your shop.'); return; }
      if (r.address !== (p.address ?? '')) change.address = r.address;
    }
    p.onSave(change);
    p.onClose();
  };

  // Takes the Book button off the site (the choice goes to Call; the barber's own link stays remembered).
  const remove = () => {
    p.onSave({ text: p.text, book: { choice: 'call' } });
    p.onClose();
  };
  const planOk = p.book?.hasPlan !== false;
  const hasButton = !!p.book && p.book.choice !== 'call';
  const warn = p.kind === 'book' && p.book && choice === 'aibarber' ? schedulerWarning(p.book.status) : null;
  const dirty = p.book && choice !== p.book.choice;

  return (
    <Sheet visible={p.visible} title={p.title} onClose={p.onClose} onDismiss={p.onDismiss} right={<SheetAction title="Save" primary onPress={save} />}>
      <ScrollView keyboardShouldPersistTaps="handled" style={st.scroll}>
        {!(p.kind === 'book' && p.book) && (
          <>
            <Text style={st.heading}>Button text</Text>
            <TextInput
              value={text}
              onChangeText={setText}
              maxLength={p.maxLength}
              placeholder={p.defaultText}
              autoFocus
              returnKeyType="done"
              accessibilityLabel="Button text"
              selectionColor={colors.accent}
              placeholderTextColor="rgba(255,255,255,0.3)"
              style={st.input}
            />
            {p.maxLength ? <Text style={st.counter}>{text.length}/{p.maxLength}</Text> : null}
          </>
        )}

        {p.kind === 'book' && p.book && (
          <>
            <Text style={st.heading}>{CHOOSER_HEADING}</Text>
            <Option label={CALL_OPTION.label} detail={CALL_OPTION.detail} selected={choice === 'call'} onPress={() => { setChoice('call'); setError(null); }} />
            {choice === 'call' && (
              <>
                <Text style={st.heading}>Button text</Text>
                <TextInput
                  value={callText}
                  onChangeText={setCallText}
                  maxLength={30}
                  placeholder={p.callDefault || 'Call now'}
                  returnKeyType="done"
                  accessibilityLabel="Button text"
                  selectionColor={colors.accent}
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  style={st.input}
                />
                <Text style={st.heading}>Phone number</Text>
                <TextInput
                  value={phone}
                  onChangeText={(v) => { setPhone(v); setError(null); }}
                  inputAccessoryViewID={doneBar.id} keyboardType="phone-pad"
                  autoCorrect={false}
                  accessibilityLabel="Phone number"
                  selectionColor={colors.accent}
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  style={st.input}
                />
                {doneBar.bar}
                <Text style={st.note}>{CALL_NOTE}</Text>
              </>
            )}
            <Option label={LINK_OPTION.label} detail={LINK_OPTION.detail} selected={choice === 'own'} onPress={() => { setChoice('own'); setError(null); }} />
            {choice === 'own' && (
              <>
                <Text style={st.heading}>Button text</Text>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  maxLength={p.maxLength}
                  placeholder={p.defaultText}
                  returnKeyType="done"
                  accessibilityLabel="Button text"
                  selectionColor={colors.accent}
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  style={st.input}
                />
                {p.maxLength ? <Text style={st.counter}>{text.length}/{p.maxLength}</Text> : null}
                <TextInput
                  value={link}
                  onChangeText={(v) => { setLink(v); setError(null); }}
                  placeholder="https://booksy.com/your-shop"
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Booking link address"
                  selectionColor={colors.accent}
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  style={st.input}
                />
              </>
            )}
            <Option
              label={BUILTIN_OPTION.label}
              detail={planOk ? BUILTIN_OPTION.detail : NEEDS_BOOKINGS_PLAN}
              selected={choice === 'aibarber'}
              onPress={() => { setError(null); if (planOk) { setPlanInfo(false); setChoice('aibarber'); } else setPlanInfo(true); }}
            />
            {!planOk && planInfo && (
              <View accessibilityLiveRegion="polite">
                <Text style={st.heading}>{PLAN_INFO.title}</Text>
                <Text style={st.note}>{PLAN_INFO.body}</Text>
                {p.onSeePlans && <SheetAction title={PLAN_INFO.primary} primary onPress={p.onSeePlans} />}
                <SheetAction title={PLAN_INFO.close} onPress={() => setPlanInfo(false)} />
              </View>
            )}
            {choice === 'aibarber' && (
              <>
                <Text style={st.heading}>Button text</Text>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  maxLength={p.maxLength}
                  placeholder={p.defaultText}
                  returnKeyType="done"
                  accessibilityLabel="Button text"
                  selectionColor={colors.accent}
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  style={st.input}
                />
              </>
            )}
            <Text style={st.note}>{SCHEDULER_NOTE}</Text>
            {warn && (
              <View>
                <Text style={st.warn} accessibilityLiveRegion="polite">{warn.text}</Text>
                {warn.action === 'setup' && p.onOpenSetup && <SheetAction title="Open Setup" onPress={p.onOpenSetup} />}
                {warn.action === 'plans' && p.onSeePlans && <SheetAction title="See plans" onPress={p.onSeePlans} />}
              </View>
            )}
            {choice === 'aibarber' && p.book.own ? <Text style={st.warn}>{DOUBLE_BOOKING}</Text> : null}
            {p.book.teamHasOwnLink ? <Text style={st.note}>{TEAM_LINK_NOTE}</Text> : null}
            {dirty ? <Text style={st.note}>{PUBLISH_BUTTON_NOTE}</Text> : null}
            {hasButton && (
              <>
                <SheetAction title="Remove button" onPress={remove} />
                <Text style={st.note}>{REMOVE_NOTE}</Text>
              </>
            )}
          </>
        )}

        {p.kind === 'call' && (
          <>
            <Text style={st.heading}>Phone number</Text>
            <TextInput
              value={phone}
              onChangeText={(v) => { setPhone(v); setError(null); }}
              inputAccessoryViewID={doneBar.id} keyboardType="phone-pad"
              autoCorrect={false}
              accessibilityLabel="Phone number"
              selectionColor={colors.accent}
              placeholderTextColor="rgba(255,255,255,0.3)"
              style={st.input}
            />
{doneBar.bar}
            <Text style={st.note}>{CALL_NOTE}</Text>
          </>
        )}

        {p.kind === 'directions' && (
          <>
            <Text style={st.heading}>Shop address</Text>
            <TextInput
              value={address}
              onChangeText={(v) => { setAddress(v); setError(null); }}
              accessibilityLabel="Shop address"
              selectionColor={colors.accent}
              placeholderTextColor="rgba(255,255,255,0.3)"
              style={st.input}
            />
            <Text style={st.note}>{DIRECTIONS_NOTE}</Text>
          </>
        )}

        {p.kind === 'shop' && (
          <>
            <Text style={st.heading}>Link</Text>
            <View style={st.readonly} accessibilityLabel="Opens your online store">
              <Text style={st.readonlyText}>Opens your online store</Text>
            </View>
            <Text style={st.note}>{SHOP_NOTE}</Text>
          </>
        )}

        {error ? <Text style={st.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        <SheetAction title="Cancel" onPress={p.onClose} />
      </ScrollView>
    </Sheet>
  );
}

function Option({ label, detail, selected, onPress, disabled }: { label: string; detail: string; selected: boolean; onPress(): void; disabled?: boolean }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected, disabled: !!disabled }} style={[st.option, selected && st.optionOn, disabled && st.optionOff]}>
      <Text style={st.optionLabel}>{label}</Text>
      <Text style={st.optionDetail}>{detail}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  scroll: { flexGrow: 0 },
  heading: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginTop: 4, marginBottom: 8 },
  input: {
    fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: '#fff',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8,
  },
  counter: { alignSelf: 'flex-end', fontFamily: fonts.body, fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 4 },
  note: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: 'rgba(255,255,255,0.6)', marginBottom: 8 },
  warn: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.overlayGold, marginBottom: 8 },
  error: { fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 18, color: '#f87171', marginBottom: 8 },
  option: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: 12, padding: 12, marginBottom: 8 },
  optionOff: { opacity: 0.5 },
  optionOn: { borderColor: colors.accent },
  optionLabel: { fontFamily: fonts.bodySemi, fontSize: 15, color: '#fff' },
  optionDetail: { fontFamily: fonts.body, fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  readonly: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 8, padding: 12, marginBottom: 8 },
  readonlyText: { fontFamily: fonts.body, fontSize: 15, color: 'rgba(255,255,255,0.6)' },
});
