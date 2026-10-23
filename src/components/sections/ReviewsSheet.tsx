import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { WebsiteData } from '@/web/types';
import { colors, fonts } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { Sheet, SheetAction } from '@/components/EditSheet';
import {
  hasRating, ratingShown, ratingSource, reviewRows, setRatingLine, setRatingShown, setReviewHidden, standardRatingLine, storedRatingLine,
} from '@/lib/sections/reviews';

interface Props {
  visible: boolean;
  data: WebsiteData;
  /** Applied to the editor's latest data, so it composes with concurrent changes. */
  onChange(update: (d: WebsiteData) => WebsiteData): void;
  onClose(): void;
  onDismiss?(): void;
}

/**
 * Rating and reviews. The rating and review count come from the booking page or Google listing, so they can
 * be hidden or re-worded but never retyped; each review is a quote that can be hidden, never edited.
 */
export function ReviewsSheet({ visible, data, onChange, onClose, onDismiss }: Props) {
  const stored = storedRatingLine(data);
  const [wording, setWording] = useState(stored);
  const [error, setError] = useState('');
  useEffect(() => {
    if (visible) { setWording(storedRatingLine(data)); setError(''); }
    // Reset only when the sheet opens, not on every keystroke's data change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const rating = hasRating(data);
  const source = ratingSource(data);
  const rows = reviewRows(data);

  const saveWording = () => {
    const r = setRatingLine(data, wording);
    setError(r.error);
    if (r.error) return;
    if (r.data !== data) {
      onChange((d) => setRatingLine(d, wording).data);
      track('section_saved', { section: 'reviews' });
    }
  };

  return (
    <Sheet visible={visible} title="Reviews" onClose={onClose} onDismiss={onDismiss} right={<SheetAction title="Done" primary onPress={onClose} />}>
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {rating ? (
          <View style={styles.block}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.label}>Show my rating</Text>
                <Text style={styles.hint}>
                  {standardRatingLine(data)}{source ? ` · from ${source}` : ''}. These numbers come from your booking page, so they can be hidden but not retyped.
                </Text>
              </View>
              <Switch
                value={ratingShown(data)}
                onValueChange={(on) => { onChange((d) => setRatingShown(d, on)); track('section_saved', { section: 'reviews' }); }}
                trackColor={{ true: colors.accent, false: 'rgba(255,255,255,0.16)' }}
                accessibilityLabel="Show my rating"
              />
            </View>
            {ratingShown(data) ? (
              <View style={styles.wording}>
                <Text style={styles.label}>Wording</Text>
                <TextInput
                  value={wording}
                  onChangeText={(v) => { setWording(v); setError(''); }}
                  onBlur={saveWording}
                  onSubmitEditing={saveWording}
                  maxLength={80}
                  placeholder={standardRatingLine(data)}
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  selectionColor={colors.accent}
                  accessibilityLabel="Rating wording"
                  returnKeyType="done"
                  style={styles.input}
                />
                <Text style={styles.hint}>
                  Write plain words. {'{rating}'}, {'{count}'} and {'{source}'} fill in the real figures. Leave empty for the standard line.
                </Text>
                {error ? <Text style={styles.error}>{error}</Text> : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {rows.length ? <Text style={styles.heading}>Reviews on your page</Text> : null}
        {rows.map((r) => (
          <View key={r.key} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.author}>{r.author}</Text>
              <Text style={[styles.comment, r.hidden && styles.dim]} numberOfLines={3}>{r.comment}</Text>
            </View>
            <Switch
              value={!r.hidden}
              onValueChange={(on) => { onChange((d) => setReviewHidden(d, r.key, !on)); track('section_saved', { section: 'reviews' }); }}
              trackColor={{ true: colors.accent, false: 'rgba(255,255,255,0.16)' }}
              accessibilityLabel={`${r.hidden ? 'Show' : 'Hide'} review by ${r.author}`}
            />
          </View>
        ))}
        {rows.length ? <Text style={styles.hint}>Reviews are quotes from your booking page, so they are hidden or shown, never edited.</Text> : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 480 },
  block: { marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  rowText: { flex: 1 },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: '#fff' },
  hint: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: 'rgba(255,255,255,0.55)', marginTop: 4 },
  wording: { paddingVertical: 10 },
  input: {
    fontFamily: fonts.body, fontSize: 16, color: '#fff', marginTop: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
  },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.danger, marginTop: 6 },
  heading: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginTop: 12, marginBottom: 2 },
  author: { fontFamily: fonts.bodySemi, fontSize: 14, color: '#fff' },
  comment: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  dim: { opacity: 0.4 },
});
