import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { ChevronLeftIcon } from '@/components/Icons';
import { discardUnpublishedDraft } from '@/lib/flow';
import { resetTo } from '@/lib/nav';
import { loadPendingPublish, type SiteRecord } from '@/lib/siteStore';

/** Height of the bar the pill sits in, above the preview (the in-page header is never covered). */
export const EDITOR_BACK_HEIGHT = 48;

/**
 * Whether the editor offers Back to the start screen: only a site that was never published, is not tied to an
 * account (an account's copy would come back at launch), has nothing paid and no paid publish pending.
 */
export function canGoBackToStart(site: SiteRecord | null, pendingPublish: boolean, signedIn: boolean): boolean {
  if (!site || pendingPublish || signedIn) return false;
  return !site.deployedUrl && !site.slug && !site.transactionId && !site.ownerUserId;
}

/** Discards the unpublished draft and opens the start screen. Re-checks for a pending paid publish first. */
export async function startOver(): Promise<void> {
  if (await loadPendingPublish().catch(() => ({}))) return;
  await discardUnpublishedDraft();
  resetTo('/start');
}

/** A native top-left "‹ Back" on its own bar above the preview; asks before discarding the generated site. */
export function EditorBackBar({ visible }: { visible: boolean }) {
  if (!visible) return null;
  const ask = () =>
    Alert.alert('Start over?', 'This discards the site you just generated.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Start over', style: 'destructive', onPress: () => void startOver() },
    ]);
  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={{ top: 8, bottom: 8, left: 12, right: 24 }}
        onPress={ask}
        style={styles.pill}
      >
        <ChevronLeftIcon size={20} color="#FFFFFF" />
        <Text style={styles.text} maxFontSizeMultiplier={1.3}>Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: EDITOR_BACK_HEIGHT, justifyContent: 'center', paddingHorizontal: 12, backgroundColor: colors.bg },
  pill: {
    minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingLeft: 8, paddingRight: 16, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.65)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  text: { fontFamily: fonts.bodySemi, fontSize: 16, color: '#FFFFFF' },
});
