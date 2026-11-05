// Two jobs, both on an explicit request from the signed-in owner, never on the generate or publish path:
//
// MODE A  classifyServiceFamily: the model is only a classifier. One call returns {family: <library guide id> | 'none'}. A family is
//   cached per (site, service key) and the page then prints the library's own reviewed wording for it. 'none', a failure, a timeout
//   or a malformed reply = default deny: nothing is cached and nothing a model wrote is ever rendered.
//
// MODE B  generateServiceCopy ("Write it for me"): cache hit -> return it (no call, no quota) | pending claim -> in_progress |
//   else claim -> count ONE request unit -> model -> (one retry with the problems) -> drop failing sentences (deterministic deny
//   layer) -> the claim checker (a separate model call, same unit; any failure or doubt = nothing is stored) -> verify with the real
//   renderer -> store -> return. The result is a PROPOSAL (status 'proposal', never rendered) until the barber approves it
//   (approveProposal), unless the server flag SERVICE_COPY_AUTO_PUBLISH is on (deps.autoPublish): then it is returned already
//   stamped approval 'auto'. Any store or counter failure ends in 'unavailable' BEFORE a model call is made. No prompt text is ever logged.
import { randomUUID } from 'node:crypto';
import type { RateLimitStore } from '../bookings/rateLimit.js';
import type { WebsiteData } from '../../types';
import { aiPageFor, lenientEnv } from '../render/guides.js';
import { serviceWordsIn } from '../render/copyRules.js';
import { candidateFromModel, entryTexts, lintEntry, type SvcCopyEntry } from '../render/svcCopy.js';
import { validSeoText } from '../render/seoText.js';
import { estimateCostUsd, MAX_OUTPUT_TOKENS, MODEL_ID, MODEL_TIMEOUT_MS, ModelError, type ModelClient, type ModelTurn } from './model.js';
import { retryMessage, SYSTEM_PROMPT, userMessage } from './prompt.js';
import { claimCheck } from './check.js';
import { classifyTitle, ClassifyError, FAMILY_NONE } from './classify.js';
import type { GuideId } from '../render/copyLibrary.js';
import { isFamilyChoice, isTextEntry, LEASE_MS, StoreError, type CopyKey, type CopyStore } from './store.js';
import { LimitStoreError, takeCall } from './limits.js';
import { stampApproval } from './approval.js';
import { familyCandidates } from '../render/familyKeywords.js';
import type { FactsResult } from './facts.js';

export type GenerateOutcome =
  /** Renderable text: `copy.approval` is set ('auto' while the flag is on, 'owner' once the barber approved). */
  | { status: 'generated' | 'cached'; copy: SvcCopyEntry }
  /** Model text waiting for the barber's "Looks right": no approval, never rendered, never indexed. */
  | { status: 'proposal'; copy: SvcCopyEntry }
  | { status: 'not_generated' }
  | { status: 'in_progress' }
  | { status: 'rate_limited'; scope: 'site' | 'account' }
  | { status: 'unavailable' };

export interface GenerateDeps {
  model: ModelClient;
  store: CopyStore;
  limits: RateLimitStore;
  now: () => number;
  log: (line: string) => void;
  token?: () => string;
  /** SERVICE_COPY_AUTO_PUBLISH is on. Default (absent) = off: Mode B text is a proposal until the owner approves it. */
  autoPublish?: boolean;
  /** The approval signing key (approval.ts signingSecret()). Absent: nothing can be approved or auto-published, so nothing renders (fail closed). */
  secret?: string | null;
}

/** Total time the two writing calls may take together; the retry is skipped past this. */
const RETRY_DEADLINE_MS = 28_000;
/** The claim check is not started past this (the route's budget is 60 s); no check means no text. */
const CHECK_DEADLINE_MS = 42_000;

function parseJson(text: string): unknown {
  const t = text.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) throw new Error('not json');
  return JSON.parse(t);
}

export async function generateServiceCopy(
  deps: GenerateDeps, who: { userId: string; draftId: string }, site: WebsiteData, f: Extract<FactsResult, { ok: true }>,
): Promise<GenerateOutcome> {
  const key: CopyKey = { userId: who.userId, draftId: who.draftId, titleKey: f.titleKey };
  const stampFor = (copy: SvcCopyEntry, mode: 'owner' | 'auto'): SvcCopyEntry | null => stampApproval(deps.secret, who, f.titleKey, f.facts.businessType, copy, mode, deps.now());
  const token = (deps.token ?? randomUUID)();
  const t0 = deps.now();
  let claimed = false;
  let tokensIn = 0;
  let tokensOut = 0;
  let calls = 0;
  let checks = 0;
  const logCost = (result: string): void => deps.log(`[service-copy] model=${MODEL_ID} calls=${calls} checks=${checks} in=${tokensIn} out=${tokensOut} cost_usd=${estimateCostUsd({ input: tokensIn, output: tokensOut }).toFixed(5)} result=${result}`);
  try {
    // 1. cache and claim (idempotency: one call per site and service, however many taps)
    const row = await deps.store.get(key);
    if (row) {
      if (row.state === 'done' && isTextEntry(row.copy) && row.factsHash === f.hash) return deliver(row.copy, row.approval, deps.autoPublish === true, stampFor);
      if (row.state === 'done') await deps.store.remove(key); // facts changed (niche): the old text is not about this service any more
      else if (t0 - row.claimedAt < LEASE_MS) return { status: 'in_progress' };
      else if (!(await deps.store.takeover(key, token, f.hash, t0))) return { status: 'in_progress' };
      else claimed = true;
    }
    if (!claimed) {
      if (!(await deps.store.claim(key, token, f.hash, t0))) return { status: 'in_progress' };
      claimed = true;
    }

    // 2. ONE counted unit for the whole request (write + optional retry + claim check: at most three model calls), then the model
    const unit = await takeCall(deps.limits, who.userId, who.draftId, deps.now());
    if (unit !== 'ok') { await deps.store.release(key, token).catch(() => {}); claimed = false; return { status: 'rate_limited', scope: unit }; }
    const allow = serviceWordsIn(f.subject.title);
    const turns: ModelTurn[] = [{ role: 'user', content: userMessage(f.facts) }];
    let best: { entry: SvcCopyEntry; kept: number; written: number } | null = null;
    let problems: string[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt === 2 && (deps.now() - t0 > RETRY_DEADLINE_MS || !problems.length)) break;
      let text: string;
      try {
        const r = await deps.model.complete({ system: SYSTEM_PROMPT, messages: turns, maxTokens: MAX_OUTPUT_TOKENS, timeoutMs: MODEL_TIMEOUT_MS });
        calls++; tokensIn += r.usage.input; tokensOut += r.usage.output; text = r.text;
      } catch (e) {
        if (e instanceof ModelError && e.usage) { tokensIn += e.usage.input; tokensOut += e.usage.output; } // a truncated reply is billed too
        if (attempt === 1) throw e;
        break;
      }
      let shapeProblem = '';
      let entry: SvcCopyEntry | null = null;
      try {
        const cand = candidateFromModel(parseJson(text));
        if ('entry' in cand) entry = cand.entry; else shapeProblem = cand.reason;
      } catch { shapeProblem = 'not valid JSON'; }
      if (!entry) problems = [`shape: ${shapeProblem}`];
      else {
        const linted = lintEntry(entry, allow);
        problems = linted.problems;
        if (linted.entry) {
          const ok = withMeta(linted.entry, f);
          if (verified(site, f, ok) && (!best || linted.kept / linted.written >= best.kept / best.written)) best = { entry: ok, kept: linted.kept, written: linted.written };
        }
      }
      // A usable answer is never retried for dropped sentences (they are simply dropped): the retry is only for an answer that cannot be used,
      // so a normal page costs two counted calls (write + check).
      if (best || !problems.length) break;
      turns.push({ role: 'assistant', content: text.slice(0, 6000) }, { role: 'user', content: retryMessage(problems) });
    }
    if (!best) { logCost('none'); await deps.store.release(key, token).catch(() => {}); claimed = false; return { status: 'not_generated' }; }

    // 2b. the claim checker: a second, independent call over what survived the deterministic layer. It is one more counted call.
    //     Every failure (budget, deadline, call, malformed reply) is DEFAULT DENY: nothing is stored and the page stays thin.
    const denyAll = async (why: string): Promise<GenerateOutcome> => { logCost(why); await deps.store.release(key, token).catch(() => {}); claimed = false; return { status: 'not_generated' }; };
    if (deps.now() - t0 > CHECK_DEADLINE_MS) return denyAll('check_deadline');
    let cleared: Set<string>;
    try {
      checks++;
      const c = await claimCheck(deps.model, entryTexts(best.entry).map((x) => x.text));
      tokensIn += c.usage.input; tokensOut += c.usage.output; cleared = c.cleared;
    } catch (e) {
      if (e instanceof ModelError && e.usage) { tokensIn += e.usage.input; tokensOut += e.usage.output; }
      return denyAll('check_failed');
    }
    const checked = lintEntry(best.entry, allow, (t) => cleared.has(t));
    const final = checked.entry ? withMeta(checked.entry, f) : null;
    if (!final || !verified(site, f, final)) return denyAll('check_dropped_too_much');
    logCost('text');

    // 3. store or leave nothing behind. The stored text never carries an approval; it is attached only on the way out.
    const entry: SvcCopyEntry = { ...final, at: new Date(deps.now()).toISOString() };
    const auto = deps.autoPublish === true;
    if (!(await deps.store.finish(key, token, entry, { tokensIn, tokensOut, approval: auto ? 'auto' : null }))) {
      claimed = false; // the claim was lost (the lease ran out): whoever holds the row decides
      const now = await deps.store.get(key);
      return now?.state === 'done' && isTextEntry(now.copy) ? deliver(now.copy, now.approval, auto, stampFor) : { status: 'in_progress' };
    }
    claimed = false;
    const signed = auto ? stampFor(entry, 'auto') : null;
    return signed ? { status: 'generated', copy: signed } : { status: 'proposal', copy: entry };
  } catch (e) {
    if (claimed) await deps.store.release(key, token).catch(() => {});
    if (calls + checks > 0 || tokensIn + tokensOut > 0) logCost('error');
    if (e instanceof LimitStoreError || e instanceof StoreError || e instanceof ModelError) {
      deps.log(`[service-copy] unavailable: ${e.message}`);
      return { status: 'unavailable' };
    }
    deps.log('[service-copy] unexpected failure');
    return { status: 'unavailable' };
  }
}

/** Meta text must also pass the SEO validator (after its tokens are resolved) or it is omitted. */
function withMeta(e: SvcCopyEntry, f: Extract<FactsResult, { ok: true }>): SvcCopyEntry {
  const out = { ...e };
  const resolve = (t: string): string => t.replace(/\{service\}/g, f.facts.serviceTitle);
  if (out.metaTitle && !validSeoText('title', resolve(out.metaTitle))) delete out.metaTitle;
  if (out.metaDescription && !validSeoText('description', resolve(out.metaDescription))) delete out.metaDescription;
  return out;
}

/** The candidate must print through the real renderer path for this site (tokens resolved, enough sentences). */
function verified(site: WebsiteData, f: Extract<FactsResult, { ok: true }>, entry: SvcCopyEntry): boolean {
  // The text rules are judged as the text would print once approved: approval itself is a separate gate (aiPageFor), tested apart.
  const printed: SvcCopyEntry = { ...entry, approval: 'owner' };
  const { svcFamily: _f, ...rest } = ((site.extraPages ?? {}) as Record<string, unknown>);
  const d: WebsiteData = { ...site, extraPages: { on: [], ...rest, serviceGuides: true, svcCopy: { [f.titleKey]: printed } } as WebsiteData['extraPages'], source: 'web-app' };
  return aiPageFor(lenientEnv(d, { place: '' }), { ...f.subject, guide: null }) !== null;
}

/**
 * What a stored write row becomes on the way out: renderable ('cached', approval stamped) only for an owner-approved row, or for any
 * row while the auto flag is on; otherwise it is still a proposal. An 'auto' row is NOT trusted once the flag is off.
 */
export function deliver(copy: SvcCopyEntry, rowApproval: 'owner' | 'auto' | null, autoPublish: boolean, stamp: (copy: SvcCopyEntry, mode: 'owner' | 'auto') => SvcCopyEntry | null): GenerateOutcome {
  const { approval: _drop, approvalSig: _s, approvalScope: _c, approvalRef: _r, approvalAt: _t, ...bare } = copy;
  // The approval is stamped (signed) here, on the server, for this exact text; a row that cannot be signed is only a proposal.
  const signed = rowApproval === 'owner' ? stamp(bare, 'owner') : autoPublish ? stamp(bare, 'auto') : null;
  if (signed) return { status: 'cached', copy: signed };
  return { status: 'proposal', copy: bare };
}

export type ApproveOutcome =
  | { status: 'approved'; copy: SvcCopyEntry }
  | { status: 'no_proposal' | 'proposal_stale' | 'not_renderable' | 'unavailable' };

/**
 * "Looks right": the owner approves the stored proposal for this exact service. The row must exist, be finished, match the current
 * facts and still print through the real renderer; only then is it flipped to approval 'owner' and returned for the editor to commit.
 * Approving an already approved row returns it again (idempotent). No model call, no quota.
 */
export async function approveProposal(
  deps: Pick<GenerateDeps, 'store' | 'log' | 'secret'> & { now?: () => number }, who: { userId: string; draftId: string }, site: WebsiteData, f: Extract<FactsResult, { ok: true }>,
): Promise<ApproveOutcome> {
  const key: CopyKey = { userId: who.userId, draftId: who.draftId, titleKey: f.titleKey };
  try {
    // No signing key = no approval can be issued (nothing signed would ever render): fail closed before touching the row.
    if (!deps.secret) return { status: 'unavailable' };
    const signed = (bare: SvcCopyEntry): SvcCopyEntry | null => stampApproval(deps.secret, who, f.titleKey, f.facts.businessType, bare, 'owner', deps.now?.());
    const row = await deps.store.get(key);
    if (!row || row.state !== 'done' || !isTextEntry(row.copy)) return { status: 'no_proposal' };
    if (row.factsHash !== f.hash) { await deps.store.remove(key); return { status: 'proposal_stale' }; }
    const { approval: _drop, approvalSig: _s, approvalScope: _c, approvalRef: _r, approvalAt: _t, ...bare } = row.copy;
    if (!verified(site, f, bare)) { await deps.store.remove(key); return { status: 'not_renderable' }; }
    const out = signed(bare);
    if (!out) return { status: 'unavailable' };
    if (row.approval === 'owner') return { status: 'approved', copy: out };
    if (!(await deps.store.approve(key))) {
      const again = await deps.store.get(key);
      return again?.state === 'done' && again.approval === 'owner' && isTextEntry(again.copy) ? { status: 'approved', copy: out } : { status: 'no_proposal' };
    }
    return { status: 'approved', copy: out };
  } catch (e) {
    deps.log(`[service-copy] approve unavailable: ${e instanceof StoreError ? 'store' : 'error'}`);
    return { status: 'unavailable' };
  }
}

export type ClassifyOutcome =
  | { status: 'family'; family: GuideId; cached: boolean }
  | { status: 'not_generated' }
  | { status: 'in_progress' }
  | { status: 'rate_limited'; scope: 'site' | 'account' }
  | { status: 'unavailable' };

/**
 * MODE A. One classifier call (one counted unit) for a custom title. The only thing kept is a library guide id; the family is cached
 * per (site, service key) so a second tap costs nothing. 'none', a malformed reply, a failed or timed-out call: nothing is cached.
 */
export async function classifyServiceFamily(
  deps: GenerateDeps, who: { userId: string; draftId: string }, f: Extract<FactsResult, { ok: true }>,
): Promise<ClassifyOutcome> {
  const key: CopyKey = { userId: who.userId, draftId: who.draftId, titleKey: f.titleKey, kind: 'family' };
  const token = (deps.token ?? randomUUID)();
  const t0 = deps.now();
  let claimed = false;
  let usage = { input: 0, output: 0 };
  const logCost = (result: string): void => deps.log(`[service-copy] mode=classify model=${MODEL_ID} in=${usage.input} out=${usage.output} cost_usd=${estimateCostUsd(usage).toFixed(5)} result=${result}`);
  // Review 6c B1: a family needs a keyword of that family in the title itself. No candidate = no family, decided here with no store
  // access, no model call and no counted unit; the model may only choose among the candidates.
  const candidates = familyCandidates(f.subject.title);
  if (!candidates.length) { deps.log('[service-copy] mode=classify result=no_candidate'); return { status: 'not_generated' }; }
  try {
    const row = await deps.store.get(key);
    if (row) {
      if (row.state === 'done' && isFamilyChoice(row.copy) && row.factsHash === f.hash && candidates.includes(row.copy.family)) return { status: 'family', family: row.copy.family, cached: true };
      if (row.state === 'done') await deps.store.remove(key);
      else if (t0 - row.claimedAt < LEASE_MS) return { status: 'in_progress' };
      else if (!(await deps.store.takeover(key, token, f.hash, t0))) return { status: 'in_progress' };
      else claimed = true;
    }
    if (!claimed) {
      if (!(await deps.store.claim(key, token, f.hash, t0))) return { status: 'in_progress' };
      claimed = true;
    }
    const unit = await takeCall(deps.limits, who.userId, who.draftId, deps.now());
    if (unit !== 'ok') { await deps.store.release(key, token).catch(() => {}); claimed = false; return { status: 'rate_limited', scope: unit }; }
    let family: GuideId | typeof FAMILY_NONE;
    try {
      const r = await classifyTitle(deps.model, f.facts.serviceTitle, candidates);
      usage = r.usage; family = r.family;
    } catch (e) {
      if (e instanceof ModelError && e.usage) usage = e.usage;
      if (e instanceof ClassifyError) { logCost('malformed'); await deps.store.release(key, token).catch(() => {}); claimed = false; return { status: 'not_generated' }; }
      throw e;
    }
    if (family === FAMILY_NONE) { logCost('none'); await deps.store.release(key, token).catch(() => {}); claimed = false; return { status: 'not_generated' }; }
    if (!(await deps.store.finish(key, token, { v: 1, family }, { tokensIn: usage.input, tokensOut: usage.output }))) {
      claimed = false;
      const now = await deps.store.get(key);
      return now?.state === 'done' && isFamilyChoice(now.copy) && candidates.includes(now.copy.family) ? { status: 'family', family: now.copy.family, cached: true } : { status: 'in_progress' };
    }
    claimed = false;
    logCost(`family=${family}`);
    return { status: 'family', family, cached: false };
  } catch (e) {
    if (claimed) await deps.store.release(key, token).catch(() => {});
    if (usage.input + usage.output > 0) logCost('error');
    deps.log(`[service-copy] classify unavailable: ${e instanceof LimitStoreError || e instanceof StoreError || e instanceof ModelError ? e.message : 'unexpected'}`);
    return { status: 'unavailable' };
  }
}

