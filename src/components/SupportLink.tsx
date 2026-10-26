import { Alert, Linking, Pressable, StyleSheet, Text } from 'react-native';
import { colors, fonts } from '@/constants/theme';

export const SUPPORT_EMAIL = 'support@davoxa.com';
export const SUPPORT_SUBJECT = 'Prime Barber account help';
export const SUPPORT_URL = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(SUPPORT_SUBJECT)}`;
export const SUPPORT_LABEL = 'Need help? Contact support';

/** An always-visible way out for the account step: opens the mail app addressed to support. */
export function SupportLink() {
  return (
    <Pressable
      onPress={() => void Linking.openURL(SUPPORT_URL).catch(() => Alert.alert('Support', `Email us at ${SUPPORT_EMAIL}.`))}
      accessibilityRole="link"
      hitSlop={8}
      style={styles.row}
    >
      <Text style={styles.text}>{SUPPORT_LABEL}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { alignSelf: 'center', marginTop: 20 },
  text: { fontFamily: fonts.body, fontSize: 13, color: colors.grey, textDecorationLine: 'underline' },
});
