import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { WebsiteData } from '@/web/types';
import { colors, fonts } from '@/constants/theme';
import { IMAGE_PATHS, editableTextPaths, getPath } from '@/lib/editable';
import { fieldLabel, imageLabel } from '@/lib/editor';
import { Sheet, SheetAction } from '@/components/EditSheet';

// The two "every slot" lists: all text fields ("Edit") and all photos
// ("Photos"). They cover what the preview can't tap (SHEET_ONLY_PATHS,
// sheetOnlyImagePaths, the luxe logo's shopName).

interface ListSheetProps {
  visible: boolean;
  data: WebsiteData;
  onPick(path: string): void;
  onClose(): void;
  onDismiss?(): void;
}

export function AllFieldsSheet({ visible, data, onPick, onClose, onDismiss }: ListSheetProps) {
  return (
    <Sheet visible={visible} title="All fields" onClose={onClose} onDismiss={onDismiss} right={<SheetAction title="Done" onPress={onClose} />}>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {editableTextPaths(data).map((path) => {
          const value = getPath(data, path);
          const text = typeof value === 'string' ? value : '';
          return (
            <Pressable
              key={path}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${fieldLabel(path)}`}
              onPress={() => onPick(path)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Text style={styles.rowLabel}>{fieldLabel(path)}</Text>
              <Text style={[styles.rowValue, !text && styles.empty]} numberOfLines={2}>
                {text || 'Empty — tap to add'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

export function PhotosSheet({ visible, data, onPick, onClose, onDismiss }: ListSheetProps) {
  return (
    <Sheet visible={visible} title="Photos" onClose={onClose} onDismiss={onDismiss} right={<SheetAction title="Done" onPress={onClose} />}>
      <ScrollView style={styles.list} contentContainerStyle={styles.grid}>
        {IMAGE_PATHS(data).map((path) => {
          const url = getPath(data, path);
          const src = typeof url === 'string' && url ? url : null;
          return (
            <Pressable
              key={path}
              accessibilityRole="button"
              accessibilityLabel={`Change ${imageLabel(path)}`}
              onPress={() => onPick(path)}
              style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
            >
              {src ? (
                <Image source={{ uri: src }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={[styles.thumb, styles.placeholder]}>
                  <Text style={styles.plus}>+</Text>
                </View>
              )}
              <Text style={styles.tileLabel} numberOfLines={1}>{imageLabel(path)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 0 },
  listContent: { paddingBottom: 8 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)' },
  pressed: { opacity: 0.6 },
  rowLabel: {
    fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)',
    marginBottom: 4,
  },
  rowValue: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: '#fff' },
  empty: { color: 'rgba(255,255,255,0.35)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingBottom: 8 },
  tile: { width: '30%', flexGrow: 1, maxWidth: '32%' },
  thumb: { width: '100%', aspectRatio: 1, borderRadius: 8, backgroundColor: '#1f1f1f' },
  placeholder: {
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.25)',
  },
  plus: { fontFamily: fonts.body, fontSize: 28, color: 'rgba(255,255,255,0.4)' },
  tileLabel: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.text, marginTop: 6 },
});
