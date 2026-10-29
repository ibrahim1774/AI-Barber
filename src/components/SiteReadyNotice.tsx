import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';

/**
 * Shown once per generated site, whichever way it was made (from scratch, a booking link or a Google listing):
 * what the barber can change, and that Publish puts it online.
 */
export function SiteReadyNotice({ visible, onClose }: { visible: boolean; onClose(): void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">You can edit the text, photos, services and prices</Text>
          <Text style={styles.body}>Make it yours, then tap Publish to put your website online.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Got it" onPress={onClose} style={styles.button}>
            <Text style={styles.buttonText}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  card: { alignSelf: 'stretch', borderRadius: 26, borderWidth: 1, borderColor: colors.ghostBorder, backgroundColor: colors.bg, padding: 24 },
  title: { fontFamily: fonts.bodyBold, fontSize: 20, lineHeight: 26, color: colors.text, textAlign: 'center' },
  body: { marginTop: 12, fontFamily: fonts.body, fontSize: 15.5, lineHeight: 22, color: colors.muted, textAlign: 'center' },
  button: { marginTop: 22, borderRadius: 999, backgroundColor: colors.accent, paddingVertical: 14, alignItems: 'center' },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: 16, color: '#0d0d0d' },
});
