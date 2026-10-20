import { StyleSheet, Text, View } from 'react-native';

// Placeholder so the Sign in link resolves — Task 9 replaces it.
export default function SignIn() {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>Sign in</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d0d0d', alignItems: 'center', justifyContent: 'center' },
  text: { color: '#fff', fontSize: 16 },
});
