// Server-stamped approval of model text (review 6c B2). The renderer is pure and also runs in the browser, so it cannot hold a secret;
// instead every server step that lets site data towards a public page (draft save, publish snapshot, and the render of every
// deploy: renderPendingBundle) calls svcCopySanitize, which keeps a piece of model text ONLY if its signature verifies:
//
//   approvalSig = HMAC-SHA256(secret, ['svccopy-approval-v2', scope, ref, issuedAt, approval, serviceKey, niche, digest(text)])
//   approvalScope = HMAC(secret, userId) (opaque, 32 hex): the account the approval was issued to
//   approvalRef   = 'd:<draft id>' (draft stage, expires after DRAFT_APPROVAL_TTL_MS) or 's:<site slug>' (the published site; set by
//                   publish when it re-stamps verified text, no expiry because deploys re-render for years)
//
// EVERY consumer verifies against what it knows NOW: draft save (user + this draft, or the account's live site), publish (user + the
// draft being published, or the account's live site; then re-stamped to the slug), save-pending-site (the slug in the request AND the
// slug's recorded owner) and every deploy render (the slug the copy was read from). A signature minted for account A or site X never
// validates for account B or site Y. Rotating the secret retires every approval (text drops, pages go thin until re-approved).

// The signature is issued only by the approve endpoint (approval 'owner') and, while SERVICE_COPY_AUTO_PUBLISH is on, by write
// (approval 'auto'). A client can copy a signed entry back unchanged, but cannot create, edit, move to another service, move to
// another owner, or re-label (owner <-> auto) one. No secret configured = nothing can be signed and nothing verifies (fail closed).
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { checkEntryShape, type SvcCopyEntry } from '../render/svcCopy.js';

/** The signing key. Read per call. Unset or short = null: no approval can be issued and no model text verifies. */
export const DRAFT_APPROVAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Clock skew allowed on an issue time in the future. */
const SKEW_MS = 5 * 60 * 1000;

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
  const { approval: _a, approvalSig: _s, approvalScope: _c, approvalRef: _r, approvalAt: _t, ...text } = shape.entry;
  return createHash('sha256').update(canon(text)).digest('hex');
}

export const userScope = (secret: string, userId: string): string => createHmac('sha256', secret).update(`scope|${userId}`).digest('hex').slice(0, 32);
export const draftRef = (draftId: string): string => `d:${draftId}`;
export const siteRef = (slug: string): string => `s:${slug}`;
const REF = /^[ds]:[A-Za-z0-9._-]{1,100}$/;

/** Constant-time string equality (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8'); const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

const sigOf = (secret: string, p: { scope: string; ref: string; at: number; approval: 'owner' | 'auto'; titleKey: string; niche: string; digest: string }): string =>
  createHmac('sha256', secret).update(JSON.stringify(['svccopy-approval-v2', p.scope, p.ref, p.at, p.approval, p.titleKey, p.niche, p.digest])).digest('hex');

/** The entry with a fresh approval stamp, or null when it cannot be signed (no secret, unusable text, no draft or site to bind to). */
export function stampApproval(secret: string | null | undefined, who: { userId: string; draftId?: string; slug?: string }, titleKey: string, niche: string, entry: SvcCopyEntry, approval: 'owner' | 'auto', now: number = Date.now()): SvcCopyEntry | null {
  if (!secret || !who.userId) return null;
  const ref = who.slug ? siteRef(who.slug) : who.draftId ? draftRef(who.draftId) : null;
  if (!ref || !REF.test(ref) || !Number.isSafeInteger(now) || now < 0) return null;
  const { approval: _a, approvalSig: _s, approvalScope: _c, approvalRef: _r, approvalAt: _t, ...bare } = entry;
  const digest = entryDigest({ ...bare, aiGenerated: true });
  if (!digest) return null;
  const scope = userScope(secret, who.userId);
  return { ...bare, aiGenerated: true, approval, approvalScope: scope, approvalRef: ref, approvalAt: now, approvalSig: sigOf(secret, { scope, ref, at: now, approval, titleKey, niche, digest }) };
}

export interface VerifyContext {
  /** The account asking right now. Given: an approval issued to anyone else fails. */
  userId?: string;
  /** The refs ('d:<draft>' / 's:<slug>') this step accepts. Given: an approval bound to anything else fails. */
  refs?: readonly string[];
  now?: number;
}

/**
 * True only for an entry whose signature was issued by this server for exactly this text, service key and niche, to the account
 * and for one of the drafts/sites named in `ctx` (when given), and (draft stage) is not expired. Unset/short secret = false.
 */
export function verifyApproval(secret: string | null | undefined, raw: unknown, titleKey: string, niche: string, ctx: VerifyContext = {}): boolean {
  if (!secret) return false;
  const shape = checkEntryShape(raw);
  if (!shape.ok || !shape.entry.aiGenerated) return false;
  const e = shape.entry;
  if ((e.approval !== 'owner' && e.approval !== 'auto') || !e.approvalSig || !e.approvalScope || !e.approvalRef || e.approvalAt === undefined) return false;
  if (ctx.userId !== undefined && !safeEqual(e.approvalScope, userScope(secret, ctx.userId))) return false;
  if (ctx.refs !== undefined && !ctx.refs.some((r) => safeEqual(r, e.approvalRef as string))) return false;
  const now = ctx.now ?? Date.now();
  if (e.approvalAt > now + SKEW_MS) return false;
  if (e.approvalRef.startsWith('d:') && now - e.approvalAt > DRAFT_APPROVAL_TTL_MS) return false;
  const digest = entryDigest(raw);
  if (!digest) return false;
  const want = Buffer.from(sigOf(secret, { scope: e.approvalScope, ref: e.approvalRef, at: e.approvalAt, approval: e.approval, titleKey, niche, digest }), 'hex');
  const got = Buffer.from(e.approvalSig, 'hex');
  return want.length === got.length && timingSafeEqual(want, got);
}
