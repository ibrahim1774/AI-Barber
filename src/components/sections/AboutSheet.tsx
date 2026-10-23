import { useEffect, useState, useRef } from 'react';
import { FormLabel } from '@/components/FormLabel';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import type { WebsiteData } from '@/web/types';
import { colors, fonts } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { Sheet, SheetAction } from '@/components/EditSheet';
import { aboutError, aboutFields, setAbout } from '@/lib/sections/aboutContact';

interface Props {
  visible: boolean;
  data: WebsiteData;
  /** Applied to the editor's latest data, so it composes with concurrent changes. */
  onChange(update: (d: WebsiteData) => WebsiteData): void;
  onClose(): void;
  onDismiss?(): void;
}

export function AboutSheet({ visible, data, onChange, onClose, onDismiss }: Props) {
  const f1 = useRef<TextInput>(null);
  const f2 = useRef<TextInput>(null);
  const f3 = useRef<TextInput>(null);
  const [f, setF] = useState(aboutFields(data));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) { setF(aboutFields(data)); setError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const save = () => {
    const err = aboutError(f);
    if (err) { setError(err); return; }
    onChange((d) => setAbout(d, f));
    track('section_saved', { section: 'about' });
    onClose();
  };

  return (
    <Sheet visible={visible} title="About" onClose={onClose} onDismiss={onDismiss} right={<SheetAction title="Save" primary onPress={save} />}>
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
        <FormLabel input={f1} style={styles.label}>Shop name</FormLabel>
        <TextInput ref={f1} value={f.shopName} onChangeText={(shopName) => { setError(null); setF({ ...f, shopName }); }} accessibilityLabel="Shop name" selectionColor={colors.accent} placeholderTextColor="rgba(255,255,255,0.3)" style={styles.input} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <FormLabel input={f2} style={styles.label}>Tagline</FormLabel>
        <TextInput ref={f2} value={f.tagline} onChangeText={(tagline) => setF({ ...f, tagline })} accessibilityLabel="Tagline" selectionColor={colors.accent} placeholderTextColor="rgba(255,255,255,0.3)" style={styles.input} />
        <FormLabel input={f3} style={styles.label}>About your shop</FormLabel>
        <TextInput ref={f3} value={f.about} onChangeText={(about) => setF({ ...f, about })} multiline accessibilityLabel="About your shop" selectionColor={colors.accent} placeholderTextColor="rgba(255,255,255,0.3)" style={[styles.input, styles.multi]} />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 460 },
  label: { fontFamily: fonts.bodySemi, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', marginBottom: 6, marginTop: 8 },
  input: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: '#fff', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12 },
  multi: { minHeight: 140, textAlignVertical: 'top' },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.danger, marginTop: 6 },
});
