import { useEffect, useRef, useState } from 'react';
import {
  ImageBackground, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { BRAND_SWATCHES, DEFAULT_SWATCH } from '@/web/lib/brandSwatches';
import { colors, fonts, swatchLabel } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { ScissorsIcon } from '@/components/Icons';
import { manualSite } from '@/lib/importer';
import { startDraft } from '@/lib/flow';

const BG = 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1920&q=80';

// The classic form's name-only layout (GeneratorForm.tsx `nameOnly` branch):
// full-bleed barber photo, logo top-left, Sign In top-right, centred
// name + colours form. Generates from the shop name alone.
export default function Manual() {
  const insets = useSafeAreaInsets();
  const [shopName, setShopName] = useState('');
  const [colorTheme, setColorTheme] = useState(DEFAULT_SWATCH);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<TextInput>(null);
  // The keyboard's Go key bypasses the disabled button, so guard here too.
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const submit = async () => {
    if (busyRef.current) return;
    if (!shopName.trim()) { input.current?.focus(); return; }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await manualSite(shopName, colorTheme);
      if (!mounted.current) return;
      await startDraft(result);
      if (!mounted.current) return;
      router.replace('/generating');
    } catch (e: any) {
      if (!mounted.current) return;
      setError(e?.message || 'An unexpected error occurred. Please try again.');
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <ImageBackground source={{ uri: BG }} resizeMode="cover" style={styles.root}>
      <Vignette />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom }]}
        >
          <View style={[styles.top, { paddingTop: insets.top + 16 }]}>
            <View style={styles.logo}>
              <ScissorsIcon size={24} color={colors.accent} />
              <Text style={styles.logoText}>
                AI<Text style={{ color: colors.accent }}>Barber</Text>
              </Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => router.push('/sign-in')} style={styles.signIn}>
              <Text style={styles.signInText}>Sign In</Text>
            </Pressable>
          </View>

          <View style={styles.center}>
            <Text style={styles.h1}>
              Generate Custom Barbershop Website{'\n'}
              <Text style={{ color: colors.accent }}>in Seconds</Text>
            </Text>

            <View style={styles.form}>
              <Field
                ref={input}
                tone="dark"
                label="Barbershop Name"
                placeholder="The Gentlemen's Lounge"
                value={shopName}
                onChangeText={setShopName}
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
              />

              <View style={styles.colours}>
                <Text style={styles.coloursLabel}>
                  Choose Your Colors <Text style={styles.coloursHint}>(pick a theme)</Text>
                </Text>
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
              </View>

              <Button variant="solid" title="Generate My Barbershop Website" loading={busy} onPress={() => void submit()} />
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.back()} style={styles.back}>
                <Text style={styles.backText}>← Back</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

// radial-gradient(60% 75% at 50% 50%, rgba(5,7,10,.55) 0%, .85 65%, .95 100%)
function Vignette() {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id="v" cx="50%" cy="50%" rx="60%" ry="75%" fx="50%" fy="50%">
          <Stop offset="0" stopColor="#05070a" stopOpacity={0.55} />
          <Stop offset="0.65" stopColor="#05070a" stopOpacity={0.85} />
          <Stop offset="1" stopColor="#05070a" stopOpacity={0.95} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#v)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24 },
  logo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoText: { fontFamily: fonts.headingBlack, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: '#fff' },
  signIn: {
    borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 16, paddingVertical: 6,
  },
  signInText: { fontFamily: fonts.headingBlack, fontSize: 14, letterSpacing: 2, textTransform: 'uppercase', color: '#fff' },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 20, paddingTop: 32, paddingBottom: 48 },
  // text-2xl font-montserrat font-black uppercase tracking-[1px] leading-[1.15]
  h1: {
    fontFamily: fonts.headingBlack, fontSize: 24, lineHeight: 28, letterSpacing: 1, textTransform: 'uppercase',
    color: '#fff', textAlign: 'center', marginBottom: 12,
  },
  form: { alignSelf: 'center', width: '100%', maxWidth: 448, gap: 20 },
  colours: { gap: 6 },
  coloursLabel: {
    fontFamily: fonts.headingBlack, fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: '#fff',
    textAlign: 'center',
  },
  coloursHint: { fontFamily: fonts.label, color: 'rgba(255,255,255,0.4)', textTransform: 'none', letterSpacing: 0 },
  swatches: { flexDirection: 'row', justifyContent: 'center', gap: 6, alignSelf: 'center', width: 320, maxWidth: '100%' },
  // 0 0 0 2px #0e0c08, 0 0 0 4px #e8c074 → dark gap then a gold ring
  ring: { flex: 1, aspectRatio: 1, maxWidth: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  ringOn: { borderWidth: 2, borderColor: '#e8c074' },
  swatch: { width: 32, height: 32, borderRadius: 16 },
  swatchEdge: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' },
  error: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: '#fecaca', textAlign: 'center' },
  back: { alignSelf: 'center' },
  backText: { fontFamily: fonts.headingBlack, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: '#fff' },
});
