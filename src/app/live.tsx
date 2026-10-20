import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { CheckCircleIcon, CheckIcon, CopyIcon } from '@/components/Icons';
import { track } from '@/lib/analytics';
import { loadSite } from '@/lib/siteStore';

const GREEN = '#22c55e';

/** The web's post-deploy "YOUR SITE IS LIVE!" screen (App.tsx), with Open / Copy / Share. */
export default function Live() {
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    track('live_opened');
    let alive = true;
    loadSite().then((s) => {
      if (!alive) return;
      if (!s?.deployedUrl) {
        router.replace('/editor');
        return;
      }
      setUrl(s.deployedUrl);
    });
    return () => {
      alive = false;
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  if (!url) return <View style={styles.root} />;

  const open = () => {
    track('live_open_tapped');
    void WebBrowser.openBrowserAsync(url);
  };
  const copy = async () => {
    await Clipboard.setStringAsync(url);
    track('live_copy_tapped');
    setCopied(true);
    AccessibilityInfo.announceForAccessibility('Link copied');
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  };
  const share = () => {
    track('live_share_tapped');
    void Share.share({ url, message: url });
  };
  const backToEditor = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/editor');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.main}>
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

        <Button variant="solid" title="View your site" onPress={open} style={styles.wide} />
        <View style={styles.row}>
          <Button variant="ghost" title={copied ? 'Copied' : 'Copy link'} onPress={copy} style={styles.half} />
          <Button variant="ghost" title="Share" onPress={share} style={styles.half} />
        </View>
        <Button variant="link" title="Back to Editor" onPress={backToEditor} style={styles.link} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  main: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
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
  link: { marginTop: 20 },
});
