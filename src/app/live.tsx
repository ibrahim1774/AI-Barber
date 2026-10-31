import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { ShareSheet } from '@/components/ShareSheet';
import { AddToHome } from '@/components/AddToHome';
import { CheckCircleIcon, CheckIcon, ChevronRightIcon, CloseIcon, CopyIcon } from '@/components/Icons';
import { track } from '@/lib/analytics';
import { useSession } from '@/lib/auth';
import { DOMAIN_ROW_EXAMPLE, DOMAIN_UPSELL_TITLE } from '@/lib/domains/model';
import { useDomainOffer } from '@/lib/domains/useDomainOffer';
import { useEntitlements } from '@/lib/entitlements';
import { homeRoute, leaveLive, resetTo, takeReturnAfterLive } from '@/lib/nav';
import { loadMyShop } from '@/lib/shop';
import { loadSite } from '@/lib/siteStore';
import { useLinkActions } from '@/lib/useLinkActions';

const GREEN = '#22c55e';

/** The web's post-deploy "YOUR SITE IS LIVE!" screen (App.tsx), with Open / Copy / Share. */
export default function Live() {
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState<string | null>(null);
  const { session, ready } = useSession();
  const [saveDismissed, setSaveDismissed] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [returnBack] = useState(takeReturnAfterLive);
  const [shopName, setShopName] = useState('');
  const { open, copy, copied } = useLinkActions(url, 'live');
  const { known: domainKnown, hasDomain } = useDomainOffer(true);
  // A Bookings or Store plan bought on the publish paywall: the next step is its booking page.
  const ents = useEntitlements();
  const [bookingsOn, setBookingsOn] = useState(false);
  useEffect(() => {
    loadMyShop().then((s) => setBookingsOn(!!s?.bookingsEnabled)).catch(() => {});
  }, []);

  useEffect(() => {
    track('live_opened');
    let alive = true;
    loadSite()
      .then((s) => {
        if (!alive) return;
        if (!s?.deployedUrl) {
          resetTo(homeRoute(s));
          return;
        }
        setShopName(s.data.shopName || s.inputs.shopName || '');
        setUrl(s.deployedUrl);
      })
      .catch(() => alive && resetTo('/start'));
    return () => {
      alive = false;
    };
  }, []);

  if (!url) return <View style={styles.root} />;

  // Done → where the barber was (after "Update my site"), else the Settings tab, where the live link stays.
  const done = () => {
    track('live_done_tapped');
    leaveLive(returnBack);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView contentContainerStyle={styles.main}>
        <View style={styles.icon}>
          <CheckCircleIcon size={80} color={GREEN} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Your site is <Text style={{ color: colors.accent }}>live!</Text>
        </Text>
        <Text style={styles.body}>Your barbershop website has been published and is now live on the web.</Text>

        <View style={styles.urlRow}>
          <Text style={styles.url} numberOfLines={1} selectable>
            {url}
          </Text>
          <Pressable
            onPress={copy}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Copied' : 'Copy URL'}
          >
            {copied ? <CheckIcon color={GREEN} /> : <CopyIcon color={colors.grey} />}
          </Pressable>
        </View>

        {domainKnown && !hasDomain && (
          <Pressable
            onPress={() => {
              track('domain_card_tapped', { screen: 'live', has_domain: false });
              router.push('/domain');
            }}
            accessibilityRole="button"
            accessibilityLabel="Buy a custom domain"
            style={styles.domainBox}
          >
            <View style={styles.domainText}>
              <Text style={styles.domainTitle}>{DOMAIN_UPSELL_TITLE}</Text>
              <Text style={styles.domainLine}>
                e.g. <Text style={styles.domainExample}>{DOMAIN_ROW_EXAMPLE}</Text>
              </Text>
            </View>
            <ChevronRightIcon size={16} color={colors.faint} />
          </Pressable>
        )}

        <Button variant="solid" title="View your site" onPress={open} style={styles.wide} />
        <View style={styles.row}>
          <Button variant="ghost" title={copied ? 'Copied' : 'Copy link'} onPress={copy} style={styles.half} />
          <Button variant="ghost" title="Share" onPress={() => setShareOpen(true)} style={styles.half} />
        </View>
        {ents.bookings && !bookingsOn && (
          <Button
            variant="ghost"
            title="Set up bookings"
            onPress={() => {
              track('live_setup_bookings_tapped');
              router.push('/bookings-setup' as never);
            }}
            style={[styles.wide, { marginTop: 12 }]}
          />
        )}
        <AddToHome />
        <Button variant="ghost" size="lg" title="Done" onPress={done} style={[styles.wide, styles.done]} />

        {ready && !session?.user && !saveDismissed && (
          <View style={styles.save}>
            <Pressable
              onPress={() => setSaveDismissed(true)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Not now"
              style={styles.saveClose}
            >
              <CloseIcon size={16} color={colors.grey} />
            </Pressable>
            <Text style={styles.saveTitle}>Save your site to an account</Text>
            {/* PostDeploymentModal.tsx's prompt */}
            <Text style={styles.saveBody}>
              Create a free account to manage your site, make edits, and republish anytime.
            </Text>
            <Button
              variant="solid"
              title="Create Account"
              onPress={() => {
                track('live_create_account_tapped');
                router.push('/sign-up');
              }}
              style={styles.wide}
            />
          </View>
        )}
      </ScrollView>
      <ShareSheet
        visible={shareOpen}
        shopName={shopName}
        links={[{ kind: 'website', url }]}
        source="live"
        onClose={() => setShareOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  main: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 24 },
  icon: { marginBottom: 32 },
  // text-2xl font-montserrat font-black uppercase tracking-[4px]
  title: {
    fontFamily: fonts.headingBlack, fontSize: 24, lineHeight: 32, letterSpacing: 4, textTransform: 'uppercase',
    color: '#fff', textAlign: 'center', marginBottom: 16,
  },
  // text-[#cccccc] text-sm
  body: {
    fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: '#cccccc', textAlign: 'center',
    marginBottom: 24, maxWidth: 420,
  },
  // bg-[#1a1a1a] border border-white/10 rounded px-4 py-3
  urlRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch',
    backgroundColor: colors.track, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 4,
    paddingHorizontal: 16, paddingVertical: 12, marginBottom: 32,
  },
  url: { flex: 1, fontFamily: fonts.mono, fontSize: 14, color: colors.accent },
  wide: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', gap: 12, alignSelf: 'stretch', marginTop: 12 },
  half: { flex: 1, paddingHorizontal: 12 },
  done: { marginTop: 20 },
  domainBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', padding: 12, marginTop: -16, marginBottom: 20,
    borderWidth: 1, borderColor: colors.hair, borderRadius: 12,
  },
  domainText: { flex: 1, gap: 2 },
  domainTitle: { fontFamily: fonts.bodySemi, fontSize: 14, color: '#fff' },
  domainLine: { fontFamily: fonts.body, fontSize: 13, color: colors.grey },
  domainExample: { fontFamily: fonts.bodySemi, color: colors.accent },
  // The web's post-deploy account prompt, as a dismissible card that never blocks.
  save: {
    alignSelf: 'stretch', marginTop: 32, padding: 20, paddingTop: 22, borderRadius: 8,
    backgroundColor: colors.track, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  saveClose: { position: 'absolute', top: 12, right: 12 },
  saveTitle: {
    fontFamily: fonts.headingBlack, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: '#fff',
    marginBottom: 8, paddingRight: 24,
  },
  saveBody: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: '#cccccc', marginBottom: 16 },
});
