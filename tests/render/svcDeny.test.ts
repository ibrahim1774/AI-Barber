// The default-deny layer for model-written service text (review 6, B1): corpora, mutation proof per rule group.
import { describe, expect, it } from 'vitest';
import { DENY_GROUP_IDS, denyProblems, type DenyKind } from '../../lib/render/svcDeny';
import { aiSentenceProblems } from '../../lib/render/svcCopy';
import { BENIGN, CLAIM_WORDS, HOSTILE, obfuscatedHostile, obfuscations } from '../serviceCopy/corpus';

const kindOf = (k?: DenyKind): DenyKind => k ?? 'sentence';

describe('corpus sizes', () => {
  it('at least 150 hostile sentences and at least 60 benign ones', () => {
    expect(HOSTILE.length + obfuscatedHostile().length).toBeGreaterThanOrEqual(150);
    expect(HOSTILE.length).toBeGreaterThanOrEqual(150);
    expect(BENIGN.length).toBeGreaterThanOrEqual(60);
    expect(obfuscatedHostile().length).toBe(CLAIM_WORDS.length * Object.keys(obfuscations).length);
  });
});

describe('hostile corpus: every sentence is dropped', () => {
  for (const h of HOSTILE) {
    it(`deny layer alone: ${JSON.stringify(h.text).slice(0, 80)}`, () => expect(denyProblems(h.text, kindOf(h.kind)), h.text).not.toEqual([]));
    it(`whole lint: ${JSON.stringify(h.text).slice(0, 80)}`, () => expect(aiSentenceProblems(h.text, [], kindOf(h.kind)), h.text).not.toEqual([]));
  }
  for (const t of obfuscatedHostile()) it(`obfuscated claim word: ${JSON.stringify(t)}`, () => {
    expect(denyProblems(t), t).not.toEqual([]);
    expect(aiSentenceProblems(t, []), t).not.toEqual([]);
  });
});

describe('benign corpus: plain descriptive sentences survive', () => {
  for (const [kind, text] of BENIGN) {
    it(`${kind}: ${text}`, () => {
      expect(denyProblems(text, kind), text).toEqual([]);
      expect(aiSentenceProblems(text, [], kind), text).toEqual([]);
    });
  }
});

describe('mutation proof: every rule group matters', () => {
  for (const g of DENY_GROUP_IDS) {
    const tagged = HOSTILE.filter((h) => h.group === g);
    it(`${g}: has probes, each is caught only by this group`, () => {
      expect(tagged.length, g).toBeGreaterThanOrEqual(1);
      for (const h of tagged) {
        expect(denyProblems(h.text, kindOf(h.kind)), h.text).not.toEqual([]);
        expect(denyProblems(h.text, kindOf(h.kind), { skip: [g] }), `without ${g}: ${h.text}`).toEqual([]); // switch the group off: the hostile sentence gets through
      }
    });
  }
  it('every hostile sentence is caught by at least one group other than the charset gate (defence in depth for homoglyphs and zero-width text)', () => {
    const noCharset = HOSTILE.filter((h) => !/[^\x00-\x7f]/.test(h.text));
    for (const h of noCharset) expect(denyProblems(h.text, kindOf(h.kind), { skip: ['charset'] }), h.text).not.toEqual([]);
  });
});

describe('specifics', () => {
  it('digits and number words', () => { for (const t of ['Bring 3 photos.', 'Bring three photos.', 'Bring a dozen photos.', 'Bring photos of the 90s style.']) expect(denyProblems(t), t).not.toEqual([]); });
  it('a sentence needs an approved shape', () => {
    expect(denyProblems('Hair length matters when choosing a style.').join()).toContain('D:shape');
    expect(denyProblems('Tell your barber what you want.')).toEqual([]);
    expect(denyProblems('What should you bring?', 'question')).toEqual([]);
    expect(denyProblems('Tell your barber what you want.', 'question').join()).toContain('question mark');
    // review 6b NIT 2: a question is judged by its shape too (an advice verb is not a question opener)
    expect(denyProblems('Tell me about {service}?', 'question').join()).toContain('D:shape');
    expect(denyProblems('Hair length matters?', 'question').join()).toContain('D:shape');
  });
  it('headings may not end with a full stop and sentences must', () => {
    expect(denyProblems('How to prepare.', 'heading').join()).toContain('final stop');
    expect(denyProblems('Tell your barber what you want', 'sentence').join()).toContain('full stop');
  });
  it('the {service} token is neutral', () => { expect(denyProblems('Ask about {service} before the visit.')).toEqual([]); });
});
