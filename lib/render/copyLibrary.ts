// The copy library (plan 2026-10-24, section 3): data only. Version 1, US English, barbershops only.
//
// Two kinds of text live here, and nothing else on a site is written by us:
//   GUIDES      ten "About this service" guides. A guide is printed on a service page only when the barber lists a
//               service that matches it, and once per site (guides.ts).
//   EXTRA_PAGES the four guide pages: FAQ, First visit, Hair care, Beard care.
//
// A block has three wordings (`variants`); each wording is a list of sentences. guides.ts picks one wording per block
// from a seed stored in the site data, so the app preview and the published site agree. Every sentence obeys the
// rules R1 to R9 in copyRules.ts (tests/render/copyLibrary.test.ts runs every sentence in every wording through them):
// no "we" or "our", no ranking, no years or licences, no walk-in or parking or free, no promises, no figures except
// advice like "2–4 weeks", no place names, and no service named that the shop does not list. Anything about the shop
// itself arrives through a token: {shop} {place} {industry} {service} {price} {duration} {phone} {address}
// {openDays} {policy} {svc:<guide>} {link:location|hours|contact|book|services}. A sentence whose token has no
// value is dropped (guides.ts), so nothing here can state a fact the barber did not give.
//
// A block id is never reused for a different meaning. Changing a wording changes unedited sites on their next
// publish (accepted, plan section 3). Pure data; imports only the rule types.
import type { GuideId, VocabGroup } from './copyRules.js';
import { GUIDE_IDS } from './copyRules.js';

export const COPY_VERSION = 1;

export { GUIDE_IDS };
export type { GuideId, VocabGroup };

export const EXTRA_IDS = ['faq', 'first-visit', 'hair-care', 'beard-care'] as const;
export type ExtraId = (typeof EXTRA_IDS)[number];

export type BlockKind = 'p' | 'list' | 'qa' | 'step';
export type Wordings = [string[], string[], string[]];

export interface Block {
  /** Stable id: the second part of the copy override key. */
  id: string;
  /** p = one paragraph; list = bullets, one per sentence; step = numbered steps; qa = a question and its answer. */
  kind: BlockKind;
  /** Longest barber override (characters). */
  max: number;
  /** Heading label key (labels.ts) printed over the block, when it has one. */
  h?: string;
  /** qa: the question (plain words, no tokens). */
  q?: string;
  /** qa about a service of the shop: which one {service} {price} {duration} mean. */
  subject?: 'haircut' | 'duration' | 'kids';
  /** Extra vocabulary this block may use (R8), on top of its guide's or page's. */
  allow?: VocabGroup[];
  variants: Wordings;
}

export interface GuideDef {
  /** A service title matches the guide when any of these matches (guides are tried most specific first). */
  match: RegExp[];
  /** A title that matches any of these never gets this guide, whatever `match` says (review K1). */
  not?: RegExp[];
  /** Vocabulary the guide's own text may use (R8). */
  allow: VocabGroup[];
  /** Words that must appear nowhere on a site that lists no service of this guide (tests/render/guides.test.ts). */
  mentions: string[];
  /** One line about how often to come back, for Hair care (haircut-type guides only). */
  interval?: [string, string, string];
  blocks: Block[];
}

export interface PageDef {
  allow: VocabGroup[];
  blocks: Block[];
}

const P = 600;
const Q = 600;

const p = (id: string, variants: Wordings, h?: string): Block => ({ id, kind: 'p', max: P, h, variants });
const list = (id: string, variants: Wordings, h?: string): Block => ({ id, kind: 'list', max: P, h, variants });
const step = (id: string, variants: Wordings, h?: string): Block => ({ id, kind: 'step', max: P, h, variants });
const qa = (id: string, q: string, variants: Wordings, extra: Partial<Block> = {}): Block => ({ id, kind: 'qa', max: Q, q, variants, ...extra });

/** The four blocks every service guide has: what it is, who it suits, how to ask for it, keeping it up. */
const guide = (what: Wordings, who: Wordings, ask: Wordings, care: Wordings): Block[] => [
  p('what', what, 'pgGuideWhat'),
  p('who', who, 'pgGuideWho'),
  p('ask', ask, 'pgGuideAsk'),
  p('care', care, 'pgGuideCare'),
];

export const GUIDES: Record<GuideId, GuideDef> = {
  'cut-beard': {
    match: [/\b(?:(?:hair\s?)?cuts?|fades?|tapers?)\s*(?:&|and|\+|with)\s*(?:a\s+)?beard\b/i],
    allow: ['cut-beard', 'beard'],
    mentions: ['haircut and beard', 'cut and beard', 'haircut & beard', 'combo'],
    interval: [
      'A haircut and beard visit is usually repeated every 3–4 weeks.',
      'Hair and beard together tend to need a refresh every 3–4 weeks.',
      'Many people repeat a haircut and beard visit every 3–4 weeks.',
    ],
    blocks: guide(
      [
        ['This service covers the haircut and the beard in one visit.', 'The hair and the beard are shaped to suit each other.'],
        ['A haircut and beard visit puts both jobs in a single booking.', 'It saves you from booking two separate visits.'],
        ['Here the hair and the beard are done together.', 'The length of one is chosen to go with the length of the other.'],
      ],
      [
        ['It suits anyone who keeps a beard and wants the hair and the beard to look planned together.'],
        ['It works well when both your hair and your beard need attention.', 'Booking them together keeps the two in step.'],
        ['If you keep a beard of any length, this is a simple way to keep your head and face matched.'],
      ],
      [
        ['Say how short you want the hair and how much length you want to keep on the beard.', 'A photo of both helps.'],
        ['Point out where the beard should start and stop on the cheeks and the neck.', 'Say if you want the neckline sharp or soft.'],
        ['Bring a photo that shows the hair and the beard together if you have one.', 'Mention how you style your hair each day.'],
      ],
      [
        ['Wash the beard with a gentle cleanser and keep the skin under it moisturized.', 'Hair and beard usually keep their shape for 2–4 weeks.'],
        ['Brush the beard each day to keep it tidy.', 'Book the next visit before the shape grows out.'],
        ['A little beard oil or balm can soften the hair and help with dry skin.', 'Comb the beard after you wash it.'],
      ],
    ),
  },

  fade: {
    match: [/\bfad(?:e|es)\b/i],
    allow: ['fade'],
    mentions: ['fade'],
    interval: [
      'A fade usually keeps its edge for about 2–3 weeks.',
      'The contrast in a fade often softens within 2–3 weeks.',
      'Many people refresh a fade every 2–3 weeks.',
    ],
    blocks: guide(
      [
        ['A fade blends short hair into longer hair so there is no hard line between them.', 'The height of the fade sets where the shortest hair starts.'],
        ['In a fade the hair on the sides and back gets shorter toward the bottom, often down to the skin.', 'The change in length is smooth.'],
        ['A fade is a cut where the sides and back step down in length, usually with clippers.', 'The result is an even gradient from longer to shorter.'],
      ],
      [
        ['A fade works with many hair types and lengths on top.', 'It suits people who like a clean, short finish on the sides.'],
        ['It suits anyone who wants a neat outline with some length on top.', 'It can be low and subtle or high and bold.'],
        ['A fade is a common choice for people who want a sharp look that is easy to style.', 'It can be kept subtle or made strong.'],
      ],
      [
        ['Say how high you want the fade: low, mid or high.', 'Tell the barber how short it should go at the shortest point.'],
        ['Bring a photo of the fade you like.', 'Say how much length you want to keep on top.'],
        ['Say whether you want the fade to go down to the skin or stop short of it.', 'Point out where on the head it should begin.'],
      ],
      [
        ['A fade grows out fast because the contrast shows.', 'Many people refresh it every 2–3 weeks.'],
        ['Keep the skin on the sides moisturized.', 'Dry skin shows more on short hair.'],
        ['Wash with a gentle shampoo and keep the top neat between visits.', 'Book again before the shape is lost.'],
      ],
    ),
  },

  taper: {
    match: [/\btaper(?:s|ed)?\b/i],
    allow: ['taper'],
    mentions: ['taper'],
    interval: [
      'A taper tends to hold its shape for 3–4 weeks.',
      'A taper grows out softly, so 3–4 weeks between visits is common.',
      'Many people book a taper every 3–4 weeks.',
    ],
    blocks: guide(
      [
        ['A taper makes the hair gradually shorter toward the neckline and around the ears.', 'The change in length is gentle.'],
        ['A taper shortens the hair in a soft slope toward the neck.', 'The sides and back stay neat while the top keeps its length.'],
        ['In a taper the length steps down slowly around the ears and the neckline.', 'It gives a clean outline without a sharp contrast.'],
      ],
      [
        ['It suits people who want a tidy, classic outline.', 'It works with short and medium lengths on top.'],
        ['It is a good choice for a neat look that grows out softly.', 'It suits many hair types.'],
        ['It suits anyone who prefers a gentle change in length to a bold one.', 'It can be worn with a part or without.'],
      ],
      [
        ['Say whether you want a short taper or a longer one.', 'Tell the barber if the neckline should be rounded or square.'],
        ['Bring a photo of the style you like.', 'Say how much length you want at the sides.'],
        ['Point out where the shortening should begin.', 'Say how you want the neckline to finish.'],
      ],
      [
        ['A taper grows out more softly than a high-contrast cut.', 'Many people return every 3–4 weeks.'],
        ['Keep the neckline tidy with regular visits.', 'Wash with a gentle shampoo.'],
        ['Comb the top into shape each day.', 'Book again when the neckline starts to blur.'],
      ],
    ),
  },

  'line-up': {
    match: [/\bline[\s-]?ups?\b/i, /\bshape[\s-]?ups?\b/i, /\bedge[\s-]?ups?\b/i],
    allow: ['line-up'],
    mentions: ['line up', 'line-up', 'lineup', 'shape up', 'shape-up', 'edge up', 'edge-up'],
    blocks: guide(
      [
        ['A line-up sharpens the hairline, the temples and the neckline.', 'It leaves clean, straight edges.'],
        ['Also called a shape-up or an edge-up, a line-up cleans the outline of the hair.', 'It is often paired with a haircut.'],
        ['A line-up redraws the edges of the hairline.', 'The rest of the hair stays as it is.'],
      ],
      [
        ['It suits anyone who wants crisp edges.', 'It works on short hair and on hair with some length.'],
        ['A line-up is for people who like a clean frame around the face.', 'It keeps a style looking fresh.'],
        ['It suits anyone whose edges have grown soft or uneven.', 'It is a light way to tidy up between full cuts.'],
      ],
      [
        ['Tell the barber where you want the hairline to sit.', 'A photo helps.'],
        ['Say how straight or how natural you want the edges.', 'Point out any spots you want left alone.'],
        ['Show where you want the temples to end.', 'Say if you want the neckline squared or rounded.'],
      ],
      [
        ['Edges soften as the hair grows back.', 'Many people refresh a line-up between full haircuts.'],
        ['Avoid picking at the edges at home.', 'Let the barber clean up stray hairs.'],
        ['Keep the skin along the edges moisturized.', 'Fresh edges can feel dry for a day.'],
      ],
    ),
  },

  'beard-trim': {
    match: [/\bbeard\b/i],
    not: [/\bcolou?r|\bdye|\bgr[ae]y\b|\bblend|\bshav|\brazor\b|\bfacial\b/i],
    allow: ['beard-trim', 'beard'],
    mentions: ['beard trim', 'beard'],
    blocks: guide(
      [
        ['A beard trim tidies the length and the outline of the beard.', 'It removes stray hairs and shapes the cheek line and the neckline.'],
        ['A beard trim brings the beard to the length you choose and shapes its edges.', 'The goal is a neat, even look.'],
        ['A beard trim keeps the shape of the beard under control.', 'The length and the lines are chosen to suit your face.'],
      ],
      [
        ['It suits anyone with a beard, from short stubble to full length.'],
        ['It helps if your beard looks uneven or has grown out of shape.', 'It also helps while you grow a beard, to keep it looking neat along the way.'],
        ['It suits beards of any length.', 'It is useful before an event or between haircuts.'],
      ],
      [
        ['Say how much length you want to keep.', 'Point out where the cheek line and the neckline should sit.'],
        ['Bring a photo of a beard shape you like.', 'Say if you want the edges sharp or natural.'],
        ['Tell the barber if you are growing the beard out.', 'Then only the stray hairs and the outline need trimming.'],
      ],
      [
        ['Wash the beard with a gentle cleanser and brush it each day.', 'A trim every 2–4 weeks keeps the shape.'],
        ['Moisturize the skin under the beard.', 'Beard oil or balm can soften the hair.'],
        ['Comb the beard after washing.', 'Book the next trim before the shape is lost.'],
      ],
    ),
  },

  shave: {
    match: [/\bhot\s*towel\b/i, /\bstraight\s*razor\b/i, /\brazor\b/i, /\bshav(?:e|es|ing)\b/i],
    not: [/\bfacial\b/i, /\brazor\b[^]*\b(?:parts?|lines?|designs?)\b/i, /\bhair\s?cuts?\b|\bcuts?\b/i],
    allow: ['shave'],
    mentions: ['shave', 'razor', 'hot towel'],
    blocks: guide(
      [
        ['A razor shave removes hair close to the skin.', 'Warm towels are often used first to soften the skin and the hair.'],
        ['A traditional shave often starts with a warm towel and a lather.', 'The razor then clears the hair from the skin.'],
        ['This service removes hair from the face or the head with a razor.', 'The skin is usually prepared first, often with a warm towel and lather.'],
      ],
      [
        ['It suits anyone who wants a close, smooth finish.', 'It gives a closer finish than clippers or a trimmer.'],
        ['It is for people who like a very clean look.', 'It leaves the skin smooth rather than stubbly.'],
        ['It suits anyone who prefers smooth skin to stubble.'],
      ],
      [
        ['Tell the barber about any sensitive spots, razor bumps or skin conditions before the shave starts.', 'Say if you want some hair left in places.'],
        ['Say which areas you want done and how smooth you want them.', 'Mention if your skin reacts easily.'],
        ['Let the barber know if you have cuts, irritation or a skin condition.', 'Say how close you want the finish.'],
      ],
      [
        ['After a shave, rinse with cool water and moisturize.', 'Skip harsh scrubs for the rest of the day.'],
        ['Keep the skin clean and moisturized for a day or two.', 'Avoid touching the area with unwashed hands.'],
        ['Apply a gentle moisturizer afterward.', 'Some redness usually settles soon; if redness or bumps last, see a doctor.'],
      ],
    ),
  },

  'kids-cut': {
    match: [/\bkids?\b/i, /\bchild(?:ren)?\b/i, /\bboys?\b/i, /\bjuniors?\b(?!\s+(?:barber|stylist))/i],
    allow: ['kids-cut'],
    mentions: ['kids', 'kid', 'child', 'children', 'boys', 'junior'],
    interval: [
      'A kids’ cut usually needs a refresh every 4–6 weeks.',
      'For children, 4–6 weeks between cuts is common.',
      'Many parents book a kids’ cut every 4–6 weeks.',
    ],
    blocks: guide(
      [
        ['A kids’ cut is a haircut made for a child.', 'The style should suit the child’s hair and be easy to look after at home.'],
        ['This is a haircut for children.', 'A good style suits the child’s hair type and the way they wear it.'],
        ['A kids’ haircut keeps the length and the shape tidy for school, sport and play.', 'It helps when the child and the parent agree on the style first.'],
      ],
      [
        ['It suits children who need a tidy cut for school, sport or an event.'],
        ['It suits a child who wants a style of their own.', 'A photo helps the barber see what the child has in mind.'],
        ['It suits children who like a cut that is easy to style.', 'Parents can ask for a style that is easy to keep up at home.'],
      ],
      [
        ['Tell the barber what the child likes and what they do not like.', 'Bring a photo if there is a style in mind.'],
        ['Explain to your child what will happen before the visit.', 'A calm start helps the haircut go smoothly.'],
        ['Say how short you want the sides and how much length to keep on top.', 'Mention if your child is sensitive about the clippers or the neck.'],
      ],
      [
        ['Keep your child’s hair clean and detangle it gently with a comb, a brush or your fingers.', 'Many children’s cuts are refreshed every 4–6 weeks.'],
        ['Wash with a gentle shampoo and rinse well.', 'A cut is easier to keep tidy when the hair is detangled gently and often.'],
        ['Check the neckline as the hair grows.', 'Book the next visit before it gets untidy.'],
      ],
    ),
  },

  design: {
    match: [/\bdesigns?\b/i, /\bhair\s*art\b/i, /\bpatterns?\b/i, /\bparts?\b/i, /\brazor\b[^]*\b(?:lines?)\b/i],
    allow: ['design'],
    mentions: ['design', 'pattern'],
    blocks: guide(
      [
        ['A hair design is a pattern or line cut into short hair, usually with a trimmer.', 'It can be a simple line or a larger pattern.'],
        ['A design adds a line, a part or a pattern to a short haircut.', 'It is usually cut in with a trimmer.'],
        ['Hair designs are shapes cut into short hair.', 'They can be a single line or a detailed pattern.'],
      ],
      [
        ['It suits people with short hair who want a custom detail.'],
        ['It suits anyone who wants their cut to stand out.', 'It works well on short, even hair.'],
        ['It suits people who want a line, a part or a pattern added to a cut.', 'The shorter the hair, the clearer the design.'],
      ],
      [
        ['Bring a picture of the design you want.', 'Say where on the head it should go and how big.'],
        ['Show a photo and say how bold you want the lines.', 'Ask the barber if the design suits your hair length.'],
        ['Describe the design in simple words or draw a quick sketch.', 'A clear picture saves time.'],
      ],
      [
        ['Lines soften as the hair grows back.', 'A design looks sharpest soon after a cut.'],
        ['Keep the hair clean and the skin moisturized.', 'Avoid scratching the lines.'],
        ['Book a refresh when the lines begin to blur.', 'Ask the barber how often your style needs it.'],
      ],
    ),
  },

  color: {
    match: [/\bcolou?r(?:s|ing)?\b/i, /\bdye\b/i, /\bhighlights?\b/i, /\bgr[ae]y\b/i, /\bblond(?:e)?\b/i, /\bbeard\b[^]*\bblend/i],
    allow: ['color'],
    mentions: ['color', 'colour', 'dye', 'highlight', 'gray', 'grey'],
    blocks: guide(
      [
        ['Hair color changes or covers the shade of your hair.', 'How it turns out depends on the shade you start with and the shade you want.'],
        ['A color service changes the shade of the hair with dye.', 'The result depends on your starting color.'],
        ['Hair color changes the shade of the hair, a little or a lot.', 'The shade and the method are chosen with the barber.'],
      ],
      [
        ['It suits anyone who wants to change or even out the shade of their hair.'],
        ['It suits people who want a change from their natural shade.', 'It can be subtle or bold.'],
        ['It suits anyone who wants a softer change in shade.', 'Talk through how natural you want the result to look.'],
      ],
      [
        ['Bring photos of the shade you want.', 'Tell the barber about any past color or bleach on your hair.'],
        ['Say whether you want a natural result or a bold one.', 'Mention any reaction you have had to hair color.'],
        ['Describe the shade in simple words and show a photo.', 'Say how much upkeep you are happy to do.'],
      ],
      [
        ['Use a gentle shampoo and wash less often to keep the color longer.', 'Expect the shade to soften as the hair grows.'],
        ['Rinse with cooler water.', 'Moisturize the hair to keep it soft.'],
        ['Protect colored hair from strong sun.', 'Book a touch-up when the shade starts to change.'],
      ],
    ),
  },

  haircut: {
    match: [/\bhair\s?cuts?\b/i, /^(?![^]*(?:\b(?:eye)?brows?\b|\bm(?:ou|u)stache\b|\bnose\b|\bears?\b|\bneck\b))[^]*\bcuts?\b/i, /\bclippers?\b/i, /\bscissors?\b/i, /\bbuzz\b/i, /\bcrew\b/i],
    allow: [],
    mentions: [],
    interval: [
      'Most short haircuts keep their shape for 2–4 weeks.',
      'A haircut tends to hold its shape for 2–4 weeks.',
      'Many people book a haircut every 2–4 weeks.',
    ],
    blocks: guide(
      [
        ['A haircut shortens and shapes your hair to suit your head and your hair type.', 'A clear description or a photo helps get the result you want.'],
        ['A haircut tidies the length and the outline of your hair.', 'The sides, the back and the top can each be a different length.'],
        ['In a haircut the barber trims the hair with clippers, scissors or both.', 'The result depends on your hair type and the style you ask for.'],
      ],
      [
        ['It suits anyone whose hair has grown out of shape.', 'It also suits anyone who wants a change.'],
        ['A haircut suits anyone who wants a neat, easy-to-manage look.', 'Ask the barber what works for your hair type.'],
        ['It suits anyone who wants a fresh start or a small update.', 'A photo helps show what you have in mind.'],
      ],
      [
        ['Describe the length you want on the sides and on top.', 'A photo helps, and so does saying how you style your hair each day.'],
        ['Say how often you plan to visit.', 'That helps the barber pick a style that grows out well.'],
        ['Show a photo from the front, side and back if you can.', 'Say what you liked and did not like about your last cut.'],
      ],
      [
        ['Wash with a gentle shampoo and comb or brush the hair each day.', 'Most short cuts keep their shape for 2–4 weeks.'],
        ['Keep the skin on the sides and neck moisturized.', 'Book your next visit before the shape is lost.'],
        ['Use only a small amount of product so the style stays light.', 'Brush the hair into shape each morning.'],
      ],
    ),
  },
};

/** The guide pages. Their data-driven parts (service lists, prices) are built by pageBodies.ts from the barber's data. */
export const EXTRA_PAGES: Record<ExtraId, PageDef> = {
  faq: {
    allow: [],
    blocks: [
      // Questions the site's own data answers. Each is dropped when its data is missing.
      qa('book', 'How do I book?', [
        ['Use the {link:book} link to choose a time.', 'To book by phone, call {phone}.'],
        ['You can book online with the {link:book} link.', 'The phone number is {phone}.'],
        ['To book, use the {link:book} link.', 'If you prefer to talk, call {phone}.'],
      ]),
      qa('hours', 'When is the shop open?', [
        ['The shop opens on {openDays} of the seven days of the week.', 'The full times are on the {link:hours} page.'],
        ['Of the seven days of the week, the shop opens on {openDays}.', 'Check the {link:hours} page for the times.'],
        ['The shop is open on {openDays} of the seven days each week.', 'See the {link:hours} page for the hours of each day.'],
      ]),
      qa('where', 'Where is the shop?', [
        ['The shop is at {address}.', 'Directions and a map are on the {link:location} page.'],
        ['You can find the shop at {address}.', 'The {link:location} page has a map.'],
        ['The address is {address}.', 'Open the {link:location} page for directions.'],
      ]),
      qa('price', 'How much is a haircut?', [
        ['The {service} is listed at {price}.', 'Prices for the other services are on the {link:services} page.'],
        ['A {service} is listed at {price}.', 'See the {link:services} page for the rest of the menu.'],
        ['The listed price for the {service} is {price}.', 'Other prices are on the {link:services} page.'],
      ], { subject: 'haircut' }),
      qa('length', 'How long does a visit take?', [
        ['The {service} is listed as {duration}.', 'Other services list their own times on the {link:services} page.'],
        ['A {service} is listed at {duration}.', 'The {link:services} page shows the other times.'],
        ['The listed time for the {service} is {duration}.', 'Check the {link:services} page for the rest.'],
      ], { subject: 'duration' }),
      qa('kids', 'Does the shop do kids’ haircuts?', [
        ['Yes. The {service} is on the service list.', 'It is listed at {price}.'],
        ['Yes, there is a {service} on the service list.', 'The listed price is {price}.'],
        ['Yes, the {service} is on the {link:services} page.', 'The {service} is listed at {price}.'],
      ], { subject: 'kids', allow: ['kids-cut'] }),
      qa('policy', 'Does the shop have a booking policy?', [
        ['{policy}'],
        ['The shop’s policy reads: {policy}'],
        ['Here is what the shop says about it: {policy}'],
      ]),
      // General questions, true of any barbershop.
      qa('bring', 'What should I bring to my first visit?', [
        ['Bring a photo of the style you want if you have one.', 'A photo shows the length and the shape better than words.'],
        ['A photo of a cut you like is the most useful thing to bring.', 'Pictures from the front, side and back help most.'],
        ['Bring a picture of the cut you like, or save one on your phone.', 'Be ready to say how you usually style your hair.'],
      ]),
      qa('describe', 'How do I describe the cut I want?', [
        ['Start with the length: short, medium or long.', 'Then say what you want on the sides, the back and the top.', 'If you are unsure, ask the barber what suits your hair.'],
        ['Talk about the length first, then the sides and the back.', 'Mention how you style your hair each day.', 'Ask a question if a term is new to you.'],
        ['Use simple words: shorter or longer, tighter or looser.', 'A photo plus a few words works better than a long description.', 'Ask the barber to confirm the plan before the cut starts.'],
      ]),
      qa('often', 'How often should I get a haircut?', [
        ['Short styles keep their shape for 2–4 weeks.', 'Longer styles can wait longer between visits.'],
        ['Most short cuts need a refresh every 3–4 weeks.', 'Hair that is kept longer needs a trim less often.'],
        ['Sharp, short styles tend to lose their shape within 2–3 weeks.', 'Longer hair can go for longer.'],
      ]),
      qa('wash', 'Should I wash my hair before I come?', [
        ['It depends on the cut, so ask when you book.', 'If in doubt, come with clean hair and little or no product.'],
        ['Clean hair with little or no product shows the true length and texture.', 'Some cuts, especially on curly hair, are done dry, so ask when you book.'],
        ['Arrive with clean hair and little product if you can.', 'Ask when you book if the shop prefers something different.'],
      ]),
      qa('late', 'What if I am running late?', [
        ['Get in touch with the shop as soon as you know.', 'The details are on the {link:contact} page.'],
        ['Message or call the shop as early as you can.', 'You can find the details on the {link:contact} page.'],
        ['Let the shop know as soon as you can.', 'Contact details are on the {link:contact} page.'],
      ]),
      qa('speakup', 'What if something feels wrong during the cut?', [
        ['Say so right away.', 'Small changes are easy to make early in the cut and hard to make late.', 'Speak up politely and be specific.'],
        ['Speak up early and be specific about what you want changed.', 'Adjusting is easier before the hair is cut short.'],
        ['Tell the barber as soon as you notice.', 'Pointing at the spot in the mirror makes it clear.'],
      ]),
      qa('fresh', 'How do I keep my cut looking fresh?', [
        ['Wash with a gentle shampoo and comb or brush the hair as your barber advises.', 'Keep the skin on the sides moisturized.', 'Book your next visit before the shape grows out.'],
        ['Brush or comb the hair into shape each day.', 'Use only a small amount of styling product.', 'Notice when the neckline starts to blur and book again.'],
        ['Keep the hair clean and the scalp moisturized.', 'Avoid cutting the hair yourself between visits.', 'Ask the barber how long your style should last.'],
      ]),
      qa('littleoff', 'What does a little off the top mean?', [
        ['It usually means a small amount of length taken from the top only.', 'Say how much in words or show it with your fingers.'],
        ['It is a vague phrase, so give a length instead.', 'Show the amount with your fingers or a photo.'],
        ['People use it to mean a light trim.', 'A clear length or a photo avoids any surprise.'],
      ]),
    ],
  },

  'first-visit': {
    allow: [],
    blocks: [
      p('booking', [
        ['Book ahead with the {link:book} link.', 'Prefer the phone? The number is {phone}.'],
        ['The {link:book} link is the quickest way to pick a time.', 'To speak to the shop first, call {phone}.'],
        ['Book before you go with the {link:book} link.', 'You can reach the shop on {phone}.'],
      ], 'pgFvBooking'),
      p('findUs', [
        ['The shop is at {address}.', 'Directions and a map are on the {link:location} page.', 'The opening times are on the {link:hours} page.'],
        ['You can find the shop at {address}.', 'The {link:location} page has a map.', 'Check the {link:hours} page before you set out.'],
        ['The address is {address}.', 'Open the {link:location} page for directions.', 'The {link:hours} page lists the opening times.'],
      ], 'pgFvFindUs'),
      list('before', [
        ['Choose a photo of the cut you want.', 'Arrive with clean hair if you can.', 'Think about how you style your hair each day.', 'Leave a few extra minutes so you are not rushed.'],
        ['Save a few photos of cuts you like.', 'Think about what you liked and disliked about past cuts.', 'Decide how much time you want to spend on your hair each morning.', 'Plan to arrive a little early.'],
        ['Pick a photo or two that show the cut you have in mind.', 'Note how short you want the sides and the back.', 'Mention if you wear glasses or a hat, because it can change how a cut sits.', 'Check the booking details so you know when to arrive.'],
      ], 'pgFvBefore'),
      step('inChair', [
        ['Say what you want first: the length, the sides, the back and the top.', 'Show your photo.', 'Ask the barber to explain the plan.', 'Speak up early if you want a change.'],
        ['Start with the length you want overall.', 'Describe the sides and the back, then the top.', 'Ask the barber to confirm the plan before starting.', 'Check the result in the mirror and ask for any small changes.'],
        ['Show your photo and say what you like about it.', 'Say what you do not want.', 'Agree on the length with the barber.', 'Tell the barber if anything feels wrong.'],
      ], 'pgFvInChair'),
    ],
  },

  'hair-care': {
    allow: [],
    blocks: [
      p('wash', [
        ['Wash with a gentle shampoo and rinse well.', 'Wash only as often as your hair needs it.'],
        ['Use lukewarm water and a gentle shampoo.', 'Too much washing can dry the scalp.'],
        ['Rinse until the water runs clear of soap.', 'A gentle shampoo is enough for most hair.'],
      ], 'pgHcWash'),
      p('dry', [
        ['Pat the hair dry with a towel instead of rubbing.', 'Comb or brush it into shape while it is damp.'],
        ['Let the hair air dry when you can.', 'Use low heat if you use a dryer.'],
        ['Towel dry gently.', 'Comb the hair in the direction you want it to lie.'],
      ], 'pgHcDry'),
      p('style', [
        ['Use a small amount of styling product and work it in with your fingers.', 'Add more only if you need it.'],
        ['Start with a little product.', 'Too much can weigh the hair down.'],
        ['Work the product through the hair, damp or dry, depending on the finish you want.', 'Comb or brush the hair into shape.'],
      ], 'pgHcStyle'),
      p('scalp', [
        ['Keep the scalp clean and moisturized.', 'Dry or flaky skin shows more on short hair.'],
        ['Massage the scalp when you wash.', 'Rinse well so no product stays behind.'],
        ['Look after the skin as well as the hair.', 'See a doctor if the scalp stays red or itchy.'],
      ], 'pgHcScalp'),
      p('between', [
        ['Hair grows at its own pace, so the right gap between cuts depends on your style.', 'Short, sharp styles need visits more often than longer ones.'],
        ['Book the next cut before the shape is lost.', 'Ask the barber how long your style should last.'],
        ['Watch the neckline and the ears.', 'They show first when it is time for another cut.'],
      ], 'pgHcBetween'),
    ],
  },

  'beard-care': {
    allow: ['beard'],
    blocks: [
      p('wash', [
        ['Wash the beard with a gentle cleanser a few times a week.', 'Rinse well and pat it dry.'],
        ['Use a mild cleanser made for the face or the beard.', 'Harsh soap can dry the hair and the skin.'],
        ['Clean the beard when it feels dirty, not every day.', 'Dry it gently with a towel.'],
      ], 'pgBcWash'),
      p('brush', [
        ['Comb or brush the beard each day.', 'This keeps it tidy and stops tangles.'],
        ['Use a comb, a brush or a pick, whichever suits the length and texture of your beard.', 'Brush in the direction the hair grows.'],
        ['Brush the beard after you wash it.', 'It helps spread the natural oils along the hair.'],
      ], 'pgBcBrush'),
      p('skin', [
        ['Moisturize the skin under the beard.', 'A little beard oil or balm can soften the hair.'],
        ['Dry skin under a beard can itch.', 'A light moisturizer can help.'],
        ['Keep the skin clean and moisturized.', 'Itching or flaking that does not clear up is worth showing to a doctor.'],
      ], 'pgBcSkin'),
      p('trim', [
        ['Trim the beard every 2–4 weeks to keep the shape.', 'Between visits, only tidy the stray hairs on the neck.'],
        ['A regular trim keeps the beard even.', 'Ask the barber what length suits your face.'],
        ['Book the next trim before the shape grows out.', 'A beard that is growing out still needs light tidying now and then.'],
      ], 'pgBcTrim'),
    ],
  },
};
