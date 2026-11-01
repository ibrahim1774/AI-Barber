import { fonts } from '@/constants/theme';
import { webDraftsEnabled } from '@/lib/webReliability';
import { Pressable, Text, View } from 'react-native';
import { useWebSaveState, ensureWebDraftSaved, resolveWebDraftConflict } from '@/lib/webAccount.web';
export function WebSaveNotice() {
  const state = useWebSaveState();
  if (!webDraftsEnabled() || state.kind === 'idle') return null;
  const action = (text: string, run: () => Promise<unknown>) => <Pressable accessibilityRole="button" onPress={() => { void run().catch(() => {}); }}><Text style={{ color: '#f4a100', fontFamily: fonts.bodyMedium, padding: 6 }}>{text}</Text></Pressable>;
  return <View accessibilityLiveRegion="polite" style={{ position: 'absolute', bottom: 82, alignSelf: 'center', maxWidth: 520, padding: 8, borderRadius: 10, backgroundColor: '#1c1c1e', zIndex: 60 }}>
    <Text style={{ color: '#fff', fontFamily: fonts.body, fontSize: 12 }}>{state.kind === 'saved' ? 'Saved to account' : state.kind === 'saving' ? 'Saving…' : state.message}</Text>
    {state.kind === 'retry' && action('Retry save', ensureWebDraftSaved)}
    {state.kind === 'conflict' && <>
      <Text style={{ color: '#fff', fontFamily: fonts.body, fontSize: 12 }}>Changed on both devices: {state.conflict?.paths.slice(0, 4).join(', ')}</Text>
      {action('Keep my changes', () => resolveWebDraftConflict('local'))}
      {action('Use saved changes', () => resolveWebDraftConflict('remote'))}
    </>}
  </View>;
}
