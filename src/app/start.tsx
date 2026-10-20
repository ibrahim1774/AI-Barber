import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Em, Text } from '@/components/Text';
import { StageChips } from '@/components/Importer';

// GbpImportPage.tsx 'gate' branch: one question, two paths, plus the escape
// hatch to the classic (name-only) form.
export default function Start() {
  return (
    <Screen>
      <StageChips />
      <Text variant="h1" style={styles.h1}>
        Do you have a <Em>booking link</Em>?
      </Text>
      <Text variant="body" style={styles.sub}>
        Booksy, theCut, Fresha, Square, Vagaro — or none at all. Your barbershop website builds itself either way.
      </Text>
      <View style={styles.buttons}>
        <Button title="Yes, I have a booking link" arrow onPress={() => router.push('/booking-link')} />
        <Button variant="ghost" title="No, I don’t have one" onPress={() => router.push('/find-listing')} />
      </View>
      <Text variant="caps" style={styles.note}>
        Photos, services & reviews imported automatically
      </Text>
      <Button
        variant="link"
        title="Rather type it in yourself? Use the classic form →"
        onPress={() => router.push('/manual')}
        style={styles.manual}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  h1: { marginTop: 24 },
  sub: { marginTop: 24, maxWidth: 512 },
  buttons: { marginTop: 44, alignSelf: 'stretch', gap: 16 },
  note: { marginTop: 32 },
  manual: { marginTop: 32 },
});
