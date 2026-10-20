import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';

// HomeLaunchGuide.tsx: shown once after generation, before the barber edits
// or publishes. Tap outside or the button to close. The web quotes its own
// button (“Publish your website.”); here it names the bar's “Publish” button,
// as the web comment asks ("Name the button the visitor actually sees").

function useLoop(make: (v: Animated.Value) => Animated.CompositeAnimation) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(make(v));
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return v;
}

const ease = Easing.inOut(Easing.ease);

export function LaunchGuide({ onClose }: { onClose(): void }) {
  // hlgBadgePulse: scale 1 → 1.06 → 1 over 1.5 s
  const badge = useLoop((v) =>
    Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 750, easing: ease, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 750, easing: ease, useNativeDriver: true }),
    ]),
  );
  // hlgPopLoop: scale 1 → 1.05 (45%–55%) → 1 over 1.8 s
  const pop = useLoop((v) =>
    Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 810, easing: ease, useNativeDriver: true }),
      Animated.delay(180),
      Animated.timing(v, { toValue: 0, duration: 810, easing: ease, useNativeDriver: true }),
    ]),
  );

  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      {/* Tap outside closes; not an accessibility element, so VoiceOver reaches the card. */}
      <Pressable style={styles.backdrop} onPress={onClose} accessible={false} />
      <View style={styles.card}>
        <Animated.Text
          style={[styles.badge, { transform: [{ scale: badge.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }] }]}
        >
          Read this before you exit
        </Animated.Text>

        <Animated.Text
          style={[styles.body, { transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) }] }]}
        >
          You can <Text style={{ color: colors.danger }}>edit your website anytime</Text> by creating an account after
          clicking <Text style={{ color: colors.overlayGold }}>“Publish.”</Text>
        </Animated.Text>

        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.button, pressed && { transform: [{ scale: 0.98 }] }]}
        >
          <Text style={styles.buttonText}>Got it — start editing</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,7,10,0.72)' },
  card: {
    width: '100%', maxWidth: 440, borderRadius: 16, padding: 24,
    backgroundColor: 'rgba(14,12,8,0.96)', borderWidth: 1, borderColor: colors.overlayGoldDark,
    shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 35, shadowOffset: { width: 0, height: 30 },
  },
  badge: {
    alignSelf: 'flex-start', marginBottom: 16, overflow: 'hidden',
    fontFamily: fonts.bodyBold, fontSize: 9, letterSpacing: 2.5, textTransform: 'uppercase',
    color: colors.overlayGold, backgroundColor: 'rgba(232,192,116,0.13)',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
  },
  body: {
    marginVertical: 8, textAlign: 'center',
    fontFamily: fonts.bodyExtra, fontSize: 18, lineHeight: 25, color: '#fff',
  },
  button: {
    marginTop: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 6, backgroundColor: colors.overlayGold,
  },
  buttonText: { fontFamily: fonts.bodyExtra, fontSize: 11, letterSpacing: 2.4, textTransform: 'uppercase', color: '#0a0a0a' },
});
