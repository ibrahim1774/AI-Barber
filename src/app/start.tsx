import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { StartOption } from '@/components/StartOption';
import { Text } from '@/components/Text';
import { colors } from '@/constants/theme';
import { refreshReminders } from '@/lib/reminders';
import { useRestoreFlow } from '@/lib/restoreFlow';

// The start screen: one headline, three ways in. Each option leads to the path
// that used to sit behind the old "booking link?" question: booking link,
// Google listing ("Is this you?") or the typed-in form.
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
      <Text variant="h1" style={styles.h1}>
        {'Barbers, run it all\nfrom '}
        <Text variant="h1" style={styles.gold}>one place.</Text>
      </Text>
      <Text variant="body" style={styles.sub}>
        A custom site, your own booking system & sell your own products.
      </Text>
      <View style={styles.options}>
        <StartOption
          primary
          arrow
          title="Use my booking link"
          subtitle="Imports services, prices and photos"
          onPress={() => go('/booking-link')}
        />
        <StartOption
          title="Find me on Google"
          subtitle="Imports photos, hours and phone"
          onPress={() => go('/find-listing')}
        />
        <StartOption
          title="Start from scratch"
          subtitle="Answer a few quick questions"
          onPress={() => go('/manual')}
        />
      </View>
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

// The old headline was 30/37; the approved one is 0.88 of that.
const styles = StyleSheet.create({
  h1: { marginTop: 84, fontSize: 26.4, lineHeight: 32.5 },
  gold: { color: colors.accent },
  sub: { marginTop: 24, maxWidth: 512, color: '#FFFFFF' },
  options: { marginTop: 32, alignSelf: 'stretch', gap: 14 },
  restore: { marginTop: 28 },
});
