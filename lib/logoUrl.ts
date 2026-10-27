// The shop logo (`site.logo = { url, w, h }`): what an upload may be and what a saved or published site may point at.
//
// The upload endpoints are unauthenticated and the logo URL comes from the client, so a URL is never proof of
// ownership. A logo URL is accepted only when it is OUR bucket's public URL for
//   <site folder>/logo/<name>.(png|jpg|jpeg)
// where the site folder is a safe, non-reserved image folder (lib/uploadTarget.ts), and (on the paths that know
// it) is this site's folder. The `/logo/` segment also keeps the file out of the photo cleanup in
// lib/ios/removeSiteLive.ts, whose URL-derived deletions only match ios-drafts/<draftId>/<file>.
import { imageFolder } from './uploadTarget.js';
import { MAX_LOGO_EDGE, MAX_LOGO_ASPECT, logoDimsOk } from './render/logo.js';

/** Content types a logo may be uploaded as. */
export const LOGO_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;
export const isLogoContentType = (ct: unknown): boolean => typeof ct === 'string' && (LOGO_CONTENT_TYPES as readonly string[]).includes(ct);

export { MAX_LOGO_EDGE, MAX_LOGO_ASPECT, logoDimsOk };

/** A logo file name: png/jpg/jpeg only. */
export const LOGO_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,150}\.(png|jpe?g)$/i;

/** `<site folder>/logo` for a safe upload folder, else null. */
export function logoFolderFor(siteFolder: unknown): string | null {
  const f = imageFolder(siteFolder);
  return f ? `${f}/logo` : null;
}

export interface LogoRules {
  /** Our bucket's name (GCS_BUCKET_NAME). Empty: nothing can be proven, so nothing is accepted. */
  bucketName: string;
  /** Whether the site folder (the part before /logo/<file>) is this site's. Absent: any safe folder. */
  allowFolder?: (folder: string) => boolean;
}

/** The site folder a logo URL sits in, or null when it is not `<bucket URL>/<safe folder>/logo/<png|jpg|jpeg>`. */
export function logoSiteFolder(url: unknown, bucketName: string): string | null {
  if (typeof url !== 'string' || !bucketName) return null;
  const prefix = `https://storage.googleapis.com/${bucketName}/`;
  if (!url.startsWith(prefix)) return null;
  const path = url.slice(prefix.length);
  // No query, fragment, escapes or odd characters: the stored path must be exactly the object path.
  if (!/^[A-Za-z0-9/_.-]+$/.test(path) || path.includes('..') || path.includes('//')) return null;
  const parts = path.split('/');
  if (parts.length < 3) return null;
  const file = parts[parts.length - 1];
  if (parts[parts.length - 2] !== 'logo' || !LOGO_FILE.test(file)) return null;
  return imageFolder(parts.slice(0, -2).join('/'));
}

/** Why this `site.logo` cannot be stored or rendered (null when it can). */
export function logoProblem(logo: unknown, rules: LogoRules): string | null {
  if (!logo || typeof logo !== 'object' || Array.isArray(logo)) return 'logo must be an object { url, w, h }';
  const { url, w, h } = logo as Record<string, unknown>;
  if (!logoDimsOk(w, h)) return 'logo w and h must be whole numbers from 1 to 4000';
  const folder = logoSiteFolder(url, rules.bucketName);
  if (!folder) return 'logo.url must be a png or jpeg this site uploaded to our storage (<folder>/logo/<file>)';
  if (rules.allowFolder && !rules.allowFolder(folder)) return "logo.url is not in this site's upload folder";
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRAFT_FOLDER = /^ios-drafts\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

/**
 * Folders an app publish may point a logo at: the anonymous draft folders the app uploads to
 * (`ios-drafts/<draftId>`, or a bare draft UUID). Never a slug folder, which belongs to a published site.
 */
export const isDraftLogoFolder = (folder: string): boolean => DRAFT_FOLDER.test(folder) || UUID.test(folder);

/** The folders a stored draft named `draftId` owns. */
export const draftOwnFolder = (draftId: string) => (folder: string): boolean => folder === draftId || folder === `ios-drafts/${draftId}`;

/** GCS_BUCKET_NAME, or '' when unset. */
export const configuredBucket = (): string => (process.env.GCS_BUCKET_NAME || '').trim();
