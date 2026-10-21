import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Page } from '@/components/Page';
import { goBackOrHome } from '@/lib/nav';

/**
 * Where an old aibarber://reset-password link (from before the code flow)
 * lands. It reads nothing from the URL: password reset is a code typed in
 * /forgot-password now.
 */
export default function ResetPassword() {
  return (
    <Page title="Reset password" onBack={goBackOrHome}>
      <View style={styles.form}>
        <Text style={styles.body}>Open AI Barber and use Forgot password to get a code.</Text>
        <Button variant="solid" title="Forgot password" onPress={() => router.replace('/forgot-password')} />
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  form: { gap: 24 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.text },
});
