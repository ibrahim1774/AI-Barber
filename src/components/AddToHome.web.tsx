import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';

// Chrome/Android fire beforeinstallprompt (one-tap install). iOS Safari can't install from code, so we show the steps.
let deferred: any = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: any) => { e.preventDefault(); deferred = e; });
}

const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);
const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

/** "Add to Home Screen" card for the web app: one tap where the browser allows it, the Share-sheet steps on iPhone. */
export function AddToHome() {
  const [ready, setReady] = useState(false);
  const [steps, setSteps] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setReady(!!deferred), 500);
    return () => clearInterval(t);
  }, []);
  if (isStandalone() || done) return null;
  const ios = isIos();
  if (!ios && !ready) return null;
  const install = async () => {
    if (ios) { setSteps((s) => !s); return; }
    deferred.prompt();
    const r = await deferred.userChoice.catch(() => null);
    deferred = null;
    if (r?.outcome === 'accepted') setDone(true);
  };
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Add Prime Barber to your home screen</Text>
      <Text style={styles.body}>Open your site and bookings in one tap, like an app.</Text>
      <Button variant="ghost" title={ios ? (steps ? 'Hide steps' : 'How to add') : 'Add to Home Screen'} onPress={install} style={styles.btn} />
      {ios && steps && (
        <Text style={styles.steps}>1. Tap the Share button in Safari (the square with an arrow).{'\n'}2. Scroll down and tap “Add to Home Screen”.{'\n'}3. Tap Add.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 16, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.hair, backgroundColor: colors.ghostBg },
  title: { color: colors.heading, fontFamily: fonts.bodySemi, fontSize: 15 },
  body: { color: colors.body, fontFamily: fonts.body, fontSize: 13, marginTop: 4 },
  btn: { marginTop: 12 },
  steps: { color: colors.text, fontFamily: fonts.body, fontSize: 13, lineHeight: 20, marginTop: 12 },
});
