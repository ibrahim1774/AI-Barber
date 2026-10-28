import { useDoneBar } from '@/components/KeyboardDoneBar';
import { useEffect, useRef, useState } from 'react';
import { FormLabel } from '@/components/FormLabel';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { WebsiteData } from '@/web/types';
import { colors, fonts } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { textMaxLength } from '@/lib/editable';
import {
  DURATIONS, SERVICE_LIBRARY, addService, durationLabel, formatPrice, moveService, newService, parseDuration,
  removeService, serviceRowMeta, updateService, type ServiceDraft,
} from '@/lib/sections/services';
import { cleanText } from '@/lib/sections/text';
import { Button } from '@/components/Button';
import { useKeyboardHeight, sheetBodyMaxHeight } from '@/lib/keyboard';
import { Sheet, SheetAction } from '@/components/EditSheet';

type Props = {
  visible: boolean;
  data: WebsiteData;
  /** Applied to the editor's latest data, so it composes with concurrent changes. */
  onChange(update: (d: WebsiteData) => WebsiteData): void;
  onClose(): void;
  onDismiss?(): void;
  /** Picks and uploads one photo through the editor's upload guard; null if cancelled or dropped. */
  upload(onPicked?: () => void): Promise<string | null>;
  /** Open straight at the add view (the preview's "+ Add a service" button) instead of the list. */
  startAdd?: boolean;
  /** Open straight at this service's edit form (a tap on its card in the preview): its index in data.services. */
  focusIndex?: number | null;
};

// index null: a service of the barber's own that is added when they save.
type Form = { index: number | null; fresh: boolean; draft: ServiceDraft };
type View_ = { kind: 'list' } | { kind: 'add' } | { kind: 'form'; form: Form };

const PHOTO_FAIL = "Couldn't upload that photo. Check your connection and try again.";

export function ServicesSheet({ visible, data, onChange, onClose, onDismiss, upload, startAdd, focusIndex }: Props) {
  const doneBar = useDoneBar('decimal-pad');
  const formScroll = useRef<ScrollView>(null);
  const fPrice = useRef<TextInput>(null);
  const f1 = useRef<TextInput>(null);
  const f2 = useRef<TextInput>(null);
  const { height } = useWindowDimensions();
  const [view, setView] = useState<View_>(startAdd ? { kind: 'add' } : { kind: 'list' });
  useEffect(() => { if (visible && startAdd) setView({ kind: 'add' }); }, [visible, startAdd]);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const afterDismiss = useRef<(() => void) | null>(null);
  const services = data.services;

  const close = () => { setView({ kind: 'list' }); onClose(); };

  const openForm = (index: number, fresh: boolean) => {
    const s = services[index];
    if (!s) return;
    setView({
      kind: 'form',
      form: {
        index, fresh,
        draft: {
          title: s.title, price: s.price ?? '', duration: parseDuration(s.duration),
          description: s.description ?? '', imageUrl: s.imageUrl ?? '',
        },
      },
    });
  };

  // The form opens once per open; the list (with Add a service) is one Back away.
  useEffect(() => { if (visible && focusIndex != null && !startAdd) openForm(focusIndex, false); }, [visible, focusIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const addFromLibrary = (title: string, duration: number, icon: Parameters<typeof newService>[2]) => {
    track('service_added', { source: 'library' });
    const index = services.length;
    onChange((d) => addService(d, newService(title, duration, icon)));
    // The new row is not in `data` yet: open the form from the values we know.
    setView({ kind: 'form', form: { index, fresh: true, draft: { title, price: '', duration, description: '', imageUrl: '' } } });
  };

  const addOwn = () => {
    setView({ kind: 'form', form: { index: null, fresh: true, draft: { title: '', price: '', duration: 30, description: '', imageUrl: '' } } });
  };

  const save = (form: Form) => {
    if (!cleanText(form.draft.title)) {
      Alert.alert('Give this service a name');
      return;
    }
    if (form.index == null) {
      track('service_added', { source: 'custom' });
      const at = services.length;
      onChange((d) => updateService(addService(d, newService(form.draft.title, form.draft.duration ?? 30, 'scissors')), at, form.draft));
    } else {
      const at = form.index;
      onChange((d) => updateService(d, at, form.draft));
    }
    setView({ kind: 'list' });
  };

  const remove = (form: Form) => {
    const index = form.index;
    if (index == null) { setView({ kind: 'list' }); return; }
    const name = cleanText(form.draft.title) || services[index]?.title || 'this service';
    Alert.alert(`Remove ${name} from your site?`, undefined, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: () => {
          track('service_removed');
          onChange((d) => removeService(d, index));
          setView({ kind: 'list' });
        },
      },
    ]);
  };

  // iOS can't show the photo picker over a sheet: hide the sheet, pick from
  // onDismiss, then bring the sheet back with the form as it was.
  const pickPhoto = (form: Form) => {
    afterDismiss.current = async () => {
      try {
        const url = await upload(() => setUploading(true));
        if (url) setView({ kind: 'form', form: { ...form, draft: { ...form.draft, imageUrl: url } } });
        setUploading(false);
        setPicking(false);
      } catch (e) {
        console.warn('[services] photo upload failed:', e);
        setUploading(false);
        // Bring the sheet back only once the alert is gone, or iOS drops it.
        Alert.alert(PHOTO_FAIL, undefined, [{ text: 'OK', onPress: () => setPicking(false) }]);
      }
    };
    setPicking(true);
  };
  const handleDismiss = () => {
    const next = afterDismiss.current;
    afterDismiss.current = null;
    if (next) void next();
    else onDismiss?.();
  };

  const keyboard = useKeyboardHeight();
  const maxH = sheetBodyMaxHeight(height, keyboard);

  let title = 'Services';
  let right: React.ReactNode = <SheetAction title="Done" primary onPress={close} />;
  let body: React.ReactNode;

  if (view.kind === 'list') {
    body = (
      <>
        <ScrollView style={{ maxHeight: maxH }} keyboardShouldPersistTaps="handled">
          {services.length === 0 && <Text style={styles.empty}>No services yet. Add the ones you offer.</Text>}
          {services.map((s, i) => (
            <View key={i} style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit ${s.title}`}
                onPress={() => openForm(i, false)}
                style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.rowTitle} numberOfLines={1}>{s.title || 'Untitled'}</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {serviceRowMeta(s) || 'Tap to add a price'}
                </Text>
              </Pressable>
              <Move label={`Move ${s.title} up`} glyph="↑" disabled={i === 0} onPress={() => onChange((d) => moveService(d, i, -1))} />
              <Move label={`Move ${s.title} down`} glyph="↓" disabled={i === services.length - 1} onPress={() => onChange((d) => moveService(d, i, 1))} />
            </View>
          ))}
        </ScrollView>
        <Button title="Add a service" onPress={() => setView({ kind: 'add' })} size="sm" style={styles.addBtn} />
      </>
    );
  } else if (view.kind === 'add') {
    title = 'Add a service';
    right = <SheetAction title="Back" onPress={() => setView({ kind: 'list' })} />;
    body = (
      <ScrollView style={{ maxHeight: maxH }} keyboardShouldPersistTaps="handled">
        {SERVICE_LIBRARY.map((g) => (
          <View key={g.group} style={styles.group}>
            <Text style={styles.groupTitle}>{g.group}</Text>
            <View style={styles.chips}>
              {g.items.map((it) => (
                <Chip key={it.title} label={it.title} onPress={() => addFromLibrary(it.title, it.duration, it.icon)} />
              ))}
            </View>
          </View>
        ))}
        <View style={styles.group}>
          <Chip label="Add your own" accent onPress={addOwn} />
        </View>
      </ScrollView>
    );
  } else {
    const { form } = view;
    const set = (patch: Partial<ServiceDraft>) =>
      setView({ kind: 'form', form: { ...form, draft: { ...form.draft, ...patch } } });
    title = form.index == null ? 'New service' : 'Edit service';
    right = <SheetAction title="Back" onPress={() => setView({ kind: 'list' })} />;
    body = (
      <>
        <ScrollView ref={formScroll} style={{ maxHeight: maxH }} keyboardShouldPersistTaps="handled">
          <FormLabel input={f1} style={styles.label}>Name</FormLabel>
          <TextInput ref={f1}
            value={form.draft.title}
            onChangeText={(t) => set({ title: t })}
            autoFocus={form.index == null}
            accessibilityLabel="Name"
            selectionColor={colors.accent}
            placeholder="e.g. Skin fade"
            placeholderTextColor="rgba(255,255,255,0.3)"
            style={styles.input}
          />
          <FormLabel input={fPrice} style={styles.label}>Price</FormLabel>
          <View style={styles.priceRow}>
            {/* Imported text like "From $25" is shown as it is, without the $ prefix. */}
            {(!form.draft.price.trim() || formatPrice(form.draft.price) != null) && <Text style={styles.dollar}>$</Text>}
            <TextInput
              ref={fPrice}
              value={formatPrice(form.draft.price) != null ? form.draft.price.replace(/^\$\s*/, '') : form.draft.price}
              onChangeText={(t) => set({ price: t })}
              autoFocus={form.fresh && form.index != null}
              inputAccessoryViewID={doneBar.id} keyboardType="decimal-pad"
              maxLength={textMaxLength('services.0.price')}
              accessibilityLabel="Price"
              selectionColor={colors.accent}
              placeholder="30"
              placeholderTextColor="rgba(255,255,255,0.3)"
              style={[styles.input, styles.priceInput]}
            />
{doneBar.bar}
          </View>
          <Text style={styles.label}>Length</Text>
          <View style={styles.chips}>
            {DURATIONS.map((m) => (
              <Chip key={m} label={durationLabel(m)} selected={form.draft.duration === m} onPress={() => set({ duration: m })} />
            ))}
          </View>
          <FormLabel input={f2} style={styles.label}>Description (optional)</FormLabel>
          <TextInput ref={f2}
            value={form.draft.description}
            onChangeText={(t) => set({ description: t })}
            multiline
            numberOfLines={2}
            onFocus={() => setTimeout(() => formScroll.current?.scrollToEnd({ animated: true }), 250)}
            accessibilityLabel="Description"
            selectionColor={colors.accent}
            placeholderTextColor="rgba(255,255,255,0.3)"
            style={[styles.input, styles.multi]}
          />
          <Text style={styles.label}>Photo (optional)</Text>
          <View style={styles.photoRow}>
            {!!form.draft.imageUrl && <Image source={{ uri: form.draft.imageUrl }} style={styles.thumb} />}
            <SheetAction
              title={form.draft.imageUrl ? 'Change' : 'Add photo'}
              onPress={() => pickPhoto(form)}
              disabled={uploading}
            />
            {uploading && <ActivityIndicator color={colors.accent} />}
          </View>
        </ScrollView>
        <View style={styles.formActions}>
          <Button title="Save" onPress={() => save(form)} size="sm" style={{ flex: 1 }} />
          {form.index != null && <SheetAction title="Delete" onPress={() => remove(form)} />}
        </View>
      </>
    );
  }

  return (
    <Sheet visible={visible && !picking} title={title} onClose={close} onDismiss={handleDismiss} right={right}>
      {body}
    </Sheet>
  );
}

function Chip({ label, onPress, selected, accent }: { label: string; onPress(): void; selected?: boolean; accent?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipOn, accent && styles.chipAccent, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Move({ label, glyph, disabled, onPress }: { label: string; glyph: string; disabled?: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.move, (pressed || disabled) && { opacity: disabled ? 0.25 : 0.6 }]}
    >
      <Text style={styles.moveText}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  empty: { fontFamily: fonts.body, fontSize: 14, color: 'rgba(255,255,255,0.55)', paddingVertical: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8,
    borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  rowMain: { flex: 1, paddingHorizontal: 14, paddingVertical: 12 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: '#fff' },
  rowMeta: { fontFamily: fonts.body, fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  move: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  moveText: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.accent },
  addBtn: { marginTop: 8, marginBottom: 4 },
  group: { marginBottom: 14 },
  groupTitle: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.5)', marginBottom: 8,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.05)',
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipAccent: { borderColor: colors.accent },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 14, color: '#fff' },
  chipTextOn: { color: colors.buttonInk },
  label: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.5)', marginTop: 10, marginBottom: 6,
  },
  input: {
    fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: '#fff',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  multi: { minHeight: 64, textAlignVertical: 'top' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dollar: { fontFamily: fonts.bodyBold, fontSize: 18, color: 'rgba(255,255,255,0.7)' },
  priceInput: { flex: 1 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)' },
  formActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
});
