import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/constants/theme';

/**
 * Bottom-sheet shell shared by the editor's sheets: a slide-up card on a dim
 * backdrop (tap outside to close). `onDismiss` fires once iOS has finished
 * dismissing, which is when the next sheet or the photo picker may present.
 */
export function Sheet({
  visible, title, onClose, onDismiss, right, children,
}: {
  visible: boolean;
  title: string;
  onClose(): void;
  onDismiss?(): void;
  right?: ReactNode;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={onDismiss}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.card, { paddingBottom: 16 + insets.bottom }]}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            {right}
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function SheetAction({ title, onPress, primary, disabled }: { title: string; onPress(): void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [styles.action, primary && styles.actionPrimary, (pressed || disabled) && { opacity: 0.6 }]}
    >
      <Text style={[styles.actionText, primary && styles.actionPrimaryText]}>{title}</Text>
    </Pressable>
  );
}

// Long-form fields get a multi-line box; names, phone, links stay single-line.
const MULTILINE = /^(about\.description\.\d+|services\.\d+\.description|policy\.body|pullQuote\.text|hero\.tagline)$/;

export interface EditSheetProps {
  visible: boolean;
  label: string;
  path: string;
  value: string;
  onSave(value: string): void;
  onClose(): void;
  onDismiss?(): void;
}

/** Edits one text field: the same sheet for a tap in the preview or a row in "All fields". */
export function EditSheet({ visible, label, path, value, onSave, onClose, onDismiss }: EditSheetProps) {
  const [text, setText] = useState(value);
  useEffect(() => {
    if (visible) setText(value);
  }, [visible, value]);

  const multiline = MULTILINE.test(path);
  const keyboard = path === 'phone' ? 'phone-pad' : path === 'bookingUrl' ? 'url' : 'default';
  const save = () => {
    if (text !== value) onSave(text);
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={label}
      onClose={onClose}
      onDismiss={onDismiss}
      right={<SheetAction title="Save" primary onPress={save} />}
    >
      <TextInput
        value={text}
        onChangeText={setText}
        autoFocus
        multiline={multiline}
        keyboardType={keyboard}
        autoCapitalize={path === 'bookingUrl' ? 'none' : 'sentences'}
        autoCorrect={path !== 'bookingUrl' && path !== 'phone'}
        returnKeyType={multiline ? 'default' : 'done'}
        onSubmitEditing={multiline ? undefined : save}
        accessibilityLabel={label}
        selectionColor={colors.accent}
        placeholderTextColor="rgba(255,255,255,0.3)"
        style={[styles.input, multiline && styles.inputMulti]}
      />
      <SheetAction title="Cancel" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  card: {
    backgroundColor: colors.sheet,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 20,
    paddingTop: 8,
    maxHeight: '85%',
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 },
  title: {
    flexShrink: 1, fontFamily: fonts.heading, fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: '#fff',
  },
  action: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 14 },
  actionPrimary: { backgroundColor: colors.accent, borderRadius: 8, alignSelf: 'auto' },
  actionText: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' },
  actionPrimaryText: { color: colors.buttonInk },
  input: {
    fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: '#fff',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8,
  },
  inputMulti: { minHeight: 120, maxHeight: 260, textAlignVertical: 'top' },
});
