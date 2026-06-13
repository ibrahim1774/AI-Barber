// Meta + TikTok pixel stubs (queue-then-flush) + deferred SDK load.
// Extracted from index.html inline scripts so Vite v6 dev server does
// not try to parse them via import-analysis. Production behavior is
// identical: this file is served as a static asset and the script tag
// is synchronous in <head>, same as the inline blocks were.

// Meta Pixel — OFFICIAL base code pattern (with callMethod switch).
!function(f,b,e,v,n,t,s){
  if(f.fbq)return;
  n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!1;n.version='2.0';
  n.queue=[];
}(window,document,'script');

// TikTok Pixel — official base code, same queue-then-flush pattern.
!function (w, d, t) {
  w.TiktokAnalyticsObject=t;
  var ttq=w[t]=w[t]||[];
  ttq.methods=['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie','holdConsent','revokeConsent','grantConsent'];
  ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
  for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
  ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
}(window, document, 'ttq');

// Deferred network load — fbevents.js + TikTok analytics + Clarity.
// Runs at `load + 500ms` so heavy SDKs do not compete with the LCP image.
(function () {
  var loadPixels = function () {
    if (!window.fbq.loaded) {
      var fbScript = document.createElement('script');
      fbScript.async = true;
      fbScript.src = 'https://connect.facebook.net/en_US/fbevents.js';
      var firstScript = document.getElementsByTagName('script')[0];
      firstScript.parentNode.insertBefore(fbScript, firstScript);
    }
    window.fbq('init', '26490568997297314');
    window.fbq('track', 'PageView');
    var ttq = window.ttq;
    ttq.load = function(e,n){var r='https://analytics.tiktok.com/i18n/pixel/events.js',o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var s=document.createElement('script');s.type='text/javascript';s.async=!0;s.src=r+'?sdkid='+e+'&lib=ttq';var f=document.getElementsByTagName('script')[0];f.parentNode.insertBefore(s,f)};
    ttq.load('D81SNARC77UATASKVG10');
    ttq.page();
    (function(c,l,a,r,i,t,y){
      c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;
      y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, 'clarity', 'script', 'w5jdq6huun');
  };
  if (document.readyState === 'complete') {
    setTimeout(loadPixels, 500);
  } else {
    window.addEventListener('load', function () {
      setTimeout(loadPixels, 500);
    });
  }
})();
