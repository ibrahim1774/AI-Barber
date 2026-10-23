import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Em, Text } from '@/components/Text';
import { StageChips } from '@/components/Importer';
import { refreshReminders } from '@/lib/reminders';
import { useRestoreFlow } from '@/lib/restoreFlow';

// GbpImportPage.tsx 'gate' branch: one question, two paths, plus the escape
// hatch to the classic (name-only) form.
export default function Start() {
  // A reinstalled subscriber starts here: their site comes back via Restore, not a new build.
  const { restore, busy } = useRestoreFlow();
  // The permission itself is asked at launch (LaunchPrompts in _layout); this
  // only keeps the schedule current.
  const go = (href: Href) => {
    void refreshReminders();
    router.push(href);
  };
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
        <Button title="Yes, I have a booking link" arrow onPress={() => go('/booking-link')} />
        <Button variant="ghost" title="No, I don’t have one" onPress={() => go('/find-listing')} />
      </View>
      <Button
        variant="link"
        title="Rather type it in yourself? Use the classic form →"
        onPress={() => go('/manual')}
        style={styles.manual}
      />
      <Button
        variant="link"
        title="Already subscribed? Restore purchases"
        onPress={() => void restore()}
        loading={busy}
        style={styles.restore}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  h1: { marginTop: 24 },
  sub: { marginTop: 24, maxWidth: 512 },
  buttons: { marginTop: 44, alignSelf: 'stretch', gap: 16 },
  manual: { marginTop: 40 },
  restore: { marginTop: 20 },
});
