import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/EditSheet';
import { Input, Label, Note, TextAction, ToggleRow } from '@/components/setup/ui';
import { moveToCover, pickProductPhotos, removePhoto } from '@/lib/store/photos';
import type { Product } from '@/lib/store/data';
import {
  emptyDraft, MAX_PHOTOS, productToDraft, validateDraft, type DraftErrors, type ProductDraft,
} from '@/lib/store/productDraft';

type Props = {
  visible: boolean;
  shopId: string;
  /** null = a new product. */
  product: Product | null;
  onClose(): void;
  /** Saves the draft; resolves true when it went through (the form then closes). */
  onSubmit(draft: ProductDraft): Promise<boolean>;
  onDelete?(): void;
};

/** The add / edit sheet: photo strip (first is the cover), name, price, description, sold out. */
export function ProductForm({ visible, shopId, product, onClose, onSubmit, onDelete }: Props) {
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft());
  const [errors, setErrors] = useState<DraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Bumped whenever the form resets or closes, so a late upload can't land in another draft.
  const token = useRef(0);

  useEffect(() => {
    token.current++;
    if (!visible) return;
    setDraft(product ? productToDraft(product) : emptyDraft());
    setErrors({});
    setBusy(false);
    setUploading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, product?.id]);

  const patch = (p: Partial<ProductDraft>) => setDraft((d) => ({ ...d, ...p }));

  const addPhotos = async (source: 'camera' | 'library') => {
    const mine = token.current;
    const stale = () => mine !== token.current;
    try {
      const urls = await pickProductPhotos(
        source, MAX_PHOTOS - draft.photos.length, shopId,
        () => !stale() && setUploading(true),
        (failed, total) => {
          if (!stale()) Alert.alert(`${total - failed} of ${total} photos added`, 'The rest didn\'t upload. Check your connection and try again.');
        },
      );
      if (stale()) return;
      if (urls.length) setDraft((d) => ({ ...d, photos: [...d.photos, ...urls].slice(0, MAX_PHOTOS) }));
    } catch (e) {
      if (!stale()) Alert.alert("Couldn't add that photo", e instanceof Error ? e.message : 'Check your connection and try again.');
    } finally {
      if (!stale()) setUploading(false);
    }
  };

  const chooseSource = () => {
    // Browser: there is no Camera / Library choice to make, the file picker offers both (and a webcam on some devices).
    if (Platform.OS === 'web') return void addPhotos('library');
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Camera', 'Library', 'Cancel'], cancelButtonIndex: 2 },
      (i) => {
        if (i === 0) void addPhotos('camera');
        if (i === 1) void addPhotos('library');
      },
    );
  };

  const photoMenu = (i: number) => {
    const options = i > 0 ? ['Make cover', 'Remove', 'Cancel'] : ['Remove', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: options.indexOf('Remove') },
      (k) => {
        const pick = options[k];
        if (pick === 'Make cover') patch({ photos: moveToCover(draft.photos, i) });
        if (pick === 'Remove') patch({ photos: removePhoto(draft.photos, i) });
      },
    );
  };

  const save = async () => {
    const e = validateDraft(draft);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      if (await onSubmit(draft)) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} title={product ? 'Edit product' : 'New product'} onClose={onClose}>
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={{ gap: 6 }}>
          <Label>Photos</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            {draft.photos.map((url, i) => (
              <Pressable
                key={`${url}-${i}`}
                onPress={() => photoMenu(i)}
                accessibilityRole="button"
                accessibilityLabel={i === 0 ? 'Cover photo options' : `Photo ${i + 1} options`}
              >
                <Image source={{ uri: url }} style={styles.thumb} />
                {i === 0 && (
                  <View style={styles.cover}><Text style={styles.coverText}>Cover</Text></View>
                )}
              </Pressable>
            ))}
            {draft.photos.length < MAX_PHOTOS && (
              <Pressable
                onPress={chooseSource}
                disabled={uploading}
                accessibilityRole="button"
                accessibilityLabel="Add photo"
                style={[styles.add, uploading && { opacity: 0.5 }]}
              >
                {uploading ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.addText}>Add photo</Text>}
              </Pressable>
            )}
          </ScrollView>
          {!!errors.photos && <Note tone="error">{errors.photos}</Note>}

          <Input title="Name" label="Name" value={draft.name} onChangeText={(t) => patch({ name: t })} placeholder="e.g. Matte pomade" maxLength={80} autoFocus={!product} />
          {!!errors.name && <Note tone="error">{errors.name}</Note>}

          <Input title="Price" label="Price in dollars" value={draft.price} onChangeText={(t) => patch({ price: t })} keyboardType="decimal-pad" placeholder="12.50" />
          {!!errors.price && <Note tone="error">{errors.price}</Note>}

          <Input title="Description (optional)" label="Description" value={draft.description} onChangeText={(t) => patch({ description: t })} multiline />
          {!!errors.description && <Note tone="error">{errors.description}</Note>}

          <ToggleRow
            label="Sold out"
            detail="Customers still see it, but can't add it to their cart"
            value={draft.soldOut}
            onValueChange={(v) => patch({ soldOut: v })}
          />

          <View style={styles.actions}>
            <Button title="Save" size="sm" onPress={() => void save()} loading={busy} disabled={uploading} style={{ flex: 1 }} />
            {!!product && !!onDelete && <TextAction title="Delete" danger onPress={onDelete} />}
          </View>
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 560 },
  strip: { gap: 10, paddingVertical: 4 },
  thumb: { width: 84, height: 84, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)' },
  cover: {
    position: 'absolute', left: 4, bottom: 4, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
    backgroundColor: colors.accent,
  },
  coverText: { fontFamily: fonts.bodyBold, fontSize: 10, color: colors.accentInk },
  add: {
    width: 84, height: 84, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.3)',
  },
  addText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.accent, textAlign: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 8 },
});
