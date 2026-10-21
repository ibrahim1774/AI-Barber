import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';

/** An empty day: points the barber at their booking link. */
export function EmptyDay({ onShare, readOnly }: { onShare(): void; readOnly?: boolean }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>No bookings yet</Text>
      {!readOnly && (
        <>
          <Text style={styles.body}>Share your booking link so clients can book themselves.</Text>
          <Button title="Share" onPress={onShare} variant="pill" style={styles.btn} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  title: { fontFamily: fonts.heading, fontSize: 18, color: colors.heading, marginBottom: 6 },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: 'center', marginBottom: 18 },
  btn: { alignSelf: 'center' },
});
