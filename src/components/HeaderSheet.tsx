import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WebsiteData } from '@/web/types';
import { colors, fonts } from '@/constants/theme';
import { Sheet, SheetAction } from '@/components/EditSheet';

type Tab = 'name' | 'logo';

/**
 * The header of the site: its shop name, or a logo that replaces the name (the name stays in the footer, the page
 * title and as the logo's alt text). Name | Logo chooses which pane to work in; Remove logo brings the name back.
 * States of the Logo pane: none (Add your logo), uploading, error (nothing changed, try again), set (Replace, Remove).
 */
export function HeaderSheet({
  visible, data, startOn, previewUri, uploading, error, onEditName, onPickLogo, onRemoveLogo, onClose, onDismiss,
}: {
  visible: boolean;
  data: WebsiteData;
  /** The pane shown each time the sheet opens (default: Logo when a logo is set, else Name). */
  startOn?: Tab;
  /** The just-uploaded logo as a data URI (shown at once); else the saved URL is shown. */
  previewUri?: string | null;
  uploading: boolean;
  /** Why the last logo upload did not work (the site is unchanged). */
  error?: string | null;
  onEditName(): void;
  onPickLogo(): void;
  onRemoveLogo(): void;
  onClose(): void;
  onDismiss?(): void;
}) {
  const logo = data.logo;
  const [tab, setTab] = useState<Tab>(startOn ?? (logo ? 'logo' : 'name'));
  useEffect(() => {
    if (visible) setTab(startOn ?? (data.logo ? 'logo' : 'name'));
    // Only when it opens: adding a logo while it is open must not flip the pane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const shown: Tab = tab;
  return (
    <Sheet visible={visible} title="Header" onClose={onClose} onDismiss={onDismiss} right={<SheetAction title="Done" onPress={onClose} />}>
      <View style={styles.seg} accessibilityRole="tablist">
        {(['name', 'logo'] as const).map((t) => (
          <Pressable
            key={t}
            accessibilityRole="tab"
            accessibilityState={{ selected: shown === t }}
            accessibilityLabel={t === 'name' ? 'Name' : 'Logo'}
            onPress={() => setTab(t)}
            style={[styles.segItem, shown === t && styles.segOn]}
          >
            <Text style={[styles.segText, shown === t && styles.segTextOn]}>{t === 'name' ? 'Name' : 'Logo'}</Text>
          </Pressable>
        ))}
      </View>

      {shown === 'name' ? (
        <View style={styles.pane}>
          <Text style={styles.label}>Shop name</Text>
          <Text style={styles.value}>{data.shopName}</Text>
          {logo && <Text style={styles.hint}>Your logo is showing in the header now. Remove it on the Logo tab to show this name again.</Text>}
          <SheetAction primary title="Edit shop name" onPress={onEditName} />
        </View>
      ) : (
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
                <Text style={styles.hint}>Show your logo in the header instead of your shop name. Logos work best on a plain background.</Text>
              )}
              {logo && (logo.w / logo.h > 5 || logo.h / logo.w > 1.5) && (
                <Text style={styles.hint}>{logo.w > logo.h ? 'Very wide logos are shrunk to fit the header, so they can look small.' : 'Tall logos are shrunk to the header height. A wider logo looks best.'}</Text>
              )}
              {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
              <SheetAction primary title={logo ? 'Replace logo' : 'Add your logo'} onPress={onPickLogo} />
              {logo && <SheetAction title="Remove logo" onPress={onRemoveLogo} />}
            </>
          )}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  seg: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: 3, marginBottom: 14 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  segOn: { backgroundColor: colors.accent },
  segText: { fontFamily: fonts.bodySemi, fontSize: 14, color: 'rgba(255,255,255,0.7)' },
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
