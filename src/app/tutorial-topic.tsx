import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Page } from '@/components/Page';
import { TutorialVideo } from '@/components/tutorial/TutorialVideo';
import { requestTour, TOUR_ROUTE, TOURS } from '@/components/tutorial/tours';
import { track } from '@/lib/analytics';
import { goBackOrHome } from '@/lib/nav';
import { topicBySlug } from '@/lib/tutorialTopics';
import { TUTORIAL_VIDEOS } from '@/lib/tutorialVideos';

/** One topic: the video, the numbered steps, and a button that starts the in-app arrows. */
export default function TutorialTopicScreen() {
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  const topic = topicBySlug(slug);
  if (!topic) {
    return (
      <Page title="Learn how it works" onBack={goBackOrHome}>
        <Text style={styles.step}>That topic isn’t available.</Text>
      </Page>
    );
  }

  const showArrows = () => {
    track('tutorial_arrows_started', { tour: topic.tour, topic: topic.slug });
    requestTour(topic.tour);
    router.navigate(TOUR_ROUTE[TOURS[topic.tour].screen] as never);
  };

  return (
    <Page title={topic.title} onBack={goBackOrHome}>
      <TutorialVideo source={TUTORIAL_VIDEOS[topic.slug]} />
      <View style={styles.steps}>
        {topic.steps.map((s, i) => (
          <View key={i} style={styles.stepRow}>
            <Text style={styles.num}>{i + 1}</Text>
            <Text style={styles.step}>{s}</Text>
          </View>
        ))}
      </View>
      <Button variant="ghost" title="Show me with arrows" onPress={showArrows} />
    </Page>
  );
}

const styles = StyleSheet.create({
  steps: { marginVertical: 20, gap: 14 },
  stepRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  num: {
    width: 24, height: 24, borderRadius: 12, textAlign: 'center', lineHeight: 24, overflow: 'hidden',
    fontFamily: fonts.bodyBold, fontSize: 13, color: colors.accentInk, backgroundColor: colors.accent,
  },
  step: { flex: 1, fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.text },
});
