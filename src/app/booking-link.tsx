import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { DEFAULT_SWATCH } from '@/web/lib/brandSwatches';
import { colors } from '@/constants/theme';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Em, Text } from '@/components/Text';
import { Card, ErrorNote, StageChips, SwatchRow, WorksWith } from '@/components/Importer';
import { ImportProgress, LINK_STEPS } from '@/components/ImportProgress';
import { useImportRun } from '@/lib/useImportRun';
import { checkBookingLink } from '@/lib/importer';
import { importBooking } from '@/lib/flow';

// Real link shapes for the self-typing placeholder (GbpImportPage TYPE_LINKS).
const TYPE_LINKS = [
  'booksy.com/en-us/12345_fade-factory_barber-shop_houston',
  'thecut.co/your-barber',
  'fresha.com/a/your-shop',
  'squareup.com/appointments/book/your-shop',
  'vagaro.com/yourbarbershop',
  'styleseat.com/m/v/yourname',
];

const WORKS_WITH = ['Booksy', 'theCut', 'Fresha', 'Square', 'Vagaro', 'StyleSeat', 'Goldie'];

// GbpImportPage.tsx 'link' branch → POST /api/import-scrape.
export default function BookingLink() {
  const [url, setUrl] = useState('');
  const [brandColor, setBrandColor] = useState(DEFAULT_SWATCH);
  const [error, setError] = useState<string | null>(null);
  const { busy, progress, slowHint, run } = useImportRun();

  const submit = () => {
    if (busy) return;
    const checked = checkBookingLink(url.trim());
    if (!checked.ok) { setError(checked.message); return; }
    setError(null);
    void run(
      () => importBooking(checked.url, brandColor),
      (msg) => setError(msg || "Couldn't pull from that link — try a different one."),
    );
  };

  return (
    <Screen overlay={busy ? <ImportProgress steps={LINK_STEPS} progress={progress} slowHint={slowHint} /> : null}>
      <StageChips />
      <Text variant="h1" style={styles.h1}>Paste your booking link.</Text>
      <Text variant="h1">
        We build the <Em color={colors.silver}>website</Em>.
      </Text>
      <Text variant="body" style={styles.sub}>
        Photos, services & reviews imported automatically. Live in about a minute — edit anything after.
      </Text>

      <Card>
        <Field
          label="Your booking link"
          value={url}
          onChangeText={setUrl}
          typeExamples={TYPE_LINKS}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <View style={styles.actions}>
          <SwatchRow value={brandColor} onChange={setBrandColor} />
          <Button size="sm" title="Build my website" arrow loading={busy} onPress={submit} />
        </View>
        <ErrorNote message={error} />
      </Card>

      <WorksWith names={WORKS_WITH} />

      <Button
        variant="link"
        title="No booking link? Type your shop name instead →"
        onPress={() => router.replace('/find-listing')}
        style={styles.escape}
      />
      <Button variant="link" title="← Back" onPress={() => router.back()} style={styles.back} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  h1: { marginTop: 24 },
  sub: { marginTop: 24, maxWidth: 512 },
  actions: { marginTop: 32, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', rowGap: 24, columnGap: 32 },
  escape: { marginTop: 20 },
  back: { marginTop: 16 },
});
