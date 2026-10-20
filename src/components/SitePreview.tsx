import { useCallback, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import type { WebsiteData } from '@/web/types';
import { EDITOR_JS, buildPreviewHtml } from '@/lib/editable';
import { parsePreviewMessage, shouldAllowPreviewRequest } from '@/lib/previewBridge';

export interface SitePreviewProps {
  data: WebsiteData;
  editable: boolean;
  onEditText(path: string): void;
  onEditImage(path: string): void;
}

/**
 * The barber's real site (the web's own template) in a WebView. In editable
 * mode text and photos are tappable; taps come back as validated bridge
 * messages. The page can't navigate anywhere (see shouldAllowPreviewRequest).
 * Each data change reloads the document; the last reported scrollY is
 * restored once the new document posts 'ready'.
 */
export default function SitePreview({ data, editable, onEditText, onEditImage }: SitePreviewProps) {
  const webRef = useRef<WebView>(null);
  const scrollY = useRef(0);

  // Memoised on data/editable: the templates stamp Date.now() into the HTML, so
  // re-rendering on every parent render would reload the page.
  const html = useMemo(() => buildPreviewHtml(data, editable), [data, editable]);
  const source = useMemo(() => ({ html }), [html]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const m = parsePreviewMessage(e.nativeEvent.data, data);
      if (!m) return;
      switch (m.type) {
        case 'edit':
          if (editable) onEditText(m.path);
          return;
        case 'image':
          if (editable) onEditImage(m.path);
          return;
        case 'scrollY':
          scrollY.current = m.y;
          return;
        case 'ready':
          webRef.current?.injectJavaScript(`window.__aibRestore && window.__aibRestore(${Math.round(scrollY.current)}); true;`);
          return;
      }
    },
    [data, editable, onEditText, onEditImage],
  );

  const onShouldStartLoadWithRequest = useCallback((req: ShouldStartLoadRequest) => shouldAllowPreviewRequest(req), []);

  return (
    <WebView
      ref={webRef}
      style={styles.web}
      source={source}
      // '*' so every request reaches onShouldStartLoadWithRequest; a narrower
      // whitelist makes react-native-webview Linking.openURL() the rest (dialer/Safari).
      originWhitelist={['*']}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
      injectedJavaScript={EDITOR_JS}
      onMessage={onMessage}
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      allowFileAccess={false}
      allowsLinkPreview={false}
      dataDetectorTypes="none"
      allowsBackForwardNavigationGestures={false}
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#0d0d0d' },
});
