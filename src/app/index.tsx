import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { colors } from '@/constants/theme';
import { homeRoute } from '@/lib/nav';
import { loadSite } from '@/lib/siteStore';

/**
 * Launch: the Edit tab is home once a site exists, otherwise the importer.
 * A pending publish is finished by _layout's ResumePublish, which moves to
 * /live on success.
 */
export default function Index() {
  const [target, setTarget] = useState<'/edit' | '/start' | null>(null);
  useEffect(() => {
    loadSite()
      .then((s) => setTarget(homeRoute(s)))
      .catch(() => setTarget('/start'));
  }, []);
  if (!target) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return <Redirect href={target} />;
}
