import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import type { WebsiteData } from '@/web/types';
import { EDITOR_JS, buildPreviewHtml, previewBackground, previewEditPaths, type PreviewPage, type PreviewProduct } from '@/lib/editable';
import { parsePreviewMessage, shouldAllowPreviewRequest, tourPillPath, type ImageRect } from '@/lib/previewBridge';
import { SAMPLE_HERO_NOTE } from '@/lib/pageHero';

export interface SitePreviewProps {
  data: WebsiteData;
  editable: boolean;
  /** The barber's products for the homepage Shop section (the preview can't fetch the live store). */
  shopProducts?: PreviewProduct[] | null;
  /** The page of a multi-page site to show (Home when absent or when the site is a single page). */
  page?: PreviewPage | null;
  onEditText(path: string): void;
  onEditImage(path: string): void;
  /** Registered with the tutorial on the tour's "Change image" chip (an invisible view over it; the chip itself is page DOM). */
  pillTourRef?: RefObject<View | null>;
  /** Paths of photos on this page that are still samples (they get a "replace with yours" prompt). */
  samplePaths?: string[];
  /** True while a sheet covers the preview: the page's chips are hidden (a class toggle in the page). */
  chipsHidden?: boolean;
}

/**
 * The barber's real site (the web's own template) in a WebView. In editable
 * mode text and photos are tappable; taps come back as validated bridge
 * messages. The page can't navigate anywhere (see shouldAllowPreviewRequest).
 * Each data change reloads the document; the last reported scrollY is
 * restored once the new document posts 'ready'.
 */
function sameRects(a: ImageRect[], b: ImageRect[]): boolean {
  return a.length === b.length && a.every((r, i) => r.path === b[i].path && r.x === b[i].x && r.y === b[i].y && r.w === b[i].w && r.h === b[i].h);
}

export default function SitePreview({ data, editable, shopProducts, page, onEditText, onEditImage, pillTourRef, samplePaths, chipsHidden }: SitePreviewProps) {
  const webRef = useRef<WebView>(null);
  const scrollY = useRef(0);
  // Where the page's "Change image" chips are on screen: only the Edit tour reads this.
  const [rects, setRects] = useState<ImageRect[]>([]);

  // Memoised on data/editable: the templates stamp Date.now() into the HTML, so
  // re-rendering on every parent render would reload the page.
  const pageKey = page ? `${page.key}:${page.index ?? ''}` : '';
  const shownPage = useRef(pageKey);
  // A different page starts at the top, not where the last one was scrolled to.
  if (shownPage.current !== pageKey) {
    shownPage.current = pageKey;
    scrollY.current = 0;
  }
  const html = useMemo(() => buildPreviewHtml(data, editable, shopProducts, page), [data, editable, shopProducts, page]);
  const source = useMemo(() => ({ html }), [html]);
  const editPaths = useMemo(() => (editable ? previewEditPaths(data, page) : []), [data, editable, page]);
  // The site's own background behind the page. On iOS (Fabric) the WKWebView
  // is transparent, so this view is what the overscroll bounce, a reload and
  // any inset below the footer show: never a fixed or light colour.
  const bg = previewBackground(data);
  const style = useMemo(() => [styles.web, { backgroundColor: bg }], [bg]);

  // Photos that are still samples: the page chip shows the "replace with yours" note over them.
  const samples = useRef(samplePaths ?? []);
  samples.current = samplePaths ?? [];
  const sampleKey = (samplePaths ?? []).join('|');
  const sendSamples = useCallback(() => {
    webRef.current?.injectJavaScript(`window.__aibSetSamples && window.__aibSetSamples(${JSON.stringify(samples.current)}, ${JSON.stringify(SAMPLE_HERO_NOTE)}); true;`);
  }, []);
  useEffect(() => { sendSamples(); }, [sampleKey, sendSamples]);

  const hiddenRef = useRef(!!chipsHidden);
  hiddenRef.current = !!chipsHidden;
  const sendHidden = useCallback(() => {
    webRef.current?.injectJavaScript(`window.__aibSetChipsHidden && window.__aibSetChipsHidden(${hiddenRef.current ? 'true' : 'false'}); true;`);
  }, []);
  useEffect(() => { sendHidden(); }, [chipsHidden, sendHidden]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const m = parsePreviewMessage(e.nativeEvent.data, data, page, editPaths);
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
          // Same photos in the same places: keep the current array so nothing re-renders (no blink).
          setRects((prev) => (sameRects(prev, m.items) ? prev : m.items));
          return;
        case 'ready':
          webRef.current?.injectJavaScript(`window.__aibRestore && window.__aibRestore(${Math.round(scrollY.current)}); true;`);
          sendSamples();
          sendHidden();
          return;
      }
    },
    [editable, editPaths, data, page, onEditText, onEditImage, sendSamples, sendHidden],
  );

  const onShouldStartLoadWithRequest = useCallback((req: ShouldStartLoadRequest) => shouldAllowPreviewRequest(req), []);

  const tourPath = tourPillPath(rects);
  const tourChip = pillTourRef ? rects.find((r) => r.path === tourPath) : undefined;

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
    {editable && tourChip && (
      <View ref={pillTourRef} collapsable={false} pointerEvents="none" style={{ position: 'absolute', left: tourChip.x, top: tourChip.y, width: tourChip.w, height: tourChip.h }} />
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  web: { flex: 1, backgroundColor: '#0d0d0d' },
});
