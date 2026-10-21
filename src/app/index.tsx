import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { colors } from '@/constants/theme';
import { pullSiteOnLaunch } from '@/lib/account';
import { homeRoute } from '@/lib/nav';
import { loadSite } from '@/lib/siteStore';
import { LOOKUP_TIMEOUT_MS, withTimeout } from '@/lib/timeout';

/**
 * Launch: the Edit tab is home once a site exists, otherwise the importer.
 * Without a local site, a signed-in account's app-made site is loaded first
 * (a reinstall keeps the keychain session), for a few seconds at most.
 * A pending publish is finished by _layout's ResumePublish, which moves to
 * /live on success.
 */
export default function Index() {
  const [target, setTarget] = useState<'/edit' | '/start' | null>(null);
  useEffect(() => {
    (async () => {
      const local = await loadSite();
      if (local) return local;
      await withTimeout(pullSiteOnLaunch(), LOOKUP_TIMEOUT_MS).catch(() => null);
      return loadSite();
    })()
      .then((s) => setTarget(homeRoute(s)))
      .catch(() => setTarget('/start'));
  }, []);
  if (!target) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return <Redirect href={target} />;
}
