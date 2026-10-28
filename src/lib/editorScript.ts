/**
 * Injected into the SitePreview WebView (injectedJavaScript, runs at document
 * end). The heavy lifting is done before the page loads (src/lib/editable.ts
 * buildPreviewHtml: editable text is already <span data-edit="path">, image
 * slots already carry data-edit-image="path", markers already stripped). This
 * script:
 *  - sweeps any stray U+2063 marker out of text, attributes and the title
 *    (defensive; prepareEditableHtml should have removed them all);
 *  - outlines editable text (photos carry only their Change image chip);
 *  - makes the site menu work (burger, entry taps -> {type:'nav'}, long press -> edit the entry's label);
 *  - a tap on a service card ([data-ab-service]) posts {type:'service', index}; on a working-hours row ([data-ab-hours]) {type:'hours'};
 *  - swallows every click and form submit (the preview is not a browser; the
 *    native onShouldStartLoadWithRequest blocks navigation as well) and posts
 *    {type:'edit'|'image', path} for taps on editable things;
 *  - reports scrollY (after the native side has restored it) and posts 'ready'
 *    on load so the native side can restore the scroll position after a
 *    re-render reloads the document;
 *  - adds a real-DOM "Change image" chip (camera icon + text) bottom-left of every
 *    [data-edit-image] photo, so it scrolls with the page natively; a tap posts
 *    {type:'image', path}. Sample-photo notes arrive via window.__aibSetSamples.
 *    Reports the chips' on-screen rectangles ('rects', settled, never while
 *    scrolling) only so the Edit tour can point at the first chip.
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
      '[data-ab-service]{outline:1px dashed rgba(212,166,74,0.75);outline-offset:-3px;border-radius:2px;cursor:pointer;-webkit-tap-highlight-color:rgba(212,166,74,0.25);}' +
      '[data-ab-service] [data-edit]{outline:none;}' +
      '[data-ab-hours]{outline:1px dashed rgba(212,166,74,0.75);outline-offset:-3px;border-radius:2px;cursor:pointer;-webkit-tap-highlight-color:rgba(212,166,74,0.25);}' +
      '[data-ab-hours] [data-edit]{outline:none;}' +
      '[data-edit-image]{cursor:pointer;}' +
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

  // The site menu. The renderer's burger is a CSS-only checkbox, and the preview swallows every click, so the
  // checkbox is toggled here. A tap on a menu entry posts {type:'nav', href} (the native side checks it against the
  // pages the app itself computed and only switches the rendered page); a long press (600 ms, hardly moving)
  // posts the entry's own label for editing instead.
  function hasClass(el, name) { return !!(el && el.classList && el.classList.contains(name)); }
  function upTo(el, test) {
    while (el && el.nodeType === 1) {
      if (test(el)) return el;
      el = el.parentElement;
    }
    return null;
  }
  function menuLink(el) {
    var a = upTo(el, function (n) { return n.tagName === 'A'; });
    if (!a) return null;
    return upTo(a, function (n) { return hasClass(n, 'ab-nav-list') || hasClass(n, 'ab-foot-pages'); }) ? a : null;
  }
  function closeMenu() {
    var t = document.getElementById('ab-nav-toggle');
    if (t) t.checked = false;
  }
  var LONG_MS = 600;
  var LONG_SLOP = 10;
  var press = null;
  var longDone = false;
  function endPress() {
    if (press && press.timer) clearTimeout(press.timer);
    press = null;
  }
  document.addEventListener('pointerdown', function (e) {
    endPress();
    longDone = false;
    var el = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
    var a = menuLink(el);
    var edit = a && a.querySelector ? a.querySelector('[data-edit]') : null;
    if (!edit) return;
    press = { x: e.clientX, y: e.clientY, timer: null };
    press.timer = setTimeout(function () {
      press.timer = null;
      longDone = true;
      post({ type: 'edit', path: edit.getAttribute('data-edit') });
    }, LONG_MS);
  }, true);
  document.addEventListener('pointermove', function (e) {
    if (!press || !press.timer) return;
    if (Math.abs(e.clientX - press.x) > LONG_SLOP || Math.abs(e.clientY - press.y) > LONG_SLOP) endPress();
  }, true);
  document.addEventListener('pointerup', endPress, true);
  document.addEventListener('pointercancel', endPress, true);

  document.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var el = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
    if (longDone) { longDone = false; return; }
    // Editor-only "+ Add a service" (injected by withAddService): opens the Services sheet at its add view.
    if (closestAttr(el, 'data-ab-add-service')) { post({ type: 'addService' }); return; }
    // Editor-only "+ Add a button" (injected by withAddButton): opens the button chooser.
    if (closestAttr(el, 'data-ab-add-button')) { post({ type: 'addButton' }); return; }
    // The burger: toggle the CSS checkbox the menu is built on.
    if (upTo(el, function (n) { return n.tagName === 'LABEL' && hasClass(n, 'ab-burger'); })) {
      var tg = document.getElementById('ab-nav-toggle');
      if (tg) tg.checked = !tg.checked;
      return;
    }
    // "More" in the menu is a <details>.
    var sum = upTo(el, function (n) { return n.tagName === 'SUMMARY'; });
    if (sum && sum.parentElement && hasClass(sum.parentElement, 'ab-more-d')) {
      if (sum.parentElement.open) sum.parentElement.removeAttribute('open'); else sum.parentElement.setAttribute('open', '');
      return;
    }
    var mlink = menuLink(el);
    if (mlink) {
      var mh = mlink.getAttribute('href') || '';
      if (mh.charAt(0) === '#') {
        try { var dest = mh.length > 1 ? document.querySelector(mh) : null; if (dest && dest.scrollIntoView) dest.scrollIntoView({ behavior: 'smooth' }); } catch (x) {}
      } else {
        post({ type: 'nav', href: mh });
      }
      closeMenu();
      return;
    }
    // A plain in-page link (#about) with no editable text of its own scrolls, as it would on the live site.
    var alink = upTo(el, function (n) { return n.tagName === 'A'; });
    if (alink && (alink.getAttribute('href') || '').charAt(0) === '#' && alink.getAttribute('href').length > 1 && !alink.querySelector('[data-edit]') && !closestAttr(el, 'data-edit')) {
      try { var d2 = document.querySelector(alink.getAttribute('href')); if (d2 && d2.scrollIntoView) d2.scrollIntoView({ behavior: 'smooth' }); } catch (x2) {}
      return;
    }
    // The logo replaces the shop name in the header: a tap on it (in the header or, for prime/euphoria, the nav bar) opens the header sheet (the name's editor).
    if (el.tagName === 'IMG' && el.getAttribute('fetchpriority') === 'high' && upTo(el, function (n) { return n.tagName === 'HEADER' || n.tagName === 'NAV'; })) { post({ type: 'edit', path: 'shopName' }); return; }
    var chipHost = closestAttr(el, 'data-aib-chip');
    if (chipHost) { post({ type: 'image', path: chipHost.getAttribute('data-aib-chip') }); return; }
    // A service card (data-ab-service, tagged by tagServiceCards): a tap anywhere on it, its words included, opens the
    // Services sheet at that service. A photo inside it, or a button/link with a label of its own, keeps its own handling.
    var card = closestAttr(el, 'data-ab-service');
    if (card && !closestAttr(el, 'data-edit-image')) {
      var own = upTo(el, function (n) { return n === card || n.tagName === 'A' || n.tagName === 'BUTTON'; });
      var ownEdit = own && own !== card && own.querySelector ? own.querySelector('[data-edit]') : null;
      var ownPath = ownEdit ? ownEdit.getAttribute('data-edit') : '';
      if (!ownEdit || ownPath.indexOf('services.') === 0) {
        var si = parseInt(card.getAttribute('data-ab-service'), 10);
        if (si >= 0) { post({ type: 'service', index: si }); return; }
      }
    }
    // The shop's working-hours rows (data-ab-hours, tagged by tagHoursRows): a tap on any day or time opens the Hours sheet.
    if (closestAttr(el, 'data-ab-hours')) { post({ type: 'hours' }); return; }
    var text = closestAttr(el, 'data-edit');
    if (text) { post({ type: 'edit', path: text.getAttribute('data-edit') }); return; }
    // A button or link whose text is editable: tapping anywhere on it edits that text (its padding, a
    // dev overlay over the middle of it), since the preview never follows links.
    var link = el;
    while (link && link.nodeType === 1 && link.tagName !== 'A') link = link.parentElement;
    var inner = link && link.nodeType === 1 && link.querySelectorAll ? link.querySelectorAll('[data-edit]') : null;
    // Two or more ("Book with Sam": label + name): the padding opens the first, the words open their own.
    if (inner && inner.length >= 1) { post({ type: 'edit', path: inner[0].getAttribute('data-edit') }); return; }
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

  // "Change image" chips: real DOM next to every [data-edit-image] photo, so they scroll with the page
  // natively (no bridge, no lag). A photo is an <img> (cannot hold children), so the chip is its next sibling,
  // absolutely positioned from the photo's box inside the same containing block; only layout changes
  // (load, resize, font/CSS arrival) re-place it, never scrolling. Preview only: this script never ships.
  var CHIP_CSS =
    '.aib-chip-host{all:initial;position:absolute;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-start;box-sizing:border-box;pointer-events:none;transform:translateY(-100%);}' +
    '.aib-chip-note{all:initial;display:block;box-sizing:border-box;max-width:100%;margin:0 0 4px 0;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,0.55);color:#fff;font:600 11px/1.2 -apple-system,system-ui,sans-serif;pointer-events:none;-webkit-user-select:none;user-select:none;}' +
    '.aib-chip{all:initial;position:relative;display:inline-flex;align-items:center;box-sizing:border-box;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,0.55);color:#fff;font:600 11px/1.2 -apple-system,system-ui,sans-serif;white-space:nowrap;cursor:pointer;pointer-events:auto;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;}' +
    '.aib-chip::before{content:"";position:absolute;top:-16px;right:-20px;bottom:-16px;left:-14px;}' +
    '.aib-chips-off .aib-chip-host{display:none!important;}' +
    '.aib-chip svg{display:block!important;flex:none;width:11px!important;height:11px!important;margin:0 4px 0 0!important;}';
  try {
    var chipStyle = document.createElement('style');
    chipStyle.textContent = CHIP_CSS;
    (document.head || document.documentElement).appendChild(chipStyle);
  } catch (e) {}
  var CAMERA =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>';
  var samples = [];
  var sampleNote = '';
  var chips = [];
  var chipRO = null;
  var syncFrame = 0;
  var INSET = 6;

  function makeChip(img, path) {
    var host = document.createElement('div');
    host.className = 'aib-chip-host';
    host.setAttribute('data-aib-chip', path);
    var chip = document.createElement('span');
    chip.className = 'aib-chip';
    chip.setAttribute('role', 'button');
    chip.setAttribute('aria-label', 'Change image');
    chip.innerHTML = CAMERA + '<span>Change image</span>';
    host.appendChild(chip);
    var ref = img.parentElement && img.parentElement.tagName === 'PICTURE' ? img.parentElement : img;
    if (ref.parentNode) ref.parentNode.insertBefore(host, ref.nextSibling);
    return { img: img, host: host, chip: chip, path: path, note: null };
  }

  function placeChip(c) {
    var img = c.img;
    var host = c.host;
    var r = img.getBoundingClientRect();
    if (!img.isConnected || r.width < 56 || r.height < 44 || window.getComputedStyle(img).display === 'none') {
      host.style.setProperty('display', 'none', 'important');
      return;
    }
    host.style.removeProperty('display');
    var fixed = window.getComputedStyle(img).position === 'fixed';
    var left = r.left + INSET;
    var top = r.bottom - INSET;
    if (fixed) {
      host.style.setProperty('position', 'fixed', 'important');
    } else {
      host.style.removeProperty('position');
      var op = host.offsetParent;
      if (op && op !== document.body && op !== document.documentElement) {
        var pr = op.getBoundingClientRect();
        left = left - pr.left - op.clientLeft + op.scrollLeft;
        top = top - pr.top - op.clientTop + op.scrollTop;
      } else {
        // No positioned ancestor: the initial containing block, measured from the document origin.
        left += window.pageXOffset || 0;
        top += window.pageYOffset || 0;
      }
    }
    host.style.setProperty('left', Math.round(left) + 'px', 'important');
    host.style.setProperty('top', Math.round(top) + 'px', 'important');
    host.style.setProperty('max-width', Math.max(0, Math.round(r.width - INSET * 2)) + 'px', 'important');
    var isSample = samples.indexOf(c.path) >= 0 && !!sampleNote;
    if (isSample && !c.note) {
      c.note = document.createElement('span');
      c.note.className = 'aib-chip-note';
      c.note.textContent = sampleNote;
      host.insertBefore(c.note, c.chip);
    } else if (isSample && c.note.textContent !== sampleNote) {
      c.note.textContent = sampleNote;
    } else if (!isSample && c.note) {
      host.removeChild(c.note);
      c.note = null;
    }
  }

  function syncChips() {
    try {
      var els = document.querySelectorAll('[data-edit-image]');
      for (var i = 0; i < els.length && i < 24; i++) {
        var el = els[i];
        var path = el.getAttribute('data-edit-image');
        var c = null;
        for (var k = 0; k < chips.length; k++) if (chips[k].img === el) c = chips[k];
        if (!c) {
          c = makeChip(el, path);
          chips.push(c);
          try { if (!chipRO && window.ResizeObserver) chipRO = new ResizeObserver(scheduleSync); if (chipRO) chipRO.observe(el); } catch (e) {}
        }
        placeChip(c);
      }
    } catch (e) {}
  }
  function scheduleSync() {
    if (syncFrame) return;
    var run = function () { syncFrame = 0; syncChips(); scheduleRects(); };
    syncFrame = window.requestAnimationFrame ? window.requestAnimationFrame(run) : setTimeout(run, 16);
  }
  // A sheet covers the preview: hide the chips (a class on <html>, no layout work).
  window.__aibSetChipsHidden = function (hidden) {
    try { document.documentElement.classList[hidden ? 'add' : 'remove']('aib-chips-off'); } catch (e) {}
  };
  window.__aibSetSamples = function (paths, note) {
    samples = paths && paths.length ? paths : [];
    sampleNote = typeof note === 'string' ? note : '';
    syncChips();
  };

  // Where the chips are on screen, for the Edit tour only (it points a spotlight at the first chip): the chips
  // that are inside the viewport, in viewport points. Posted when things settle, never while scrolling.
  var rectTimer = null;
  function postRects() {
    try {
      var vw = window.innerWidth || document.documentElement.clientWidth || 0;
      var vh = window.innerHeight || document.documentElement.clientHeight || 0;
      var items = [];
      for (var i = 0; i < chips.length && items.length < 24; i++) {
        if (chips[i].host.style.display === 'none') continue;
        var r = chips[i].chip.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh) continue;
        items.push({ path: chips[i].path, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
      }
      post({ type: 'rects', items: items });
    } catch (e) {}
  }
  function scheduleRects() {
    clearTimeout(rectTimer);
    rectTimer = setTimeout(postRects, 160);
  }
  window.addEventListener('resize', scheduleSync);
  document.addEventListener('load', scheduleSync, true);
  try { if (window.ResizeObserver) new ResizeObserver(scheduleSync).observe(document.documentElement); } catch (e) {}

  // Scroll: report only after the native side restored the previous position,
  // so the fresh document's scrollY=0 never overwrites the saved value.
  var restored = false;
  var pending = false;
  window.addEventListener('scroll', function () {
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
      scheduleSync();
    }
    go();
  };

  // Tailwind CDN and web fonts move things after load: report again a little later.
  function ready() { sweep(); syncChips(); post({ type: 'ready' }); scheduleRects(); setTimeout(syncChips, 700); setTimeout(syncChips, 2000); setTimeout(postRects, 2200); }
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready);
})();
true;`;
