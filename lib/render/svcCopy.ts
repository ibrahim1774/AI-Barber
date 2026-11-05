// Dedicated service-page text written once by the model for a service the library has no guide for (Phase 1 step 6).
//
// Stored at extraPages.svcCopy[titleKey] (titleKey = svcTitleKey(title), the same key as `svc.<titleKey>.visit`). The
// server never writes site data: api/web-app/service-copy.ts returns an entry and the editor commits it like any edit.
//
// A stored entry is NEVER trusted (the browser can write anything there):
//   - the shape and every length are re-checked (checkEntryShape): anything off omits the whole entry, nothing is repaired;
//   - `aiGenerated: true` text is linted again sentence by sentence (R1 to R17 plus the AI rules below). A sentence that fails
//     is dropped; too little left omits the entry;
//   - the model never writes the shop's own facts. A sentence may hold only the tokens {service} and {place}; the renderer
//     resolves them through the same strict whitelist as the library text (spliceable), so an unusable value drops the sentence;
//   - `aiGenerated: false` is the barber's own wording (an edit): printed escaped as written, not linted, no tokens.
//
// Pure, imports only copyRules (so guides.ts can use it without a cycle).
import { copyProblems, type VocabGroup } from './copyRules.js';
import { denyProblems, type DenyKind } from './svcDeny.js';

export interface SvcSection { h: string; p: string }
export interface SvcFaq { q: string; a: string }
export interface SvcCopyEntry {
  v: 1;
  /** true until the barber edits the text (the editor badge reads this; an edit sets it false and the text is then the barber's own). */
  aiGenerated: boolean;
  heading?: string;
  intro: string;
  sections: SvcSection[];
  faq: SvcFaq[];
  metaTitle?: string;
  metaDescription?: string;
  /** ISO time the text was written (display only). */
  at?: string;
  /**
   * Who let this model text go public. Model text (aiGenerated true) is printed ONLY with an approval: 'owner' (the barber tapped
   * "Looks right" on the proposal) or 'auto' (the server flag SERVICE_COPY_AUTO_PUBLISH was on when it was written). Without one
   * the entry is a proposal: never printed, never indexed. The barber's own words (aiGenerated false) carry none.
   */
  approval?: 'owner' | 'auto';
}

export const LIMITS = {
  heading: 80, intro: 800, sectionH: 80, sectionP: 700, faqQ: 120, faqA: 400, metaTitle: 60, metaDescription: 160,
  sectionsMax: 4, faqMax: 4, total: 6000, keys: 12,
} as const;
/** Fewest sentences that must survive the lint for an entry to be kept (and printed). */
export const MIN_SENTENCES = 4;
/** Share of the written sentences that must survive. */
export const MIN_SURVIVAL = 0.5;

const KEYS = new Set(['v', 'aiGenerated', 'heading', 'intro', 'sections', 'faq', 'metaTitle', 'metaDescription', 'at', 'approval']);
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

// ── plain text only ─────────────────────────────────────────────────────────────────────────────
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\ufeff\\u00ad\\ufff9-\\ufffb]');
const MARKUP = /[<>`*_#|~^\\\[\]]|&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,31});|https?:|www\.|\w@\w|\.(?:com|net|org|io|co|us|uk)\b|\b(?:javascript|data):/i;

/** Why `s` is not plain text (empty = plain). Tokens in braces are allowed here and checked by the lint. */
export function plainTextProblem(s: string): string {
  if (CONTROL.test(s)) return 'control or invisible character';
  if (MARKUP.test(s)) return 'markup, link or address';
  if (/^\s|\s$|\s{2,}/.test(s)) return 'spacing';
  if (s.includes('\n') || s.includes('\t')) return 'line break';
  return '';
}

// ── honesty rules for AI text, on top of R1 to R17 (copyRules.ts) ────────────────────────────────
// copyRules already refuse we/our/us, years, licensed, certified, guarantee, free, prices (digits), health words, quotes,
// rank words, proper nouns and non-ASCII. These close the gaps that matter for free prose.
const AI_RULES: { id: string; re: RegExp }[] = [
  { id: 'A1 voice', re: /\b(?:i|me|my|mine|myself|i'm|i've|i'll|i'd)\b/i },
  { id: 'A2 credentials', re: /\b(?:insured|insurance|bonded|qualified|qualification|credential\w*|degrees?|diplomas?|apprentic\w*|graduate[sd]?|college|school|academy|trained|training|specialis[te]\w*|specializ\w*|master|masters|pro|pros|vetted|background[- ]checked)\b/i },
  { id: 'A3 experience', re: /\b(?:experience[ds]?|experienced|seasoned|veteran|longtime|long-time|decades?|for years|many years|years of|over \w+ years|since \w+)\b/i },
  { id: 'A4 warranty', re: /\b(?:warrant(?:y|ies|ied)|lifetime|money[- ]back|refund\w*|redo|re-do|touch[- ]?ups? (?:are|is)|no[- ]risk|risk[- ]free|assured|ensure[sd]?|ensuring|certain(?:ly)?|definitely|always works|never fails?)\b/i },
  { id: 'A5 price', re: /\b(?:dollars?|bucks?|cents?|usd|price[ds]?|pricing|cost[s]?|fees?|rates?|charge[sd]?|charging|afford\w*|budget|worth the)\b|[$£€¢]/i },
  { id: 'A6 result', re: /\b(?:results?|outcomes?|resulting|transform\w*|rejuvenat\w*|restor\w*|repair\w*|fix(?:es|ed)?|eliminat\w*|remov(?:e|es|ed|ing) (?:wrinkles?|scars?|blemish\w*|stains?)|reduce[sd]?|improv(?:e|es|ed|ing) (?:your )?(?:hair|skin|scalp)|younger|youthful|anti-?aging|long[- ]lasting|lasts? (?:for )?(?:weeks|months)|last(?:s|ing) longer)\b/i },
  { id: 'A7 medical', re: /\b(?:medical\w*|medicine|medication|doctors?|physicians?|dermatolog\w*|clinic\w*|prescri\w*|diagnos\w*|symptoms?|infections?|infected|diseases?|illness\w*|allerg\w*|hypoallergenic|sensitive skin|scalp issues?|therap\w*|remed\w*|sooth\w*|detox\w*|inflam\w*|irritat\w*|sunburn\w*|rash\w*|dry scalp|moisturi\w*|nourish\w*|hydrat\w*|vitamin\w*|toxin\w*)\b/i },
  { id: 'A8 superlative', re: /\b(?:most|ultimate|unique|unparalleled|superior|supreme|ideal|optimal|elite|top-tier|unbeatable|unbeaten|incomparable|matchless|peerless|number[- ]one|leading|signature|legendary|iconic|famous|popular|favou?rite|in demand|sought[- ]after|trending|go-to|must-have|world[- ]class|one of a kind|second to none|closest|easiest|fastest|quickest|softest|smoothest|cleanest|sharpest|freshest|strongest|gentlest|longest|shortest|highest|lowest|biggest|smallest|newest|oldest|finest|greatest|nicest|lightest|deepest|warmest|coolest|busiest|simplest|safest|healthiest)\b/i },
  { id: 'A9 comparison', re: /\b(?:better|worse|superior|than|unlike|compared|versus|vs|rather than|instead of|beats?|outperform\w*|stands? out|different from|apart from (?:other|the rest)|other (?:shops?|barbers?|salons?|places))\b/i },
  { id: 'A10 shop-specific', re: /\b(?:here|our|ours|the shop|this shop|the salon|this salon|the studio|this studio|at (?:the|this) (?:shop|salon|studio|location)|open (?:late|early|daily|weekends?|7|every|all)|opens|closes|closed|hours|book(?:ings?)? (?:online|today|now|here)|call (?:us|now|ahead)|text us|walk[- ]?ins?|appointments? (?:only|required|needed)|reserv\w+|deposit\w*|cancel\w*|no[- ]shows?|parking|located|location|nearby|neighbou?rhood|in town|menu)\b/i },
  { id: 'A11 people', re: /\b(?:customers?|clients?|guests?|regulars?|everyone|everybody|nobody|no one|all (?:of )?our|people (?:love|say|trust|choose)|popular with)\b/i },
  { id: 'A12 absolutes', re: /\b(?:never|always|no matter|completely|totally|entirely|absolutely|everyone|everything|anyone)\b/i },
  { id: 'A13 brand', re: /\b(?:brand\w*|pomade|cologne|laser)\b/i },
  { id: 'A14 contact', re: /\b(?:phone|email|e-mail|address|website|instagram|facebook|tiktok|whatsapp)\b/i },
];

// R11 only allows ASCII, which Spanish, French or Italian written without accents also satisfy. English prose must hold a common English function word (when it is five words or more, or holds a word of another language),
// and must not hold two words of another language for every English one.
const EN_WORDS = new Set('the and to of is are your you for with that this can if when it be will may about before after ask tell what how which should would could from at on in or as not do does have has an by so there their they them these those more some any each one'.split(' '));
const FOREIGN_WORDS = new Set('el la los las de del que es un una para con por se no lo le les des du et est der die das und ist nicht ein eine mit von il di che per sono gli une au aux pour dans sur qui ou y en os um uma'.split(' '));
function languageProblem(text: string): string {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length < 3) return '';
  const en = words.filter((w) => EN_WORDS.has(w)).length;
  const foreign = words.filter((w) => FOREIGN_WORDS.has(w)).length;
  if (en === 0 && (words.length >= 5 || foreign >= 1)) return 'A15 language: no common English word';
  if (foreign >= 2 && foreign * 2 >= en) return 'A15 language: reads as another language';
  return '';
}

const TOKEN_ANY = /\{[^{}]*\}/g;
// The place is never given to the model and never written into AI text: {service} is the only token.
const ALLOWED_TOKENS = new Set(['{service}']);

/** Every rule one sentence of AI text breaks (empty = clean). `allow` = the vocabulary groups the service's own title uses. */
export function aiSentenceProblems(sentence: string, allow: readonly VocabGroup[], kind: DenyKind = 'sentence'): string[] {
  const out: string[] = [];
  const pt = plainTextProblem(sentence);
  if (pt) out.push(`plain: ${pt}`);
  for (const t of sentence.match(TOKEN_ANY) ?? []) if (!ALLOWED_TOKENS.has(t)) out.push(`token: only {service} is allowed, got ${t}`);
  out.push(...copyProblems(sentence, { allow, strict: true }));
  const bare = sentence.replace(TOKEN_ANY, ' tok ');
  for (const { id, re } of AI_RULES) {
    const m = re.exec(bare);
    if (m) out.push(`${id}: ${m[0].trim()}`);
  }
  const lang = languageProblem(bare);
  if (lang) out.push(lang);
  if (Array.from(sentence).length > 300) out.push('length: sentence over 300 characters');
  // The default-deny layer (svcDeny.ts): character set, shape, deny groups. Runs for generated text AND again at render time.
  out.push(...denyProblems(sentence, kind));
  return out;
}

// ── sentences ───────────────────────────────────────────────────────────────────────────────────
/** Splits a paragraph into sentences (a sentence ends at . ! ? followed by a space). No abbreviation is special: text that fails to split cleanly is judged as one long sentence. */
export function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}
const PRONOUN_OPEN = /^(?:it|its|this|that|these|those|they|them|their|he|she|his|her|there|such|doing so|also|and|but|so|then|however)\b/i;

/** The claim checker's verdict for one piece of text: true only when it was explicitly cleared. */
export type Clearance = (text: string) => boolean;

export interface LintedText { text: string; kept: number; written: number; problems: string[] }

/**
 * One paragraph: sentences that fail are dropped; the sentence right after a dropped one is dropped too when it opens with a
 * pronoun or a connective (it would point at text that is gone). Never repaired. `text` is '' when nothing is left.
 */
export function lintParagraph(text: string, allow: readonly VocabGroup[], cleared?: Clearance): LintedText {
  const sents = sentencesOf(text);
  const out: string[] = [];
  const problems: string[] = [];
  let droppedBefore = false;
  for (const s of sents) {
    const p = aiSentenceProblems(s, allow);
    if (!p.length && cleared && !cleared(s)) p.push('check: not cleared by the claim checker');
    if (p.length) { problems.push(...p); droppedBefore = true; continue; }
    if (droppedBefore && PRONOUN_OPEN.test(s)) { problems.push('orphan: opens with a pronoun after a dropped sentence'); continue; }
    droppedBefore = false;
    out.push(s);
  }
  return { text: out.join(' '), kept: out.length, written: sents.length, problems };
}

/** A heading or question: one line that passes the same rules (no final-stop requirement). Empty problems = ok. */
export function lintLine(text: string, allow: readonly VocabGroup[], kind: DenyKind = 'heading', cleared?: Clearance): string[] {
  if (sentencesOf(text).length !== 1) return ['line: must be one sentence'];
  const p = aiSentenceProblems(text, allow, kind);
  if (!p.length && cleared && !cleared(text)) p.push('check: not cleared by the claim checker');
  return p;
}

// ── shape ───────────────────────────────────────────────────────────────────────────────────────
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number, min = 1): v is string => typeof v === 'string' && Array.from(v).length >= min && Array.from(v).length <= max;

/** The entry if `raw` has exactly the stored shape within every cap, else a reason. Never changes the values. */
export function checkEntryShape(raw: unknown): { ok: true; entry: SvcCopyEntry } | { ok: false; reason: string } {
  if (!isObj(raw)) return { ok: false, reason: 'not an object' };
  for (const k of Object.keys(raw)) if (!KEYS.has(k)) return { ok: false, reason: `unknown key ${k.slice(0, 20)}` };
  if (raw.v !== 1) return { ok: false, reason: 'version' };
  if (typeof raw.aiGenerated !== 'boolean') return { ok: false, reason: 'aiGenerated' };
  if (!str(raw.intro, LIMITS.intro)) return { ok: false, reason: 'intro' };
  if (own(raw, 'heading') && !str(raw.heading, LIMITS.heading)) return { ok: false, reason: 'heading' };
  if (own(raw, 'metaTitle') && !str(raw.metaTitle, LIMITS.metaTitle)) return { ok: false, reason: 'metaTitle' };
  if (own(raw, 'metaDescription') && !str(raw.metaDescription, LIMITS.metaDescription)) return { ok: false, reason: 'metaDescription' };
  if (own(raw, 'at') && !str(raw.at, 40)) return { ok: false, reason: 'at' };
  if (own(raw, 'approval') && ((raw.approval !== 'owner' && raw.approval !== 'auto') || raw.aiGenerated !== true)) return { ok: false, reason: 'approval' };
  if (!Array.isArray(raw.sections) || raw.sections.length > LIMITS.sectionsMax) return { ok: false, reason: 'sections' };
  if (!Array.isArray(raw.faq) || raw.faq.length > LIMITS.faqMax) return { ok: false, reason: 'faq' };
  const sections: SvcSection[] = [];
  for (const s of raw.sections) {
    if (!isObj(s) || Object.keys(s).some((k) => k !== 'h' && k !== 'p') || !str(s.h, LIMITS.sectionH) || !str(s.p, LIMITS.sectionP)) return { ok: false, reason: 'section' };
    sections.push({ h: s.h, p: s.p });
  }
  const faq: SvcFaq[] = [];
  for (const f of raw.faq) {
    if (!isObj(f) || Object.keys(f).some((k) => k !== 'q' && k !== 'a') || !str(f.q, LIMITS.faqQ) || !str(f.a, LIMITS.faqA)) return { ok: false, reason: 'faq item' };
    faq.push({ q: f.q, a: f.a });
  }
  const entry: SvcCopyEntry = { v: 1, aiGenerated: raw.aiGenerated, intro: raw.intro, sections, faq };
  if (own(raw, 'heading')) entry.heading = raw.heading as string;
  if (own(raw, 'metaTitle')) entry.metaTitle = raw.metaTitle as string;
  if (own(raw, 'metaDescription')) entry.metaDescription = raw.metaDescription as string;
  if (own(raw, 'at')) entry.at = raw.at as string;
  if (own(raw, 'approval')) entry.approval = raw.approval as 'owner' | 'auto';
  const total = [entry.heading, entry.intro, entry.metaTitle, entry.metaDescription, ...sections.flatMap((s) => [s.h, s.p]), ...faq.flatMap((f) => [f.q, f.a])]
    .reduce((n, t) => n + (t ? Array.from(t).length : 0), 0);
  if (total > LIMITS.total) return { ok: false, reason: 'total length' };
  return { ok: true, entry };
}

/** The same JSON schema the model is asked for (strict: nothing else is accepted). */
export const MODEL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['heading', 'intro', 'sections', 'faq', 'metaTitle', 'metaDescription'],
  properties: {
    heading: { type: 'string' },
    intro: { type: 'string' },
    sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['h', 'p'], properties: { h: { type: 'string' }, p: { type: 'string' } } } },
    faq: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['q', 'a'], properties: { q: { type: 'string' }, a: { type: 'string' } } } },
    metaTitle: { type: 'string' },
    metaDescription: { type: 'string' },
  },
} as const;

/** Model output (parsed JSON) -> the strict candidate entry, or a reason. Empty meta strings count as omitted. */
export function candidateFromModel(raw: unknown): { ok: true; entry: SvcCopyEntry } | { ok: false; reason: string } {
  if (!isObj(raw)) return { ok: false, reason: 'not an object' };
  const need = ['heading', 'intro', 'sections', 'faq', 'metaTitle', 'metaDescription'];
  for (const k of Object.keys(raw)) if (!need.includes(k)) return { ok: false, reason: `unknown key ${k.slice(0, 20)}` };
  for (const k of need) if (!own(raw, k)) return { ok: false, reason: `missing ${k}` };
  const o: Record<string, unknown> = { v: 1, aiGenerated: true, intro: raw.intro, sections: raw.sections, faq: raw.faq };
  for (const k of ['heading', 'metaTitle', 'metaDescription'] as const) {
    // The meta fields are optional extras: one that is empty, not text or over its cap is left out, it never sinks the text.
    if (typeof raw[k] !== 'string' || raw[k] === '' || Array.from(raw[k] as string).length > (k === 'heading' ? LIMITS.heading : k === 'metaTitle' ? LIMITS.metaTitle : LIMITS.metaDescription)) continue;
    o[k] = raw[k];
  }
  return checkEntryShape(o);
}

export interface LintedEntry { entry: SvcCopyEntry | null; written: number; kept: number; problems: string[] }

/**
 * The AI text of an entry after the lint: failing sentences dropped, a section or question whose heading fails dropped whole,
 * a failing heading or meta omitted. `entry` is null when too little survives (MIN_SENTENCES, MIN_SURVIVAL) or there is no intro.
 * Idempotent: linting its own output changes nothing.
 */
export function lintEntry(e: SvcCopyEntry, allow: readonly VocabGroup[], cleared?: Clearance): LintedEntry {
  const problems: string[] = [];
  let written = 0;
  let kept = 0;
  const line = (t: string, kind: DenyKind): string | null => { const p = lintLine(t, allow, kind, cleared); if (p.length) { problems.push(...p); return null; } return t; };
  const intro = (() => { const r = lintParagraph(e.intro, allow, cleared); written += r.written; kept += r.kept; problems.push(...r.problems); return r.text; })();
  // A section or question whose heading fails is not printed, so its sentences count as written but never as kept.
  const sections: SvcSection[] = [];
  for (const s of e.sections) {
    const h = line(s.h, 'heading');
    const r = lintParagraph(s.p, allow, cleared);
    written += r.written; problems.push(...r.problems);
    if (h !== null && r.text) { sections.push({ h, p: r.text }); kept += r.kept; }
  }
  const faq: SvcFaq[] = [];
  for (const f of e.faq) {
    const q = line(f.q, 'question');
    const r = lintParagraph(f.a, allow, cleared);
    written += r.written; problems.push(...r.problems);
    if (q !== null && r.text) { faq.push({ q, a: r.text }); kept += r.kept; }
  }
  const out: SvcCopyEntry = { v: 1, aiGenerated: true, intro, sections, faq };
  const heading = e.heading ? line(e.heading, 'heading') : null;
  if (heading) out.heading = heading;
  // The meta fields get the honesty lint here; the seo validator (60 / 160, plain, no emoji) is applied by the caller.
  const mt = e.metaTitle ? line(e.metaTitle, 'heading') : null;
  if (mt) out.metaTitle = mt;
  const md = e.metaDescription ? lintParagraph(e.metaDescription, allow, cleared) : null;
  if (md && md.written === 1 && md.kept === 1) out.metaDescription = md.text; else if (md) problems.push(...md.problems);
  if (e.at) out.at = e.at;
  if (e.approval) out.approval = e.approval;
  const total = kept;
  if (!intro || total < MIN_SENTENCES || written === 0 || total / written < MIN_SURVIVAL) return { entry: null, written, kept, problems };
  return { entry: out, written, kept, problems };
}

/** Every distinct piece of text of an entry that would be printed, with its kind: what the claim checker must judge. */
export function entryTexts(e: SvcCopyEntry): { text: string; kind: DenyKind }[] {
  const seen = new Set<string>();
  const out: { text: string; kind: DenyKind }[] = [];
  const add = (text: string | undefined, kind: DenyKind): void => { if (text && !seen.has(text)) { seen.add(text); out.push({ text, kind }); } };
  const paras = (t: string): void => { for (const s of sentencesOf(t)) add(s, 'sentence'); };
  add(e.heading, 'heading');
  paras(e.intro);
  for (const s of e.sections) { add(s.h, 'heading'); paras(s.p); }
  for (const f of e.faq) { add(f.q, 'question'); paras(f.a); }
  add(e.metaTitle, 'heading');
  if (e.metaDescription) paras(e.metaDescription);
  return out;
}
