import { useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { PlusIcon } from '@/components/bookings/icons';
import { ProductForm } from '@/components/store/products/ProductForm';
import { useProducts } from '@/components/store/products/useProducts';
import type { Product } from '@/lib/store/data';
import { draftToProduct, formatPrice, type ProductDraft } from '@/lib/store/productDraft';

const GAP = 12;
const PAD = 16;

/**
 * The Products grid: a + card first, photo cards with name and price, a
 * "Sold out" veil. Tap edits; long-press enters Arrange (up/down arrows, Done).
 * Read-only when `locked` (the hosting lapse).
 */
export function ProductsPane({
  shopId, locked, lockReason = 'lapsed', onUpgrade, onFirstProduct,
}: {
  shopId: string;
  locked: boolean;
  /** 'lapsed': the subscription ended. 'plan': the plan doesn't include the Store (upgrade invited). */
  lockReason?: 'lapsed' | 'plan';
  onUpgrade?(): void;
  /** The shop's very first product was just saved. */
  onFirstProduct?(): void;
}) {
  const planLock = locked && lockReason === 'plan';
  const { width } = useWindowDimensions();
  const cardW = Math.floor((width - PAD * 2 - GAP) / 2);
  const { products, loading, failed, refresh, add, update, remove, reorder } = useProducts(shopId);
  const [form, setForm] = useState<{ product: Product | null } | null>(null);
  const [order, setOrder] = useState<Product[] | null>(null); // Arrange mode
  const [pulling, setPulling] = useState(false);

  const arranging = order != null;
  const shown = order ?? products;

  const pull = async () => {
    setPulling(true);
    await refresh();
    setPulling(false);
  };

  const submit = async (d: ProductDraft): Promise<boolean> => {
    const next = draftToProduct(d);
    const cur = form?.product;
    if (!cur) {
      const first = products.length === 0;
      const ok = await add(next);
      if (ok && first) onFirstProduct?.();
      return ok;
    }
    // Send only what changed.
    const patch: Partial<typeof next> = {};
    if (next.name !== cur.name) patch.name = next.name;
    if (next.priceCents !== cur.priceCents) patch.priceCents = next.priceCents;
    if (next.description !== cur.description) patch.description = next.description;
    if (JSON.stringify(next.photos) !== JSON.stringify(cur.photos)) patch.photos = next.photos;
    if (next.soldOut !== cur.soldOut) patch.soldOut = next.soldOut;
    if (Object.keys(patch).length === 0) return true;
    return update(cur.id, patch);
  };

  const confirmRemove = (p: Product) =>
    Alert.alert(`Remove ${p.name}?`, 'It leaves your shop page right away. Past orders keep their details.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: () => {
          setForm(null);
          void remove(p.id);
        },
      },
    ]);

  const move = (i: number, dir: -1 | 1) =>
    setOrder((cur) => {
      if (!cur) return cur;
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const done = async () => {
    const ids = (order ?? []).map((p) => p.id);
    const changed = ids.some((id, i) => id !== products[i]?.id);
    if (changed) {
      // Keep the local order on screen until the write settles; a failure reloads the real one.
      const ok = await reorder(ids);
      if (!ok) await refresh();
    }
    setOrder(null);
  };

  if (loading) return <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />;

  if (failed && products.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Couldn't load your products</Text>
        <Button title="Try again" onPress={() => void refresh()} style={styles.emptyBtn} />
      </View>
    );
  }

  const formEl = (
    <ProductForm
      visible={!!form}
      shopId={shopId}
      product={form?.product ?? null}
      onClose={() => setForm(null)}
      onSubmit={submit}
      onDelete={form?.product ? () => confirmRemove(form.product!) : undefined}
    />
  );

  if (products.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle} accessibilityRole="header">
          {planLock ? 'Open your store with the Store plan' : locked ? 'No products yet' : 'Add your first product'}
        </Text>
        <Text style={styles.emptyBody}>
          {planLock
            ? 'Upgrade to Store to add products and reopen your shop page.'
            : locked
              ? 'Your subscription has ended. Products are read-only until you resubscribe.'
              : 'Pomade, beard oil, merch. Customers buy it right from your shop page.'}
        </Text>
        {planLock && onUpgrade && <Button title="Upgrade to Store" onPress={onUpgrade} />}
        {!locked && (
          <Pressable
            onPress={() => setForm({ product: null })}
            accessibilityRole="button"
            accessibilityLabel="Add product"
            style={({ pressed }) => [styles.bigPlus, pressed && { opacity: 0.85 }]}
          >
            <PlusIcon size={36} color={colors.accentInk} />
          </Pressable>
        )}
        {formEl}
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      {arranging && (
        <View style={styles.arrangeBar}>
          <Text style={styles.arrangeText}>Arrange: move products up or down</Text>
          <Pressable onPress={() => void done()} accessibilityRole="button" accessibilityLabel="Done" hitSlop={10}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      )}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.grid}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void pull()} tintColor={colors.accent} />}
      >
        {!locked && !arranging && (
          <Pressable
            onPress={() => setForm({ product: null })}
            accessibilityRole="button"
            accessibilityLabel="Add product"
            style={({ pressed }) => [styles.card, styles.plusCard, { width: cardW }, pressed && { opacity: 0.8 }]}
          >
            <PlusIcon size={32} color={colors.accent} />
            <Text style={styles.plusText}>Add product</Text>
          </Pressable>
        )}
        {shown.map((p, i) => (
          <View key={p.id} style={[styles.card, { width: cardW }]}>
            <Pressable
              onPress={() => !arranging && !locked && setForm({ product: p })}
              onLongPress={() => !locked && !arranging && products.length > 1 && setOrder(products)}
              accessibilityRole="button"
              accessibilityLabel={locked ? p.name : `Edit ${p.name}`}
            >
              {p.photos[0] ? (
                <Image source={{ uri: p.photos[0] }} style={{ width: cardW, height: cardW, backgroundColor: 'rgba(255,255,255,0.08)' }} />
              ) : (
                <View style={[styles.noPhoto, { width: cardW, height: cardW }]}>
                  <Text style={styles.noPhotoText}>{p.name.trim().charAt(0).toUpperCase()}</Text>
                </View>
              )}
              {p.soldOut && (
                <View style={[styles.veil, { height: cardW }]} pointerEvents="none"><Text style={styles.veilText}>Sold out</Text></View>
              )}
              <View style={styles.meta}>
                <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.price}>{formatPrice(p.priceCents)}</Text>
              </View>
            </Pressable>
            {arranging && (
              <View style={styles.arrows}>
                <Arrow label={`Move ${p.name} up`} glyph="↑" disabled={i === 0} onPress={() => move(i, -1)} />
                <Arrow label={`Move ${p.name} down`} glyph="↓" disabled={i === shown.length - 1} onPress={() => move(i, 1)} />
              </View>
            )}
          </View>
        ))}
      </ScrollView>
      {formEl}
    </View>
  );
}

function Arrow({ label, glyph, disabled, onPress }: { label: string; glyph: string; disabled?: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
      disabled={disabled} onPress={onPress} hitSlop={4} style={[styles.arrow, disabled && { opacity: 0.25 }]}
    >
      <Text style={styles.arrowText}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 40 },
  card: {
    borderRadius: 14, overflow: 'hidden', backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.hair,
  },
  plusCard: { alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 200, borderStyle: 'dashed', borderColor: 'rgba(244,161,0,0.5)' },
  plusText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.accent },
  noPhoto: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  noPhotoText: { fontFamily: fonts.heading, fontSize: 40, color: colors.faint },
  veil: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(13,13,13,0.62)' },
  veilText: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', color: colors.text },
  meta: { paddingHorizontal: 12, paddingVertical: 10 },
  name: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  price: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 2 },
  arrows: { flexDirection: 'row', justifyContent: 'center', borderTopWidth: 1, borderTopColor: colors.hair },
  arrow: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' },
  arrowText: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.accent },
  arrangeBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: PAD, paddingTop: 14,
  },
  arrangeText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.muted },
  doneText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.accent },
  empty: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 56 },
  emptyTitle: { fontFamily: fonts.heading, fontSize: 22, color: colors.heading, textAlign: 'center', marginBottom: 10 },
  emptyBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.muted, textAlign: 'center', marginBottom: 28 },
  emptyBtn: { alignSelf: 'stretch' },
  bigPlus: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
});
