import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { MiniWeek } from '@/components/team/BarberSheet';
import { initialOf, type TeamCard } from '@/lib/team';

const GAP = 12;
const SIDE = 20;

/** Horizontal swipeable barber cards: photo, name, role, 7-dot mini-week, service chips. The last card adds a barber. */
export function TeamCards({
  cards, canManageBookings, onEdit, onAdd, onAddToBookings,
}: {
  cards: TeamCard[];
  /** There is a shop: website-only cards can be promoted with "Add to bookings". */
  canManageBookings: boolean;
  onEdit(c: TeamCard): void;
  onAdd(): void;
  onAddToBookings(c: TeamCard): void;
}) {
  const { width } = useWindowDimensions();
  const w = Math.min(300, width - 2 * SIDE - 28); // leaves a peek of the next card, so it reads as swipeable
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={w + GAP}
      decelerationRate="fast"
      contentContainerStyle={{ paddingHorizontal: SIDE, gap: GAP }}
      style={{ marginHorizontal: -SIDE - 0 }}
      accessibilityLabel="Your barbers"
    >
      {cards.map((c) => (
        <View key={c.key} style={[st.card, { width: w }]} accessibilityLabel={`${c.name}, ${c.title}`}>
          <View style={st.top}>
            {c.photo ? <Image source={{ uri: c.photo }} style={st.avatar} /> : (
              <View style={[st.avatar, st.avatarEmpty]}><Text style={st.initial}>{initialOf(c.name)}</Text></View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={st.name} numberOfLines={1}>{c.name}</Text>
              <Text style={st.title} numberOfLines={1}>{c.title}</Text>
              {c.kind === 'site' && <Text style={st.tag}>Website only</Text>}
            </View>
          </View>
          <MiniWeek days={c.days} />
          <View style={st.chips}>
            {c.chips.map((n) => (
              <View key={n} style={st.chip}><Text style={st.chipText} numberOfLines={1}>{n}</Text></View>
            ))}
            {c.more > 0 && <View style={st.chip}><Text style={st.chipText}>{`+${c.more}`}</Text></View>}
            {c.chips.length === 0 && <Text style={st.none}>No services listed</Text>}
          </View>
          <View style={st.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${c.name}`} onPress={() => onEdit(c)} hitSlop={6} style={st.edit}>
              <Text style={st.editText}>{c.isOwner ? 'Edit my profile' : 'Edit'}</Text>
            </Pressable>
            {c.kind === 'site' && canManageBookings && (
              <Pressable accessibilityRole="button" accessibilityLabel={`Add ${c.name} to bookings`} onPress={() => onAddToBookings(c)} hitSlop={6} style={st.edit}>
                <Text style={st.editText}>Add to bookings</Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}
      <Pressable
        accessibilityRole="button" accessibilityLabel="Add a barber card" onPress={onAdd}
        style={[st.card, st.addCard, { width: Math.min(w, 220) }]}
      >
        <Text style={st.addPlus}>+</Text>
        <Text style={st.addText}>Add a barber</Text>
      </Pressable>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  card: {
    borderRadius: 16, borderWidth: 1, borderColor: colors.hair, backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 16, gap: 14, justifyContent: 'space-between',
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.1)' },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: fonts.heading, fontSize: 28, color: colors.accent },
  name: { fontFamily: fonts.heading, fontSize: 20, color: colors.heading },
  title: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  tag: { fontFamily: fonts.bodySemi, fontSize: 11, letterSpacing: 0.6, color: colors.overlayGold, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, minHeight: 28 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', maxWidth: '100%' },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.chipText },
  none: { fontFamily: fonts.body, fontSize: 12, color: colors.faint },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  edit: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.ghostBorder },
  editText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.text },
  addCard: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.22)', gap: 6 },
  addPlus: { fontFamily: fonts.heading, fontSize: 34, color: colors.accent },
  addText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.text },
});
