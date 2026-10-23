import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import type { WebsiteData } from '@/web/types';
import { EDITOR_JS, buildPreviewHtml, previewBackground, type PreviewProduct } from '@/lib/editable';
import { parsePreviewMessage, shouldAllowPreviewRequest, type ImageRect } from '@/lib/previewBridge';
import { ChangeImagePills } from '@/components/ChangeImagePills';

export interface SitePreviewProps {
  data: WebsiteData;
  editable: boolean;
  /** The barber's products for the homepage Shop section (the preview can't fetch the live store). */
  shopProducts?: PreviewProduct[] | null;
  onEditText(path: string): void;
  onEditImage(path: string): void;
  /** Registered with the tutorial on the tour's "Change image" pill. */
  pillTourRef?: RefObject<View | null>;
}

/**
 * The barber's real site (the web's own template) in a WebView. In editable
 * mode text and photos are tappable; taps come back as validated bridge
 * messages. The page can't navigate anywhere (see shouldAllowPreviewRequest).
 * Each data change reloads the document; the last reported scrollY is
 * restored once the new document posts 'ready'.
 */
export default function SitePreview({ data, editable, shopProducts, onEditText, onEditImage, pillTourRef }: SitePreviewProps) {
  const webRef = useRef<WebView>(null);
  const scrollY = useRef(0);
  // Where each photo is on screen (for the "Change image" pills), and whether the page is moving.
  const [rects, setRects] = useState<ImageRect[]>([]);
  const [moving, setMoving] = useState(false);

  // Memoised on data/editable: the templates stamp Date.now() into the HTML, so
  // re-rendering on every parent render would reload the page.
  const html = useMemo(() => buildPreviewHtml(data, editable, shopProducts), [data, editable, shopProducts]);
  const source = useMemo(() => ({ html }), [html]);
  // The site's own background behind the page. On iOS (Fabric) the WKWebView
  // is transparent, so this view is what the overscroll bounce, a reload and
  // any inset below the footer show: never a fixed or light colour.
  const bg = previewBackground(data);
  const style = useMemo(() => [styles.web, { backgroundColor: bg }], [bg]);

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
        case 'rects':
          setRects(m.items);
          setMoving(false);
          return;
        case 'scrolling':
          setMoving(true);
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
    <View style={styles.fill}>
    <WebView
      ref={webRef}
      style={style}
      source={source}
      // No automatic insets (safe area, keyboard): the preview sits between the
      // status-bar padding and PublishBar, so any inset would only be a gap.
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      automaticallyAdjustsScrollIndicatorInsets={false}
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
    {editable && <ChangeImagePills items={rects} hidden={moving} onPress={onEditImage} tourRef={pillTourRef} />}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  web: { flex: 1, backgroundColor: '#0d0d0d' },
});
