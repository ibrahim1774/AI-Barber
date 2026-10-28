import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/constants/theme';
import { ChevronLeftIcon } from '@/components/Icons';
import { CustomerRow } from '@/components/bookings/CustomerRow';
import { useCustomers } from '@/components/bookings/useCustomers';
import { filterCustomers, type CustomerSort } from '@/lib/bookings/customers';
import { goBackOrHome } from '@/lib/nav';
import { withPaymentGate } from '@/components/PaymentLock';

const SORTS: { value: CustomerSort; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'bookings', label: 'Most booked' },
  { value: 'name', label: 'A–Z' },
  { value: 'paid', label: 'Paid' },
];

/** Everyone who booked, derived from the shop's appointments. Read-only. */
function CustomersScreen() {
  const insets = useSafeAreaInsets();
  const { phase, shop, customers, refresh } = useCustomers();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CustomerSort>('recent');
  const [refreshing, setRefreshing] = useState(false);

  const anyPaid = customers.some((c) => c.paidCents > 0);
  const sorts = SORTS.filter((s) => s.value !== 'paid' || anyPaid);
  const activeSort = sorts.some((s) => s.value === sort) ? sort : 'recent';
  const shown = useMemo(() => filterCustomers(customers, query, activeSort), [customers, query, activeSort]);
  const tz = shop?.timezone ?? 'America/New_York';

  const pull = async () => {
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={goBackOrHome} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={styles.side}>
          <ChevronLeftIcon size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">Customers</Text>
        <View style={styles.side} />
      </View>

      {phase === 'loading' && <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />}

      {(phase === 'error' || phase === 'no-shop') && (
        <FlatList
          data={[]}
          renderItem={null}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pull()} tintColor={colors.accent} />}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {phase === 'error' ? "Couldn't load customers. Pull down to try again." : 'Set up Bookings to see your customers here.'}
            </Text>
          }
        />
      )}

      {phase === 'ready' && (
        <>
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
                {sorts.map((s) => {
                  const on = s.value === activeSort;
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
            renderItem={({ item }) => (
              <CustomerRow customer={item} tz={tz} onPress={() => router.push(`/customers/${item.id}` as never)} />
            )}
            contentContainerStyle={[styles.list, { paddingBottom: 32 + insets.bottom }]}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pull()} tintColor={colors.accent} />}
            ListEmptyComponent={
              customers.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyTitle}>No customers yet</Text>
                  <Text style={styles.empty}>People who book on your site show up here.</Text>
                </View>
              ) : (
                <Text style={styles.empty}>No one matches that search.</Text>
              )
            }
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14 },
  side: { width: 40, alignItems: 'flex-start', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.heading, fontSize: 22, color: colors.heading },
  search: {
    marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12,
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
  list: { paddingHorizontal: 16, paddingTop: 4 },
  emptyBox: { alignItems: 'center', marginTop: 48, gap: 8 },
  emptyTitle: { fontFamily: fonts.heading, fontSize: 20, color: colors.heading, textAlign: 'center' },
  empty: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.muted, textAlign: 'center', paddingHorizontal: 24, marginTop: 24 },
});

export default withPaymentGate(CustomersScreen, 'customers');
