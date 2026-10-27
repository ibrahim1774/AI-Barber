import { useEffect } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { BackButton } from '@/components/BackButton';
import { ChevronRightIcon } from '@/components/Icons';
import { Page } from '@/components/Page';
import { track } from '@/lib/analytics';
import { SUPPORT_URL } from '@/lib/policyLinks';
import { nextInSection, topicFor } from '@/lib/learnContent';
import { useLearnClips } from '@/lib/learnClips';
import { LearnVideo } from '@/components/LearnVideo';

const LINK = /(https?:\/\/[^\s]*[^\s.,)]|[\w.+-]+@[\w-]+\.[\w.]*\w)/;

/** Opens a link the way Settings does: web pages in the in-app browser, email addresses in the mail app. */
const openLink = (part: string) => {
  if (part.startsWith('http')) void WebBrowser.openBrowserAsync(part.endsWith('/support') ? SUPPORT_URL : part).catch(() => {});
  else Linking.openURL(`mailto:${part}`).catch(() => Alert.alert('Support', `Email us at ${part}.`));
};

/** A step's words, with any web address or email address made tappable. */
function StepText({ text }: { text: string }) {
  return (
    <Text style={styles.stepText}>
      {text.split(LINK).map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} style={styles.link} accessibilityRole="link" onPress={() => openLink(part)}>{part}</Text>
        ) : part,
      )}
    </Text>
  );
}

/** One Learn topic: a short intro line and numbered steps. An unknown topic goes back to the list. */
export default function LearnTopic() {
  const { topic } = useLocalSearchParams<{ topic?: string }>();
  const current = topicFor(Array.isArray(topic) ? topic[0] : topic);
  const clips = useLearnClips();
  useEffect(() => {
    if (current) track('learn_topic_viewed', { topic: current.slug });
  }, [current]);
  if (!current) return <Redirect href={'/settings/learn' as never} />;
  const next = nextInSection(current);
  return (
    <Page title={current.title}>
      <BackButton onPress={() => router.back()} />
      <Text style={styles.title} accessibilityRole="header">{current.title}</Text>
      <Text style={styles.detail}>{current.detail}</Text>
      {clips[current.slug] ? <LearnVideo uri={clips[current.slug].url} poster={clips[current.slug].poster} /> : null}
      {current.steps.map((step, i) => (
        <View key={i} style={styles.step}>
          <Text style={styles.num}>{i + 1}</Text>
          <StepText text={step} />
        </View>
      ))}
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
  title: { fontFamily: fonts.heading, fontSize: 20, color: colors.heading, marginTop: 4 },
  detail: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: 4 },
  step: { flexDirection: 'row', gap: 10, marginTop: 10 },
  num: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 20, color: colors.accent, width: 18 },
  stepText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.text },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  next: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, marginTop: 10 },
  nextText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.accent },
});
