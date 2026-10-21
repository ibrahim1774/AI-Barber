import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Page } from '@/components/Page';
import { Barbers } from '@/components/setup/Barbers';
import { BookingRules } from '@/components/setup/BookingRules';
import { GetPaid } from '@/components/setup/GetPaid';
import { MemberHours } from '@/components/setup/HoursGrid';
import { ServicesEditorView } from '@/components/setup/ServicesEditor';
import { SetupHub, type HubTarget } from '@/components/setup/SetupHub';
import { Wizard } from '@/components/setup/Wizard';
import { useServicesEditor } from '@/components/setup/useServicesEditor';
import { Note } from '@/components/setup/ui';
import { track } from '@/lib/analytics';
import { syncIfSignedIn } from '@/lib/account';
import { useSession } from '@/lib/auth';
import { goBackOrHome } from '@/lib/nav';
import { pickAndUploadPhoto } from '@/lib/photos';
import { buildSetupBody, shopSetup } from '@/lib/setup/ownerApi';
import { setPostAuthReturn } from '@/lib/setup/gate';
import { withMirroredServices } from '@/lib/setup/servicesMap';
import { updateSiteData } from '@/lib/setup/siteSync';
import { wizardDone } from '@/lib/setup/wizardFlag';
import { listMembers, loadMyShop, type Member, type Service, type Shop } from '@/lib/shop';
import { loadSite, type SiteRecord } from '@/lib/siteStore';

type Phase =
  | { kind: 'loading' }
  | { kind: 'gate' }
  | { kind: 'nosite' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; shop: Shop; site: SiteRecord; wizard: boolean };

type Sub = 'hub' | HubTarget;
const TITLES: Record<Sub, string> = {
  hub: 'Bookings setup', services: 'Services', barbers: 'Barbers', hours: 'Hours', rules: 'Booking rules', pay: 'Get paid',
};

/**
 * Account gate first (Bookings need a free account), then POST /api/shop/setup, then the
 * first-run wizard (once) or the setup hub.
 */
export default function BookingsSetup() {
  const { session, ready } = useSession();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [sub, setSub] = useState<Sub>('hub');
  const signedIn = !!session;

  const load = useCallback(async () => {
    try {
      const site = await loadSite();
      if (!site) return setPhase({ kind: 'nosite' });
      let shop = await loadMyShop();
      if (!shop) {
        // Make sure the account has the site row first (the server picks the slug from it).
        await syncIfSignedIn(site);
        await shopSetup(buildSetupBody(site));
        track('bookings_shop_created');
        shop = await loadMyShop();
      }
      if (!shop) return setPhase({ kind: 'error', message: "We couldn't create your booking page. Try again." });
      setPhase({ kind: 'ready', shop, site, wizard: !(await wizardDone(shop.id)) });
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong. Try again.' });
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!signedIn) {
      setPhase({ kind: 'gate' });
      return;
    }
    setPostAuthReturn(null);
    setPhase({ kind: 'loading' });
    void load();
  }, [ready, signedIn, load]);

  // Leaving the gate without signing in must not send a later sign-in back here.
  useEffect(() => () => setPostAuthReturn(null), []);

  const reloadShop = useCallback(async () => {
    try {
      const shop = await loadMyShop();
      setPhase((p) => (p.kind === 'ready' && shop ? { ...p, shop } : p));
    } catch {
      // keep the shop we have
    }
  }, []);

  const goGate = (to: '/sign-up' | '/sign-in') => {
    setPostAuthReturn('/bookings-setup');
    router.push(to);
  };

  const back = sub !== 'hub' && phase.kind === 'ready' && !phase.wizard ? () => setSub('hub') : goBackOrHome;

  return (
    <Page title={phase.kind === 'ready' && phase.wizard ? 'Set up bookings' : TITLES[sub]} onBack={back}>
      {phase.kind === 'loading' && <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />}
      {phase.kind === 'gate' && (
        <View style={st.center}>
          <Text style={st.h}>Create a free account to take bookings</Text>
          <Text style={st.p}>
            Your account keeps your bookings, barbers and payments safe, and gets them back on a new phone. Your website
            stays as it is.
          </Text>
          <Button title="Create account" onPress={() => goGate('/sign-up')} />
          <Button variant="ghost" title="I already have an account" onPress={() => goGate('/sign-in')} />
        </View>
      )}
      {phase.kind === 'nosite' && (
        <View style={st.center}>
          <Text style={st.h}>Build your website first</Text>
          <Text style={st.p}>Your booking page uses your shop's name, services and look.</Text>
          <Button title="Build my website" onPress={() => router.replace('/start')} />
        </View>
      )}
      {phase.kind === 'error' && (
        <View style={st.center}>
          <Text style={st.p}>{phase.message}</Text>
          <Button title="Try again" onPress={() => { setPhase({ kind: 'loading' }); void load(); }} />
        </View>
      )}
      {phase.kind === 'ready' && phase.wizard && (
        <Wizard
          shop={phase.shop}
          site={phase.site}
          onShopChanged={reloadShop}
          onFinish={() => { setSub('hub'); setPhase({ ...phase, wizard: false }); void reloadShop(); }}
        />
      )}
      {phase.kind === 'ready' && !phase.wizard && (
        <SubView
          sub={sub}
          shop={phase.shop}
          site={phase.site}
          onOpen={setSub}
          onShopChanged={reloadShop}
          onSiteChanged={(site) => setPhase((p) => (p.kind === 'ready' ? { ...p, site } : p))}
        />
      )}
    </Page>
  );
}

function SubView({
  sub, shop, site, onOpen, onShopChanged, onSiteChanged,
}: {
  sub: Sub; shop: Shop; site: SiteRecord;
  onOpen(s: Sub): void; onShopChanged(): void; onSiteChanged(s: SiteRecord): void;
}) {
  switch (sub) {
    case 'hub':
      return <SetupHub shop={shop} site={site} onOpen={onOpen} onShopChanged={onShopChanged} onSiteChanged={onSiteChanged} />;
    case 'services':
      return <ServicesPane shop={shop} site={site} />;
    case 'barbers':
      return <Barbers shop={shop} uploadFolder={site.draftId} />;
    case 'hours':
      return <HoursPane shop={shop} />;
    case 'rules':
      return <BookingRules shop={shop} onSaved={() => { onShopChanged(); onOpen('hub'); }} />;
    case 'pay':
      return <GetPaid shop={shop} onChanged={onShopChanged} />;
  }
}

function ServicesPane({ shop, site }: { shop: Shop; site: SiteRecord }) {
  const mirror = useCallback((list: Service[]) => { void updateSiteData((d) => withMirroredServices(d, list)).catch(() => {}); }, []);
  const ed = useServicesEditor(shop, mirror, () => pickAndUploadPhoto(site.draftId));
  return (
    <>
      <ServicesEditorView ed={ed} />
      <Note>Services shown on your website update it the next time you publish.</Note>
    </>
  );
}

/** Hours for one person; with barbers, pick whose. */
function HoursPane({ shop }: { shop: Shop }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => { listMembers(shop.id).then(setMembers).catch(() => setMembers([])); }, [shop.id]);
  if (!members) return <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} />;
  const id = pick ?? members.find((m) => m.role === 'owner')?.id ?? members[0]?.id;
  if (!id) return <Note>No one to set hours for yet.</Note>;
  return (
    <>
      {members.length > 1 && (
        <View style={st.chips}>
          {members.map((m) => (
            <Button key={m.id} variant={m.id === id ? 'solid' : 'ghost'} title={m.name} onPress={() => setPick(m.id)} style={{ paddingHorizontal: 14 }} />
          ))}
        </View>
      )}
      <MemberHours memberId={id} />
    </>
  );
}

const st = StyleSheet.create({
  center: { gap: 16 },
  h: { fontFamily: fonts.heading, fontSize: 24, color: colors.heading },
  p: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.body },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
});
