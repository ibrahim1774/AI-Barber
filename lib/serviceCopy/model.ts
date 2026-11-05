// The model call, behind an interface so tests never touch the network. The official @anthropic-ai/sdk is not a dependency of this
// repo (and installing it is a network step), so the live client is a small fetch client for POST /v1/messages. It sends no
// temperature (rejected by current models), caps output tokens, aborts on a timeout and never throws its own message upward.
import { MODEL_OUTPUT_SCHEMA } from '../render/svcCopy.js';

export const MODEL_ID = 'claude-haiku-5-5';
export const MAX_OUTPUT_TOKENS = 5000;
export const MODEL_TIMEOUT_MS = 20_000;
/** Pinned on purpose: 2023-06-01 is still accepted by the Messages API. Move to the official SDK (typed errors, retries) when it can be installed. */
export const ANTHROPIC_VERSION = '2023-06-01';
/** One retry of a 429, 529 or 5xx inside the same counted call (a hit cannot be refunded), waiting at most this long. */
export const RETRY_WAIT_MAX_MS = 5_000;
/** Haiku 5.5, USD per million tokens (up to 100K prompt tokens). Used for the cost log line only. */
export const PRICE_PER_MTOK = { input: 0.10, output: 0.50 } as const;

export interface ModelTurn { role: 'user' | 'assistant'; content: string }
export interface ModelRequest { system: string; messages: ModelTurn[]; maxTokens: number; timeoutMs: number; /** JSON schema of the reply; the text schema when absent. */ schema?: object; /** output_config.effort; 'low' when absent. */ effort?: 'low' | 'medium' | 'high' }
export interface ModelUsage { input: number; output: number }
export interface ModelResult { text: string; usage: ModelUsage }
export interface ModelClient { complete(req: ModelRequest): Promise<ModelResult> }

/** A failed call. `kind` is safe to log and to map to a status; there is never a message from the API in it. */
export class ModelError extends Error {
  constructor(readonly kind: 'config' | 'timeout' | 'http' | 'truncated' | 'refused' | 'empty', readonly status?: number, /** What a failed call still used (a truncated reply is billed), for the cost line. */ readonly usage?: ModelUsage) { super(`model_${kind}`); }
}

export const estimateCostUsd = (u: ModelUsage): number => (u.input * PRICE_PER_MTOK.input + u.output * PRICE_PER_MTOK.output) / 1_000_000;

const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const retryable = (status: number): boolean => status === 429 || status === 529 || status >= 500;

export function liveModelClient(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch, sleep: (ms: number) => Promise<void> = sleepMs): ModelClient {
  return {
    async complete(req) {
      const key = env.ANTHROPIC_API_KEY;
      if (!key) throw new ModelError('config');
      const send = async (): Promise<Response> => {
        try {
          return await fetchImpl('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
            body: JSON.stringify({
              model: MODEL_ID, max_tokens: req.maxTokens, system: req.system, messages: req.messages,
              output_config: { effort: req.effort ?? 'low', format: { type: 'json_schema', schema: req.schema ?? MODEL_OUTPUT_SCHEMA } },
            }),
            signal: AbortSignal.timeout(req.timeoutMs),
          });
        } catch (e: any) {
          throw new ModelError(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'http');
        }
      };
      let r = await send();
      if (!r.ok && retryable(r.status)) {
        const ra = Number(r.headers?.get?.('retry-after'));
        await sleep(Math.min(RETRY_WAIT_MAX_MS, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000));
        r = await send();
      }
      if (!r.ok) throw new ModelError('http', r.status);
      const j: any = await r.json().catch(() => null);
      if (!j || typeof j !== 'object') throw new ModelError('empty');
      const usage = { input: Number(j.usage?.input_tokens) || 0, output: Number(j.usage?.output_tokens) || 0 };
      if (j.stop_reason === 'max_tokens') throw new ModelError('truncated', undefined, usage);
      if (j.stop_reason === 'refusal') throw new ModelError('refused', undefined, usage);
      const text = Array.isArray(j.content) ? j.content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('') : '';
      if (!text) throw new ModelError('empty', undefined, usage);
      return { text, usage };
    },
  };
}
