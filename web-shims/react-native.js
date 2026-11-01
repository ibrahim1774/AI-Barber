// Web stand-in for 'react-native': everything react-native-web exports, plus the pieces it leaves out that this app uses.
// ActionSheetIOS is missing from react-native-web (showActionSheetWithOptions was undefined and threw), so it is a small
// DOM menu here. Only the metro web resolver maps to this file; iOS never sees it.
export * from 'react-native-web';

function showActionSheetWithOptions(config, callback) {
  const doc = typeof document !== 'undefined' ? document : null;
  const options = (config && config.options) || [];
  const cancelIdx = config && typeof config.cancelButtonIndex === 'number' ? config.cancelButtonIndex : -1;
  const destructive = config && config.destructiveButtonIndex;
  const destructiveSet = Array.isArray(destructive) ? destructive : destructive == null ? [] : [destructive];
  if (!doc) return;
  const root = doc.createElement('div');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;font-family:system-ui,-apple-system,sans-serif';
  const card = doc.createElement('div');
  card.style.cssText = 'width:100%;max-width:420px;margin:0 8px 8px;display:flex;flex-direction:column;gap:8px';
  const group = doc.createElement('div');
  group.style.cssText = 'background:#1c1c1e;border-radius:14px;overflow:hidden';
  let done = false;
  const finish = (i) => {
    if (done) return;
    done = true;
    doc.removeEventListener('keydown', onKey, true);
    root.remove();
    if (typeof callback === 'function') callback(i);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(cancelIdx); } };
  const heading = [config && config.title, config && config.message].filter(Boolean).join(' - ');
  if (heading) {
    const h = doc.createElement('div');
    h.textContent = heading;
    h.style.cssText = 'padding:12px 16px;font-size:13px;color:rgba(255,255,255,.55);text-align:center;border-bottom:1px solid rgba(255,255,255,.1)';
    group.appendChild(h);
  }
  const mk = (label, i, parent, last) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-label', label);
    const bad = destructiveSet.indexOf(i) >= 0;
    b.style.cssText = 'display:block;width:100%;padding:15px 16px;font-size:17px;border:0;cursor:pointer;background:transparent;color:' + (bad ? '#ff453a' : '#0a84ff') + (i === cancelIdx ? ';font-weight:600' : '') + (last ? '' : ';border-bottom:1px solid rgba(255,255,255,.1)');
    b.addEventListener('click', () => finish(i));
    parent.appendChild(b);
  };
  const rest = options.map((_, i) => i).filter((i) => i !== cancelIdx);
  rest.forEach((i, k) => mk(options[i], i, group, k === rest.length - 1));
  card.appendChild(group);
  if (cancelIdx >= 0 && options[cancelIdx] != null) {
    const g2 = doc.createElement('div');
    g2.style.cssText = 'background:#2c2c2e;border-radius:14px;overflow:hidden';
    mk(options[cancelIdx], cancelIdx, g2, true);
    card.appendChild(g2);
  }
  root.appendChild(card);
  root.addEventListener('click', (e) => { if (e.target === root) finish(cancelIdx); });
  doc.addEventListener('keydown', onKey, true);
  doc.body.appendChild(root);
  const first = root.querySelector('button');
  if (first) first.focus();
}

export const ActionSheetIOS = {
  showActionSheetWithOptions,
  showShareActionSheetWithOptions(_options, failure) { if (typeof failure === 'function') failure(new Error('Sharing is not available in the browser.')); },
  dismissActionSheet() {},
};
