import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { ChevronRightIcon } from '@/components/Icons';
import { Page } from '@/components/Page';
import { goBackOrHome } from '@/lib/nav';
import { TUTORIAL_TOPICS } from '@/lib/tutorialTopics';

/** Learn how it works: the five topics. Each opens a video with the steps written below it. */
export default function Tutorial() {
  return (
    <Page title="Learn how it works" onBack={goBackOrHome}>
      <View style={styles.group}>
        {TUTORIAL_TOPICS.map((t) => (
          <Pressable
            key={t.slug}
            onPress={() => router.push({ pathname: '/tutorial-topic', params: { slug: t.slug } } as never)}
            accessibilityRole="button"
            accessibilityLabel={t.title}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.text}>
              <Text style={styles.label}>{t.title}</Text>
              <Text style={styles.detail}>{t.blurb}</Text>
            </View>
            <ChevronRightIcon size={16} color={colors.faint} />
          </Pressable>
        ))}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  group: { backgroundColor: colors.sheet, borderRadius: 14, borderWidth: 1, borderColor: colors.hair, overflow: 'hidden' },
  row: {
    minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hair,
  },
  pressed: { backgroundColor: 'rgba(255,255,255,0.04)' },
  text: { flex: 1 },
  label: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
  detail: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 2 },
});
