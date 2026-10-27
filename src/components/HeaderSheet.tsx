import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { WebsiteData } from '@/web/types';
import { colors, fonts } from '@/constants/theme';
import { Sheet, SheetAction } from '@/components/EditSheet';
import { contrastNote, type LogoVerdict } from '@/lib/logoContrast';
import { LOGO_BOTH_ENABLED, headerShowOf, type HeaderShow } from '@/lib/logo';

const CHOICES: { key: HeaderShow; label: string }[] = [
  { key: 'both', label: 'Logo + name' },
  { key: 'logo', label: 'Logo only' },
  { key: 'name', label: 'Name only' },
];

/**
 * The one "Logo & name" screen: the logo (Add / Replace / Remove), the shop name edited in place, and what the header
 * shows: Logo + name (default), Logo only or Name only. Name only keeps the uploaded logo, so switching back needs no
 * new upload; Remove logo is the only delete. Every change goes to the site at once, so the preview updates live.
 */
export function HeaderSheet({
  visible, data, previewUri, contrast, uploading, error, onShow, onSaveName, onPickLogo, onRemoveLogo, onClose, onDismiss,
}: {
  visible: boolean;
  data: WebsiteData;
  /** The just-uploaded logo as a data URI (shown at once); else the saved URL is shown. */
  previewUri?: string | null;
  /** How visible the just-uploaded logo is on the dark header (session only); a calm note shows when it may be hard to see. */
  contrast?: LogoVerdict | null;
  uploading: boolean;
  /** Why the last logo upload did not work (the site is unchanged). */
  error?: string | null;
  onShow(s: HeaderShow): void;
  /** A non-empty shop name; an empty one is never sent. */
  onSaveName(text: string): void;
  onPickLogo(): void;
  onRemoveLogo(): void;
  onClose(): void;
  onDismiss?(): void;
}) {
  const logo = data.logo;
  const show = headerShowOf(data);
  const [name, setName] = useState(data.shopName ?? '');
  useEffect(() => {
    if (visible) setName(data.shopName ?? '');
    // Only when it opens: typing must not be overwritten by the saved copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const change = (t: string) => {
    setName(t);
    if (t.trim()) onSaveName(t);
  };
  // An empty name is refused: leaving the box shows the saved name again.
  const settle = () => setName((cur) => (cur.trim() ? cur : data.shopName ?? ''));
  return (
    <Sheet visible={visible} title="Logo & name" onClose={onClose} onDismiss={onDismiss} right={<SheetAction title="Done" onPress={onClose} />}>
      <View style={styles.pane}>
        {uploading ? (
          <View style={styles.busy} accessibilityLabel="Uploading logo">
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.value}>Uploading logo…</Text>
          </View>
        ) : (
          <>
            {logo ? (
              <View style={styles.preview}>
                <Image source={{ uri: previewUri || logo.url }} style={styles.logoImg} resizeMode="contain" accessibilityLabel="Your logo" />
              </View>
            ) : (
              <Text style={styles.hint}>Add your logo to show it in the header next to your shop name. Logos work best on a plain background.</Text>
            )}
            {logo && contrastNote(contrast) && <Text style={styles.hint}>{contrastNote(contrast)}</Text>}
            {logo && (logo.w / logo.h > 5 || logo.h / logo.w > 1.5) && (
              <Text style={styles.hint}>{logo.w > logo.h ? 'Very wide logos are shrunk to fit the header, so they can look small.' : 'Tall logos are shrunk to the header height. A wider logo looks best.'}</Text>
            )}
            {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
            <SheetAction primary title={logo ? 'Replace logo' : 'Add your logo'} onPress={onPickLogo} />
            {logo && <SheetAction title="Remove logo" onPress={onRemoveLogo} />}
          </>
        )}

        <Text style={styles.label}>Shop name</Text>
        <TextInput
          value={name}
          onChangeText={change}
          onBlur={settle}
          onSubmitEditing={settle}
          maxLength={80}
          returnKeyType="done"
          autoCapitalize="words"
          accessibilityLabel="Shop name"
          selectionColor={colors.accent}
          placeholderTextColor="rgba(255,255,255,0.3)"
          style={styles.input}
        />

        {LOGO_BOTH_ENABLED && (
          <>
            <Text style={styles.label}>Show in the header</Text>
            <View style={styles.seg} accessibilityRole="radiogroup">
              {CHOICES.map((c) => {
                const disabled = !logo && c.key !== 'name';
                const selected = show === c.key;
                return (
                  <Pressable
                    key={c.key}
                    accessibilityRole="radio"
                    accessibilityLabel={c.label}
                    accessibilityState={{ selected, disabled }}
                    disabled={disabled}
                    onPress={() => { if (!disabled) onShow(c.key); }}
                    style={[styles.segItem, selected && styles.segOn, disabled && styles.segOff]}
                  >
                    <Text style={[styles.segText, selected && styles.segTextOn]}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {!logo && <Text style={styles.hint}>Add a logo first</Text>}
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  seg: { flexDirection: 'row', alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: 3 },
  segOff: { opacity: 0.35 },
  input: {
    alignSelf: 'stretch', fontFamily: fonts.body, fontSize: 16, color: '#fff', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  segOn: { backgroundColor: colors.accent },
  segText: { fontFamily: fonts.bodySemi, fontSize: 13, textAlign: 'center', color: 'rgba(255,255,255,0.7)' },
  segTextOn: { color: '#000' },
  pane: { gap: 10, alignItems: 'center', paddingBottom: 8 },
  label: {
    alignSelf: 'flex-start', fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)',
  },
  value: { alignSelf: 'flex-start', fontFamily: fonts.body, fontSize: 16, color: '#fff' },
  hint: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
  error: { fontFamily: fonts.bodySemi, fontSize: 13, color: '#ff8a80', textAlign: 'center' },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 24 },
  preview: { width: '100%', height: 90, borderRadius: 8, backgroundColor: '#1f1f1f', alignItems: 'center', justifyContent: 'center' },
  logoImg: { width: '90%', height: 70 },
});
