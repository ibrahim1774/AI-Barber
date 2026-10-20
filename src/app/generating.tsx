import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { ScissorsIcon, WarningIcon } from '@/components/Icons';

// Copied from LoadingScreen.tsx.
const MESSAGES = [
  'Sharpening the blades...',
  'Designing luxury layouts...',
  'Generating premium AI imagery (2/2)...',
  'Crafting custom descriptions...',
  'Clipping the final code...',
  'Styling your unique identity...',
  'Preparing the barber chair...',
  'Applying high-end filters...',
  'Ensuring pixel-perfect results...',
];

// The draft is already saved when this screen opens. On the web the loading
// screen only shows while the site generates; here it holds long enough for
// the first two staged messages, then snaps to 100% and opens the editor.
const HOLD_MS = 3000;

export default function Generating() {
  const [progress, setProgress] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setProgress((p) => Math.min(100, p + 1)), 100);
    const messageTimer = setInterval(() => setMessageIndex((i) => (i + 1) % MESSAGES.length), 2500);
    let go: ReturnType<typeof setTimeout>;
    const done = setTimeout(() => {
      clearInterval(timer);
      setProgress(100);
      // Reset the stack so back / swipe from the editor never returns to the importer.
      go = setTimeout(() => {
        if (router.canDismiss()) router.dismissAll();
        router.replace('/editor');
      }, 150);
    }, HOLD_MS);
    return () => {
      clearInterval(timer);
      clearInterval(messageTimer);
      clearTimeout(done);
      clearTimeout(go);
    };
  }, []);

  return (
    <View style={styles.root}>
      <Bounce>
        <ScissorsIcon size={64} color={colors.accent} />
      </Bounce>

      <Text style={styles.title}>
        AI<Text style={{ color: colors.accent }}>BARBER</Text>
      </Text>

      <Pulse>
        <Text style={styles.message}>{MESSAGES[messageIndex]}</Text>
      </Pulse>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${progress}%` }]} />
      </View>

      <Text style={styles.percent}>GENERATING LUXURY ASSETS: {progress}%</Text>

      <View style={styles.warning}>
        <WarningIcon size={16} color={colors.accent} />
        <Text style={styles.warningText}>Do not close or navigate away — your website build may fail.</Text>
      </View>
    </View>
  );
}

// Tailwind animate-bounce: up 25% of the height and back, once a second.
function Bounce({ children }: { children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 500, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [0, -16] });
  return <Animated.View style={{ marginBottom: 32, transform: [{ translateY }] }}>{children}</Animated.View>;
}

// Tailwind animate-pulse: opacity 1 → .5 → 1 every 2 s.
function Pulse({ children }: { children: React.ReactNode }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.5, duration: 1000, useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={{ opacity: v }}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  title: {
    fontFamily: fonts.headingBlack, fontSize: 24, letterSpacing: 4, textTransform: 'uppercase', color: '#fff',
    textAlign: 'center', marginBottom: 16,
  },
  message: {
    fontFamily: fonts.body, fontSize: 12, lineHeight: 24, letterSpacing: 3, textTransform: 'uppercase',
    color: colors.accent, textAlign: 'center', marginBottom: 32,
  },
  track: {
    width: '100%', maxWidth: 448, height: 6, borderRadius: 3, backgroundColor: colors.track,
    overflow: 'hidden', marginBottom: 16,
  },
  fill: { height: '100%', borderRadius: 3, backgroundColor: colors.accent },
  percent: { fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1.2, color: 'rgba(255,255,255,0.4)' },
  warning: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24, paddingHorizontal: 8 },
  warningText: { flexShrink: 1, fontFamily: fonts.body, fontSize: 12, letterSpacing: 0.3, color: colors.grey },
});
