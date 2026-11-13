import { fetchPublicImage } from './safeFetch.js';

/** A website import's logo is returned inline (never as a URL on the old site): the app re-uploads it to our storage like a picked file. */
export const MAX_LOGO_BYTES = 1.5 * 1024 * 1024;
const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** The logo as a `data:` URL, or undefined for any problem (private host, wrong type such as SVG/GIF, too big, timeout). Never throws. */
export async function logoDataUrlOf(logoUrl: unknown, fetchImage: typeof fetchPublicImage = fetchPublicImage): Promise<string | undefined> {
  if (typeof logoUrl !== 'string' || !logoUrl) return undefined;
  try {
    const { buffer, contentType } = await fetchImage(logoUrl, { maxBytes: MAX_LOGO_BYTES });
    if (!LOGO_TYPES.has(contentType) || buffer.byteLength === 0 || buffer.byteLength > MAX_LOGO_BYTES) return undefined;
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch {
    return undefined;
  }
}
