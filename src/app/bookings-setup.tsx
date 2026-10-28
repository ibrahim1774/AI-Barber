import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { UpgradeCard } from '@/components/UpgradeCard';
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
import { useLatestTransactionId } from '@/lib/paywall';
import { registerPushForShop, relinkShopPurchase } from '@/lib/setup/relink';
import { goBackOrHome } from '@/lib/nav';
import { useTierAccess, useUpgrade } from '@/lib/tierAccess';
import { pickAndUploadPhoto } from '@/lib/photos';
import { buildSetupBody, shopSetup } from '@/lib/setup/ownerApi';
import { setPostAuthReturn } from '@/lib/setup/gate';
import { mirrorServices } from '@/lib/samplePrices';
import { updateSiteData } from '@/lib/setup/siteSync';
import { wizardDone } from '@/lib/setup/wizardFlag';
import { listMembers, loadMyShop, type Member, type Service, type Shop } from '@/lib/shop';
import { loadSite, type SiteRecord } from '@/lib/siteStore';
import { withPaymentGate } from '@/components/PaymentLock';

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
function BookingsSetup() {
  const { session, ready } = useSession();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [sub, setSub] = useState<Sub>('hub');
  // Set when the first-run wizard finishes: the hub opens with a "You're set" confirmation.
  const [finished, setFinished] = useState(false);
  const signedIn = !!session;
  const latestTransactionId = useLatestTransactionId();
  const tier = useTierAccess('bookings');
  const upgrade = useUpgrade('bookings_upgrade');
  // Without the plan there is nothing to set up (and no shop is created); wait until that is known.
  const blocked = tier.status === 'ready' && !tier.entitled;
  const waiting = tier.status === 'loading';
  // Offline with nothing known: no shop is created; offer a retry.
  const unsure = tier.status === 'error';

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
        void registerPushForShop();
        shop = await loadMyShop();
      }
      if (!shop) return setPhase({ kind: 'error', message: "We couldn't create your booking page. Try again." });
      setPhase({ kind: 'ready', shop, site, wizard: !(await wizardDone(shop.id)) });
      // A shop made before the subscription was linked stays paused: link it now, quietly.
      if (!shop.purchaseLinked) {
        void relinkShopPurchase({ latestTransactionId }).then(async (linked) => {
          if (!linked) return;
          const fresh = await loadMyShop().catch(() => null);
          if (fresh) setPhase((p) => (p.kind === 'ready' ? { ...p, shop: fresh } : p));
        });
      }
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong. Try again.' });
    }
  }, [latestTransactionId]);

  useEffect(() => {
    if (!ready || blocked) return;
    if (!signedIn) {
      setPhase({ kind: 'gate' });
      return;
    }
    setPostAuthReturn(null);
    setPhase({ kind: 'loading' });
    if (!waiting && !unsure) void load();
  }, [ready, signedIn, load, blocked, waiting, unsure]);

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
      {blocked && <UpgradeCard kind="bookings" onUpgrade={() => void upgrade.run()} busy={upgrade.busy} />}
      {unsure && (
        <View style={st.center}>
          <Text style={st.p}>We couldn't check your plan. Check your connection and try again.</Text>
          <Button title="Try again" onPress={tier.retry} />
        </View>
      )}
      {!blocked && !unsure && phase.kind === 'loading' && <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />}
      {!blocked && !unsure && phase.kind === 'gate' && (
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
      {!blocked && !unsure && phase.kind === 'nosite' && (
        <View style={st.center}>
          <Text style={st.h}>Build your website first</Text>
          <Text style={st.p}>Your booking page uses your shop's name, services and look.</Text>
          <Button title="Build my website" onPress={() => router.replace('/start')} />
        </View>
      )}
      {!blocked && !unsure && phase.kind === 'error' && (
        <View style={st.center}>
          <Text style={st.p}>{phase.message}</Text>
          <Button title="Try again" onPress={() => { setPhase({ kind: 'loading' }); void load(); }} />
        </View>
      )}
      {!blocked && !unsure && phase.kind === 'ready' && phase.wizard && (
        <Wizard
          shop={phase.shop}
          site={phase.site}
          onShopChanged={reloadShop}
          onFinish={() => { setSub('hub'); setFinished(true); setPhase({ ...phase, wizard: false }); void reloadShop(); }}
        />
      )}
      {phase.kind === 'ready' && !phase.wizard && finished && sub === 'hub' && <YoureSet />}
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

/** The confirmation under the hub header right after the first-run wizard. */
export function YoureSet() {
  return (
    <View style={st.set} accessibilityRole="summary" accessibilityLabel="You're set">
      <Text style={st.setTitle}>You're set</Text>
      <Text style={st.setBody}>Your booking setup is saved. You can change anything here any time.</Text>
    </View>
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
  const mirror = useCallback((list: Service[]) => { void updateSiteData((d, r) => mirrorServices(d, list, r.inputs.samplePricesFilled)).catch(() => {}); }, []);
  const ed = useServicesEditor(shop, mirror, () => pickAndUploadPhoto(site.draftId));
  useEffect(() => { void Promise.resolve(updateSiteData((d) => d, (i) => (i.pricesReviewed ? i : { ...i, pricesReviewed: true }))).catch(() => {}); }, []);
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
  set: { borderRadius: 14, borderWidth: 1, borderColor: colors.accent, padding: 16, marginBottom: 16, gap: 4 },
  setTitle: { fontFamily: fonts.heading, fontSize: 18, color: colors.heading },
  setBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.body },
  center: { gap: 16 },
  h: { fontFamily: fonts.heading, fontSize: 24, color: colors.heading },
  p: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.body },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
});

export default withPaymentGate(BookingsSetup, 'bookings-setup');
