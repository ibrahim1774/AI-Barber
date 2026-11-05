// Which service titles may be shown to the model at all. The title is the barber's free text and the one string that reaches
// the prompt, so it must look like a service NAME and nothing else. A title that fails is not repaired: no call is made.
//
// On top of the splice whitelist (spliceable 'name': letters, digits, a few inner marks, no markup, capped):
//   - at most 6 words and 60 characters (a real service name is short; an instruction is not);
//   - letters, digits, spaces, '&', '+', '-' and apostrophes only (no colon, quote, bracket, slash, comma, full stop);
//   - no word from the instruction vocabulary (ignore, instructions, prompt, system, output, json, you, please ...);
//   - it must not open with an imperative verb ("Write ...", "Say ...", "Forget ...").
import { spliceable } from '../render/spliceable.js';
import { svcTitleKey } from '../render/guides.js';
import { DENY_GROUP_IDS, denyProblems } from '../render/svcDeny.js';

export const TITLE_MAX_CHARS = 60;
export const TITLE_MAX_WORDS = 6;

const DENY = new Set(`ignore ignoring disregard forget override overrule bypass pretend roleplay jailbreak instruction instructions prompt prompts system assistant developer
previous above earlier following rule rules policy output respond response reply answer print say tell reveal repeat translate
json xml html markdown code script javascript sql http https url api key keys token tokens password secret secrets credential credentials
you your yours yourself please anthropic claude gpt openai model models ai llm bot chatbot admin sudo
escribe escribir ignora ignorar olvida olvidar dime genera generar traduce responde schreibe ignoriere vergiss sag erkläre erklare ecris ecrire lisez ignorez oubliez dis traduis reponds scrivi ignora dimmi mention include add list claim state`.split(/\s+/));
const IMPERATIVE_FIRST = new Set('mention include add list claim state escribe schreibe lisez ecris scrivi write say tell explain describe repeat print output act reply respond answer ask forget ignore pretend imagine translate summarize generate create produce return remember'.split(' '));

const TITLE_CLAIM_GROUPS = new Set(['credentials', 'superlative', 'promise', 'voice']);
const TITLE_SKIP = DENY_GROUP_IDS.filter((g) => !TITLE_CLAIM_GROUPS.has(g));

/** The title as it may be sent to the model, or null (do not call). */
export function aiTitle(title: unknown): string | null {
  if (typeof title !== 'string') return null;
  // Compatibility forms (fullwidth letters, ligatures, odd spacing) are refused, not folded: a title that changes under NFKC is not a plain name.
  if (title.normalize('NFKC') !== title) return null;
  const v = spliceable('name', title);
  if (v === null) return null;
  // Personal data: a phone number, a long digit run, or a person ("by Maria Lopez") must never reach the model.
  if ((v.match(/\d/g) ?? []).length >= 3 || /\d[\d\s-]{5,}\d/.test(v)) return null;
  if (/\b(?:by|with|from|at)\s+[\p{Lu}]/u.test(v) && !/^[^a-z]*$/.test(v)) return null;
  if (Array.from(v).length > TITLE_MAX_CHARS) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} &+'’-]*$/u.test(v)) return null;
  const words = v.split(' ').filter(Boolean);
  if (words.length > TITLE_MAX_WORDS) return null;
  const lower = words.map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
  if (lower.some((w) => DENY.has(w))) return null;
  if (words.length > 1 && IMPERATIVE_FIRST.has(lower[0])) return null;
  if (/^[\p{N}\s&+'’-]+$/u.test(v)) return null; // no letters at all
  // A claim in the NAME is never sent: the page stays thin (licensed, best, guaranteed, 20 years ...). Words the default-deny layer refuses are refused here too.
  if (words.length >= 1 && denyProblems(`Tell ${lower.join(' ')} now.`, 'sentence', { skip: TITLE_SKIP }).length) return null;
  // The key the text is stored under must be derivable from the title (a title the key function mangles is not usable).
  if (svcTitleKey(v) === '') return null;
  return v;
}
