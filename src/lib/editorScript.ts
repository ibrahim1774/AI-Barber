/**
 * Injected into the SitePreview WebView (injectedJavaScript, runs at document
 * end). The heavy lifting is done before the page loads (src/lib/editable.ts
 * buildPreviewHtml: editable text is already <span data-edit="path">, image
 * slots already carry data-edit-image="path", markers already stripped). This
 * script:
 *  - sweeps any stray U+2063 marker out of text, attributes and the title
 *    (defensive; prepareEditableHtml should have removed them all);
 *  - outlines editable text and photos;
 *  - swallows every click and form submit (the preview is not a browser; the
 *    native onShouldStartLoadWithRequest blocks navigation as well) and posts
 *    {type:'edit'|'image', path} for taps on editable things;
 *  - reports scrollY (after the native side has restored it) and posts 'ready'
 *    on load so the native side can restore the scroll position after a
 *    re-render reloads the document;
 *  - reports where each tappable photo ([data-edit-image]) is on screen
 *    ('rects', the visible part of it) after load, resize, layout change and
 *    when scrolling stops, and 'scrolling' when it starts, so the native
 *    "Change image" pills can sit on the photos and hide while they move.
 *
 * Plain ES5, ASCII-only source (no backslash escapes: Babel cooks \u escapes
 * even inside String.raw) — it is a string, not compiled.
 */
export const EDITOR_JS = String.raw`(function () {
  if (window.__aibEditor) return;
  window.__aibEditor = true;

  function post(m) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {}
  }

  // U+2063 marker, built at runtime so this source stays plain ASCII.
  var M = String.fromCharCode(0x2063);
  var MARK = new RegExp(M + '(?:[a-zA-Z]+|/)' + M + '|' + M, 'g');
  function clean(s) { return s.indexOf(M) < 0 ? s : s.replace(MARK, ''); }
  function sweep() {
    try {
      var walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        if (node.nodeValue && node.nodeValue.indexOf(M) >= 0) node.nodeValue = clean(node.nodeValue);
      }
      var els = document.getElementsByTagName('*');
      for (var i = 0; i < els.length; i++) {
        var attrs = els[i].attributes;
        for (var j = 0; j < attrs.length; j++) {
          if (attrs[j].value.indexOf(M) >= 0) els[i].setAttribute(attrs[j].name, clean(attrs[j].value));
        }
      }
      document.title = clean(document.title);
    } catch (e) {}
  }
  sweep();

  try {
    var style = document.createElement('style');
    style.textContent =
      '[data-edit]{outline:1px dashed rgba(212,166,74,0.75);outline-offset:3px;border-radius:2px;cursor:pointer;-webkit-tap-highlight-color:rgba(212,166,74,0.25);}' +
      '[data-edit-image]{outline:2px dashed rgba(212,166,74,0.75);outline-offset:-4px;cursor:pointer;}' +
      'a,img{-webkit-touch-callout:none;}';
    (document.head || document.documentElement).appendChild(style);
  } catch (e) {}

  function closestAttr(el, name) {
    while (el && el.nodeType === 1) {
      if (el.hasAttribute(name)) return el;
      el = el.parentElement;
    }
    return null;
  }

  document.addEventListener('submit', function (e) {
    e.preventDefault();
    e.stopPropagation();
  }, true);

  document.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var el = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
    var text = closestAttr(el, 'data-edit');
    if (text) { post({ type: 'edit', path: text.getAttribute('data-edit') }); return; }
    // A button or link whose text is editable: tapping anywhere on it edits that text (its padding, a
    // dev overlay over the middle of it), since the preview never follows links.
    var link = el;
    while (link && link.nodeType === 1 && link.tagName !== 'A') link = link.parentElement;
    var inner = link && link.nodeType === 1 && link.querySelectorAll ? link.querySelectorAll('[data-edit]') : null;
    if (inner && inner.length === 1) { post({ type: 'edit', path: inner[0].getAttribute('data-edit') }); return; }
    var img = closestAttr(el, 'data-edit-image');
    if (img) { post({ type: 'image', path: img.getAttribute('data-edit-image') }); return; }
    // Photos sit under overlays (hero gradient). Not for taps on links/buttons.
    if (closestAttr(el, 'href')) return;
    if (document.elementsFromPoint) {
      var stack = document.elementsFromPoint(e.clientX, e.clientY);
      for (var i = 0; i < stack.length; i++) {
        if (stack[i].hasAttribute && stack[i].hasAttribute('data-edit-image')) {
          post({ type: 'image', path: stack[i].getAttribute('data-edit-image') });
          return;
        }
      }
    }
  }, true);

  // Photo rectangles for the native "Change image" pills: the visible part of
  // every [data-edit-image], in viewport points, small and capped.
  var rectTimer = null;
  var moving = false;
  var liveTimer = null;
  function postRects() {
    try {
      var vw = window.innerWidth || document.documentElement.clientWidth || 0;
      var vh = window.innerHeight || document.documentElement.clientHeight || 0;
      var els = document.querySelectorAll('[data-edit-image]');
      var items = [];
      for (var i = 0; i < els.length && items.length < 24; i++) {
        var r = els[i].getBoundingClientRect();
        var x1 = Math.max(0, r.left);
        var y1 = Math.max(0, r.top);
        var x2 = Math.min(vw, r.right);
        var y2 = Math.min(vh, r.bottom);
        if (x2 - x1 < 56 || y2 - y1 < 44) continue;
        items.push({ path: els[i].getAttribute('data-edit-image'), x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) });
      }
      moving = false;
      post({ type: 'rects', items: items });
    } catch (e) {}
  }
  function scheduleRects() {
    clearTimeout(rectTimer);
    rectTimer = setTimeout(postRects, 160);
  }
  window.addEventListener('resize', scheduleRects);
  document.addEventListener('load', scheduleRects, true);
  try { if (window.ResizeObserver) new ResizeObserver(scheduleRects).observe(document.documentElement); } catch (e) {}

  // Scroll: report only after the native side restored the previous position,
  // so the fresh document's scrollY=0 never overwrites the saved value.
  var restored = false;
  var pending = false;
  window.addEventListener('scroll', function () {
    if (!moving) { moving = true; post({ type: 'scrolling' }); }
    // Keep the native pills following the photos while scrolling (throttled), so they never blink off.
    if (!liveTimer) liveTimer = setTimeout(function () { liveTimer = null; postRects(); }, 60);
    scheduleRects();
    if (!restored || pending) return;
    pending = true;
    setTimeout(function () {
      pending = false;
      post({ type: 'scrollY', y: window.scrollY || window.pageYOffset || 0 });
    }, 120);
  }, { passive: true });

  window.__aibRestore = function (y) {
    var root = document.documentElement;
    root.style.scrollBehavior = 'auto'; // luxe sets scroll-behavior: smooth
    var tries = 0;
    function go() {
      window.scrollTo(0, y);
      tries++;
      // Tailwind CDN / web fonts can grow the page after load; retry briefly.
      if (tries < 8 && Math.abs((window.scrollY || 0) - y) > 2) { setTimeout(go, 100); return; }
      root.style.scrollBehavior = '';
      restored = true;
      scheduleRects();
    }
    go();
  };

  // Tailwind CDN and web fonts move things after load: report again a little later.
  function ready() { sweep(); post({ type: 'ready' }); scheduleRects(); setTimeout(postRects, 700); setTimeout(postRects, 2000); }
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready);
})();
true;`;
