import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { photoFailMessage, pickAndUploadPhoto } from '@/lib/photos';
import {
  getMemberServiceIds, listMembers, listServices, type Member, type Service, type Shop,
} from '@/lib/shop';
import { loadSite } from '@/lib/siteStore';
import { memberProfileLive, refreshSavedTeam, removeTeamMember, saveTeamMember } from '@/lib/team';
import { useTeamLimits } from '@/lib/useTeamLimits';
import { MemberHours } from '@/components/setup/HoursGrid';
import { Card, Chip, Chips, Input, Label, Note, TextAction } from '@/components/setup/ui';

type View_ = { kind: 'list' } | { kind: 'form'; member: Member | null };

/** Add, edit and remove barbers: photo, bio, their own hours, which services they do. */
export function Barbers({ shop, uploadFolder, onChanged }: { shop: Shop; uploadFolder: string; onChanged?(): void }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [view, setView] = useState<View_>({ kind: 'list' });
  const limits = useTeamLimits();

  const reload = useCallback(async () => {
    try {
      setMembers(await listMembers(shop.id));
    } catch (e) {
      setMembers([]);
      Alert.alert("Couldn't load your team", e instanceof Error ? e.message : undefined);
    }
  }, [shop.id]);
  useEffect(() => { void reload(); }, [reload]);
  // The site's team cards follow ab_members: refresh them whenever this list opens.
  useEffect(() => { void refreshSavedTeam(shop); }, [shop]);

  if (!members) return <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} />;

  if (view.kind === 'form') {
    return (
      <BarberForm
        shop={shop}
        uploadFolder={uploadFolder}
        member={view.member}
        onAddError={limits.handleAddError}
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
      <Button
        title="Add a barber" size="sm" loading={limits.busy} style={{ marginTop: 8 }}
        onPress={() => { if (limits.canAdd(members.length)) setView({ kind: 'form', member: null }); }}
      />
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
  shop, uploadFolder, member, onDone, onCancel, onSaved, onAddError,
}: {
  shop: Shop; uploadFolder: string; member: Member | null;
  onDone(): void; onCancel(): void; onSaved(m: Member): void; onAddError(e: unknown): boolean;
}) {
  const [name, setName] = useState(member?.name ?? '');
  const [title, setTitle] = useState(member?.title ?? '');
  const [link, setLink] = useState(member?.bookingUrl ?? '');
  const [profileLive, setProfileLive] = useState(false);
  // A member created by an earlier attempt of this save: a retry updates it, never adds a second one.
  const created = useRef<Member | null>(null);
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
    memberProfileLive().then((live) => alive && setProfileLive(live)).catch(() => {});
    // Before migration 015 the role and link of a barber live in the site's team entry.
    if (member) {
      loadSite().then((rec) => {
        const e = rec?.data.staff?.find((x) => x?.memberId === member.id);
        if (!alive || !e) return;
        setTitle((t) => t || e.role || '');
        setLink((l) => l || e.bookingUrl || '');
      }).catch(() => {});
    }
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
    } catch (e) {
      Alert.alert(photoFailMessage(e, "Couldn't upload that photo. Check your connection and try again."));
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
      const r = await saveTeamMember({
        shop, profileLive, member: member ?? created.current,
        draft: { name: clean, title, photo, bio, bookingUrl: link, serviceIds: selected, week: null },
        services,
        onCreated: (m) => { created.current = m; },
      });
      onSaved(r.member!);
    } catch (e) {
      if (onAddError(e)) return onCancel();
      Alert.alert("Couldn't save", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!member) return;
    try {
      const r = await removeTeamMember({ shop, member });
      if (r.kind === 'has-bookings') {
        Alert.alert(
          `${member.name} has ${r.count} upcoming booking${r.count === 1 ? '' : 's'}`,
          'Cancel or move them in the Bookings tab first, then remove this barber.',
        );
        return;
      }
      onDone();
    } catch (e) {
      Alert.alert("Couldn't remove", e instanceof Error ? e.message : 'Try again.');
    }
  };

  const confirmRemove = () => {
    if (!member) return;
    Alert.alert(`Remove ${member.name}?`, 'They stop appearing on your booking page and your website. Past bookings keep their details.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void remove() },
    ]);
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
        <Input title="Name" label="Name" value={name} onChangeText={setName} placeholder="e.g. Mike" />
        <Input title="Role" label="Role" value={title} onChangeText={setTitle} placeholder="Barber, Owner and master barber…" maxLength={80} />
        <Input title="Short bio (optional)" label="Bio" value={bio} onChangeText={setBio} multiline />
        <Input
          title="Booking link (optional)" label="Booking link" value={link} onChangeText={setLink}
          placeholder="https://" autoCapitalize="none" autoCorrect={false} keyboardType="url"
        />
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
        {member && !isOwner && <TextAction title="Remove barber" danger onPress={confirmRemove} />}
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
