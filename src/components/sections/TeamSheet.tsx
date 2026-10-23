import { useEffect, useState, useRef } from 'react';
import { FormLabel } from '@/components/FormLabel';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { WebsiteData } from '@/web/types';
import { colors, fonts } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { Sheet, SheetAction } from '@/components/EditSheet';
import { addMember, moveMember, removeMember, updateMember } from '@/lib/sections/team';
import { usePhotoPick } from '@/components/sections/usePhotoPick';

interface Props {
  visible: boolean;
  data: WebsiteData;
  /** Applied to the editor's latest data, so it composes with concurrent changes. */
  onChange(update: (d: WebsiteData) => WebsiteData): void;
  onClose(): void;
  onDismiss?(): void;
  /** Picks and uploads one photo through the editor's upload guard; null if cancelled or dropped. */
  upload(onPicked?: () => void): Promise<string | null>;
  /** A barber who is also a booking member is managed on the Team screen (ab_members is their source of truth). */
  onOpenTeam?(): void;
}

/** null = the list; 'new' = adding; a number = editing that person. */
type Form = null | 'new' | number;

export function TeamSheet({ visible, data, onChange, onClose, onDismiss, upload, onOpenTeam }: Props) {
  const f1 = useRef<TextInput>(null);
  const f2 = useRef<TextInput>(null);
  const [form, setForm] = useState<Form>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [photo, setPhoto] = useState('');
  const [error, setError] = useState('');
  const staff = data.staff ?? [];

  useEffect(() => {
    if (visible) setForm(null);
  }, [visible]);

  const pick = usePhotoPick(upload, (url) => setPhoto(url));

  const open = (f: Form) => {
    const m = typeof f === 'number' ? staff[f] : undefined;
    setName(m?.name ?? '');
    setRole(m?.role ?? '');
    setPhoto(m?.photo ?? '');
    setError('');
    setForm(f);
  };
  const commit = (update: (d: WebsiteData) => WebsiteData) => {
    onChange(update);
    track('section_saved', { section: 'team' });
  };
  const save = () => {
    const input = { name, role, photo };
    const index = form as number;
    const update = (d: WebsiteData) => (form === 'new' ? addMember(d, input) : updateMember(d, index, input));
    if (update(data) === data) { setError('Add a name.'); return; }
    commit(update);
    setForm(null);
  };
  const remove = () => {
    const m = staff[form as number];
    Alert.alert(`Remove ${m?.name ?? 'this person'} from your site?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { commit((d) => removeMember(d, form as number)); setForm(null); } },
    ]);
  };

  const shown = visible && !pick.hidden;
  const dismiss = () => pick.onDismiss(onDismiss);

  if (form !== null) {
    return (
      <Sheet
        visible={shown}
        title={form === 'new' ? 'Add a person' : 'Edit person'}
        onClose={() => setForm(null)}
        onDismiss={dismiss}
        right={<SheetAction title="Save" primary onPress={save} />}
      >
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
          <Pressable accessibilityRole="button" accessibilityLabel={photo ? 'Change photo' : 'Add photo'} onPress={() => pick.start()} style={styles.photoWrap}>
            <View style={styles.circle}>
              {pick.busy ? <ActivityIndicator color={colors.accent} /> : photo ? <Image source={{ uri: photo }} style={styles.circleImg} /> : <Text style={styles.add}>+</Text>}
            </View>
            <Text style={styles.photoText}>{photo ? 'Change photo' : 'Add photo'}</Text>
          </Pressable>
          <FormLabel input={f1} style={styles.label}>Name</FormLabel>
          <TextInput ref={f1} value={name} onChangeText={(t) => { setError(''); setName(t); }} accessibilityLabel="Name" selectionColor={colors.accent} placeholderTextColor="rgba(255,255,255,0.3)" style={styles.input} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <FormLabel input={f2} style={styles.label}>Role</FormLabel>
          <TextInput ref={f2} value={role} onChangeText={setRole} placeholder="Barber, Owner…" accessibilityLabel="Role" selectionColor={colors.accent} placeholderTextColor="rgba(255,255,255,0.3)" style={styles.input} />
          {form !== 'new' ? <SheetAction title="Remove" onPress={remove} /> : null}
        </ScrollView>
      </Sheet>
    );
  }

  return (
    <Sheet visible={shown} title="Team" onClose={onClose} onDismiss={dismiss} right={<SheetAction title="Done" primary onPress={onClose} />}>
      {data.template && data.template !== 'luxe' ? (
        <Text style={styles.note}>Your team shows on Design 1. The design you're on doesn't have a team section yet.</Text>
      ) : null}
      <ScrollView style={styles.scroll}>
        {staff.map((m, i) => (
          <View key={i} style={styles.row}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${m.name}`} onPress={() => (m.memberId && onOpenTeam ? onOpenTeam() : open(i))} style={styles.person}>
              <View style={styles.thumb}>{m.photo ? <Image source={{ uri: m.photo }} style={styles.circleImg} /> : null}</View>
              <View style={styles.flex}>
                <Text style={styles.name} numberOfLines={1}>{m.name}</Text>
                {m.role ? <Text style={styles.roleText} numberOfLines={1}>{m.role}</Text> : null}
                {m.memberId ? <Text style={styles.roleText} numberOfLines={1}>On your booking page · edit in Team</Text> : null}
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Move ${m.name} up`} disabled={i === 0} onPress={() => commit((d) => moveMember(d, i, -1))} hitSlop={8} style={[styles.move, i === 0 && styles.off]}>
              <Text style={styles.moveText}>↑</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Move ${m.name} down`} disabled={i === staff.length - 1} onPress={() => commit((d) => moveMember(d, i, 1))} hitSlop={8} style={[styles.move, i === staff.length - 1 && styles.off]}>
              <Text style={styles.moveText}>↓</Text>
            </Pressable>
          </View>
        ))}
        {staff.length === 0 ? <Text style={styles.note}>No one added yet.</Text> : null}
        <SheetAction title="Add a person" onPress={() => open('new')} />
        {onOpenTeam ? <SheetAction title="Manage barbers and bookings" onPress={onOpenTeam} /> : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { maxHeight: 440 },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.6)', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  person: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' },
  name: { fontFamily: fonts.bodySemi, fontSize: 15, color: '#fff' },
  roleText: { fontFamily: fonts.body, fontSize: 13, color: 'rgba(255,255,255,0.55)' },
  move: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)' },
  moveText: { fontFamily: fonts.bodyBold, fontSize: 16, color: '#fff' },
  off: { opacity: 0.3 },
  photoWrap: { alignItems: 'center', gap: 8, paddingBottom: 6 },
  circle: { width: 84, height: 84, borderRadius: 42, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderStyle: 'dashed', backgroundColor: 'rgba(255,255,255,0.04)' },
  circleImg: { width: '100%', height: '100%' },
  add: { fontFamily: fonts.bodyBold, fontSize: 28, color: colors.accent },
  photoText: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.accent },
  label: { fontFamily: fonts.bodySemi, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', marginBottom: 6, marginTop: 8 },
  input: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: '#fff', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12 },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.danger, marginTop: 6 },
});
