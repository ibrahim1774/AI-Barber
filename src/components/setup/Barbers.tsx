import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { pickAndUploadPhoto } from '@/lib/photos';
import { weekToRows, defaultWeek } from '@/lib/setup/availability';
import {
  addMember, countUpcoming, getMemberServiceIds, listMembers, listServices, removeMember, saveAvailability,
  setMemberServiceIds, updateMember, type Member, type Service, type Shop,
} from '@/lib/shop';
import { MemberHours } from '@/components/setup/HoursGrid';
import { Card, Chip, Chips, Input, Label, Note, TextAction } from '@/components/setup/ui';

type View_ = { kind: 'list' } | { kind: 'form'; member: Member | null };

/** Add, edit and remove barbers: photo, bio, their own hours, which services they do. */
export function Barbers({ shop, uploadFolder, onChanged }: { shop: Shop; uploadFolder: string; onChanged?(): void }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [view, setView] = useState<View_>({ kind: 'list' });

  const reload = useCallback(async () => {
    try {
      setMembers(await listMembers(shop.id));
    } catch (e) {
      setMembers([]);
      Alert.alert("Couldn't load your team", e instanceof Error ? e.message : undefined);
    }
  }, [shop.id]);
  useEffect(() => { void reload(); }, [reload]);

  if (!members) return <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} />;

  if (view.kind === 'form') {
    return (
      <BarberForm
        shop={shop}
        uploadFolder={uploadFolder}
        member={view.member}
        onDone={async () => { setView({ kind: 'list' }); await reload(); onChanged?.(); }}
        onCancel={() => setView({ kind: 'list' })}
        onSaved={async (m) => { await reload(); setView({ kind: 'form', member: m }); onChanged?.(); }}
      />
    );
  }

  return (
    <View>
      {members.map((m) => (
        <View key={m.id} style={st.row}>
          <Avatar url={m.photoUrl} name={m.name} />
          <View style={{ flex: 1 }}>
            <Text style={st.name}>{m.name}</Text>
            <Text style={st.meta}>{m.role === 'owner' ? 'You' : 'Barber'}</Text>
          </View>
          <TextAction title="Edit" onPress={() => setView({ kind: 'form', member: m })} />
        </View>
      ))}
      <Button title="Add a barber" size="sm" onPress={() => setView({ kind: 'form', member: null })} style={{ marginTop: 8 }} />
      <Note>Each barber has their own hours, services and calendar. Customers can pick a barber or "Any".</Note>
    </View>
  );
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  return url ? (
    <Image source={{ uri: url }} style={st.avatar} />
  ) : (
    <View style={[st.avatar, st.avatarEmpty]}><Text style={st.initial}>{name.trim().charAt(0).toUpperCase() || '?'}</Text></View>
  );
}

function BarberForm({
  shop, uploadFolder, member, onDone, onCancel, onSaved,
}: {
  shop: Shop; uploadFolder: string; member: Member | null;
  onDone(): void; onCancel(): void; onSaved(m: Member): void;
}) {
  const [name, setName] = useState(member?.name ?? '');
  const [bio, setBio] = useState(member?.bio ?? '');
  const [photo, setPhoto] = useState<string | null>(member?.photoUrl ?? null);
  const [services, setServices] = useState<Service[]>([]);
  const [selected, setSelected] = useState<string[] | null>(null); // null = all
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let alive = true;
    listServices(shop.id).then((l) => alive && setServices(l)).catch(() => {});
    if (member) getMemberServiceIds(member.id).then((ids) => alive && setSelected(ids)).catch(() => {});
    return () => { alive = false; };
  }, [shop.id, member]);

  const toggle = (id: string) => {
    const cur = selected ?? services.map((x) => x.id);
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    setSelected(next.length === services.length ? null : next);
  };

  const pick = async () => {
    try {
      setUploading(true);
      const url = await pickAndUploadPhoto(uploadFolder);
      if (url) setPhoto(url);
    } catch {
      Alert.alert("Couldn't upload that photo. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const clean = name.trim();
    if (!clean) return Alert.alert('Give this barber a name.');
    if (selected && selected.length === 0) return Alert.alert('Pick at least one service, or choose All services.');
    setBusy(true);
    try {
      let m = member;
      if (m) {
        await updateMember(m.id, { name: clean, bio: bio.trim(), photoUrl: photo });
      } else {
        m = await addMember(shop.id, { name: clean, bio: bio.trim(), photoUrl: photo });
        await saveAvailability(m.id, weekToRows(defaultWeek()));
      }
      await setMemberServiceIds(m.id, selected);
      onSaved({ ...m, name: clean, bio: bio.trim(), photoUrl: photo });
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!member) return;
    try {
      const upcoming = await countUpcoming(member.id);
      if (upcoming > 0) {
        Alert.alert(
          `${member.name} has ${upcoming} upcoming booking${upcoming === 1 ? '' : 's'}`,
          'Cancel or move them in the Bookings tab first, then remove this barber.',
        );
        return;
      }
      Alert.alert(`Remove ${member.name}?`, 'They stop appearing on your booking page. Past bookings keep their details.', [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: () => removeMember(member.id).then(onDone).catch((e) => Alert.alert("Couldn't remove", e?.message)),
        },
      ]);
    } catch (e) {
      Alert.alert("Couldn't check bookings", e instanceof Error ? e.message : 'Try again.');
    }
  };

  const isOwner = member?.role === 'owner';
  return (
    <View>
      <Card title={member ? (isOwner ? 'You' : 'Edit barber') : 'New barber'}>
        <View style={st.photoRow}>
          <Avatar url={photo} name={name} />
          <TextAction title={photo ? 'Change photo' : 'Add photo'} onPress={() => void pick()} disabled={uploading} />
          {uploading && <ActivityIndicator color={colors.accent} />}
        </View>
        <Label>Name</Label>
        <Input label="Name" value={name} onChangeText={setName} placeholder="e.g. Mike" />
        <Label>Short bio (optional)</Label>
        <Input label="Bio" value={bio} onChangeText={setBio} multiline />
        <Label>Services they do</Label>
        <Chips>
          <Chip label="All services" selected={selected === null} onPress={() => setSelected(null)} />
          {services.map((sv) => (
            <Chip key={sv.id} label={sv.name} selected={selected !== null && selected.includes(sv.id)} onPress={() => toggle(sv.id)} />
          ))}
        </Chips>
        <Button title={member ? 'Save' : 'Add barber'} size="sm" onPress={() => void save()} loading={busy} style={{ marginTop: 8 }} />
      </Card>
      {member && (
        <Card title={`${isOwner ? 'Your' : `${member.name}'s`} hours`}>
          <MemberHours memberId={member.id} />
        </Card>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <TextAction title="Back" onPress={member ? onDone : onCancel} />
        {member && !isOwner && <TextAction title="Remove barber" danger onPress={() => void remove()} />}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 8, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)' },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: fonts.heading, fontSize: 18, color: colors.accent },
  name: { fontFamily: fonts.bodyBold, fontSize: 15, color: '#fff' },
  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
