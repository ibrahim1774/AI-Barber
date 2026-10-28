import { useDoneBar } from '@/components/KeyboardDoneBar';
import { useEffect, useRef, useState } from 'react';
import { FormLabel } from '@/components/FormLabel';
import {
  ActivityIndicator, Animated, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { ArrowRight } from '@/components/Icons';

// HomeBookingPrompts.tsx, shown on top of the editor after a name-only site
// generates. Step 1: booking link → [Generate] scrapes + rebuilds and finishes
// (finishes without step 2); [Don't have] → step 2. A failed scrape falls to step 2 with a
// note. Step 2: service area + phone → [Finish generating].
// Not ported: the per-keystroke live preview (each data change reloads the
// WebView here, so the site updates once on Finish instead).

export interface HomePromptsProps {
  /** Scrape + rebuild from the booking link; true on success. */
  onSubmitBookingLink(link: string): Promise<boolean>;
  /** Re-generate the site from the entered service area + phone. */
  onFinish(area: string, phone: string): void;
  /** Parent unmounts the overlay. */
  onComplete(): void;
  initialArea?: string;
  initialPhone?: string;
}

type Step = 'booking' | 'areaphone' | 'done';

const PULL_ESTIMATE_SECONDS = 20;

export function HomePrompts({ onSubmitBookingLink, onFinish, onComplete, initialArea = '', initialPhone = '' }: HomePromptsProps) {
  const doneBar = useDoneBar('phone-pad');
  const [step, setStep] = useState<Step>('booking');
  const [bookingUrl, setBookingUrl] = useState('');
  const [area, setArea] = useState(initialArea);
  const [phone, setPhone] = useState(initialPhone);
  const areaRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const [scraping, setScraping] = useState(false);
  const [scrapeNote, setScrapeNote] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(PULL_ESTIMATE_SECONDS);
  const closing = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setCountdown(PULL_ESTIMATE_SECONDS);
    if (!scraping) return;
    const id = setInterval(() => setCountdown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [scraping]);

  // After the final step, slide out then call onComplete.
  useEffect(() => {
    if (step !== 'done') return;
    const t = setTimeout(() => Animated.timing(closing, { toValue: 1, duration: 300, useNativeDriver: true }).start(), 250);
    const t2 = setTimeout(() => onComplete(), 600);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [step, onComplete, closing]);

  const handleGenerateFromLink = async () => {
    const link = bookingUrl.trim();
    if (!link || scraping) return;
    setScraping(true);
    setScrapeNote(null);
    let ok = false;
    try {
      ok = await onSubmitBookingLink(link);
    } catch {
      ok = false;
    }
    setScraping(false);
    if (ok) {
      setStep('done');
    } else {
      setScrapeNote("We couldn't read that link. Enter your area and phone instead.");
      setStep('areaphone');
    }
  };

  const handleAreaPhoneSubmit = () => {
    const a = area.trim();
    const p = phone.trim();
    if (!a || !p) return;
    onFinish(a, p);
    setStep('done');
  };

  const cardMotion = {
    opacity: closing.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [
      { translateY: closing.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) },
      { scale: closing.interpolate({ inputRange: [0, 1], outputRange: [1, 0.98] }) },
    ],
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.overlay} accessibilityLiveRegion="polite" accessibilityViewIsModal>
      <Animated.View style={[styles.card, cardMotion]}>
        <View style={styles.badgeRow}>
          <Text style={styles.badge}>{step === 'booking' ? 'Step 1' : step === 'areaphone' ? 'Last step' : 'Done'}</Text>
        </View>

        {step === 'booking' && (
          <View>
            <Text style={styles.title} accessibilityRole="header">Add your booking link</Text>
            <Text style={styles.sub}>
              {"Paste your Booksy, Fresha, or Squareup link and we'll build from your real services, photos & reviews. No link? Tap Don't have."}
            </Text>
            <TextInput
              value={bookingUrl}
              onChangeText={setBookingUrl}
              placeholder="booksy.com/your-shop"
              placeholderTextColor="rgba(255,255,255,0.35)"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoFocus
              editable={!scraping}
              returnKeyType="go"
              onSubmitEditing={handleGenerateFromLink}
              accessibilityLabel="Booking link"
              selectionColor={colors.overlayGold}
              style={[styles.input, scraping && { opacity: 0.5 }]}
            />
            <View style={styles.btnRow}>
              <Pressable
                accessibilityRole="button"
                disabled={scraping}
                onPress={() => { setScrapeNote(null); setStep('areaphone'); }}
                style={[styles.ghost, scraping && { opacity: 0.5 }]}
              >
                <Text style={styles.ghostText}>Don't have</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!bookingUrl.trim() || scraping}
                onPress={handleGenerateFromLink}
                style={[styles.gold, (!bookingUrl.trim() || scraping) && { opacity: 0.5 }]}
              >
                {scraping ? (
                  <>
                    <ActivityIndicator size="small" color="#0a0a0a" />
                    <Text style={styles.goldText}>{countdown > 0 ? `Pulling… ${countdown}s` : 'Almost there…'}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.goldText}>Generate</Text>
                    <ArrowRight size={13} color="#0a0a0a" />
                  </>
                )}
              </Pressable>
            </View>
          </View>
        )}

        {step === 'areaphone' && (
          <View>
            <Text style={styles.title} accessibilityRole="header">A couple final details</Text>
            <Text style={styles.sub}>
              {scrapeNote || "We'll add these throughout your site so locals can find and call you."}
            </Text>
            <FormLabel input={areaRef} style={styles.label}>Service area</FormLabel>
            <TextInput
              ref={areaRef}
              value={area}
              onChangeText={setArea}
              placeholder="Dallas, TX"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoFocus
              returnKeyType="next"
              accessibilityLabel="Service area"
              selectionColor={colors.overlayGold}
              style={styles.input}
            />
            <FormLabel input={phoneRef} style={styles.label}>Phone number</FormLabel>
            <TextInput
              ref={phoneRef}
              value={phone}
              onChangeText={setPhone}
              placeholder="(555) 123-4567"
              placeholderTextColor="rgba(255,255,255,0.35)"
              inputAccessoryViewID={doneBar.id} keyboardType="phone-pad"
              textContentType="telephoneNumber"
              accessibilityLabel="Phone number"
              selectionColor={colors.overlayGold}
              style={styles.input}
            />
{doneBar.bar}
            <Pressable
              accessibilityRole="button"
              disabled={!area.trim() || !phone.trim()}
              onPress={handleAreaPhoneSubmit}
              style={[styles.gold, styles.full, (!area.trim() || !phone.trim()) && { opacity: 0.5 }]}
            >
              <Text style={styles.goldText}>Finish generating</Text>
              <ArrowRight size={13} color="#0a0a0a" />
            </Pressable>
          </View>
        )}
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // The web overlay is non-modal (pointer-events-none around the card); here
  // it blocks the editor underneath so nothing is edited while the prompts
  // can still regenerate the site.
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  card: {
    width: '100%', maxWidth: 440, borderRadius: 16, padding: 24,
    backgroundColor: colors.overlayCard, borderWidth: 1, borderColor: colors.overlayGoldDark,
    shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 35, shadowOffset: { width: 0, height: 30 },
  },
  badgeRow: { flexDirection: 'row', marginBottom: 12 },
  badge: {
    fontFamily: fonts.bodyBold, fontSize: 9, letterSpacing: 2.5, textTransform: 'uppercase',
    color: colors.overlayGold, backgroundColor: 'rgba(232,192,116,0.13)',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden',
  },
  title: { fontFamily: fonts.heading, fontSize: 18, lineHeight: 22, letterSpacing: -0.27, color: '#fff', marginBottom: 4 },
  sub: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: 'rgba(255,255,255,0.55)', marginBottom: 16 },
  label: {
    fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.55)', marginBottom: 6,
  },
  input: {
    fontFamily: fonts.body, fontSize: 14, color: '#fff',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 12, marginBottom: 12,
  },
  btnRow: { flexDirection: 'row', gap: 8 },
  ghost: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: 6,
  },
  ghostText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' },
  gold: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 6, backgroundColor: colors.overlayGold,
  },
  full: { flex: 0, width: '100%' },
  goldText: { fontFamily: fonts.bodyExtra, fontSize: 11, letterSpacing: 2.4, textTransform: 'uppercase', color: '#0a0a0a' },
});
