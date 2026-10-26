import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { ChevronRightIcon } from '@/components/Icons';
import { LearnTopicIcon } from '@/components/LearnIcons';
import { Page } from '@/components/Page';
import { track } from '@/lib/analytics';
import { LEARN_SECTIONS, topicsIn, type LearnSectionId } from '@/lib/learnContent';

/** Settings, Learn how it works: four collapsed sections. Tapping a header opens that section (one at a time); each row opens its own screen. */
export default function LearnList() {
  const [open, setOpen] = useState<LearnSectionId | null>(null);
  useEffect(() => {
    track('learn_viewed');
  }, []);
  return (
    <Page title="Learn how it works" onBack={() => router.back()}>
      {LEARN_SECTIONS.map((sec) => {
        const on = open === sec.id;
        const topics = topicsIn(sec.id);
        return (
          <View key={sec.id} style={styles.section}>
            <Pressable
              onPress={() => setOpen(on ? null : sec.id)}
              accessibilityRole="button"
              accessibilityLabel={sec.title}
              accessibilityState={{ expanded: on }}
              style={({ pressed }) => [styles.header, on && styles.headerOn, pressed && styles.pressed]}
            >
              <Text style={styles.headerText}>{sec.title}</Text>
              <View style={on ? styles.chevOpen : undefined}>
                <ChevronRightIcon size={16} color={colors.muted} />
              </View>
            </Pressable>
            {on && topics.map((t) => (
              <Pressable
                key={t.slug}
                onPress={() => router.push(`/settings/learn/${t.slug}` as never)}
                accessibilityRole="button"
                accessibilityLabel={t.title}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <LearnTopicIcon slug={t.slug} size={16} color={colors.accent} />
                <Text style={styles.title} numberOfLines={1}>{t.title}</Text>
                <ChevronRightIcon size={14} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        );
      })}
    </Page>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 8, borderRadius: 12, backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.hair, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 14 },
  headerOn: { borderBottomWidth: 1, borderBottomColor: colors.hair },
  headerText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
  chevOpen: { transform: [{ rotate: '90deg' }] },
  pressed: { backgroundColor: 'rgba(255,255,255,0.04)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 14 },
  title: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.text },
});
