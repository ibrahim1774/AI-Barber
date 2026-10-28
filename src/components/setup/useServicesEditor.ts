import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { addService, listServices, removeService, reorderServices, updateService, type Service, type Shop } from '@/lib/shop';
import { draftToPatch, emptyDraft, serviceToDraft, type ServiceDraft } from '@/lib/setup/serviceDraft';

export type ServicesView =
  | { kind: 'list' }
  | { kind: 'add' }
  | { kind: 'form'; id: string | null; draft: ServiceDraft };

export type ServicesEditor = ReturnType<typeof useServicesEditor>;

/**
 * State and actions for the bookings-mode Services editor. ab_services is the
 * source: every write reloads the list and reports it through `onServices`, which
 * mirrors the show-on-website ones into WebsiteData.services.
 */
export function useServicesEditor(
  shop: Shop,
  onServices: (services: Service[]) => void,
  pickPhoto: () => Promise<string | null>,
  variant: 'website' | 'booking' = 'booking',
) {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [view, setView] = useState<ServicesView>({ kind: 'list' });

  const refresh = useCallback(async (mirror: boolean) => {
    const list = await listServices(shop.id);
    setServices(list);
    if (mirror) onServices(list);
    return list;
  }, [shop.id, onServices]);

  useEffect(() => {
    let alive = true;
    listServices(shop.id)
      .then((l) => alive && setServices(l))
      .catch((e) => alive && Alert.alert("Couldn't load your services", e instanceof Error ? e.message : undefined))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [shop.id]);

  const guard = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert("Couldn't save that", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const openForm = (s: Service) => setView({ kind: 'form', id: s.id, draft: serviceToDraft(s) });
  const addOwn = () => setView({ kind: 'form', id: null, draft: emptyDraft('', 30) });
  const addFromLibrary = (title: string, durationMin: number) =>
    guard(async () => {
      const created = await addService(shop.id, { name: title, durationMin, sort: services.length });
      const list = await refresh(true);
      const s = list.find((x) => x.id === created.id) ?? created;
      setView({ kind: 'form', id: s.id, draft: serviceToDraft(s) });
    });

  const setDraft = (patch: Partial<ServiceDraft>) =>
    setView((v) => (v.kind === 'form' ? { ...v, draft: { ...v.draft, ...patch } } : v));

  const save = () =>
    guard(async () => {
      if (view.kind !== 'form') return;
      const r = draftToPatch(view.draft, variant === 'website' ? { website: true, existing: services.find((x) => x.id === view.id) } : undefined);
      if (!r.ok) {
        Alert.alert(r.message);
        return;
      }
      if (view.id) await updateService(view.id, r.patch);
      else await addService(shop.id, { name: r.patch.name!, durationMin: r.patch.durationMin!, ...r.patch, sort: services.length });
      await refresh(true);
      setView({ kind: 'list' });
    });

  const remove = (s: Service) =>
    Alert.alert(`Remove ${s.name}?`, 'It leaves your website on the next publish and your booking page right away. Past bookings keep their details.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: () => void guard(async () => {
          await removeService(s.id);
          await refresh(true);
          setView({ kind: 'list' });
        }),
      },
    ]);

  const move = (i: number, dir: -1 | 1) =>
    guard(async () => {
      const j = i + dir;
      if (j < 0 || j >= services.length) return;
      const ids = services.map((x) => x.id);
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await reorderServices(ids);
      await refresh(true);
    });

  const photo = async () => {
    if (view.kind !== 'form') return;
    try {
      setUploading(true);
      const url = await pickPhoto();
      if (url) setDraft({ photoUrl: url });
    } catch {
      Alert.alert("Couldn't upload that photo. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  const reload = () => void refresh(false).catch(() => {});

  // Deposits are taken by card only. Same flag Get paid reads; the server also treats the deposit as 0 while card is off.
  const cardReady = shop.stripeConnected && shop.stripeChargesEnabled;

  return { variant, cardReady, reload, services, loading, busy, uploading, view, setView, openForm, addOwn, addFromLibrary, setDraft, save, remove, move, photo };
}
