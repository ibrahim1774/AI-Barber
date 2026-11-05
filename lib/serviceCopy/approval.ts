// Server-stamped approval of model text (review 6c B2). The renderer is pure and also runs in the browser, so it cannot hold a secret;
// instead every server step that lets site data towards a public page (draft save, publish snapshot, and the render of every
// deploy: renderPendingBundle) calls svcCopySanitize, which keeps a piece of model text ONLY if its signature verifies:
//
//   approvalSig = HMAC-SHA256(secret, ['svccopy-approval-v1', scope, approval, serviceKey, niche, digest(text)])
//   approvalScope = HMAC(secret, userId) (opaque, 32 hex), checked against the signed-in owner wherever the owner is known
//
// The signature is issued only by the approve endpoint (approval 'owner') and, while SERVICE_COPY_AUTO_PUBLISH is on, by write
// (approval 'auto'). A client can copy a signed entry back unchanged, but cannot create, edit, move to another service, move to
// another owner, or re-label (owner <-> auto) one. No secret configured = nothing can be signed and nothing verifies (fail closed).
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { checkEntryShape, type SvcCopyEntry } from '../render/svcCopy.js';

/** The signing key. Read per call. Unset or short = null: no approval can be issued and no model text verifies. */
export function signingSecret(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.SERVICE_COPY_SIGNING_SECRET;
  return typeof v === 'string' && v.length >= 16 ? v : null;
}

const canon = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
};

/** sha256 of the text of an entry (normalised by the shape check), ignoring only the approval fields themselves. */
export function entryDigest(raw: unknown): string | null {
  const shape = checkEntryShape(raw);
  if (!shape.ok) return null;
  const { approval: _a, approvalSig: _s, approvalScope: _c, ...text } = shape.entry;
  return createHash('sha256').update(canon(text)).digest('hex');
}

export const userScope = (secret: string, userId: string): string => createHmac('sha256', secret).update(`scope|${userId}`).digest('hex').slice(0, 32);

const sigOf = (secret: string, p: { scope: string; approval: 'owner' | 'auto'; titleKey: string; niche: string; digest: string }): string =>
  createHmac('sha256', secret).update(JSON.stringify(['svccopy-approval-v1', p.scope, p.approval, p.titleKey, p.niche, p.digest])).digest('hex');

/** The entry with a fresh approval stamp, or null when it cannot be signed (no secret, unusable text). */
export function stampApproval(secret: string | null | undefined, who: { userId: string }, titleKey: string, niche: string, entry: SvcCopyEntry, approval: 'owner' | 'auto'): SvcCopyEntry | null {
  if (!secret) return null;
  const { approval: _a, approvalSig: _s, approvalScope: _c, ...bare } = entry;
  const digest = entryDigest({ ...bare, aiGenerated: true });
  if (!digest) return null;
  const scope = userScope(secret, who.userId);
  return { ...bare, aiGenerated: true, approval, approvalScope: scope, approvalSig: sigOf(secret, { scope, approval, titleKey, niche, digest }) };
}

/** True only for an entry whose signature was issued by this server for exactly this text, service key, niche (and owner, when known). */
export function verifyApproval(secret: string | null | undefined, raw: unknown, titleKey: string, niche: string, userId?: string): boolean {
  if (!secret) return false;
  const shape = checkEntryShape(raw);
  if (!shape.ok || !shape.entry.aiGenerated) return false;
  const e = shape.entry;
  if ((e.approval !== 'owner' && e.approval !== 'auto') || !e.approvalSig || !e.approvalScope) return false;
  if (userId !== undefined && e.approvalScope !== userScope(secret, userId)) return false;
  const digest = entryDigest(raw);
  if (!digest) return false;
  const want = Buffer.from(sigOf(secret, { scope: e.approvalScope, approval: e.approval, titleKey, niche, digest }), 'hex');
  const got = Buffer.from(e.approvalSig, 'hex');
  return want.length === got.length && timingSafeEqual(want, got);
}
