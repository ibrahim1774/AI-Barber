import { Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';

/** Full-screen QR code on a white card: a customer scans it from the barber's phone. */
export function QrScreen({
  visible, shopName, url, onClose,
}: {
  visible: boolean;
  shopName: string;
  url: string;
  onClose(): void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.card}>
          <QRCode value={url} size={260} color="#000" backgroundColor="#fff" />
          {!!shopName.trim() && (
            <Text style={styles.name} numberOfLines={2}>
              {shopName.trim()}
            </Text>
          )}
          <Text style={styles.scan}>Scan to see our website</Text>
        </View>
        <Text style={styles.hint}>Take a screenshot to save or print it.</Text>
        <Button variant="solid" title="Done" onPress={onClose} style={styles.done} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 28, alignItems: 'center', alignSelf: 'stretch' },
  name: { fontFamily: fonts.heading, fontSize: 22, lineHeight: 28, color: '#000', textAlign: 'center', marginTop: 20 },
  scan: { fontFamily: fonts.bodySemi, fontSize: 15, color: '#333', marginTop: 6 },
  hint: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: 'center', marginTop: 20 },
  done: { alignSelf: 'stretch', marginTop: 24 },
});
