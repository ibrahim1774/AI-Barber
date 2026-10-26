import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { colors } from '@/constants/theme';
import { launchRoute } from '@/lib/launchRoute';

/**
 * Launch: the locked account step when a payment waits for its account, else the Edit tab once a site exists,
 * otherwise the importer (see launchRoute). A pending publish is finished by _layout's ResumePublish, which moves
 * to /live on success.
 */
export default function Index() {
  const [target, setTarget] = useState<'/edit' | '/start' | '/claim' | null>(null);
  useEffect(() => {
    launchRoute()
      .then(setTarget)
      .catch(() => setTarget('/start'));
  }, []);
  if (!target) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return <Redirect href={target} />;
}
