// Web stand-in for react-native-webview: an iframe fed with srcDoc; the page's
// window.ReactNativeWebView.postMessage becomes window.parent.postMessage.
const React = require('react');
const SHIM = '<script>window.ReactNativeWebView={postMessage:function(d){parent.postMessage({__rnw:1,data:d},"*")}};</script>';
const WebView = React.forwardRef(function WebView({ source, style, onMessage, injectedJavaScript }, ref) {
  const frame = React.useRef(null);
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (js) => { try { frame.current && frame.current.contentWindow && frame.current.contentWindow.eval(js); } catch (e) {} },
    reload: () => {},
  }));
  React.useEffect(() => {
    const h = (e) => { if (e.source === (frame.current && frame.current.contentWindow) && e.data && e.data.__rnw) onMessage && onMessage({ nativeEvent: { data: e.data.data } }); };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, [onMessage]);
  const onLoad = () => { try { if (injectedJavaScript && frame.current) frame.current.contentWindow.eval(injectedJavaScript); } catch (e) {} };
  const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : (style || {});
  return React.createElement('iframe', { ref: frame, srcDoc: SHIM + ((source && source.html) || ''), onLoad, style: { border: 0, width: '100%', height: '100%', flex: 1, backgroundColor: flat.backgroundColor } });
});
module.exports = { WebView, default: WebView };
