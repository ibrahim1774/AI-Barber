import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { GearIcon } from '@/components/Icons';
import { Page } from '@/components/Page';
import { track } from '@/lib/analytics';
import { useSession } from '@/lib/auth';
import { resetTo } from '@/lib/nav';
import { loadSite, type SiteRecord } from '@/lib/siteStore';

const GREEN = '#22c55e';

/**
 * "Dashboard" (named on aibarber.org/support): the app's home once a site
 * exists. Edit opens the editor, where Publish republishes (free while
 * subscribed) through the usual /publishing path.
 */
export default function Dashboard() {
  const [site, setSite] = useState<SiteRecord | null>(null);
  const { session, ready } = useSession();

  // Fresh on every visit: the editor and a publish change the record.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadSite().then((s) => {
        if (!alive) return;
        if (!s) resetTo('/start');
        else setSite(s);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  useFocusEffect(useCallback(() => track('dashboard_opened'), []));

  const settings = () => router.push('/settings');

  if (!site) return <View style={styles.blank} />;

  const name = site.data.shopName || site.inputs.shopName || 'Your barbershop';
  const url = site.deployedUrl;

  return (
    <Page
      title="Dashboard"
      right={
        <Pressable onPress={settings} hitSlop={12} accessibilityRole="button" accessibilityLabel="Settings">
          <GearIcon size={22} color={colors.text} />
        </Pressable>
      }
    >
      <View style={styles.card}>
        <Text style={styles.kicker}>Your website</Text>
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: url ? GREEN : colors.faint }]} />
          {url ? (
            <Text style={styles.url} numberOfLines={1} selectable>
              {url.replace(/^https?:\/\//, '')}
            </Text>
          ) : (
            <Text style={styles.unpublished}>Not published</Text>
          )}
        </View>

        <Button title="Edit" arrow onPress={() => router.push('/editor')} style={styles.cta} />
        {url && (
          <Button
            variant="ghost"
            title="Open site"
            onPress={() => {
              track('dashboard_open_site');
              void WebBrowser.openBrowserAsync(url);
            }}
            style={styles.gap}
          />
        )}
        <Button variant="ghost" title="Settings" onPress={settings} style={styles.gap} />
      </View>

      <Text style={styles.help}>
        {url
          ? 'Tap Edit, make your changes, then tap Publish. Your live site updates with the new version — republishing is included in your subscription.'
          : 'Tap Edit to finish your site, then tap Publish to put it live.'}
      </Text>

      {ready &&
        (session?.user ? (
          <Text style={styles.account}>Signed in as {session.user.email}</Text>
        ) : (
          <Pressable onPress={() => router.push('/sign-up')} accessibilityRole="link" hitSlop={8} style={styles.link}>
            <Text style={styles.linkText}>Create an account to manage your site from aibarber.org too</Text>
          </Pressable>
        ))}
    </Page>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.sheet, borderRadius: 18, borderWidth: 1, borderColor: colors.hair, padding: 20,
  },
  kicker: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: colors.muted,
  },
  name: { fontFamily: fonts.heading, fontSize: 24, lineHeight: 30, color: colors.heading, marginTop: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  url: { flex: 1, fontFamily: fonts.mono, fontSize: 13, color: colors.accent },
  unpublished: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.muted },
  cta: { alignSelf: 'stretch' },
  gap: { alignSelf: 'stretch', marginTop: 12 },
  help: {
    fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: colors.body, textAlign: 'center',
    marginTop: 20, paddingHorizontal: 8,
  },
  account: { fontFamily: fonts.body, fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 24 },
  link: { marginTop: 24, paddingHorizontal: 16 },
  linkText: {
    fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 20, color: colors.accent, textAlign: 'center',
    textDecorationLine: 'underline',
  },
});
