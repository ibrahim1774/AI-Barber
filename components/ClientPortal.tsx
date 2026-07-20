import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Globe, LogOut, Save, Rocket, CheckCircle2, X, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

/*
 * /edit — Client Sites portal.
 *
 * The editing layer for the hand-built static client sites (each one a
 * 20-25 page HTML site deployed as its own Vercel project on the
 * "Client Sites" team). Completely separate from the barber generator:
 * sites live as raw HTML in the `client-sites` storage bucket and are
 * edited in place — there is no WebsiteData model here.
 *
 * Flow: client logs in (account created by scripts/onboard-client-site.mjs)
 * → sees their pages → edits text inline / clicks an image to replace it
 * → Save writes the HTML back to the bucket → Publish deploys the bucket
 * copy to their Vercel project via /api/client-site-publish.
 */

const BUCKET = 'client-sites';
const SANS = '"Manrope", "Inter", system-ui, sans-serif';
const GOLD = '#e8c074';
const BG = '#0a0a0a';

const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const publicBase = `${SUPABASE_URL || ''}/storage/v1/object/public/${BUCKET}`;

// Per-page save history lives in <slug>/_history/ (flat, page path encoded
// with "__" so one list() call finds a page's versions). The publish API and
// the page list both exclude _history so backups never deploy.
const HISTORY_DIR = '_history';
const HISTORY_KEEP = 10;
const historyPrefix = (page: string) => `${page.replace(/\//g, '__')}@@`;
const historyKey = (page: string) => `${historyPrefix(page)}${Date.now()}`;

interface ClientSite {
  slug: string;
  name: string;
  vercel_project_name: string;
  live_url: string | null;
}

// ── storage helpers ────────────────────────────────────────────────────────

async function listAllFiles(prefix: string): Promise<string[]> {
  const out: string[] = [];
  const PAGE = 1000;
  // Offset-paginate: a single list() call truncates past `limit`, and image
  // replacement adds a new images/edit-* file per swap — folders grow.
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(error.message);
    for (const entry of data || []) {
      const full = `${prefix}/${entry.name}`;
      if ((entry as any).id === null) out.push(...(await listAllFiles(full)));
      else out.push(full);
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// ── HTML rewriting (bucket preview ↔ live site) ────────────────────────────
//
// In the editor the page is rendered from a srcDoc, so relative URLs need a
// <base> tag and root-absolute URLs ("/styles.css") need to point at the
// bucket's public copy. Both injections are exactly reversed on save, so the
// stored HTML keeps its original URL style.

function absPrefix(slug: string): string {
  return `${publicBase}/${slug}/`;
}

function rewriteForEditor(html: string, slug: string, pagePath: string): string {
  const dir = pagePath.includes('/') ? pagePath.slice(0, pagePath.lastIndexOf('/') + 1) : '';
  const baseHref = `${absPrefix(slug)}${dir}`;
  let out = html;

  // Root-absolute refs → bucket public URLs (skip protocol-relative "//").
  out = out.replace(
    /(\s(?:href|src|poster))=(["'])\/(?!\/)/g,
    (_m, attr, q) => `${attr}=${q}${absPrefix(slug)}`
  );
  // srcset holds comma-separated candidates ("/img-800.jpg 800w, /img.jpg") —
  // rewrite each root-absolute candidate or the browser resolves them against
  // the injected <base> (supabase origin) and shows broken responsive images.
  out = out.replace(/(\ssrcset=)(["'])([^"']*)\2/gi, (_m, attr, q, val) => {
    const rewritten = String(val).replace(/(^|,)(\s*)\/(?!\/)/g, (_s, sep, ws) => `${sep}${ws}${absPrefix(slug)}`);
    return `${attr}${q}${rewritten}${q}`;
  });
  out = out.replace(/url\(\s*(["']?)\/(?!\/)/g, (_m, q) => `url(${q}${absPrefix(slug)}`);

  // <base> so relative refs ("images/x.jpg", "../styles.css") resolve.
  // (?=[\s>]) so "<header ...>" can't match as the <head> tag.
  const baseTag = `<base data-editor-base href="${baseHref}">`;
  const headRe = /<head(?=[\s>])[^>]*>/i;
  if (headRe.test(out)) out = out.replace(headRe, (m) => `${m}\n${baseTag}`);
  else if (/<html(?=[\s>])[^>]*>/i.test(out)) out = out.replace(/<html(?=[\s>])[^>]*>/i, (m) => `${m}\n${baseTag}`);
  else out = `${baseTag}\n${out}`;

  return out;
}

function serializeForSave(doc: Document, slug: string): string {
  const clone = doc.documentElement.cloneNode(true) as HTMLElement;

  clone.querySelectorAll('[data-editor-style]').forEach((el) => el.remove());
  clone.querySelectorAll('base[data-editor-base]').forEach((el) => el.remove());
  clone.querySelectorAll('[data-editor-editable]').forEach((el) => {
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-editor-editable');
  });
  clone.querySelectorAll('img[data-editor-img]').forEach((el) => {
    el.removeAttribute('data-editor-img');
  });
  clone.querySelectorAll('[data-editor-selected]').forEach((el) => {
    el.removeAttribute('data-editor-selected');
  });
  clone.querySelectorAll('[data-editor-bg-badge]').forEach((el) => el.remove());
  clone.querySelectorAll('[data-editor-bg]').forEach((el) => {
    // Revert the positioning context we added for the badge.
    if (el.hasAttribute('data-editor-bg-pos')) {
      (el as HTMLElement).style.removeProperty('position');
      if (!(el as HTMLElement).getAttribute('style')) el.removeAttribute('style');
      el.removeAttribute('data-editor-bg-pos');
    }
    el.removeAttribute('data-editor-bg');
    el.removeAttribute('data-editor-bg-selected');
  });

  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>\n` : '<!DOCTYPE html>\n';
  let html = doctype + clone.outerHTML;
  // Undo the editor URL rewrite so stored HTML stays root-absolute.
  html = html.split(absPrefix(slug)).join('/');
  return html;
}

// Tags that never get contentEditable (structure, media, form controls).
const NON_EDITABLE_TAGS = new Set([
  'HTML', 'HEAD', 'BODY', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'TITLE',
  'IFRAME', 'SVG', 'PATH', 'IMG', 'PICTURE', 'SOURCE', 'VIDEO', 'AUDIO', 'CANVAS',
  'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'BR', 'HR',
]);

function hasDirectText(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim()) return true;
  }
  return false;
}

// Container-level tags: if an element has one of these as a child, making it
// editable would let a stray Ctrl+A/Delete wipe whole layout sections (grids,
// cards, inline scripts). Editing stays scoped to leaf-ish text elements.
const BLOCK_CHILD_TAGS = new Set([
  'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'MAIN',
  'UL', 'OL', 'TABLE', 'FIGURE', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P',
  'SCRIPT', 'STYLE',
]);

function hasBlockChildren(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if (BLOCK_CHILD_TAGS.has(child.tagName)) return true;
  }
  return false;
}

// Browser-side image shrink so client phone photos don't bloat the site.
async function compressImage(file: File): Promise<{ blob: Blob; ext: string }> {
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
    return { blob: file, ext: file.name.split('.').pop() || 'img' };
  }
  const bitmap = await createImageBitmap(file);
  const MAX_W = 1600;
  const scale = Math.min(1, MAX_W / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  const usePng = file.type === 'image/png';
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, usePng ? 'image/png' : 'image/jpeg', 0.85)
  );
  if (!blob) return { blob: file, ext: file.name.split('.').pop() || 'img' };
  return { blob, ext: usePng ? 'png' : 'jpg' };
}

function pageLabel(path: string): string {
  const noExt = path.replace(/\.html$/, '');
  if (noExt === 'index') return 'Home';
  return noExt
    .split('/')
    .map((seg) => (seg === 'index' ? 'Home' : seg.replace(/-/g, ' ')))
    .join(' › ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── component ──────────────────────────────────────────────────────────────

export const ClientPortal: React.FC = () => {
  const { user, signIn, signOut, isLoading: authLoading } = useAuth();

  // login form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // site + pages
  const [site, setSite] = useState<ClientSite | null>(null);
  const [siteLoaded, setSiteLoaded] = useState(false);
  const [pages, setPages] = useState<string[]>([]);
  const [activePage, setActivePage] = useState<string | null>(null);

  // editor
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  // Bumped to force the active page to reload from the bucket (used by Undo).
  const [reloadKey, setReloadKey] = useState(0);
  const [undoing, setUndoing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  // Clicked photo awaiting replacement. Browsers only open a file chooser
  // from a click in the SAME document as the input — a click inside the
  // sandboxed iframe can't trigger it. So image click selects the photo and
  // this panel's own button (a real parent-document click) opens the picker.
  const [pendingImage, setPendingImage] = useState<{ src: string; kind: 'img' | 'bg' } | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingImgRef = useRef<HTMLImageElement | null>(null);
  // Element whose CSS background-image is being replaced (hero sections etc.).
  const pendingBgRef = useRef<HTMLElement | null>(null);
  const dirtyRef = useRef(false);
  const setDirtyBoth = useCallback((v: boolean) => {
    dirtyRef.current = v;
    setDirty(v);
  }, []);

  const showToast = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  // Load the signed-in client's site + page list.
  useEffect(() => {
    if (!user) {
      setSite(null);
      setSiteLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      // limit(1) instead of maybeSingle(): an account owning 2+ sites (the
      // onboard script allows it) must not error into the "no site" screen —
      // it gets its first site. A real query failure is surfaced, not
      // silently rendered as "no site assigned".
      const { data: rows, error: siteErr } = await supabase
        .from('client_sites')
        .select('slug, name, vercel_project_name, live_url')
        .eq('owner', user.id)
        .order('created_at', { ascending: true })
        .limit(1);
      if (cancelled) return;
      if (siteErr) {
        console.error('[portal] site lookup failed:', siteErr);
        setSiteLoaded(true);
        showToast('err', 'Could not load your site — check your connection and refresh.');
        return;
      }
      const data = (rows?.[0] as ClientSite) || null;
      setSite(data);
      setSiteLoaded(true);
      if (data) {
        try {
          const files = await listAllFiles((data as ClientSite).slug);
          if (cancelled) return;
          const html = files
            .map((f) => f.slice((data as ClientSite).slug.length + 1))
            .filter((f) => f.endsWith('.html') && !f.startsWith(`${HISTORY_DIR}/`))
            .sort((a, b) =>
              a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)
            );
          setPages(html);
          if (html.length) setActivePage(html[0]);
        } catch (e) {
          console.error('[portal] page list failed:', e);
          showToast('err', 'Could not load your pages. Refresh to retry.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, showToast]);

  // Load the active page's HTML into the editor.
  useEffect(() => {
    if (!site || !activePage) return;
    let cancelled = false;
    setPageLoading(true);
    setSrcDoc(null);
    (async () => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .download(`${site.slug}/${activePage}`);
      if (cancelled) return;
      setPageLoading(false);
      if (error || !data) {
        showToast('err', `Could not open ${activePage}`);
        return;
      }
      const html = await data.text();
      if (cancelled) return;
      setSrcDoc(rewriteForEditor(html, site.slug, activePage));
      setDirtyBoth(false);
      // A page change replaces the document — any selected photo is stale.
      setPendingImage(null);
      pendingImgRef.current = null;
      pendingBgRef.current = null;
    })();
    return () => {
      cancelled = true;
    };
  }, [site, activePage, reloadKey, showToast, setDirtyBoth]);

  // Warn about unsaved edits on tab close.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Wire up editing inside the iframe once the page renders.
  const handleIframeLoad = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !doc.body) return;

    // Editor affordances (stripped on save).
    const style = doc.createElement('style');
    style.setAttribute('data-editor-style', '1');
    style.textContent = `
      [data-editor-editable]:hover { outline: 1.5px dashed rgba(232,192,116,0.85) !important; outline-offset: 2px; cursor: text; }
      [data-editor-editable]:focus { outline: 2px solid rgba(232,192,116,1) !important; outline-offset: 2px; }
      img[data-editor-img]:hover { outline: 2px dashed rgba(232,192,116,0.95) !important; outline-offset: 2px; cursor: pointer !important; filter: brightness(0.85); }
      img[data-editor-selected] { outline: 3px solid rgba(232,192,116,1) !important; outline-offset: 2px; }
      [data-editor-bg-badge] {
        position: absolute; top: 14px; right: 14px; z-index: 2147483000;
        display: inline-flex; align-items: center; gap: 6px;
        padding: 10px 14px; border-radius: 999px;
        background: rgba(10,10,10,0.82); color: rgba(232,192,116,1);
        border: 1.5px solid rgba(232,192,116,0.9);
        font: 700 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        letter-spacing: 0.04em; white-space: nowrap; cursor: pointer;
        box-shadow: 0 4px 16px rgba(0,0,0,0.45);
      }
      [data-editor-bg-badge]:hover { background: rgba(232,192,116,1); color: #0a0a0a; }
      [data-editor-bg]:hover { outline: 2px dashed rgba(232,192,116,0.55) !important; outline-offset: -2px; }
      [data-editor-bg-selected] { outline: 3px solid rgba(232,192,116,1) !important; outline-offset: -3px; }
    `;
    doc.head.appendChild(style);

    // Text: leaf-ish elements with their own text become editable in place.
    // 'plaintext-only' keeps Enter/paste from injecting <div>/<span> junk
    // into the saved HTML; skipping elements with block children keeps a
    // stray select-all+delete from wiping whole sections.
    doc.body.querySelectorAll('*').forEach((el) => {
      if (NON_EDITABLE_TAGS.has(el.tagName)) return;
      if (el.closest('script, style, svg')) return;
      if (!hasDirectText(el)) return;
      if (hasBlockChildren(el)) return;
      el.setAttribute('contenteditable', 'plaintext-only');
      el.setAttribute('data-editor-editable', '1');
    });
    doc.body.addEventListener('input', () => setDirtyBoth(true));

    // Links: never navigate away inside the editor.
    doc.body.addEventListener(
      'click',
      (e) => {
        const target = e.target as Element | null;
        // "Change background" badge → select the host section and open the
        // parent-side panel (same pattern as photos: the real file-chooser
        // click happens in the parent document).
        const badge = target?.closest?.('[data-editor-bg-badge]');
        if (badge) {
          e.preventDefault();
          e.stopPropagation();
          const host = badge.closest('[data-editor-bg]') as HTMLElement | null;
          if (host) {
            doc.querySelectorAll('img[data-editor-selected]').forEach((el) => el.removeAttribute('data-editor-selected'));
            doc.querySelectorAll('[data-editor-bg-selected]').forEach((el) => el.removeAttribute('data-editor-bg-selected'));
            host.setAttribute('data-editor-bg-selected', '1');
            pendingImgRef.current = null;
            pendingBgRef.current = host;
            const bg = doc.defaultView?.getComputedStyle(host).backgroundImage || '';
            const m = bg.match(/url\(["']?([^"')]+)["']?\)/i);
            setPendingImage({ src: m?.[1] || '', kind: 'bg' });
          }
          return;
        }
        const a = target?.closest?.('a');
        // NOT `instanceof HTMLImageElement`: the element lives in the
        // IFRAME's realm, so the parent window's constructor never matches
        // and the branch silently never runs. Tag check is realm-safe.
        // closest() also catches clicks landing on a wrapper (<picture>).
        const img = (target?.closest?.('img') ??
          (target && target.tagName === 'IMG' ? target : null)) as HTMLImageElement | null;
        if (img && img.hasAttribute('data-editor-img')) {
          e.preventDefault();
          e.stopPropagation();
          // Select the photo and open the parent-side panel; the panel's
          // "Choose new photo" button (a real click in THIS document) is
          // what opens the file chooser — an iframe click can't.
          doc.querySelectorAll('img[data-editor-selected]').forEach((el) => el.removeAttribute('data-editor-selected'));
          img.setAttribute('data-editor-selected', '1');
          doc.querySelectorAll('[data-editor-bg-selected]').forEach((el) => el.removeAttribute('data-editor-bg-selected'));
          pendingBgRef.current = null;
          pendingImgRef.current = img;
          setPendingImage({ src: img.currentSrc || img.src, kind: 'img' });
          return;
        }
        if (a) e.preventDefault();
      },
      true
    );

    // Images: click-to-replace.
    doc.body.querySelectorAll('img').forEach((img) => img.setAttribute('data-editor-img', '1'));

    // CSS background images (hero sections etc.): sizeable elements whose
    // background is a real url() get an always-visible "Change background"
    // badge. A badge — not click-anywhere — because these sections are full
    // of editable text; tapping the headline must keep editing text.
    const win = doc.defaultView;
    if (win) {
      doc.body.querySelectorAll<HTMLElement>('*').forEach((el) => {
        if (el.closest('script, style, svg, [data-editor-bg-badge]')) return;
        // Nested background layers: the outermost host already got a badge.
        if (el.parentElement?.closest('[data-editor-bg]')) return;
        const bg = win.getComputedStyle(el).backgroundImage;
        if (!bg || bg === 'none' || !/url\(/i.test(bg)) return;
        // Data-URI textures (tiny inline patterns) aren't client photos.
        if (/url\(["']?data:/i.test(bg) && !/url\(["']?https?:/i.test(bg) && !/url\(["']?\//i.test(bg)) return;
        const r = el.getBoundingClientRect();
        // Skip icons/textures — only section-scale backgrounds are editable.
        if (r.width < 220 || r.height < 140) return;
        el.setAttribute('data-editor-bg', '1');
        // The badge is absolutely positioned — give static hosts a
        // positioning context, reverted on save.
        if (win.getComputedStyle(el).position === 'static') {
          el.style.position = 'relative';
          el.setAttribute('data-editor-bg-pos', '1');
        }
        const badge = doc.createElement('button');
        badge.type = 'button';
        badge.setAttribute('data-editor-bg-badge', '1');
        badge.setAttribute('contenteditable', 'false');
        badge.textContent = '📷 Change background';
        el.appendChild(badge);
      });
    }
  }, [setDirtyBoth]);

  // Replace the clicked image with an uploaded (compressed) one.
  const handleImageFile = useCallback(
    async (file: File) => {
      // Background replacement: swap only the url(...) layer of the host's
      // computed background-image so gradient overlays survive, and write it
      // inline (inline longhand beats the stylesheet).
      const bgEl = pendingBgRef.current;
      if (bgEl && site) {
        setPendingImage(null);
        pendingBgRef.current = null;
        bgEl.removeAttribute('data-editor-bg-selected');
        try {
          const { blob, ext } = await compressImage(file);
          const path = `${site.slug}/images/edit-${Date.now()}.${ext}`;
          const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
            contentType: blob.type || 'application/octet-stream',
            upsert: true,
          });
          if (error) throw new Error(error.message);
          const newUrl = `${publicBase}/${path}`;
          const doc = bgEl.ownerDocument;
          const computed = doc.defaultView?.getComputedStyle(bgEl).backgroundImage || '';
          const swapped = computed.replace(/url\((["']?)(?:(?!\1\)).)*\1\)/i, `url("${newUrl}")`);
          bgEl.style.backgroundImage = /url\(/i.test(swapped) && swapped !== computed ? swapped : `url("${newUrl}")`;
          setDirtyBoth(true);
          showToast('ok', 'Background replaced — remember to Save');
        } catch (e: any) {
          console.error('[portal] background upload failed:', e);
          showToast('err', `Background upload failed: ${e?.message || 'unknown error'}`);
        }
        return;
      }
      const img = pendingImgRef.current;
      setPendingImage(null);
      if (!img || !site) return;
      pendingImgRef.current = null;
      img.removeAttribute('data-editor-selected');
      try {
        const { blob, ext } = await compressImage(file);
        const path = `${site.slug}/images/edit-${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
          contentType: blob.type || 'application/octet-stream',
          upsert: true,
        });
        if (error) throw new Error(error.message);
        img.src = `${publicBase}/${path}`;
        // srcset would override our new src at some widths — drop it.
        img.removeAttribute('srcset');
        img.removeAttribute('data-src');
        // Inside <picture>, sibling <source> elements outrank the <img> —
        // remove them or the live site keeps showing the OLD image.
        const picture = img.closest('picture');
        if (picture) picture.querySelectorAll('source').forEach((s) => s.remove());
        setDirtyBoth(true);
        showToast('ok', 'Image replaced — remember to Save');
      } catch (e: any) {
        console.error('[portal] image upload failed:', e);
        showToast('err', `Image upload failed: ${e?.message || 'unknown error'}`);
      }
    },
    [site, setDirtyBoth, showToast]
  );

  // Back up the page's CURRENT version into _history before overwriting it,
  // pruned to the newest HISTORY_KEEP entries per page. Best-effort — a
  // backup failure never blocks the save itself.
  const backupCurrentVersion = useCallback(async (slug: string, page: string) => {
    try {
      const { data: current } = await supabase.storage.from(BUCKET).download(`${slug}/${page}`);
      if (!current) return;
      await supabase.storage
        .from(BUCKET)
        .upload(`${slug}/${HISTORY_DIR}/${historyKey(page)}`, current, {
          contentType: 'text/html',
          upsert: true,
        });
      // Prune old versions of this page.
      const { data: entries } = await supabase.storage
        .from(BUCKET)
        .list(`${slug}/${HISTORY_DIR}`, { limit: 1000 });
      const mine = (entries || [])
        .filter((e) => e.name.startsWith(historyPrefix(page)))
        .sort((a, b) => b.name.localeCompare(a.name)); // ts suffix → newest first
      const stale = mine.slice(HISTORY_KEEP).map((e) => `${slug}/${HISTORY_DIR}/${e.name}`);
      if (stale.length) await supabase.storage.from(BUCKET).remove(stale);
    } catch (e) {
      console.warn('[portal] history backup failed (save continues):', e);
    }
  }, []);

  const handleSave = useCallback(async () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !site || !activePage) return;
    setSaving(true);
    try {
      const html = serializeForSave(doc, site.slug);
      await backupCurrentVersion(site.slug, activePage);
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(`${site.slug}/${activePage}`, new Blob([html], { type: 'text/html' }), {
          contentType: 'text/html',
          upsert: true,
        });
      if (error) throw new Error(error.message);
      setDirtyBoth(false);
      showToast('ok', 'Saved. Publish when you want it live.');
    } catch (e: any) {
      console.error('[portal] save failed:', e);
      showToast('err', `Save failed: ${e?.message || 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  }, [site, activePage, setDirtyBoth, showToast, backupCurrentVersion]);

  // Undo, two stages:
  //  - Unsaved edits on screen → discard them (reload the saved version).
  //  - Nothing unsaved → swap the page with its previous saved version
  //    (the current one is backed up first, so pressing Undo again brings
  //    it right back — undo/redo toggle).
  const handleUndo = useCallback(async () => {
    if (!site || !activePage || saving || undoing) return;

    if (dirtyRef.current) {
      if (!window.confirm('Throw away the edits you just made on this page?')) return;
      setReloadKey((k) => k + 1); // reload from the bucket → unsaved edits gone
      return;
    }

    setUndoing(true);
    try {
      const { data: entries } = await supabase.storage
        .from(BUCKET)
        .list(`${site.slug}/${HISTORY_DIR}`, { limit: 1000 });
      const mine = (entries || [])
        .filter((e) => e.name.startsWith(historyPrefix(activePage)))
        .sort((a, b) => b.name.localeCompare(a.name));
      if (!mine.length) {
        showToast('err', 'Nothing to undo yet on this page.');
        return;
      }
      if (!window.confirm('Put this page back to how it was before your last save?')) return;

      const prevKey = `${site.slug}/${HISTORY_DIR}/${mine[0].name}`;
      const { data: prev, error: prevErr } = await supabase.storage.from(BUCKET).download(prevKey);
      if (prevErr || !prev) throw new Error(prevErr?.message || 'Could not load the previous version');

      // Current version → history (so Undo can be undone), then restore.
      await backupCurrentVersion(site.slug, activePage);
      const { error: putErr } = await supabase.storage
        .from(BUCKET)
        .upload(`${site.slug}/${activePage}`, prev, { contentType: 'text/html', upsert: true });
      if (putErr) throw new Error(putErr.message);
      await supabase.storage.from(BUCKET).remove([prevKey]);

      setReloadKey((k) => k + 1);
      showToast('ok', 'Went back to the previous version — Publish to make it live.');
    } catch (e: any) {
      console.error('[portal] undo failed:', e);
      showToast('err', `Undo failed: ${e?.message || 'unknown error'}`);
    } finally {
      setUndoing(false);
    }
  }, [site, activePage, saving, undoing, showToast, backupCurrentVersion]);

  const handlePublish = useCallback(async () => {
    if (!site) return;
    if (dirtyRef.current) {
      showToast('err', 'You have unsaved edits — hit Save first.');
      return;
    }
    setPublishing(true);
    setPublishedUrl(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error('Session expired — sign in again');
      const resp = await fetch('/api/client-site-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ slug: site.slug }),
      });
      // A platform 502/504 returns an HTML error page, not JSON — don't let
      // the parse error mask the real outcome.
      let json: { ok?: boolean; url?: string; error?: string } = {};
      try {
        json = await resp.json();
      } catch {
        throw new Error(
          resp.ok
            ? 'Publish finished but the response was unreadable — check your live site.'
            : `Publish failed (${resp.status}). Give it a minute, then check your live site before retrying.`
        );
      }
      if (!resp.ok || !json.ok) throw new Error(json.error || 'Publish failed');
      setPublishedUrl(json.url || site.live_url || '');
    } catch (e: any) {
      console.error('[portal] publish failed:', e);
      showToast('err', e?.message || 'Publish failed');
    } finally {
      setPublishing(false);
    }
  }, [site, showToast]);

  const switchPage = useCallback(
    (page: string) => {
      if (page === activePage) return;
      if (dirtyRef.current && !window.confirm('You have unsaved edits on this page. Leave without saving?')) {
        return;
      }
      setActivePage(page);
    },
    [activePage]
  );

  const handleLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLoginBusy(true);
      setLoginError(null);
      const { error } = await signIn(email.trim(), password);
      setLoginBusy(false);
      if (error) setLoginError('Wrong email or password. Check the login you were given.');
    },
    [email, password, signIn]
  );

  // ── screens ──────────────────────────────────────────────────────────────

  // Session restore in flight — don't flash the login form at a signed-in
  // client on every refresh.
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: BG }}>
        <Loader2 size={32} className="animate-spin" style={{ color: GOLD }} />
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-5"
        style={{ background: BG, fontFamily: SANS }}
      >
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-7"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] mb-2" style={{ color: GOLD }}>
            Client Portal
          </p>
          <h1 className="text-xl font-bold text-white mb-1">Edit your website</h1>
          <p className="text-[12px] text-white/50 mb-5">
            Sign in with the login your web team gave you.
          </p>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full mb-2.5 rounded-lg border border-white/15 bg-transparent px-3.5 py-3 text-[14px] text-white placeholder-white/30 outline-none focus:border-white/40"
          />
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full mb-3 rounded-lg border border-white/15 bg-transparent px-3.5 py-3 text-[14px] text-white placeholder-white/30 outline-none focus:border-white/40"
          />
          {loginError && <p className="mb-3 text-[12px] text-red-400">{loginError}</p>}
          <button
            type="submit"
            disabled={loginBusy}
            className="w-full rounded-lg py-3 text-[12px] font-black uppercase tracking-[0.18em] transition disabled:opacity-60"
            style={{ background: GOLD, color: '#0a0a0a' }}
          >
            {loginBusy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    );
  }

  if (!siteLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: BG }}>
        <Loader2 size={32} className="animate-spin" style={{ color: GOLD }} />
      </div>
    );
  }

  if (!site) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4 px-5 text-center"
        style={{ background: BG, fontFamily: SANS }}
      >
        <p className="text-white text-lg font-semibold">No website is assigned to this account yet.</p>
        <p className="text-white/50 text-sm max-w-sm">
          If that seems wrong, contact the team that built your site.
        </p>
        <button
          onClick={() => signOut()}
          className="mt-2 rounded-lg border border-white/20 px-5 py-2.5 text-[12px] font-bold uppercase tracking-[0.15em] text-white"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: BG, fontFamily: SANS }}>
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-white">{site.name}</p>
          {site.live_url && (
            <a
              href={site.live_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-white/45 hover:text-white/80"
            >
              <Globe size={11} /> {site.live_url.replace(/^https?:\/\//, '')}
            </a>
          )}
        </div>
        <button
          onClick={handleUndo}
          disabled={saving || undoing || pageLoading}
          title="Undo — go back to how this page was"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3.5 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-white/70 transition hover:text-white disabled:opacity-40"
        >
          {undoing ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
          <span className="hidden sm:inline">Undo</span>
        </button>
        <button
          onClick={handleSave}
          disabled={!dirty || saving || pageLoading}
          className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] transition disabled:opacity-40"
          style={{ borderColor: GOLD, color: GOLD }}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {dirty ? 'Save' : 'Saved'}
        </button>
        <button
          onClick={handlePublish}
          disabled={publishing || saving}
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] transition disabled:opacity-60"
          style={{ background: GOLD, color: '#0a0a0a' }}
        >
          {publishing ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
          {publishing ? 'Publishing…' : 'Publish'}
        </button>
        <button
          onClick={() => signOut()}
          title="Sign out"
          className="rounded-lg border border-white/15 p-2.5 text-white/60 hover:text-white"
        >
          <LogOut size={14} />
        </button>
      </header>

      {/* Body: page list + editor */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Mobile page picker */}
        <div className="border-b border-white/10 p-2 md:hidden">
          <select
            value={activePage || ''}
            onChange={(e) => switchPage(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-[#141414] px-3 py-2.5 text-[13px] text-white outline-none"
          >
            {pages.map((p) => (
              <option key={p} value={p}>
                {pageLabel(p)}
              </option>
            ))}
          </select>
        </div>

        {/* Desktop sidebar */}
        <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-white/10 py-3 md:block">
          <p className="px-4 pb-2 text-[9px] font-bold uppercase tracking-[0.25em] text-white/35">
            Pages ({pages.length})
          </p>
          {pages.map((p) => (
            <button
              key={p}
              onClick={() => switchPage(p)}
              className={`block w-full truncate px-4 py-2 text-left text-[12.5px] transition ${
                p === activePage
                  ? 'bg-white/[0.07] font-semibold text-white'
                  : 'text-white/55 hover:bg-white/[0.04] hover:text-white/85'
              }`}
              style={p === activePage ? { boxShadow: `inset 2px 0 0 ${GOLD}` } : undefined}
            >
              {pageLabel(p)}
            </button>
          ))}
        </aside>

        {/* Editor */}
        <main className="relative min-h-0 flex-1 bg-white">
          {pageLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
              <Loader2 size={30} className="animate-spin" style={{ color: GOLD }} />
            </div>
          )}
          {srcDoc !== null && (
            <iframe
              ref={iframeRef}
              srcDoc={srcDoc}
              onLoad={handleIframeLoad}
              title="Page editor"
              className="h-full min-h-[70vh] w-full border-0"
              // No allow-scripts ON PURPOSE: (1) the site's own JS would run
              // same-origin with the portal and could read the Supabase
              // session from localStorage; (2) script-driven DOM mutations
              // (nav clones, banners, lazy-loaders) would get baked into
              // every Save and compound per publish. Editing is parent-driven
              // and needs only allow-same-origin.
              sandbox="allow-same-origin"
            />
          )}
        </main>
      </div>

      {/* Hint bar */}
      <div className="border-t border-white/10 px-4 py-2 text-center text-[11px] text-white/40">
        Click any text to edit it. Click any photo to replace it. Use the 📷 Change background button on photo backdrops. Save, then Publish to update your live site.
      </div>

      {/* Hidden picker for image replacement */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void handleImageFile(f);
        }}
      />

      {/* Photo-replace panel. The file chooser must be opened by a click in
          THIS document (browser rule), so the iframe click only selects the
          photo and this button does the actual open. */}
      {pendingImage && (
        <div className="fixed bottom-14 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/10 bg-[#141414] p-3 pr-4 shadow-2xl">
          {pendingImage.src ? (
            <img
              src={pendingImage.src}
              alt="Selected photo"
              className="h-14 w-14 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-white/5 text-[20px]">📷</div>
          )}
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-white">
              {pendingImage.kind === 'bg' ? 'Change this background photo?' : 'Replace this photo?'}
            </p>
            <p className="text-[11px] text-white/45">JPG or PNG — we&apos;ll resize it for you.</p>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="ml-2 shrink-0 rounded-lg px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.12em]"
            style={{ background: GOLD, color: '#0a0a0a' }}
          >
            Choose new photo
          </button>
          <button
            onClick={() => {
              pendingImgRef.current?.removeAttribute('data-editor-selected');
              pendingImgRef.current = null;
              pendingBgRef.current?.removeAttribute('data-editor-bg-selected');
              pendingBgRef.current = null;
              setPendingImage(null);
            }}
            className="shrink-0 rounded-lg border border-white/15 p-2.5 text-white/60 hover:text-white"
            aria-label="Cancel"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-full px-5 py-2.5 text-[12.5px] font-semibold shadow-xl ${
            toast.kind === 'ok' ? 'bg-emerald-500 text-black' : 'bg-red-500 text-white'
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Publish success */}
      {publishedUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-5">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#141414] p-7 text-center">
            <button
              onClick={() => setPublishedUrl(null)}
              className="absolute-close float-right -mt-2 -mr-2 p-1 text-white/40 hover:text-white"
              aria-label="Close"
            >
              <X size={16} />
            </button>
            <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-400" />
            <p className="text-lg font-bold text-white">Your site is live!</p>
            <p className="mt-1 text-[12.5px] text-white/50">
              Changes are on your website now. It can take a few seconds to show everywhere.
            </p>
            <a
              href={publishedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-block w-full rounded-lg py-3 text-[12px] font-black uppercase tracking-[0.16em]"
              style={{ background: GOLD, color: '#0a0a0a' }}
            >
              View my website
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientPortal;
