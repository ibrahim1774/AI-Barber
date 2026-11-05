// The guide library (Step 8): general, evergreen advice and definitions for visitors. Data only, version 1, US English, barbershops.
//
// These pages are FILLER FOR VISITORS: they exist so a multi-page site reaches the floor of 21 pages. They are `noindex`, left out of the
// sitemap and out of the JSON-LD. Because they are published without anyone checking them against a particular shop, every sentence must
// be true for EVERY shop that can reach it, so the library follows hard rules (enforced by tests/render/guidePages.library.test.ts):
//   - NO owner text: there are no tokens at all. A sentence cannot name the shop, a service, a price, a place, a phone number or a person.
//   - It describes what a thing IS or advises the reader. It never praises, rates or promises, and says nothing about results, health,
//     hair growth, tools, products, brands, durations or prices.
//   - No "we" / "our"; no first person at all.
//   - Every sentence passes copyProblems() (R1 to R11, R16) with its guide's `allow` list AND the independent default-deny layer
//     svcDeny.denyProblems() with NO group skipped. That layer demands an approved shape, so each sentence opens with an advice verb, an
//     if/when/before/after clause, or "A/An/The/This/These <noun> is/are ...".
//   - A published wording is never edited in place: a fix adds a new wording or a new block id (tests/render/fixtures/guideLibrary.hashes.json).
//
// Each guide has three blocks, each with THREE differently structured wordings; the wording shown is picked per business from the stored
// seed (variantIndex on `guides.<id>.<block>`), or by the owner. The blocks: `intro` (paragraph), `points` (list), `tip` (paragraph).
// Pure data; imports only types and ids.
import type { VocabGroup } from './copyRules.js';
import type { GuidePageId } from './guideIds.js';

export type Wordings = [string[], string[], string[]];
export type StyleId =
  | 'crew-cut' | 'buzz-cut' | 'fade' | 'taper' | 'side-part' | 'pompadour' | 'undercut' | 'quiff' | 'slick-back' | 'comb-over'
  | 'textured-crop' | 'mohawk' | 'mullet' | 'caesar';

export interface GuideBlockDef {
  id: 'intro' | 'points' | 'tip';
  kind: 'p' | 'list';
  /** Heading printed over the block (none for the intro). One fixed wording; it is also deny-checked. */
  h?: string;
  /** Longest owner override (characters). */
  max: number;
  variants: Wordings;
  /** hairstyle-ideas `points` only: the style each sentence defines, in the same order as `variants`. Used for the optional link to the shop's own page. */
  styleOf?: [StyleId[], StyleId[], StyleId[]];
}

/** Which services must exist for the guide to be offered at all: structuralGuide() ids (familyKeywords.ts). Absent = general, offered to every barber site. */
export type GuideWhen = 'fade-or-taper' | 'kids-cut' | 'shave';

export interface GuideDef {
  title: string;
  /** One line for the hub. A sentence in an approved shape. */
  blurb: string;
  when?: GuideWhen;
  /** Service-name vocabulary groups this guide's sentences may use (copyRules R8). */
  allow: VocabGroup[];
  blocks: GuideBlockDef[];
}

const P = 600;
const intro = (variants: Wordings): GuideBlockDef => ({ id: 'intro', kind: 'p', max: P, variants });
const points = (h: string, variants: Wordings, styleOf?: GuideBlockDef['styleOf']): GuideBlockDef => ({ id: 'points', kind: 'list', h, max: P, variants, ...(styleOf ? { styleOf } : {}) });
const tip = (variants: Wordings): GuideBlockDef => ({ id: 'tip', kind: 'p', h: 'Keep in mind', max: P, variants });

export const GUIDE_LIBRARY: Record<GuidePageId, GuideDef> = {
  'ask-for-the-cut': {
    title: 'How to ask for the cut you want',
    blurb: 'Learn how to describe the cut you have in mind.',
    allow: [],
    blocks: [
      intro([
        ['Start with the look you want, then move on to the details.', 'Tell your barber what you like about your current cut and what you would change.'],
        ['A photo is a simple way to show the length and shape you mean.', 'If you can, bring a photo of the cut you have in mind.'],
        ['Think about the sides, the back and the upper hair before you sit down.', 'Say what you want for each part.'],
      ]),
      points('Things to say', [
        ['Say how short you want the sides and the back.', 'Say how much length you want to keep in the upper hair.', 'Mention how you style your hair.', 'Tell your barber if you have a part you like to keep.'],
        ['Bring a photo or a sketch, and say which part of it you like.', 'Point out any part of the photo that does not apply to your hair.', 'Ask what changes would help the cut suit your hair type.', 'Confirm the plan before the cutting starts.'],
        ['Use simple words for length, such as short, medium or long.', 'Show the length with your fingers if that helps.', 'Ask your barber to explain any term you do not know.', 'Describe the finish you want at the neckline and around the ears.'],
      ]),
      tip([
        ['Speak up during the cut if something is not what you pictured.', 'Say so early, because small changes are simple to make at the start.'],
        ['Before you get up from the chair, check the sides, the back and the neckline.', 'Ask for a change if something needs adjusting.'],
        ['Once the plan is clear, tell your barber to go ahead.', 'Ask questions at any point.'],
      ]),
    ],
  },

  'hairstyle-ideas': {
    title: 'Hairstyle ideas',
    blurb: 'Read a short description of each of the common hairstyles.',
    allow: ['fade', 'taper'],
    blocks: [
      intro([
        ['A hairstyle name is shorthand for a length, a shape and a finish.', 'Use the names below as a starting point and add a photo.'],
        ['Read through the styles below to find words for what you like.', 'Ask for a change to any style so it suits your hair.'],
        ['When a style name catches your eye, write it down.', 'Remember that names vary between barbers, so a photo helps too.'],
      ]),
      {
        id: 'points', kind: 'list', h: 'Common styles', max: P,
        variants: [
          [
            'A crew cut is a short style with tapered sides and a little more length in the upper hair.',
            'A buzz cut is a short style that keeps the hair at one even length.',
            'A fade is a cut that blends short hair into the long hair above it, with no hard line between them.',
            'A taper is a cut where the hair shortens gradually toward the neckline and around the ears.',
            'A side part is a style where the hair is combed to one side along a clear parting line.',
            'A pompadour is a style where the hair is swept up and back from the forehead to add height.',
          ],
          [
            'An undercut is a style with short sides and back and a sudden change in length where the long hair begins.',
            'A quiff is a style where the front hair is brushed up and back to create volume.',
            'A slick back is a style where the hair is combed straight back from the forehead.',
            'A comb over is a style where the hair is combed across from a side part.',
            'A fade is a cut that blends short hair into the long hair above it, with no hard line between them.',
            'A taper is a cut where the hair shortens gradually toward the neckline and around the ears.',
          ],
          [
            'A textured crop is a short style with choppy layers and a fringe.',
            'A mohawk is a style with short sides and a strip of long hair along the middle.',
            'A mullet is a style that is short at the front and sides and long at the back.',
            'A caesar is a short style with an even length and a short fringe brushed forward.',
            'A buzz cut is a short style that keeps the hair at one even length.',
            'A fade is a cut that blends short hair into the long hair above it, with no hard line between them.',
          ],
        ],
        styleOf: [
          ['crew-cut', 'buzz-cut', 'fade', 'taper', 'side-part', 'pompadour'],
          ['undercut', 'quiff', 'slick-back', 'comb-over', 'fade', 'taper'],
          ['textured-crop', 'mohawk', 'mullet', 'caesar', 'buzz-cut', 'fade'],
        ],
      },
      tip([
        ['Ask your barber how a style would behave with your hair type.', 'Remember that the same name can look different on straight, wavy and curly hair.'],
        ['Think about how much effort you want to put into styling.', 'Ask your barber about the upkeep a style needs.'],
        ['If a style goes by another name, a photo clears it up.', 'Save the photo so you can show it again at your next visit.'],
      ]),
    ],
  },

  'fade-and-taper': {
    title: 'Fade and taper guide',
    blurb: 'Learn the difference between a fade and a taper.',
    when: 'fade-or-taper',
    allow: ['fade', 'taper'],
    blocks: [
      intro([
        ['A fade is a cut where the hair shortens in steps until it is cropped short.', 'A taper is a similar cut where the change in length is milder and stays by the neckline and ears.'],
        ['The word fade describes hair that blends from one length into another.', 'A taper describes a gradual shortening toward the neckline and around the ears.'],
        ['This guide covers the common fade types and how a taper differs.', 'Use the terms below when you describe what you want.'],
      ]),
      points('Terms to know', [
        ['A low fade is one that starts just above the ears and the neckline.', 'A mid fade is one that starts around the temples.', 'A high fade is one that starts well up the sides of the head.', 'A drop fade is one that curves down behind the ear.', 'Ask how far the fade should reach down the head.'],
        ['Say whether you want the fade to start low, mid or high.', 'Say how far down the fade should go.', 'Mention if you want the change in length to be gradual or sudden.', 'Show a photo of the fade you have in mind.'],
        ['A low taper is one that stays by the neckline and the ears.', 'A mid taper is one that starts a little way up the sides.', 'A high taper is one that starts well up the sides.', 'A taper fade is a milder fade that stays by the neckline and the ears.', 'Ask your barber to explain the difference if the names are unclear.'],
      ]),
      tip([
        ['Tell your barber how you part and style the upper hair, because the fade frames it.', 'Ask what upkeep the cut needs.'],
        ['Remember that a fade changes shape as the hair lengthens.', 'Ask your barber when to return for a touch up.'],
        ['If you wear a hat or helmet a lot, mention it.', 'Bring a photo that shows the height of the fade you want.'],
      ]),
    ],
  },

  'barber-matters': {
    title: 'Why your barber matters',
    blurb: 'Learn why a clear conversation before the cut matters.',
    allow: [],
    blocks: [
      intro([
        ['A haircut is shaped by your hair, your plan and the person holding the tools.', 'Talk through the plan before the cutting starts.'],
        ['Think of a haircut as a series of small choices about length, shape and finish.', 'Ask your barber to walk you through those choices.'],
        ['When you find a barber you like, tell them what works for you.', 'Keep notes on what you asked for so a repeat visit is simple.'],
      ]),
      points('Questions to ask', [
        ['Ask your barber how the cut would suit your hair type.', 'Ask about the neckline and the edges, because small details change the finish.', 'Say what you did not like about your previous cut.', 'Mention any hair habits that affect the cut, such as a cowlick or a strong part.'],
        ['Share a photo and ask what changes the cut would need for your hair.', 'Ask which tools are used for each part of the cut.', 'Say if you want a light change or a bold one.', 'Ask for advice on keeping the shape between visits.'],
        ['Consider advice about what suits your face and your hair.', 'Decide together how much to change in one visit.', 'Point out any part of the hair you want left alone.', 'Ask questions at any point during the cut.'],
      ]),
      tip([
        ['Keep the conversation specific.', 'Share clear feedback after each visit, so the next one fits you more closely.'],
        ['Think of each visit as a chance to adjust the plan.', 'Tell your barber what to keep and what to change.'],
        ['Once you find a style you like, save a photo of it.', 'Show it again at later visits.'],
      ]),
    ],
  },

  'gap-between-haircuts': {
    title: 'Choosing the gap between your haircuts',
    blurb: 'Learn what shapes the gap between haircuts.',
    allow: [],
    blocks: [
      intro([
        ['The gap between haircuts is a personal choice.', 'Ask your barber what gap suits your hair and your style.'],
        ['Consider how short your style is, because short styles tend to lose their shape sooner.', 'Ask your barber for a suggestion based on your hair and style.'],
        ['Remember that tidy edges and short sides lose their shape sooner, while long layers hold theirs.', 'Ask your barber what suits your style.'],
      ]),
      points('Things to weigh', [
        ['If your style has tidy edges, plan for touch ups sooner.', 'If your style is long or layered, the shape tends to hold for a while.', 'If you have a big event coming up, ask about timing the cut beforehand.', 'If your hair is wavy or curly, ask how it behaves as the length builds.'],
        ['Look for the point where your style starts to lose its shape.', 'Pick a rhythm that fits your routine, then adjust it.', 'Keep a note of the date of each cut.', 'Ask your barber to suggest a return time at the end of each visit.'],
        ['When the edges look uneven, a touch up may be due.', 'When the hair sits differently, it may be time for a trim.', 'Before an important event, consider a trim.', 'After a haircut, note when you start to dislike the shape.'],
      ]),
      tip([
        ['Avoid letting the style get hard to manage.', 'Ask your barber what to do between visits.'],
        ['Remember that hair changes shape at its own pace.', 'Use your own judgment alongside any suggestion.'],
        ['If you are unsure, ask your barber when to come back.', 'Write the answer down.'],
      ]),
    ],
  },

  'prepare-your-visit': {
    title: 'Preparing for your visit',
    blurb: 'Read a short checklist to use before you arrive.',
    allow: [],
    blocks: [
      intro([
        ['A short checklist is a simple way to prepare for a haircut.', 'Use it before you head out.'],
        ['Before you head out, think about what you want from the cut.', 'Save a photo of the cut you want.'],
        ['Plan ahead so the visit is simple.', 'Start with the points below.'],
      ]),
      points('A short checklist', [
        ['Arrive with your hair styled the way you wear it.', 'Bring a photo of the cut you want.', 'Wear something with a loose neckline.', 'Plan to arrive a little early.', 'Bring a hat or hair tie if you use one.'],
        ['Think about how you want to style the cut at home.', 'Make a list of questions to ask.', 'Save any photos in one place so they are easy to find.', 'Check the time before you head out.'],
        ['If you have a strong part or a cowlick, plan to mention it.', 'If you wear a hat or helmet a lot, mention that too.', 'If you have an event coming up, say so.', 'If you have questions, write them down first.'],
      ]),
      tip([
        ['Take your time to settle in before the cut starts.', 'Ask your barber to confirm the plan out loud.'],
        ['Keep your photos handy.', 'Show them early.'],
        ['Remember that a clear plan keeps the visit simple.', 'Say what you want in plain words.'],
      ]),
    ],
  },

  'child-first-haircut': {
    title: 'A child\'s first haircut',
    blurb: 'Learn how to prepare a child for a first haircut.',
    when: 'kids-cut',
    allow: ['kids-cut'],
    blocks: [
      intro([
        ['A first haircut is a new situation for many children.', 'Plan the visit around the child\'s routine.'],
        ['Talk to the child about the visit beforehand, in simple words.', 'Explain what to expect.'],
        ['If a child is wary of a new place, a little preparation can help.', 'Read the points below before you go.'],
      ]),
      points('Ideas for parents', [
        ['Choose a time when the child is rested and fed.', 'Show the child a photo of the style you both like.', 'Let the child sit on a parent\'s lap if the barber allows it.', 'Bring a small distraction, such as a toy or a snack.'],
        ['Keep the first visit short and simple.', 'Ask the barber to go slowly and explain each step.', 'Tell the child they did well afterward.', 'Bring a snack for afterward.'],
        ['If the child is wary of the sound of the tools, ask the barber to show them first.', 'If the child fidgets, take a short break.', 'If the child prefers, let them hold a mirror.', 'Once the cut is done, tell the child it went well.'],
      ]),
      tip([
        ['Remember that each child is different.', 'Go at the pace that suits your child.'],
        ['Arrive a little early so the child can look around.', 'Stay beside the chair.'],
        ['Take a photo of the finished cut.', 'Keep it to show at the next visit.'],
      ]),
    ],
  },

  'face-shape': {
    title: 'Choosing a style for your face shape',
    blurb: 'Read general ideas for matching a style to your face.',
    allow: [],
    blocks: [
      intro([
        ['The shape of your face is one factor when you choose a style.', 'Use the ideas below as starting points, not rules.'],
        ['A face shape is a rough description of the outline of your face.', 'Remember that guides differ and your own taste matters as well.'],
        ['If you want a starting point, look at the outline of your face in a mirror.', 'Read the common shapes below and see which fits.'],
      ]),
      points('Common shapes', [
        ['An oval face is one where the forehead and jaw are similar in width.', 'A round face is one with similar width and length and a rounded jaw.', 'A heart shaped face is one with a broad forehead that narrows toward the chin.', 'A long face is one that is narrow for its length.', 'A diamond face is one with wide cheekbones and a narrower forehead and jaw.'],
        ['If you have a round face, you may like height in the upper hair and tidy sides.', 'If you have a long face, you may like some length at the sides and a fringe.', 'If you have an oval face, many styles can suit you.', 'If you have a heart shaped face, you may like a fringe or length around the chin.', 'If you have a diamond face, you may like volume at the forehead and jaw.'],
        ['Find the widest part of your face in a mirror.', 'Think about where you want more or less volume.', 'Ask your barber for an opinion on which styles suit your face.', 'Try a style for a while before you decide if it suits you.'],
      ]),
      tip([
        ['Remember that hair type, lifestyle and taste matter as much as face shape.', 'Show a photo of a style you like and ask how it would suit your face.'],
        ['Keep in mind that shape guides are general.', 'Ask your barber to suggest small changes.'],
        ['If a style does not suit you, say so, because small adjustments are possible.', 'Bring the photo again at your next visit.'],
      ]),
    ],
  },

  'hair-types': {
    title: 'Hair types explained',
    blurb: 'Read short descriptions of straight, wavy, curly and coily hair.',
    allow: [],
    blocks: [
      intro([
        ['A hair type is a description of how the strands curve, from straight to tightly coiled.', 'Tell your barber your hair type when you ask for a cut.'],
        ['The curl type is one thing that shapes how a cut behaves.', 'Ask your barber about thickness and texture as well.'],
        ['If you are unsure of your hair type, ask your barber.', 'Share how your hair behaves after it dries.'],
      ]),
      points('Types and traits', [
        ['A straight hair type is one that falls without a curl or a wave.', 'A wavy hair type is one with a loose, flowing curve.', 'A curly hair type is one with defined spirals or ringlets.', 'A coily hair type is one with tight coils or small spirals.'],
        ['If your hair is curly or coily, it can appear to have less length once it dries.', 'If your hair is wavy, the shape can change as the length changes.', 'If your hair is straight, ask how the cut would fall when it dries.', 'If your hair is fine, it may lie flat, and layers can add shape.'],
        ['Tell your barber if your hair shrinks as it dries.', 'Ask whether a cut should be done wet or dry for your hair type.', 'Mention whether your hair is fine, medium or thick.', 'Ask how your hair type affects the choice of style.'],
      ]),
      tip([
        ['Remember that hair type can differ between the front and the back of the head.', 'Point this out if you notice it.'],
        ['Ask your barber how to work with your hair type, not against it.', 'Write the answer down.'],
        ['Share any past cuts that worked or did not work for your hair.', 'Bring photos of them if you have any.'],
      ]),
    ],
  },

  'hair-care-basics': {
    title: 'Hair care basics',
    blurb: 'Read general ideas for looking after your hair between visits.',
    allow: [],
    blocks: [
      intro([
        ['A hair care routine is a set of habits for washing, drying and styling.', 'Ask your barber what suits your hair type.'],
        ['Start with a few simple habits and adjust them to your hair.', 'Ask your barber which habits fit your hair type and style.'],
        ['Remember that each head of hair is different.', 'Use the points below as general ideas, not strict rules.'],
      ]),
      points('Simple habits', [
        ['Wash the hair in a way that suits your hair type.', 'Rinse well so that no lather is left behind in the hair.', 'Dry the hair by patting it with a towel instead of rubbing.', 'Use a comb or brush that suits your hair type.'],
        ['Ask your barber about a washing routine for your hair.', 'Keep heat tools on a low setting when you use them.', 'Brush or comb the hair before you wash it if it tangles.', 'Use only a small amount of whatever you style with, and add more if needed.'],
        ['If your hair looks dry, ask your barber for ideas.', 'If you use heat tools, keep them moving.', 'When you style, start with a small amount and build up.', 'After swimming or sweating, rinse the hair.'],
      ]),
      tip([
        ['Remember that a simple routine is easy to keep.', 'Try one new habit at a time.'],
        ['Ask your barber to go over your routine at your next visit.', 'Write down any changes.'],
        ['Take note of what your hair responds to.', 'Keep the habits that suit it.'],
      ]),
    ],
  },

  'beard-care-basics': {
    title: 'Beard care basics',
    blurb: 'Read general ideas for keeping a beard tidy.',
    allow: ['beard', 'beard-trim'],
    blocks: [
      intro([
        ['A beard routine is a set of habits for washing, combing and trimming.', 'Ask your barber what suits the shape of your beard.'],
        ['Start with a simple routine of washing, combing and trimming.', 'Ask your barber where the outline should sit.'],
        ['If you keep a beard, a few habits help it look tidy.', 'Read the points below for ideas.'],
      ]),
      points('Simple habits', [
        ['Wash the beard when you wash your hair.', 'Comb or brush the beard to keep the hairs lying in one direction.', 'Keep stray hairs in check with a small trim.', 'Ask your barber where to set the neckline and the cheek line.'],
        ['Decide what length you want the beard to be.', 'Keep the outline tidy between your visits.', 'Use a comb to check the length on each side.', 'Ask your barber about the shape of the cheek line and the neckline.'],
        ['If the beard looks uneven, ask for a trim to even it up.', 'If you want a change, bring a photo of the beard you like.', 'If the hair around the mouth gets in the way, ask your barber about trimming it.', 'When you comb the beard, start from the chin.'],
      ]),
      tip([
        ['Remember that beards differ in density and shape, so a style that suits one may not suit another.', 'Ask your barber for an opinion.'],
        ['Ask your barber how to keep the shape between visits.', 'Write the answer down.'],
        ['Take photos of a beard shape you like and show them at your next visit.', 'Mention any part of the beard you want left alone.'],
      ]),
    ],
  },

  'shave-guide': {
    title: 'Shave guide',
    blurb: 'Read what the words around a shave mean.',
    when: 'shave',
    allow: ['shave', 'beard'],
    blocks: [
      intro([
        ['A wet shave is a shave done with water and lather.', 'Ask your barber to explain the steps before you start.'],
        ['A hot towel shave is one that begins with a warm towel on the face.', 'Tell your barber if you would like to skip that step.'],
        ['This guide covers common shave terms and questions.', 'Use it to prepare for the visit.'],
      ]),
      points('Terms and questions', [
        ['A head shave is a shave of the hair on the head.', 'A face shave is a shave of the hair on the face.', 'A hot towel shave is one that begins with a warm towel on the face.', 'Ask what shaving tools are used and how they are prepared.'],
        ['Tell your barber if you have shaved recently.', 'Ask your barber what length the hair should be before a shave.', 'Say whether you want the full face or only part of it.', 'Ask about the steps and the order they follow.'],
        ['If you wear a beard, say which parts to shave and which to keep.', 'If you want a particular shape, bring a photo.', 'If you have a question, ask it before the shave starts.', 'Before the shave, tell your barber about any step you want to avoid.'],
      ]),
      tip([
        ['Remember that a shave is a personal choice.', 'Speak up if a step is unclear.'],
        ['Ask your barber what to do after the shave.', 'Write the answer down.'],
        ['Take your time describing the finish you want.', 'Say so before the shave starts.'],
      ]),
    ],
  },

  'barber-words': {
    title: 'Barbershop words explained',
    blurb: 'Read short definitions of the words that barbers use.',
    allow: ['fade', 'taper', 'line-up'],
    blocks: [
      intro([
        ['A short word list is a simple way to learn common terms.', 'Use it to follow the conversation at the chair.'],
        ['Learn the shorthand below to describe what you want.', 'Ask for an explanation of any other term you hear.'],
        ['If a term is unfamiliar, ask about it.', 'This list covers some common ones.'],
      ]),
      points('Terms to know', [
        ['A fade is a cut where the hair shortens in steps until it is cropped short.', 'A taper is a cut where the hair shortens gradually by the neckline and the ears.', 'Ask for a line-up if you want the hairline, the temples and the neckline tidied.', 'A blend is a spot where short and long hair meet without a hard line.', 'A guard is an attachment that sets the length left behind by the tool.'],
        ['The neckline is the edge of the hair at the back of the neck.', 'The hairline is the edge of the hair along the forehead and temples.', 'A cowlick is a patch of hair that sits in a different direction from the rest.', 'A part is the line where the hair is divided to fall to either side.'],
        ['A textured cut is one with layers that add movement.', 'A cropped cut is one kept short around the whole head.', 'A trim is a small cut that keeps the current shape.', 'Ask whether a shape-up and a line-up mean the same thing.'],
      ]),
      tip([
        ['Remember that terms can differ from one barber to the next.', 'Use a photo to clear up any confusion.'],
        ['Ask your barber to explain a term in plain words.', 'Write it down for next time.'],
        ['Write down terms you like and use them at your next visit.', 'Keep the list in a handy place for your next visit.'],
      ]),
    ],
  },

  'choosing-a-length': {
    title: 'Choosing a length',
    blurb: 'Read ideas for deciding between short, medium and long.',
    allow: [],
    blocks: [
      intro([
        ['A hair length is a choice about both style and upkeep.', 'Think about the sides, the back and the upper hair separately.'],
        ['The right length is a balance of style and upkeep.', 'Ask your barber to show how different lengths would sit.'],
        ['If you are undecided, start with a small change.', 'Take a photo before and after so you can see the difference.'],
      ]),
      points('Ways to decide', [
        ['If you want less styling effort, a short style may suit you.', 'If you like options, a medium length gives room to change the style.', 'If you want to tie the hair back, ask what length makes that possible.', 'If your hair is curly, remember that it appears to lose length when it dries.'],
        ['Ask for the length in simple words, such as short, medium or long.', 'Show the length you want with your fingers or a photo.', 'Say whether the sides and back should match the upper hair.', 'Mention how much of a change you want in one visit.'],
        ['These length words are relative terms.', 'Show the length you mean with a photo or your fingers.', 'Ask your barber to confirm what short, medium or long means for your hair.', 'Tell your barber if the length looks different from what you pictured.'],
      ]),
      tip([
        ['You can start with a small cut and ask for more later.', 'Take your time deciding.'],
        ['Remember that hair can be cut off but not put back.', 'Ask your barber to go step by step.'],
        ['Take your time deciding.', 'Ask for a photo of similar lengths if you have trouble picturing them.'],
      ]),
    ],
  },

  'styling-basics': {
    title: 'Styling basics',
    blurb: 'Read general ideas for styling hair at home.',
    allow: [],
    blocks: [
      intro([
        ['A styling routine is a few steps you repeat to shape your hair.', 'Ask your barber to show you the steps for your cut.'],
        ['Start with a simple routine you can repeat.', 'Ask your barber how to style the cut you chose.'],
        ['If you want to style your hair at home, plan a few simple steps.', 'Use the points below as a guide.'],
      ]),
      points('Simple steps', [
        ['Start with towel dried hair unless your barber suggests otherwise.', 'Use only a small amount of whatever you style with at first.', 'Use your fingers or a comb to work it through.', 'Use your comb to set the hair in the direction you want.'],
        ['Comb the hair in the direction of the part.', 'Use more only if you need it.', 'Keep any heat tool on a low setting.', 'Ask your barber to demonstrate the steps.'],
        ['If the hair sits flat, try a little more volume at the roots.', 'If the style falls out of shape, check how much you used.', 'When you finish, check the shape in a mirror from the side.', 'Once you find a routine you like, write it down.'],
      ]),
      tip([
        ['Remember that a style may take a few tries.', 'Keep practicing until the steps are familiar.'],
        ['Ask your barber for a demonstration at your next visit.', 'Bring the tools you plan to use.'],
        ['Take a photo when the style sits the way you want.', 'Show it at your next visit.'],
      ]),
    ],
  },

  'between-visits': {
    title: 'Between visits',
    blurb: 'Read ideas for keeping a cut tidy between visits.',
    allow: [],
    blocks: [
      intro([
        ['The time between visits is when a cut changes shape.', 'Ask your barber what to expect.'],
        ['Think about how your cut changes shape as the hair lengthens.', 'Plan a few simple habits to keep it tidy.'],
        ['If you want to keep a cut tidy, small habits help.', 'Read the ideas below.'],
      ]),
      points('Small habits', [
        ['Comb or brush the hair into shape when you style it.', 'Check the neckline in a mirror from time to time.', 'Ask your barber which parts of the cut need a touch up first.', 'Avoid cutting the hair yourself unless you were shown how.'],
        ['Use a comb to keep the part in place.', 'Use a mirror to check the back with another mirror.', 'Take off hats and helmets when you can, to let the hair settle.', 'Ask about a short touch up between full cuts.'],
        ['If the edges look uneven, arrange a touch up.', 'If the hair sits differently, adjust how you style it.', 'When you notice stray hairs, ask your barber about them.', 'Before you try a new routine, ask your barber.'],
      ]),
      tip([
        ['Remember that small habits can add up over time.', 'Keep the routine simple.'],
        ['Ask your barber for advice that suits your cut.', 'Write it down.'],
        ['Take note of what you do between visits.', 'Share it at your next visit.'],
      ]),
    ],
  },

  'new-barber': {
    title: 'Trying a new barber',
    blurb: 'Read ideas for a first visit with a new barber.',
    allow: [],
    blocks: [
      intro([
        ['A first visit is a chance to set expectations with a new barber.', 'Share what you want and what you have disliked in the past.'],
        ['Think about what you liked and disliked about your previous cuts.', 'Bring that list with you.'],
        ['If you are changing barbers, a short conversation at the start helps.', 'Read the points below before you go.'],
      ]),
      points('Before you sit down', [
        ['Bring a photo of a cut you liked.', 'Describe the cut you had before.', 'Say what you would like to keep and what you would change.', 'Ask questions about the plan before the cutting starts.'],
        ['Mention how you style your hair at home.', 'Tell your barber about habits that affect the cut.', 'Confirm the plan in your own words.', 'Ask for a small change first if you are unsure.'],
        ['If the first cut is almost right but not exact, say so politely.', 'If something is unclear, ask for an explanation.', 'When you get home, note what worked for you.', 'Before your next visit, think about what you would adjust.'],
      ]),
      tip([
        ['Remember that it can take a few visits to settle on a plan.', 'Give feedback that is kind and clear.'],
        ['Share what you liked and what you would change.', 'Keep notes for your next visit.'],
        ['Write down what worked and what did not.', 'Bring the notes to your next visit.'],
      ]),
    ],
  },
};

/** The hub page (/guides/). */
export const GUIDE_HUB = {
  title: 'Hair and grooming guides',
  /** Link label for the footer. */
  footerLabel: 'Guides',
  /** Link label at the end of the line on the Services page. */
  servicesLinkLabel: 'Hair and grooming guides',
  intro: [
    ['These guides are short reads on choosing a style, asking for a cut and looking after hair.', 'Pick a topic below to start reading.'],
    ['This page is a collection of short guides on hair and grooming.', 'Read the ones that fit what you are planning.'],
    ['If you are planning a visit, these guides can help you prepare.', 'Read in any order, because each guide stands on its own.'],
  ] as Wordings,
  /** The one line on the Services page; the link follows it. */
  servicesLine: [
    ['These guides focus on choosing a style, asking for a cut and looking after hair.'],
    ['Read the guides for ideas on choosing a style and asking for a cut.'],
    ['If you are planning a visit, the guides cover how to prepare.'],
  ] as Wordings,
  introMax: 600,
  servicesLineMax: 300,
};

/** Fixed small words the guide pages print (not editable, no claims). */
export const GUIDE_UI = {
  back: 'Back to guides',
  more: 'More guides',
  onThisSite: 'On this site',
} as const;
