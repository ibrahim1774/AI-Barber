import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Sheet } from '@/components/EditSheet';
import { Button } from '@/components/Button';
import { HoursGrid } from '@/components/setup/HoursGrid';
import { Chip, Chips, Input, Label, Note, TextAction, ToggleRow } from '@/components/setup/ui';
import { defaultWeek, type DayHours } from '@/lib/setup/availability';
import { photoFailMessage, pickAndUploadPhoto } from '@/lib/photos';
import type { Member, Service, Shop } from '@/lib/shop';
import {
  initialOf, openDays, removeTeamMember, saveTeamMember, type MemberDraft, type TeamCard,
} from '@/lib/team';

type Props = {
  visible: boolean;
  /** null = a new barber */
  card: TeamCard | null;
  shop: Shop | null;
  services: Service[];
  /** The shop's weekly hours: the default a new barber copies. */
  shopHours: DayHours[];
  profileLive: boolean;
  uploadFolder: string;
  onClose(): void;
  /** Saved or removed: the caller reloads. */
  onChanged(): void;
  /** A failed add: true when it was a limit / plan error and has been shown (the sheet then closes). */
  onAddError(e: unknown): boolean;
};

const sameWeek = (a: DayHours[], b: DayHours[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * "Add a barber" and edit, one sheet in three steps: (1) photo, name, role; (2) services they do and weekly
 * hours (copied from the shop by default, per-day toggles); (3) about and an optional booking link. Without a
 * shop there is no step 2 (services and hours are booking data). Saves through saveTeamMember, the same
 * function Setup > Barbers uses.
 */
export function BarberSheet({ visible, card, shop, services, shopHours, profileLive, uploadFolder, onClose, onChanged, onAddError }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [link, setLink] = useState('');
  const [selected, setSelected] = useState<string[] | null>(null);
  const [same, setSame] = useState(true);
  const [week, setWeek] = useState<DayHours[]>(shopHours);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  // A member created by an earlier attempt of this same save: a retry updates it instead of adding another.
  const created = useRef<Member | null>(null);

  const editingMember = card?.kind === 'member' ? card.view!.member : null;
  // A website-only entry (scraped, legacy, or no shop) is saved to the site only, never as a booking member.
  const bookingMode = !!shop && (card === null || card.kind === 'member');
  const steps = bookingMode ? [0, 1, 2] : [0, 2];
  const isOwner = !!card?.isOwner;

  useEffect(() => {
    if (!visible) return;
    created.current = null;
    setStep(0);
    setError('');
    setBusy(false);
    const m = card?.view?.member;
    setName(card?.name ?? '');
    setTitle((profileLive ? m?.title : null) ?? card?.entry?.role ?? m?.title ?? '');
    setPhoto(card?.photo ?? null);
    setBio(m?.bio ?? card?.entry?.bio ?? '');
    setLink((profileLive ? m?.bookingUrl : null) ?? card?.entry?.bookingUrl ?? '');
    setSelected(card?.view ? card.view.serviceIds : null);
    const w = card?.view ? card.view.week : shopHours;
    setWeek(w);
    setSame(!card?.view || sameWeek(card.view.week, shopHours));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, card]);

  const pos = steps.indexOf(step);
  const last = pos === steps.length - 1;

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
      setError(photoFailMessage(e, "Couldn't upload that photo. Check your connection and try again."));
    } finally {
      setUploading(false);
    }
  };

  const next = () => {
    if (step === 0 && !name.trim()) { setError('Give this barber a name.'); return; }
    if (step === 1 && selected && selected.length === 0) { setError('Pick at least one service, or choose All services.'); return; }
    setError('');
    setStep(steps[pos + 1]);
  };

  const save = async () => {
    if (!name.trim()) { setStep(0); setError('Give this barber a name.'); return; }
    if (bookingMode && selected && selected.length === 0) { setStep(1); setError('Pick at least one service, or choose All services.'); return; }
    const draft: MemberDraft = {
      name, title, photo, bio, bookingUrl: link, serviceIds: bookingMode ? selected : null,
      week: bookingMode ? (same ? shopHours : week) : null,
    };
    setBusy(true);
    setError('');
    try {
      await saveTeamMember({
        shop: bookingMode ? shop : null,
        profileLive,
        member: editingMember ?? created.current,
        siteIndex: card?.siteIndex ?? null,
        draft,
        services,
        onCreated: (m) => { created.current = m; },
      });
      onChanged();
      onClose();
    } catch (e) {
      if (onAddError(e)) { onClose(); return; }
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!card) return;
    try {
      const r = await removeTeamMember({ shop, member: editingMember, siteIndex: card.siteIndex });
      if (r.kind === 'has-bookings') {
        Alert.alert(
          `${card.name} has ${r.count} upcoming booking${r.count === 1 ? '' : 's'}`,
          'Cancel them, or move them to another barber, in the Bookings tab first. Then you can remove this barber.',
          [{ text: 'OK', style: 'cancel' }, { text: 'Open Bookings', onPress: () => { onClose(); router.navigate('/(tabs)/bookings'); } }],
        );
        return;
      }
      onChanged();
      onClose();
    } catch (e) {
      Alert.alert("Couldn't remove", e instanceof Error ? e.message : 'Try again.');
    }
  };

  const confirmRemove = () => {
    if (!card) return;
    Alert.alert(
      `Remove ${card.name}?`,
      card.kind === 'member'
        ? 'They stop appearing on your booking page and your website. Past bookings keep their details.'
        : 'They are removed from your website.',
      [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void remove() }],
    );
  };

  return (
    <Sheet
      visible={visible}
      title={card ? (isOwner ? 'You' : 'Edit barber') : 'Add a barber'}
      onClose={onClose}
      right={<Text style={st.stepText} accessibilityLabel={`Step ${pos + 1} of ${steps.length}`}>{`${pos + 1} of ${steps.length}`}</Text>}
    >
      <ScrollView keyboardShouldPersistTaps="handled" style={st.scroll} contentContainerStyle={st.body}>
        {step === 0 && (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel={photo ? 'Change photo' : 'Add photo'} onPress={() => void pick()} style={st.photoWrap}>
              <View style={st.circle}>
                {uploading ? <ActivityIndicator color={colors.accent} /> : photo ? <Image source={{ uri: photo }} style={st.circleImg} /> : (
                  <Text style={st.plus}>{name.trim() ? initialOf(name) : '+'}</Text>
                )}
              </View>
              <Text style={st.photoText}>{photo ? 'Change photo' : 'Add photo'}</Text>
            </Pressable>
            <Input title="Name" label="Name" value={name} onChangeText={(t) => { setError(''); setName(t); }} placeholder="e.g. Sam Fade" autoCapitalize="words" maxLength={80} />
            <Input title="Role" label="Role" value={title} onChangeText={setTitle} placeholder="Barber, Owner and master barber…" maxLength={80} />
          </>
        )}
        {step === 1 && (
          <>
            <Label>Services they do</Label>
            {services.length === 0 ? (
              <Note>Add your services in Bookings setup first. Until then this barber does everything you offer.</Note>
            ) : (
              <Chips>
                <Chip label="All services" selected={selected === null} onPress={() => { setError(''); setSelected(null); }} />
                {services.map((sv) => (
                  <Chip key={sv.id} label={sv.name} selected={selected !== null && selected.includes(sv.id)} onPress={() => { setError(''); toggle(sv.id); }} />
                ))}
              </Chips>
            )}
            <Label>Weekly hours</Label>
            <ToggleRow
              label="Same hours as the shop"
              detail={same ? 'Switch off to set this barber\'s own days and times.' : undefined}
              value={same}
              onValueChange={setSame}
            />
            {same ? <MiniWeek days={openDays(shopHours)} /> : <HoursGrid week={week} onChange={setWeek} />}
          </>
        )}
        {step === 2 && (
          <>
            <Input title="About (optional)" label="About" value={bio} onChangeText={setBio} multiline placeholder="A line or two about this barber" maxLength={600} />
            <Input
              title="Booking link (optional)" label="Booking link" value={link} onChangeText={(t) => { setError(''); setLink(t); }}
              placeholder="https://" autoCapitalize="none" autoCorrect={false} keyboardType="url"
            />
            <Note>Customers who tap "Book with" this barber go to this link. Leave it empty to use your booking page.</Note>
            {card && !isOwner && <TextAction title="Remove barber" danger onPress={confirmRemove} />}
          </>
        )}
        {!!error && <Note tone="error">{error}</Note>}
      </ScrollView>
      <View style={st.footer}>
        {pos > 0 ? <TextAction title="Back" onPress={() => { setError(''); setStep(steps[pos - 1]); }} /> : <TextAction title="Cancel" onPress={onClose} />}
        <Button
          title={last ? (card ? 'Save' : 'Add barber') : 'Next'}
          size="sm"
          onPress={last ? () => void save() : next}
          loading={busy}
          style={{ minWidth: 170 }}
        />
      </View>
    </Sheet>
  );
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Seven dots, Monday first: filled on the days someone works. */
export function MiniWeek({ days, compact }: { days: boolean[]; compact?: boolean }) {
  const open = days.filter(Boolean).length;
  return (
    <View
      style={[st.week, compact && { gap: 5 }]}
      accessible
      accessibilityLabel={open === 0 ? 'No days set' : `Works ${open} ${open === 1 ? 'day' : 'days'} a week`}
    >
      {days.map((on, i) => (
        <View key={i} style={st.dayCol}>
          <View style={[st.dot, on && st.dotOn]} />
          <Text style={[st.dayLetter, on && { color: colors.text }]}>{DAY_LETTERS[i]}</Text>
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  scroll: { maxHeight: 420 },
  body: { gap: 12, paddingBottom: 8 },
  stepText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.muted },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10 },
  photoWrap: { alignItems: 'center', gap: 8, paddingBottom: 4 },
  circle: {
    width: 92, height: 92, borderRadius: 46, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderStyle: 'dashed', backgroundColor: 'rgba(255,255,255,0.04)',
  },
  circleImg: { width: '100%', height: '100%' },
  plus: { fontFamily: fonts.heading, fontSize: 32, color: colors.accent },
  photoText: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.accent },
  week: { flexDirection: 'row', gap: 8 },
  dayCol: { alignItems: 'center', gap: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.12)' },
  dotOn: { backgroundColor: colors.accent },
  dayLetter: { fontFamily: fonts.bodySemi, fontSize: 10, color: colors.faint },
});
