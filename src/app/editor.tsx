import { StyleSheet, Text, View } from 'react-native';

// Placeholder so router.replace('/editor') resolves — Task 7 replaces it.
export default function Editor() {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>Editor</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d0d0d', alignItems: 'center', justifyContent: 'center' },
  text: { color: '#fff', fontSize: 16 },
});
