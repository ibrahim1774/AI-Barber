import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Page } from '@/components/Page';
import { Note } from '@/components/setup/ui';
import { BarberSheet } from '@/components/team/BarberSheet';
import { TeamCards } from '@/components/team/TeamCards';
import { defaultWeek, type DayHours } from '@/lib/setup/availability';
import { goBackOrHome } from '@/lib/nav';
import { loadMyShop, type Service, type Shop } from '@/lib/shop';
import { loadSite, type SiteRecord } from '@/lib/siteStore';
import {
  addLegacyToBookings, memberProfileLive, refreshSavedTeam, shopWeek, teamCards, type MemberView, type TeamCard,
} from '@/lib/team';
import { capForTier } from '@/lib/team';
import { getSharedPlan } from '@/lib/plan';
import { useTeamLimits } from '@/lib/useTeamLimits';
import { withPaymentGate } from '@/components/PaymentLock';

type Loaded = {
  shop: Shop | null;
  site: SiteRecord | null;
  views: MemberView[];
  services: Service[];
  shopHours: DayHours[];
  profileLive: boolean;
};

/**
 * The Team screen: swipeable barber cards and the "Add a barber" sheet. With a shop, ab_members is the source
 * of truth and the site's team cards are refreshed from it on open; without one it edits the website's team.
 */
function TeamScreen() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState<{ card: TeamCard | null } | null>(null);
  const limits = useTeamLimits();

  const load = useCallback(async () => {
    try {
      const site = await loadSite();
      // A failed lookup is an error with a retry, never "no shop" (that would offer to set bookings up for a paying shop).
      const shop: Shop | null = await loadMyShop();
      const profileLive = shop ? await memberProfileLive() : false;
      const fresh = await refreshSavedTeam(shop);
      setData({
        shop,
        site: shop ? await loadSite() : site,
        views: fresh?.views ?? [],
        services: fresh?.services ?? [],
        shopHours: shop ? await shopWeek(shop.id) : defaultWeek(),
        profileLive,
      });
      setError('');
    } catch (e) {
      setError("Couldn't load your team. Check your connection and try again.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const cards = useMemo(
    () => (data ? teamCards(data.views, data.site?.data.staff, data.services, data.profileLive) : []),
    [data],
  );
  const memberCount = data?.views.length ?? 0;
  const cap = capForTier(getSharedPlan()?.tier);

  const add = () => {
    // A shop's plan decides (Bookings 2, Store 5); a website-only team has no cap here.
    if (data?.shop && !limits.canAdd(memberCount)) return;
    setSheet({ card: null });
  };

  const promote = async (c: TeamCard) => {
    if (!data?.shop || !c.entry || c.siteIndex == null) return;
    if (!limits.canAdd(memberCount)) return;
    try {
      await addLegacyToBookings({
        shop: data.shop, profileLive: data.profileLive, siteIndex: c.siteIndex, entry: c.entry, week: null, services: data.services,
      });
      await load();
    } catch (e) {
      if (!limits.handleAddError(e)) Alert.alert("Couldn't add to bookings", e instanceof Error ? e.message : 'Try again.');
    }
  };

  return (
    <Page title="Your team" onBack={goBackOrHome}>
      {!data && !error && <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />}
      {!!error && (
        <View style={st.center}>
          <Text style={st.p}>{error}</Text>
          <Button title="Try again" onPress={() => { setError(''); void load(); }} />
        </View>
      )}
      {data && (
        <>
          <Text style={st.lead}>
            {data.shop
              ? 'Each barber has their own profile, services and hours. Customers can pick a barber when they book, and your website shows the team.'
              : 'Your website shows these people in its Team section. Set up Bookings to let customers book each barber online.'}
          </Text>
          <TeamCards
            cards={cards}
            canManageBookings={!!data.shop}
            onEdit={(c) => setSheet({ card: c })}
            onAdd={add}
            onAddToBookings={(c) => void promote(c)}
          />
          <View style={st.addRow}>
            <Button title="Add a barber" onPress={add} loading={limits.busy} />
          </View>
          {!!data.shop && cap != null && memberCount > cap && (
            <Note tone="warn">{`Your plan includes ${cap} people on the team. Everyone stays bookable; upgrade to add more.`}</Note>
          )}
          {!data.shop && (
            <Button title="Set up bookings" variant="ghost" onPress={() => router.push('/bookings-setup')} style={{ marginTop: 8 }} />
          )}
          <BarberSheet
            visible={!!sheet}
            card={sheet?.card ?? null}
            shop={data.shop}
            services={data.services}
            shopHours={data.shopHours}
            profileLive={data.profileLive}
            uploadFolder={data.site?.draftId ?? 'team'}
            onClose={() => setSheet(null)}
            onChanged={() => void load()}
            onAddError={limits.handleAddError}
          />
        </>
      )}
    </Page>
  );
}

const st = StyleSheet.create({
  center: { alignItems: 'center', gap: 16, marginTop: 32 },
  p: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.body, textAlign: 'center' },
  lead: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.body, marginBottom: 18 },
  addRow: { marginTop: 22, marginBottom: 12 },
});

export default withPaymentGate(TeamScreen, 'team');
