// Where the public image endpoints (api/upload-image, api/get-upload-urls) may write.
//
// Both are unauthenticated and write `${folder}/${filename}` in the same bucket that holds the
// server's own JSON (pending-sites/{slug}.json is an app site's stored copy, which a sweep
// restore or admin republish deploys). Without these checks, siteId 'pending-sites' and
// filename 'fade-lab.json' replaced any app site's stored copy.
//
// Real callers:
// - web editor / publish: folder = the shop slug, filename `hero-<ts>.jpg`, `gallery-0-<ts>.jpg`...
// - iOS app: folder = `<draftId>`, `ios-drafts/<draftId>` or `ab-products/<shopId>`,
//   filename `<ts>-<rand>.jpg`.

/** First path segments the server writes itself. Never writable through the image endpoints. */
export const RESERVED_PREFIXES = ['pending-sites', 'pending-sites-history', 'admin-republish-runs'];

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const IMAGE_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,150}\.(jpe?g|png|webp|gif|heic|heif|avif|svg)$/i;

/** The folder when it is a safe, non-reserved image folder (1 to 3 segments), else null. */
export function imageFolder(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split('/');
  if (parts.length < 1 || parts.length > 3) return null;
  if (!parts.every((p) => SEGMENT.test(p))) return null;
  if (RESERVED_PREFIXES.some((r) => r === parts[0].toLowerCase())) return null;
  return parts.join('/');
}

/** The filename when it is a single-segment image name, else null. */
export function imageFilename(raw: unknown): string | null {
  return typeof raw === 'string' && IMAGE_FILE.test(raw) ? raw : null;
}

/** A content type the image endpoints accept. */
export function isImageContentType(ct: string): boolean {
  return /^image\/[a-z0-9.+-]+$/i.test(ct);
}
