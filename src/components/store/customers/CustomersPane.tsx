import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { StoreCustomerRow } from '@/components/store/customers/StoreCustomerRow';
import { useStoreCustomers } from '@/components/store/customers/useStoreCustomers';
import { filterStoreCustomers, type StoreCustomerSort } from '@/lib/store/customers';

const SORTS: { value: StoreCustomerSort; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'orders', label: 'Most orders' },
  { value: 'name', label: 'A–Z' },
  { value: 'spent', label: 'Spent' },
];

/** Everyone who ordered, derived from the shop's orders. Read-only. */
export function CustomersPane() {
  const { phase, customers, refresh } = useStoreCustomers();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<StoreCustomerSort>('recent');
  const [refreshing, setRefreshing] = useState(false);
  const shown = useMemo(() => filterStoreCustomers(customers, query, sort), [customers, query, sort]);

  const pull = async () => {
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  };
  const control = <RefreshControl refreshing={refreshing} onRefresh={() => void pull()} tintColor={colors.accent} />;

  if (phase === 'loading') return <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />;
  if (phase === 'error' || phase === 'no-shop') {
    return (
      <FlatList
        data={[]}
        renderItem={null}
        refreshControl={control}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {phase === 'error' ? "Couldn't load customers. Pull down to try again." : 'Set up your shop to see your customers here.'}
          </Text>
        }
      />
    );
  }
  return (
    <View style={styles.flex}>
      {customers.length > 0 && (
        <>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search name, phone or email"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Search customers"
            style={styles.search}
          />
          <View style={styles.seg} accessibilityRole="tablist">
            {SORTS.map((s) => {
              const on = s.value === sort;
              return (
                <Pressable
                  key={s.value}
                  onPress={() => setSort(s.value)}
                  accessibilityRole="tab"
                  accessibilityLabel={`Sort: ${s.label}`}
                  accessibilityState={{ selected: on }}
                  style={[styles.item, on && styles.itemOn]}
                >
                  <Text style={[styles.itemText, on && styles.itemTextOn]} numberOfLines={1}>{s.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
      <FlatList
        data={shown}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <StoreCustomerRow customer={item} onPress={() => router.push(`/store-customers/${item.id}` as never)} />}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={control}
        ListEmptyComponent={
          customers.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>No customers yet</Text>
              <Text style={styles.empty}>People who buy from your shop show up here.</Text>
            </View>
          ) : (
            <Text style={styles.empty}>No one matches that search.</Text>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  search: {
    marginHorizontal: 16, marginTop: 12, marginBottom: 12, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12,
    backgroundColor: colors.ghostBg, borderWidth: 1, borderColor: colors.hair, color: colors.text, fontFamily: fonts.body, fontSize: 15,
  },
  seg: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, padding: 3, borderRadius: 12, backgroundColor: colors.ghostBg,
    borderWidth: 1, borderColor: colors.hair,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 9 },
  itemOn: { backgroundColor: colors.accent },
  itemText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.muted },
  itemTextOn: { color: colors.accentInk },
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 },
  emptyBox: { alignItems: 'center', marginTop: 48, gap: 8 },
  emptyTitle: { fontFamily: fonts.heading, fontSize: 20, color: colors.heading, textAlign: 'center' },
  empty: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.muted, textAlign: 'center', paddingHorizontal: 24, marginTop: 24 },
});
