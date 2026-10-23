import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { DURATIONS, SERVICE_LIBRARY, durationLabel } from '@/lib/sections/services';
import { centsToPrice } from '@/lib/setup/servicesMap';
import type { DepositType } from '@/lib/shop';
import type { ServicesEditor as Ed } from '@/components/setup/useServicesEditor';
import { Chip, Chips, Input, Label, Note, TextAction, ToggleRow, s } from '@/components/setup/ui';

const DEPOSITS: { key: DepositType; label: string }[] = [
  { key: 'none', label: 'No deposit' },
  { key: 'fixed', label: 'Fixed $' },
  { key: 'percent', label: 'Percent' },
];

/** The bookings-mode Services editor (list, add, form). State comes from useServicesEditor. */
export function ServicesEditorView({ ed }: { ed: Ed }) {
  const { view } = ed;
  if (ed.loading) return <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} />;

  if (view.kind === 'add') {
    return (
      <View>
        {SERVICE_LIBRARY.map((g) => (
          <View key={g.group} style={{ marginBottom: 14 }}>
            <Text style={s.label}>{g.group}</Text>
            <Chips>
              {g.items.map((it) => (
                <Chip key={it.title} label={it.title} onPress={() => void ed.addFromLibrary(it.title, it.duration)} />
              ))}
            </Chips>
          </View>
        ))}
        <Chip label="Add your own" onPress={ed.addOwn} />
        <TextAction title="Back" onPress={() => ed.setView({ kind: 'list' })} />
      </View>
    );
  }

  if (view.kind === 'form') {
    const d = view.draft;
    const existing = ed.services.find((x) => x.id === view.id);
    return (
      <View style={{ gap: 6 }}>
        <Input title="Name" label="Name" value={d.name} onChangeText={(t) => ed.setDraft({ name: t })} placeholder="e.g. Skin fade" autoFocus={view.id == null} />
        <Input title="Price" label="Price in dollars" value={d.price} onChangeText={(t) => ed.setDraft({ price: t })} keyboardType="decimal-pad" placeholder="30 (leave blank to ask)" />
        <Label>Length</Label>
        <Chips>
          {DURATIONS.map((m) => (
            <Chip key={m} label={durationLabel(m)} selected={d.durationMin === m} onPress={() => ed.setDraft({ durationMin: m })} />
          ))}
        </Chips>
        <Input title="Description (optional)" label="Description" value={d.description} onChangeText={(t) => ed.setDraft({ description: t })} multiline />
        <Label>Photo (optional)</Label>
        <View style={st.photoRow}>
          {!!d.photoUrl && <Image source={{ uri: d.photoUrl }} style={st.thumb} />}
          <TextAction title={d.photoUrl ? 'Change' : 'Add photo'} onPress={() => void ed.photo()} disabled={ed.uploading} />
          {ed.uploading && <ActivityIndicator color={colors.accent} />}
        </View>
        <ToggleRow label="Bookable" detail="Customers can book it online" value={d.bookable} onValueChange={(v) => ed.setDraft({ bookable: v })} />
        <ToggleRow label="Show on website" detail="Listed in your site's Services section" value={d.showOnSite} onValueChange={(v) => ed.setDraft({ showOnSite: v })} />
        <Label>Advanced: deposit</Label>
        <Chips>
          {DEPOSITS.map((x) => (
            <Chip key={x.key} label={x.label} selected={d.depositType === x.key} onPress={() => ed.setDraft({ depositType: x.key, deposit: '' })} />
          ))}
        </Chips>
        {d.depositType !== 'none' && (
          <Input
            label={d.depositType === 'fixed' ? 'Deposit in dollars' : 'Deposit percent'}
            value={d.deposit}
            onChangeText={(t) => ed.setDraft({ deposit: t })}
            keyboardType="decimal-pad"
            placeholder={d.depositType === 'fixed' ? '10' : '25'}
          />
        )}
        {d.depositType !== 'none' && <Note>Deposits are taken by card, so card payments must be connected.</Note>}
        <View style={st.actions}>
          <Button title="Save" size="sm" onPress={() => void ed.save()} loading={ed.busy} style={{ flex: 1 }} />
          {existing && <TextAction title="Remove" danger onPress={() => ed.remove(existing)} />}
          <TextAction title="Cancel" onPress={() => ed.setView({ kind: 'list' })} />
        </View>
      </View>
    );
  }

  return (
    <View>
      {ed.services.length === 0 && <Note>No services yet. Add the ones you offer.</Note>}
      {ed.services.map((sv, i) => (
        <View key={sv.id} style={st.row}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${sv.name}`} onPress={() => ed.openForm(sv)} style={st.rowMain}>
            <Text style={st.rowTitle} numberOfLines={1}>{sv.name}</Text>
            <Text style={st.rowMeta} numberOfLines={1}>
              {[sv.priceCents != null ? centsToPrice(sv.priceCents) : 'Ask for price', durationLabel(sv.durationMin), !sv.bookable ? 'Not bookable' : '', !sv.showOnSite ? 'Hidden on site' : '']
                .filter(Boolean).join('  ·  ')}
            </Text>
          </Pressable>
          <Move label={`Move ${sv.name} up`} glyph="↑" disabled={i === 0 || ed.busy} onPress={() => void ed.move(i, -1)} />
          <Move label={`Move ${sv.name} down`} glyph="↓" disabled={i === ed.services.length - 1 || ed.busy} onPress={() => void ed.move(i, 1)} />
        </View>
      ))}
      <Button title="Add a service" size="sm" onPress={() => ed.setView({ kind: 'add' })} style={{ marginTop: 8 }} />
    </View>
  );
}

function Move({ label, glyph, disabled, onPress }: { label: string; glyph: string; disabled?: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
      disabled={disabled} onPress={onPress} hitSlop={4} style={[st.move, disabled && { opacity: 0.25 }]}
    >
      <Text style={st.moveText}>{glyph}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  rowMain: { flex: 1, paddingHorizontal: 14, paddingVertical: 12 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: '#fff' },
  rowMeta: { fontFamily: fonts.body, fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  move: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  moveText: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.accent },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
});
