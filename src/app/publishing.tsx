import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';

// Placeholder so the editor's Publish button resolves — Task 8 replaces it
// with the Superwall paywall + publish flow.
export default function Publishing() {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>Publishing</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  text: { fontFamily: fonts.heading, fontSize: 16, color: '#fff' },
});
