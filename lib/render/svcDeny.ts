// DEFAULT-DENY first pass for model-written service text (Phase 1 step 6, fix round 6). Pure, no imports.
//
// The text it judges is published WITHOUT the barber's review, so this layer must be near-complete. A deny-list alone never
// converges (every review found the next synonym), so the defence is layered:
//   1. the prompt limits the content to a generic, non-promissory description of what a service is (lib/serviceCopy/prompt.ts);
//   2. THIS module: a sentence survives only if (a) it uses a tiny character set, (b) it has an approved SHAPE (advice, a
//      plain definition or a question), and (c) it trips none of the deny groups below;
//   3. a second, independent model call judges every surviving sentence (lib/serviceCopy/check.ts) and anything it does not
//      clear explicitly is dropped; a failing checker drops the whole request;
//   4. the renderer runs this module again on stored text (guides.aiPageFor), so text that was stored or forged is re-checked.
//
// Each group has an id so the tests can switch one off and prove that a hostile sentence only it catches then gets through.
export type DenyKind = 'sentence' | 'question' | 'heading';

export const DENY_GROUP_IDS = [
  'charset', 'structure', 'obfuscation', 'shape', 'language', 'digits', 'voice', 'promise', 'health', 'credentials',
  'superlative', 'time', 'outcome', 'business', 'people', 'names', 'spanish',
] as const;
export type DenyGroupId = (typeof DENY_GROUP_IDS)[number];

const w = (body: string): RegExp => new RegExp(`\\b(?:${body})\\b`, 'i');

// ── word groups (matched against the lower-cased sentence with {service} replaced by "tok") ───────────────
const DIGITS = w('zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|dozens?|couple|percent\\w*|half|quarter|double|triple|twice|\\w+teen');

const VOICE = w("we|we're|we've|we'll|we'd|our|ours|ourselves|us|i|i'm|i've|i'll|i'd|my|mine|myself|me");

const PROMISE = new RegExp([
  "\\b(?:will|won't|wont|shall|going to|guarantee\\w*|promis\\w*|ensur\\w*|assur\\w*|certain\\w*|definite\\w*|sure|confiden\\w*|satisf\\w*|happy|happier|unhappy|unsatisf\\w*|dissatisf\\w*|disappoint\\w*|upset|complain\\w*|policy|policies|covered|coverage|delight\\w*|pleased|thrilled|trust\\w*|depend\\w*|rely|relies|reliab\\w*|worr\\w*|backed|warrant\\w*|refund\\w*|redo|amend\\w*|rectif\\w*|put right|make it right|made right|make things right|peace of mind|rest easy|no risk|risk-free|money-back|leave you|leaves you|leave feeling|leaving you|walk out|walk away|come away|go home|you'?ll|you are sure)\\b",
  "\\byou (?:can|will|may|are going to) (?:expect|count on|be sure|rest assured)\\b",
  "\\w'll\\b",
].join('|'), 'i');

const HEALTH = w([
  'health\\w*', 'medic\\w*', 'hair ?loss', 'bald\\w*', 'thinning', 'scalps?', 'skin\\w*', 'treat\\w*', 'cure\\w*', 'curing', 'heal\\w*', 'prevent\\w*', 'relie\\w*', 'relief', 'therap\\w*',
  'dermat\\w*', 'dandruff', 'itch\\w*', 'flak\\w*', 'headache\\w*', 'migraine\\w*', 'tension', 'stress\\w*', 'anxi\\w*', 'pain\\w*', 'sore\\w*', 'ache\\w*', 'aching', 'hurt\\w*', 'sting\\w*',
  'blood', 'pressure', 'cortisol', 'circulat\\w*', 'sleep\\w*', 'relax\\w*', 'calm\\w*', 'sooth\\w*', 'eas(?:e|es|ed|ing)', 'tea tree', 'sensitiv\\w*', 'allerg\\w*', 'infect\\w*', 'hygien\\w*',
  'sanit\\w*', 'steril\\w*', 'disinfect\\w*', 'clean\\w*', 'spotless', 'germ\\w*', 'bacteri\\w*', 'virus\\w*', 'safe\\w*', 'safety', 'gentl\\w*', 'harm\\w*', 'damag\\w*', 'repair\\w*', 'restor\\w*',
  'nourish\\w*', 'hydrat\\w*', 'moistur\\w*', 'vitamin\\w*', 'collagen', 'detox\\w*', 'toxin\\w*', 'wrinkle\\w*', 'acne', 'eczema', 'psoriasis', 'rash\\w*', 'inflam\\w*', 'irritat\\w*', 'burn\\w*',
  'scar\\w*', 'swell\\w*', 'bleed\\w*', 'wound\\w*', 'grow\\w*', 'regrow\\w*', 'fuller', 'thicker', 'thicken\\w*', 'stronger', 'strengthen\\w*', 'follic\\w*', 'muscle\\w*', 'nerve\\w*', 'joint\\w*',
  'wellness', 'well-being', 'wellbeing', 'holistic', 'natural\\w*', 'organic', 'chemical\\w*', 'ingredient\\w*', 'hormone\\w*', 'immune', 'immunity', 'disease\\w*', 'illness\\w*', 'condition\\w*',
  'symptom\\w*', 'diagnos\\w*', 'prescri\\w*', 'doctor\\w*', 'physician\\w*', 'clinic\\w*', 'surgeon\\w*', 'surgery', 'mental', 'mood', 'depress\\w*', 'insomnia', 'fatigue', 'tired', 'energi[sz]\\w*', 'rejuvenat\\w*',
].join('|'));

const CREDENTIALS = w([
  'licen[cs]\\w*', 'certif\\w*', 'insur\\w*', 'bond(?:ed|ing)?', 'train(?:ed|ing|s|er|ers)?', 'experienc\\w*', 'expert\\w*', 'professional\\w*', 'master\\w*', 'award\\w*', 'years?', 'yrs?', 'skill(?:s|ed|ful|fully)?',
  'qualif\\w*', 'accredit\\w*', 'regist\\w*', 'vetted', 'apprentic\\w*', 'graduat\\w*', 'degrees?', 'diploma\\w*', 'board', 'association\\w*', 'member\\w*', 'specialist\\w*', 'specializ\\w*', 'specialis\\w*',
  'veteran\\w*', 'seasoned', 'reput\\w*', 'vaccinat\\w*', 'pros?', 'craftsm\\w*', 'artisan\\w*', 'technician\\w*', 'authentic\\w*', 'official\\w*', 'approved', 'authori[sz]\\w*', 'permits?', 'compliant', 'compliance',
  'regulat\\w*', 'standards?', 'credential\\w*', 'background', 'checked', 'decades?', 'generations?', 'established', 'since', 'longtime', 'knowledgeable', 'knowledge', 'know-how', 'expertise', 'talented', 'gifted',
  'dedicated', 'passionate', 'committed', 'devoted', 'accredited', 'trained', 'educated', 'schooled', 'taught', 'mentor\\w*', 'heritage', 'tradition\\w*', 'legacy', 'family-owned', 'owned', 'founded',
].join('|'));

const SUPERLATIVE = new RegExp([
  w([
    'best', 'better', 'worse', 'worst', 'top', 'topmost', 'finest', 'perfect\\w*', 'flawless\\w*', 'ultimate\\w*', 'premium', 'leading', 'unmatched', 'unrivall?ed', 'unbeat\\w*', 'than', 'unlike', 'compar\\w*',
    'versus', 'vs', 'most', 'least', 'greatest', 'great', 'excellen\\w*', 'outstanding', 'superb', 'amazing', 'fantastic', 'wonderful', 'awesome', 'incredible', 'luxur\\w*', 'deluxe', 'high-?quality', 'quality',
    'superior', 'supreme', 'ideal', 'optimal', 'popular\\w*', 'favou?rite\\w*', 'famous', 'renowned', 'unique', 'exceptional', 'stunning', 'beautiful\\w*', 'gorgeous', 'elite', 'signature', 'legendary', 'iconic',
    'trending', 'go-to', 'must-have', 'world-?class', 'second to none', 'one of a kind', 'number one', 'brilliant', 'magnificent', 'impressive', 'remarkable', 'extraordinary', 'marvel\\w*', 'spectacular',
    'exquisite', 'immaculate', 'pristine', 'polished', 'sleek', 'sharp\\w*', 'crisp', 'precise\\w*', 'precision', 'meticulous\\w*', 'careful\\w*', 'attentive', 'thorough\\w*', 'masterful\\w*', 'expertly', 'skilfully', 'nice\\w*', 'lovely',
    'bigger', 'biggest', 'smaller', 'smallest', 'longer', 'longest', 'shorter', 'shortest', 'faster', 'fastest', 'quicker', 'quickest', 'smoother', 'smoothest', 'softer', 'softest', 'closer', 'closest', 'cleaner', 'cleanest',
    'easier', 'easiest', 'strongest', 'thickest', 'thinner', 'thinnest', 'higher', 'highest', 'lower', 'lowest', 'newer', 'newest', 'older', 'oldest', 'deeper', 'deepest', 'warmer', 'warmest', 'cooler', 'coolest',
    'busier', 'busiest', 'simpler', 'simplest', 'safer', 'safest', 'healthier', 'healthiest', 'lighter', 'lightest', 'fresher', 'freshest', 'younger', 'youngest', 'brighter', 'brightest', 'tighter', 'tightest',
    'richer', 'richest', 'cheaper', 'cheapest', 'nicer', 'finer', 'firmer', 'good', 'goodness', 'awful', 'bad', 'terrible', 'horrible', 'poor',
  ].join('|')).source,
].join('|'), 'i');

const TIME = w([
  'quick\\w*', 'fast\\w*', 'minutes?', 'mins?', 'hours?', 'hrs?', 'seconds?', 'secs?', 'days?', 'daily', 'weeks?', 'weekly', 'weekend\\w*', 'months?', 'monthly', 'annual\\w*', 'overnight', 'tonight', 'today', 'tomorrow',
  'mornings?', 'evenings?', 'afternoons?', 'same-?day', 'instant\\w*', 'immediate\\w*', 'soon', 'rapid\\w*', 'swift\\w*', 'prompt\\w*', 'speedy', 'brief\\w*', 'short-?term', 'long-?term', 'lasts?', 'lasting', 'last-?minute',
  'duration', 'takes', 'taking', 'took', 'how long', 'long time', 'schedule\\w*', 'noon', 'midnight', 'a\\.?m', 'p\\.?m', 'am', 'pm', 'meanwhile', 'moments?', 'instantly', 'shortly', 'eventually', 'periodic\\w*',
  'regular\\w*', 'frequent\\w*', 'often', 'usually', 'typically', 'generally', 'normally', 'commonly', 'seasonal\\w*', 'summer', 'winter', 'spring', 'autumn', 'holidays?', 'weekdays?',
].join('|'));

const OUTCOME = new RegExp([
  w([
    'long-?lasting', 'results?', 'resulting', 'guarantee\\w*', 'ensur\\w*', 'promis\\w*', 'always', 'never', 'ever', 'forever', 'permanent\\w*', 'lifetime', 'all', 'every', 'everyone', 'everything', 'anyone', 'anything',
    'nothing', 'nobody', 'everywhere', 'completely', 'totally', 'entirely', 'absolutely', 'fully', 'perfectly', 'truly', 'really', 'very', 'extremely', 'highly', 'incredibly', 'deeply', 'leaves?', 'leaving', 'feel(?:s|ing)?',
    'felt', 'benefit\\w*', 'improv\\w*', 'enhanc\\w*', 'boost\\w*', 'refresh\\w*', 'revitali\\w*', 'glow\\w*', 'radian\\w*', 'shin(?:e|es|y)', 'transform\\w*', 'reduc\\w*', 'eliminat\\w*', 'remov(?:e|es|ed|ing|al)',
    'stop(?:s|ped|ping)?', 'fix\\w*', 'correct\\w*', 'rebuild\\w*', 'lift\\w*', 'tighten\\w*', 'smooth\\w*', 'soft\\w*', 'silky', 'enjoy\\w*', 'love\\w*', 'adore\\w*', 'pamper\\w*', 'indulg\\w*', 'reward\\w*',
    'worth\\w*', 'value\\w*', 'achiev\\w*', 'attain\\w*', 'deliver\\w*', 'provid\\w*', 'offer\\w*', 'ensure', 'effective\\w*', 'effect\\w*', 'work(?:s|ed) wonders', 'do(?:es)? wonders', 'wonders', 'magic\\w*', 'miracle\\w*', 'proven',
    'lasts?', 'last', 'noticeabl\\w*', 'visible', 'visibly', 'upgrade\\w*', 'younger', 'youthful', 'anti-?ag\\w*', 'fresh\\w*', 'restful',
  ].join('|')).source,
  '\\blooks? (?:great|good|better|fresh|sharp|neat|amazing|fuller|younger|polished|stunning|new|its best|your best)\\b',
  "\\byou(?:'| )?(?:ll|will)\\b",
].join('|'), 'i');

const BUSINESS = w([
  'appointment\\w*', 'book\\w*', 'reserv\\w*', 'walk-?ins?', 'deposit\\w*', 'cancel\\w*', 'resched\\w*', 'no-?shows?', 'parking', 'pric\\w*', 'cost\\w*', 'fees?', 'free', 'discount\\w*', 'deals?', 'cheap\\w*', 'afford\\w*',
  'budget\\w*', 'pay\\w*', 'tips?', 'tipping', 'dollars?', 'bucks?', 'cents?', 'usd', 'rates?', 'charg\\w*', 'package\\w*', 'membership\\w*', 'loyalty', 'gift\\w*', 'voucher\\w*', 'coupon\\w*', 'promo\\w*', 'special\\w*',
  'here', 'shops?', 'salons?', 'studios?', 'stores?', 'business\\w*', 'compan\\w*', 'team\\w*', 'staff\\w*', 'owner\\w*', 'location\\w*', 'address\\w*', 'hours', 'menu\\w*', 'open\\w*', 'clos(?:e|es|ed|ing)', 'call\\w*',
  'text(?:s|ed|ing)?', 'phone\\w*', 'email\\w*', 'e-mail\\w*', 'website\\w*', 'online', 'app', 'apps', 'link\\w*', 'instagram', 'facebook', 'tiktok', 'whatsapp', 'review\\w*', 'rating\\w*', 'rated', 'stars?', 'testimonial\\w*',
  'recommend\\w*', 'referr\\w*', 'customer\\w*', 'clients?', 'guests?', 'visitors', 'patron\\w*', 'people', 'folks', 'others', 'regulars?', 'fans?', 'crowd', 'community', 'neighbou?rs?', 'brand\\w*', 'product\\w*',
  'pomade', 'cologne', 'laser', 'equipment', 'friendly', 'welcom\\w*', 'cozy', 'comfortabl\\w*', 'relaxed', 'atmosphere', 'ambience', 'ambiance', 'vibe\\w*', 'environment',
  'wifi', 'refreshments?', 'drinks?', 'coffee', 'tea', 'music', 'television', 'tv', 'service[sd]? (?:is|are) (?:offered|provided|available)', 'lineup', 'queue', 'wait\\w*', 'busy', 'crowded',
  'discreet', 'private', 'privacy', 'confidential\\w*', 'respect\\w*', 'courteous', 'polite', 'caring', 'professional', 'honest', 'friendly',
].join('|'));

const PEOPLE = new RegExp([
  "^(?:your|the|a|an|each|every|our|my|this|that)\\s+(?:\\w+\\s+)?(?:barbers?|stylists?|hairdressers?|technicians?|techs?|therapists?|estheticians?|aestheticians?|practitioners?|artists?|owners?|staff|team|shops?|salons?|studios?|businesses|business|professionals?)\\b",
  "\\b(?:barbers?|stylists?|hairdressers?|technicians?|nail techs?|therapists?|practitioners?)\\s+(?:is|are|has|have|had|holds|uses|follows|takes|works|knows|does|makes|keeps|stays|handles|carries|brings|ensures|checks|cleans|will|can|may|might|should|offers|provides|performs|adjusts|listens|guides|explains|asks|always|never|only|also|then|first|often|usually)\\b",
  "\\b(?:mr|mrs|ms|dr|sir|madam|miss|mister)\\b",
].join('|'), 'i');

const PLACE_WORDS = w([
  'street', 'st', 'avenue', 'ave', 'road', 'rd', 'boulevard', 'blvd', 'lane', 'drive', 'plaza', 'square', 'city', 'town', 'village', 'downtown', 'uptown', 'neighbou?rhood', 'borough', 'county', 'district', 'suburb',
  'nearby', 'local\\w*', 'area', 'region', 'corner', 'block', 'zip', 'postcode', 'state', 'country', 'north\\w*', 'south\\w*', 'east\\w*', 'west\\w*', 'central', 'beach', 'mall', 'airport', 'station', 'near', 'around the corner',
  'brooklyn', 'manhattan', 'queens', 'bronx', 'harlem', 'london', 'paris', 'york', 'angeles', 'chicago', 'miami', 'houston', 'dallas', 'austin', 'texas', 'california', 'florida', 'ohio', 'toronto', 'vancouver', 'montreal',
  'mexico', 'canada', 'england', 'scotland', 'wales', 'ireland', 'usa', 'uk', 'america\\w*', 'british', 'canadian', 'mexican', 'europe\\w*', 'asia\\w*', 'africa\\w*', 'atlanta', 'boston', 'seattle', 'denver', 'phoenix', 'vegas',
  'gillette', 'wahl', 'andis', 'oster', 'olaplex', 'redken', 'loreal', 'kerastase', 'opi', 'cnd', 'shellac', 'gelish', 'essie', 'dior', 'chanel', 'nike', 'apple', 'google', 'amazon', 'clipper\\w*',
].join('|'));

// Spanish (and a few French and German) equivalents of the groups above, matched on text with accents folded.
const SPANISH = w([
  'licenci\\w*', 'licencia\\w*', 'certific\\w*', 'asegur\\w*', 'garant\\w*', 'promet\\w*', 'promes\\w*', 'salud\\w*', 'medic\\w*', 'tratamient\\w*', 'curar', 'curativ\\w*', 'sana\\w*', 'sanar', 'prevenir', 'previen\\w*',
  'alivi\\w*', 'terapi\\w*', 'dermat\\w*', 'cuero', 'cabelludo', 'piel', 'calvicie', 'caida', 'anos?', 'experiencia', 'experto\\w*', 'profesional\\w*', 'maestro\\w*', 'premio\\w*', 'premiad\\w*', 'mejor\\w*', 'peor',
  'ultim\\w*', 'lider\\w*', 'minutos?', 'horas?', 'dias?', 'semanas?', 'meses', 'rapid\\w*', 'inmediat\\w*', 'duradero\\w*', 'resultado\\w*', 'siempre', 'nunca', 'nuestr\\w*', 'nosotros', 'mi', 'mis', 'yo', 'usted\\w*',
  'ustedes', 'nos', 'precio\\w*', 'costo\\w*', 'gratis', 'descuento\\w*', 'oferta\\w*', 'cita\\w*', 'reserv\\w*', 'clientes?', 'todos', 'todas', 'todo', 'nada', 'muy', 'calmante', 'relaj\\w*', 'estres', 'dolor\\w*', 'cabeza',
  'barberia', 'peluqueria', 'uno', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'cien', 'ciento', 'mil', 'confianza', 'seguro', 'segura',
  'cuidado', 'pida', 'reserve', 'llame', 'visite', 'disfrute', 'perfecto', 'perfecta', 'excelente', 'calidad', 'servicio', 'pelo', 'cabello', 'masaje', 'uñas', 'unas',
  'garantie', 'licence', 'annees', 'meilleur\\w*', 'jamais', 'toujours', 'heures', 'notre', 'nous', 'nos', 'prix', 'garantiert', 'jahre', 'beste\\w*', 'immer', 'wir', 'unser\\w*', 'preis\\w*',
].join('|'));

// Words that, glued together without spaces or with filler characters between the letters, still give a claim away. Long stems
// only (5+ letters), because they are matched inside the letters-only form of the sentence.
const SQUASH_STEMS = [
  'licens', 'licenc', 'certif', 'insur', 'guarant', 'dermatolog', 'therapy', 'therapeut', 'medical', 'medicin', 'hairloss', 'hairgrowth', 'regrow', 'awardwin', 'experienc', 'diagnos', 'cortisol', 'headache',
  'infection', 'relieve', 'dandruff', 'bloodpressure', 'moneyback', 'satisfact', 'bestin', 'numberone', 'promise', 'asegur', 'garantiz', 'salud', 'tratamient', 'profesional', 'minutes', 'professional', 'unrivall', 'worldclass',
  'longlasting', 'sameday', 'treatment', 'warrant', 'refund', 'discount', 'deposit', 'scalp', 'expert', 'yearsof', 'yearsin', 'highlyskill', 'fullyinsur', 'walkins', 'booknow', 'callnow',
];
const collapse = (s: string): string => s.replace(/(.)\1+/g, '$1');
const SQUASH_COLLAPSED = SQUASH_STEMS.map(collapse);

// ── shapes ──────────────────────────────────────────────────────────────────────────────────────
const ADVICE_VERBS = new Set(('tell ask bring wear plan speak mention arrive let check choose think consider share describe show explain decide pick keep avoid try start begin prepare take save remember note read allow give talk discuss point '
  + 'request confirm clarify learn find see discover understand look use wash brush comb dry rinse stay sit dress pack get make write list focus go photograph compare decide prefer say ').split(/\s+/).filter(Boolean));
const CONDITIONAL_OPEN = new Set('if when before after during while once whether'.split(' '));
const QUESTION_OPEN = /^(?:what|how|which|why|when|can|could|should|do|does|is|are|may|might)\b/i;
const MODAL_YOU = /^you\s+(?:can|may|might|could|should|need|want|do not|don't|are welcome|are free)\b/i;
const DEFINITION = /^(?:a|an|the|this|these)\s+(?:[a-z{}]+\s+){0,4}?(?:is|are|means|involves|involve|refers to|includes|include|focuses on|focus on|covers|consists of|describes)\b/i;

function shapeOk(norm: string, kind: DenyKind): boolean {
  if (kind === 'heading') return true;
  if (kind === 'question') return QUESTION_OPEN.test(norm) && norm.endsWith('?');
  const first = norm.split(' ')[0];
  if (ADVICE_VERBS.has(first)) return true;
  if (CONDITIONAL_OPEN.has(first)) return true;
  if (MODAL_YOU.test(norm)) return true;
  if (DEFINITION.test(norm)) return true;
  return false;
}

const EN_WORDS = new Set('the and to of is are your you for with that this can if when be may about before after ask tell what how which should would could from at on in or as not do does have has an by there their they them these those more some any each one a it its so'.split(' '));
const FOREIGN_WORDS = new Set('el la los las de del que es un una para con por se lo le les des du et est der die das und ist nicht ein eine mit von il di che per sono gli une au aux pour dans sur qui ou y en os um uma su sus al pero como cuando tu tus te'.split(' '));

// ── the check ───────────────────────────────────────────────────────────────────────────────────
const CHARSET = /^[A-Za-z0-9 ,.'?!;:{}-]+$/;
const TOKEN = /\{[^{}]*\}/g;

export interface DenyOptions { skip?: ReadonlySet<DenyGroupId> | readonly DenyGroupId[] }

/** Why `text` may not be published (empty = it passes this layer). `kind`: a sentence (needs an approved shape), a question, or a heading / title. */
export function denyProblems(text: string, kind: DenyKind = 'sentence', opts: DenyOptions = {}): string[] {
  const skip = new Set<DenyGroupId>(opts.skip ? Array.from(opts.skip as Iterable<DenyGroupId>) : []);
  const out: string[] = [];
  const hit = (id: DenyGroupId, why: string): void => { if (!skip.has(id)) out.push(`D:${id}: ${why}`); };

  if (!CHARSET.test(text)) hit('charset', 'character outside letters, digits and . , ; : ! ? \' - { }');

  const bare = text.replace(TOKEN, ' tok ');
  const norm = bare.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();
  const letters = norm.replace(/[^a-z]/g, '');
  const squash = collapse(letters);

  // structure
  const words = norm.split(' ').filter(Boolean);
  const struct: string[] = [];
  if (text !== text.trim() || /\s{2,}|\t|\n|\r/.test(text)) struct.push('spacing');
  if (words.length < (kind === 'heading' ? 2 : 3)) struct.push('too short');
  if (words.length > 40 || text.length > 300) struct.push('too long');
  if (kind === 'sentence' && !/[.]$/.test(text.trim())) struct.push('must end with a full stop');
  if (kind === 'sentence' && /[!]/.test(text)) struct.push('exclamation');
  if (kind === 'question' && !/\?$/.test(text.trim())) struct.push('must end with a question mark');
  if (kind === 'heading' && /[.!]$/.test(text.trim())) struct.push('heading with a final stop');
  if (/[?!]/.test(text.replace(/[?!]$/, ''))) struct.push('stray ? or !');
  if (/^[^A-Z{]/.test(text.trim())) struct.push('does not start with a capital');
  if (/\b[A-Z]{2,}\b/.test(bare)) struct.push('capitals');
  if (/(.)\1{3,}/.test(norm)) struct.push('stretched letters');
  if (/[,;:.\-']{2,}/.test(text.replace(/\.\.\./g, '#'))) struct.push('repeated punctuation');
  if (struct.length) hit('structure', struct.join(', '));

  // obfuscation: letters spread out or split by filler, or claim stems hiding inside the letters-only form
  if (/(?:^|[\s.,;:'-])(?:[a-z][\s.,;:'-]+){3,}[a-z](?:$|[\s.,;:'-])/i.test(bare) || /[a-z]([.\-'])[a-z]\1[a-z]/i.test(bare)) hit('obfuscation', 'spread-out letters');
  const stem = SQUASH_COLLAPSED.find((s) => squash.includes(s));
  if (stem) hit('obfuscation', `hidden "${stem}"`);

  if (!shapeOk(norm, kind)) hit('shape', 'not advice, a plain definition or a question');

  // language: English function words, and not another language's
  const enCount = words.filter((x) => EN_WORDS.has(x)).length;
  const foreign = words.filter((x) => FOREIGN_WORDS.has(x)).length;
  if ((words.length >= 5 && enCount < 2) || (words.length >= 3 && enCount < 1 && foreign >= 1) || (foreign >= 2 && foreign * 2 >= enCount)) hit('language', 'does not read as English');

  const rules: [DenyGroupId, RegExp, string][] = [
    ['digits', /\d/, 'digit'], ['digits', DIGITS, 'number word'],
    ['voice', VOICE, 'first person'], ['promise', PROMISE, 'promise'], ['health', HEALTH, 'health or body'],
    ['credentials', CREDENTIALS, 'credential or experience'], ['superlative', SUPERLATIVE, 'superlative or comparison'],
    ['time', TIME, 'time claim'], ['outcome', OUTCOME, 'outcome'], ['business', BUSINESS, 'claim about the business'],
    ['people', PEOPLE, 'person as subject'], ['names', PLACE_WORDS, 'place or brand'], ['spanish', SPANISH, 'other language'],
  ];
  for (const [id, re, why] of rules) {
    const m = re.exec(norm);
    if (m) hit(id, `${why}: ${m[0].trim().slice(0, 30)}`);
  }
  // names: a capital letter anywhere but the start of a sentence (a person, a brand, a place)
  const raw = bare.split(/\s+/).filter(Boolean);
  for (let i = 1; i < raw.length; i++) if (/^[A-Z]/.test(raw[i]) && !/[.!?]$/.test(raw[i - 1])) { hit('names', `capitalised word "${raw[i].slice(0, 20)}"`); break; }
  return out;
}
