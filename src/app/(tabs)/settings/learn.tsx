import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { LearnVideo } from '@/components/LearnVideo';
import { Page } from '@/components/Page';
import { track } from '@/lib/analytics';
import { LEARN_FEATURES, type LearnVideoSlug } from '@/lib/learnContent';

/** Settings, Learn how it works: what the app does for you. Videos appear here once they are bundled. */
export default function LearnScreen() {
  useEffect(() => {
    track('learn_viewed');
  }, []);
  return (
    <Page title="Learn how it works" onBack={() => router.back()}>
      <LearnVideo slug="intro" />
      <Text style={styles.lead}>Everything you need to run your barbershop online, in one app.</Text>
      {LEARN_FEATURES.map((f) => (
        <View key={f.slug} style={styles.card} accessibilityLabel={f.title}>
          <Text style={styles.title}>{f.title}</Text>
          <Text style={styles.value}>{f.value}</Text>
          <View style={styles.video}>
            <LearnVideo slug={f.slug as LearnVideoSlug} />
          </View>
        </View>
      ))}
    </Page>
  );
}

const styles = StyleSheet.create({
  lead: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.muted, marginVertical: 16 },
  card: { backgroundColor: colors.sheet, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.hair },
  title: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.text },
  video: { marginTop: 4 },
  value: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: 4 },
});
