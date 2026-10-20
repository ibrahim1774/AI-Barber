import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { fontAssets } from '@/constants/theme';

export default function RootLayout() {
  const [loaded, error] = useFonts(fontAssets);
  // Render nothing until Montserrat/Manrope are ready; on a font load error
  // fall back to system fonts rather than a blank app.
  if (!loaded && !error) return null;
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }}>
        <Stack.Screen name="generating" options={{ gestureEnabled: false, animation: 'fade' }} />
        {/* The editor is the stack's root once a site exists: no swipe back to the importer. */}
        <Stack.Screen name="editor" options={{ gestureEnabled: false, animation: 'fade' }} />
      </Stack>
    </>
  );
}
