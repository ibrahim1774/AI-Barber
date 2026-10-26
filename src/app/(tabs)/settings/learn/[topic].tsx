import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { BackButton } from '@/components/BackButton';
import { ChevronRightIcon } from '@/components/Icons';
import { LearnVideo } from '@/components/LearnVideo';
import { Page } from '@/components/Page';
import { track } from '@/lib/analytics';
import { LEARN_TOPICS, topicFor } from '@/lib/learnContent';

/** One Learn topic: its video, the title and a few lines. An unknown topic goes back to the list. */
export default function LearnTopic() {
  const { topic } = useLocalSearchParams<{ topic?: string }>();
  const current = topicFor(Array.isArray(topic) ? topic[0] : topic);
  useEffect(() => {
    if (current) track('learn_topic_viewed', { topic: current.slug });
  }, [current]);
  if (!current) return <Redirect href={'/settings/learn' as never} />;
  const next = LEARN_TOPICS[LEARN_TOPICS.findIndex((t) => t.slug === current.slug) + 1];
  return (
    <Page title={current.title}>
      <BackButton onPress={() => router.back()} />
      <View style={styles.video}>
        <LearnVideo slug={current.slug} />
      </View>
      <Text style={styles.title} accessibilityRole="header">{current.title}</Text>
      <Text style={styles.detail}>{current.detail}</Text>
      {next && (
        <Pressable
          onPress={() => router.replace(`/settings/learn/${next.slug}` as never)}
          accessibilityRole="button"
          accessibilityLabel={`Next: ${next.title}`}
          hitSlop={8}
          style={styles.next}
        >
          <Text style={styles.nextText}>Next: {next.title}</Text>
          <ChevronRightIcon size={16} color={colors.accent} />
        </Pressable>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  video: { marginTop: 8 },
  title: { fontFamily: fonts.heading, fontSize: 22, color: colors.heading, marginTop: 8 },
  detail: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.muted, marginTop: 8 },
  next: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, marginTop: 16 },
  nextText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.accent },
});
