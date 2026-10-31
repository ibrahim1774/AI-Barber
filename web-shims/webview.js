// Web stand-in for react-native-webview: a sandboxed iframe fed with srcDoc. Without
// allow-same-origin the page gets an opaque origin, so site content can't read the app's
// localStorage (the session). The page's window.ReactNativeWebView.postMessage becomes a
// postMessage to this window's origin; injectJavaScript is a postMessage the page evals.
const React = require('react');
const shim = (origin) => '<script>(function(){var O=' + JSON.stringify(origin) + ';window.ReactNativeWebView={postMessage:function(d){parent.postMessage({__rnw:1,data:d},O)}};addEventListener("message",function(e){if(e.source===parent&&e.data&&typeof e.data.__rnwEval==="string"){try{(0,eval)(e.data.__rnwEval)}catch(x){}}})})();</script>';
const WebView = React.forwardRef(function WebView({ source, style, onMessage, injectedJavaScript }, ref) {
  const frame = React.useRef(null);
  const send = (js) => { const w = frame.current && frame.current.contentWindow; if (w) w.postMessage({ __rnwEval: js }, '*'); };
  React.useImperativeHandle(ref, () => ({ injectJavaScript: send, reload: () => {} }));
  React.useEffect(() => {
    const h = (e) => { if (e.source === (frame.current && frame.current.contentWindow) && e.data && e.data.__rnw && typeof e.data.data === 'string') onMessage && onMessage({ nativeEvent: { data: e.data.data } }); };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, [onMessage]);
  const onLoad = () => { if (injectedJavaScript) send(injectedJavaScript); };
  const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : (style || {});
  return React.createElement('iframe', { ref: frame, sandbox: 'allow-scripts', srcDoc: shim(window.location.origin) + ((source && source.html) || ''), onLoad, style: { border: 0, width: '100%', height: '100%', flex: 1, backgroundColor: flat.backgroundColor } });
});
module.exports = { WebView, default: WebView };
