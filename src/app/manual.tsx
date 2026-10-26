import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { BRAND_SWATCHES, DEFAULT_SWATCH } from '@/web/lib/brandSwatches';
import { swatchLabel } from '@/constants/theme';
import { Screen } from '@/components/Screen';
import { FlowError, FlowHelper, FlowInput, FlowTitle, PillButton } from '@/components/FlowParts';
import { manualSite } from '@/lib/importer';
import { MANUAL_FIELD_ORDER, manualInputs, validateManual, type ManualForm } from '@/lib/manualForm';
import { scratchPicks } from '@/lib/scratchDefaults';
import { servicesFromPicks } from '@/lib/serviceChecklist';
import { discardUnpublishedDraft, startDraft } from '@/lib/flow';
import { useRevealAboveKeyboard } from '@/lib/keyboard';
import { backToStart, confirmCancel } from '@/lib/nav';

// Start from scratch: the same dark flow shell as the booking-link screen (back chevron top-left). The typed values go
// only into the site record; none of them is tracked, logged or put in a route.
export default function Manual() {
  const [form, setForm] = useState<ManualForm>({ shopName: '', place: '', phone: '' });
  const [colorTheme, setColorTheme] = useState(DEFAULT_SWATCH);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refs = {
    shopName: useRef<TextInput>(null), place: useRef<TextInput>(null), phone: useRef<TextInput>(null),
  };
  // The keyboard's Go key bypasses the disabled button, so guard here too.
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // With the phone pad up the Build button used to sit under the keyboard: scroll it into view while a field has focus.
  const { scrollRef, cardRef: ctaRef, onScroll } = useRevealAboveKeyboard([]);

  const set = (k: keyof ManualForm) => (v: string) => { setError(null); setForm((f) => ({ ...f, [k]: v })); };

  const submit = async () => {
    if (busyRef.current) return;
    const errors = validateManual(form);
    const bad = MANUAL_FIELD_ORDER.find((k) => errors[k]);
    if (bad) {
      setError(errors[bad]!);
      refs[bad].current?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await manualSite(manualInputs(form, colorTheme, servicesFromPicks(scratchPicks())));
      if (!mounted.current) return;
      await startDraft(result);
      // Cancelled while saving: don't leave a half-built draft behind.
      if (!mounted.current) { void discardUnpublishedDraft(); return; }
      router.replace('/generating');
    } catch (e: any) {
      if (!mounted.current) return;
      setError(e?.message || 'An unexpected error occurred. Please try again.');
      busyRef.current = false;
      setBusy(false);
    }
  };

  // While the site is being built: confirm; cancelling makes the pending build a no-op (it saves and navigates nowhere).
  const back = () => {
    if (!busyRef.current) { backToStart(); return; }
    confirmCancel(() => { mounted.current = false; backToStart(); });
  };

  return (
    <Screen onBack={back} scrollRef={scrollRef} onScroll={onScroll}>
      <FlowTitle first="Start from" second="scratch" />
      <View style={styles.form}>
        <FlowInput
          ref={refs.shopName}
          label="Barbershop name"
          value={form.shopName}
          onChangeText={set('shopName')}
          maxLength={80}
          placeholder="Jack's Barbershop"
          autoCapitalize="words"
          returnKeyType="next"
          onSubmitEditing={() => refs.place.current?.focus()}
        />
        <View>
          <FlowInput
            ref={refs.place}
            label="Local service area"
            value={form.place}
            onChangeText={set('place')}
            placeholder="Austin, TX"
            autoCapitalize="words"
            maxLength={60}
            returnKeyType="next"
            onSubmitEditing={() => refs.phone.current?.focus()}
          />
          <FlowHelper>{"Shown on your pages as 'Barbershop in <area>'."}</FlowHelper>
        </View>
        <FlowInput
          ref={refs.phone}
          label="Phone number"
          value={form.phone}
          onChangeText={set('phone')}
          maxLength={30}
          placeholder="(512) 555-0142"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoCorrect={false}
          // The phone pad has no Return key (FlowInput adds a Done-only bar above it), so onSubmitEditing never fires from it; kept for a hardware keyboard.
          returnKeyType="done"
          onSubmitEditing={() => Keyboard.dismiss()}
        />

        <View style={styles.swatches}>
          {BRAND_SWATCHES.map((c) => {
            const on = colorTheme.toLowerCase() === c.toLowerCase();
            return (
              <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityLabel={swatchLabel(c)}
                accessibilityState={{ selected: on }}
                onPress={() => setColorTheme(c)}
                style={[styles.ring, on && styles.ringOn]}
              >
                <View style={[styles.swatch, { backgroundColor: c }, !on && styles.swatchEdge]} />
              </Pressable>
            );
          })}
        </View>

        <FlowError message={error} />
      </View>
      <View ref={ctaRef} collapsable={false} style={styles.ctaWrap}>
        <PillButton primary arrow title="Build my website" loading={busy} onPress={() => void submit()} style={styles.cta} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { alignSelf: 'stretch', marginTop: 28, gap: 18 },
  swatches: { flexDirection: 'row', justifyContent: 'center', gap: 6, alignSelf: 'center', width: 320, maxWidth: '100%' },
  // a dark gap then a gold ring around the picked colour
  ring: { flex: 1, aspectRatio: 1, maxWidth: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  ringOn: { borderWidth: 2, borderColor: '#e8c074' },
  swatch: { width: 32, height: 32, borderRadius: 16 },
  swatchEdge: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' },
  ctaWrap: { alignSelf: 'stretch' },
  cta: { marginTop: 24 },
});
