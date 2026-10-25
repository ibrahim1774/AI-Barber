import { Stack } from 'expo-router';

/** Settings and the pages that open inside it, so the tab bar stays visible. */
export default function SettingsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
