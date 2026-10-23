import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { track } from '@/lib/analytics';
import { PUBLISH_FOR_BOOKING_LINK, PUBLISH_FOR_SHOP_LINK } from '@/lib/customerLinks';
import { requestPublish } from '@/lib/publishRequest';

/** The one publish path (the Edit tab's handlePublish: paywall, then /publishing), as Settings does it. */
export function publishNow(source: string): void {
  track('publish_for_link_tapped', { source });
  requestPublish();
  router.navigate('/edit');
}

/** Shown instead of a customer link until the booking / shop page is live: one line and a Publish button. */
export function PublishForLink({
  kind, source, style, align = 'center',
}: {
  kind: 'booking' | 'shop';
  source: string;
  style?: StyleProp<ViewStyle>;
  align?: 'center' | 'left';
}) {
  return (
    <View style={[styles.wrap, align === 'left' && { alignItems: 'flex-start' }, style]}>
      <Text style={[styles.text, align === 'left' && { textAlign: 'left' }]}>
        {kind === 'booking' ? PUBLISH_FOR_BOOKING_LINK : PUBLISH_FOR_SHOP_LINK}
      </Text>
      <Button title="Publish" variant="pill" onPress={() => publishNow(source)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 12 },
  text: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: 'center' },
});
