import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { track } from '@/lib/analytics';

/**
 * Open / Copy / Share for the live link, as /live and the Settings tab show
 * them. Events are `<source>_open_tapped`, `<source>_copy_tapped`,
 * `<source>_share_tapped`; `copied` is true for 2 s after a copy.
 */
export function useLinkActions(url: string | null, source: 'live' | 'settings') {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const open = useCallback(() => {
    if (!url) return;
    track(`${source}_open_tapped`);
    void WebBrowser.openBrowserAsync(url);
  }, [url, source]);

  const copy = useCallback(async () => {
    if (!url) return;
    await Clipboard.setStringAsync(url);
    track(`${source}_copy_tapped`);
    setCopied(true);
    AccessibilityInfo.announceForAccessibility('Link copied');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }, [url, source]);

  const share = useCallback(() => {
    if (!url) return;
    track(`${source}_share_tapped`);
    void Share.share({ url, message: url });
  }, [url, source]);

  return { open, copy, share, copied };
}
