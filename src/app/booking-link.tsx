import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { DEFAULT_SWATCH } from '@/web/lib/brandSwatches';
import { colors } from '@/constants/theme';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PasteIcon } from '@/components/Icons';
import { FlowError, FlowHelper, FlowInput, FlowTitle, PillButton } from '@/components/FlowParts';
import { ImportProgress, LINK_STEPS } from '@/components/ImportProgress';
import { useImportRun } from '@/lib/useImportRun';
import { checkBookingLink } from '@/lib/importer';
import { importBooking } from '@/lib/flow';
import { goBackOrHome } from '@/lib/nav';

// Screen 2 of the start flow: paste the booking link; the import lands on "Here's what we found" (/import-review).
// GbpImportPage.tsx 'link' branch → POST /api/import-scrape.
export default function BookingLink() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { busy, progress, slowHint, run } = useImportRun();

  const submit = () => {
    if (busy) return;
    const checked = checkBookingLink(url.trim());
    if (!checked.ok) { setError(checked.message); return; }
    setError(null);
    void run(
      () => importBooking(checked.url, DEFAULT_SWATCH),
      (msg) => setError(msg || "Couldn't pull from that link — try a different one."),
      '/import-review',
    );
  };

  // The clipboard is read only when the barber taps the icon (iOS shows its own paste notice).
  const paste = async () => {
    try {
      const text = (await require('expo-clipboard').getStringAsync()) as string;
      if (text?.trim()) { setUrl(text.trim()); setError(null); }
    } catch {
      /* no clipboard: the field still takes typed text */
    }
  };

  return (
    <Screen onBack={goBackOrHome} overlay={busy ? <ImportProgress steps={LINK_STEPS} progress={progress} slowHint={slowHint} /> : null}>
      <FlowTitle first="Paste your" second="booking link" />
      <View style={styles.form}>
        <FlowInput
          label="Booking link"
          accessibilityLabel="Your booking link"
          value={url}
          onChangeText={setUrl}
          placeholder="booksy.com/your-shop"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="go"
          onSubmitEditing={submit}
          trailing={
            <Pressable accessibilityRole="button" accessibilityLabel="Paste from clipboard" hitSlop={8} onPress={() => void paste()} style={styles.paste}>
              <PasteIcon size={20} color={colors.muted} />
            </Pressable>
          }
        />
        <FlowHelper>Services, photos and reviews come along.</FlowHelper>
        <FlowError message={error} />
      </View>
      <PillButton primary arrow title="Continue" loading={busy} onPress={submit} style={styles.cta} />
      <Button
        variant="link"
        title="I don't have a link"
        onPress={() => router.replace('/find-listing')}
        style={styles.escape}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { alignSelf: 'stretch', marginTop: 28 },
  paste: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  cta: { marginTop: 24 },
  escape: { marginTop: 24 },
});
