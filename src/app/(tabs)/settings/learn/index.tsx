import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { ChevronRightIcon } from '@/components/Icons';
import { LearnTopicIcon } from '@/components/LearnIcons';
import { Page } from '@/components/Page';
import { track } from '@/lib/analytics';
import { LEARN_SECTIONS, topicsIn } from '@/lib/learnContent';

/** Settings, Learn how it works: a list of topics. Each row opens that topic's own screen with its video; no video plays here. */
export default function LearnList() {
  useEffect(() => {
    track('learn_viewed');
  }, []);
  return (
    <Page title="Learn how it works" onBack={() => router.back()}>
      {LEARN_SECTIONS.map((sec) => (
        <View key={sec.id} style={styles.section}>
          <Text style={styles.header} accessibilityRole="header">{sec.title}</Text>
          {topicsIn(sec.id).map((t) => (
            <Pressable
              key={t.slug}
              onPress={() => router.push(`/settings/learn/${t.slug}` as never)}
              accessibilityRole="button"
              accessibilityLabel={t.title}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.icon}>
                <LearnTopicIcon slug={t.slug} size={22} color={colors.accent} />
              </View>
              <View style={styles.text}>
                <Text style={styles.title}>{t.title}</Text>
                <Text style={styles.value}>{t.value}</Text>
              </View>
              <ChevronRightIcon size={16} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      ))}
    </Page>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 14 },
  header: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: colors.muted,
    marginBottom: 8, marginLeft: 4, marginTop: 6,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, padding: 14, marginBottom: 10, borderRadius: 14,
    backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.hair,
  },
  pressed: { backgroundColor: 'rgba(255,255,255,0.04)' },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  text: { flex: 1 },
  title: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.text },
  value: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 2 },
});
