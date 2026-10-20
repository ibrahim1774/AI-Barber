import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { colors } from '@/constants/theme';
import { requestTrackingWhenActive } from '@/lib/analytics';
import { loadSite } from '@/lib/siteStore';

/**
 * Launch: the Dashboard is home once a site exists, otherwise the importer.
 * A pending publish is finished by _layout's ResumePublish, which moves to
 * /live on success.
 */
export default function Index() {
  const [target, setTarget] = useState<'/dashboard' | '/start' | null>(null);
  // First screen after the splash: the tracking prompt (once; later launches
  // skip it), as soon as the app is active.
  useEffect(() => requestTrackingWhenActive(), []);
  useEffect(() => {
    loadSite()
      .then((s) => setTarget(s ? '/dashboard' : '/start'))
      .catch(() => setTarget('/start'));
  }, []);
  if (!target) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return <Redirect href={target} />;
}
