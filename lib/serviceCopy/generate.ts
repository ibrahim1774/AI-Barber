// Writes the dedicated text of ONE service, once. Steps (none runs on the generate or publish path; the endpoint calls this on request):
//   cache hit -> return it (no call, no quota)   |   pending claim -> in_progress   |   else claim -> count a call -> model ->
//   check -> (one retry with the problems, counted as a second call) -> drop failing sentences (deterministic deny layer) ->
//   the claim checker (a separate model call, counted too; any failure or doubt = nothing is stored) -> verify with the real renderer ->
//   store -> return. Any store or counter failure ends in 'unavailable' BEFORE a model call is made. No prompt text is ever logged.
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
import { LEASE_MS, StoreError, type CopyKey, type CopyStore } from './store.js';
import { LimitStoreError, takeCall } from './limits.js';
import type { FactsResult } from './facts.js';

export type GenerateOutcome =
  | { status: 'generated' | 'cached'; copy: SvcCopyEntry }
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
      if (row.state === 'done' && row.copy && row.factsHash === f.hash) return { status: 'cached', copy: row.copy };
      if (row.state === 'done') await deps.store.remove(key); // facts changed (niche): the old text is not about this service any more
      else if (t0 - row.claimedAt < LEASE_MS) return { status: 'in_progress' };
      else if (!(await deps.store.takeover(key, token, f.hash, t0))) return { status: 'in_progress' };
      else claimed = true;
    }
    if (!claimed) {
      if (!(await deps.store.claim(key, token, f.hash, t0))) return { status: 'in_progress' };
      claimed = true;
    }

    // 2. the model, with at most one retry; each call is counted first
    const allow = serviceWordsIn(f.subject.title);
    const turns: ModelTurn[] = [{ role: 'user', content: userMessage(f.facts) }];
    let best: { entry: SvcCopyEntry; kept: number; written: number } | null = null;
    let problems: string[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt === 2 && (deps.now() - t0 > RETRY_DEADLINE_MS || !problems.length)) break;
      const verdict = await takeCall(deps.limits, who.userId, who.draftId, deps.now());
      if (verdict !== 'ok') {
        if (attempt === 1) { await deps.store.release(key, token).catch(() => {}); claimed = false; return { status: 'rate_limited', scope: verdict }; }
        break; // the retry is refused: judge the first answer
      }
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
    const verdict = await takeCall(deps.limits, who.userId, who.draftId, deps.now());
    if (verdict !== 'ok') { logCost('check_not_counted'); await deps.store.release(key, token).catch(() => {}); claimed = false; return { status: 'rate_limited', scope: verdict }; }
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

    // 3. store or leave nothing behind
    const entry: SvcCopyEntry = { ...final, at: new Date(deps.now()).toISOString() };
    if (!(await deps.store.finish(key, token, entry, { tokensIn, tokensOut }))) {
      claimed = false; // the claim was lost (the lease ran out): whoever holds the row decides
      const now = await deps.store.get(key);
      return now?.state === 'done' && now.copy ? { status: 'cached', copy: now.copy } : { status: 'in_progress' };
    }
    claimed = false;
    return { status: 'generated', copy: entry };
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
  const d: WebsiteData = { ...site, extraPages: { on: [], ...(site.extraPages as object), serviceGuides: true, svcCopy: { [f.titleKey]: entry } } as WebsiteData['extraPages'], source: 'web-app' };
  return aiPageFor(lenientEnv(d, { place: '' }), f.subject) !== null;
}
