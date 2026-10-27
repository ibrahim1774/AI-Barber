import { logoContrast, contrastNote, HEADER_RGB } from '@/lib/logoContrast';

const solid = (n: number, rgba: [number, number, number, number]) => {
  const a = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) a.set(rgba, i * 4);
  return a;
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const H = HEADER_RGB;

describe('logoContrast', () => {
  it('all-black opaque is low', () => {
    const r = logoContrast(solid(100, [0, 0, 0, 255]), H);
    expect(r.verdict).toBe('low');
    expect(r.lowShare).toBe(1);
  });
  it('black on transparent is low (transparent pixels are ignored)', () => {
    expect(logoContrast(concat(solid(20, [0, 0, 0, 255]), solid(80, [0, 0, 0, 0])), H).verdict).toBe('low');
  });
  it('all-white is ok', () => {
    const r = logoContrast(solid(100, [255, 255, 255, 255]), H);
    expect(r).toEqual({ verdict: 'ok', lowShare: 0 });
  });
  it('50/50 black and white is partly-low', () => {
    const r = logoContrast(concat(solid(50, [0, 0, 0, 255]), solid(50, [255, 255, 255, 255])), H);
    expect(r.verdict).toBe('partly-low');
    expect(r.lowShare).toBe(0.5);
  });
  it('thresholds: 85% low, 40% partly, just under each', () => {
    const mix = (low: number) => logoContrast(concat(solid(low, [0, 0, 0, 255]), solid(100 - low, [255, 255, 255, 255])), H).verdict;
    expect(mix(85)).toBe('low');
    expect(mix(84)).toBe('partly-low');
    expect(mix(40)).toBe('partly-low');
    expect(mix(39)).toBe('ok');
  });
  it('mid-grey #808080 is ok, #2a2a2a is low', () => {
    expect(logoContrast(solid(50, [128, 128, 128, 255]), H).verdict).toBe('ok');
    expect(logoContrast(solid(50, [0x2a, 0x2a, 0x2a, 255]), H).verdict).toBe('low');
  });
  it('an opaque white plate with black text is ok', () => {
    expect(logoContrast(concat(solid(80, [255, 255, 255, 255]), solid(20, [0, 0, 0, 255])), H).verdict).toBe('ok');
  });
  it('fully transparent is unknown, and says nothing', () => {
    const r = logoContrast(solid(100, [0, 0, 0, 0]), H);
    expect(r.verdict).toBe('unknown');
    expect(contrastNote(r.verdict)).toBeNull();
  });
  it('a semi-transparent halo (alpha 127) is ignored', () => {
    expect(logoContrast(concat(solid(90, [0, 0, 0, 127]), solid(10, [255, 255, 255, 255])), H).verdict).toBe('ok');
  });
  it('near-empty (under 2% opaque) is unknown', () => {
    expect(logoContrast(concat(solid(1, [0, 0, 0, 255]), solid(99, [0, 0, 0, 0])), H).verdict).toBe('unknown');
  });
  it('tiny and odd sizes: 1 pixel, 3 pixels, empty, trailing partial pixel', () => {
    expect(logoContrast(solid(1, [0, 0, 0, 255]), H).verdict).toBe('low');
    expect(logoContrast(concat(solid(2, [255, 255, 255, 255]), solid(1, [0, 0, 0, 255])), H).lowShare).toBeCloseTo(1 / 3);
    expect(logoContrast(new Uint8Array(0), H).verdict).toBe('unknown');
    expect(logoContrast(concat(solid(10, [255, 255, 255, 255]), new Uint8Array(3)), H).verdict).toBe('ok');
  });
  it('the header is dark in every design', () => {
    expect(Math.max(...H)).toBeLessThanOrEqual(40);
  });
});

describe('contrastNote', () => {
  it('maps verdicts to calm copy', () => {
    expect(contrastNote('low')).toBe('This logo may be hard to see on the header');
    expect(contrastNote('partly-low')).toBe('Parts of this logo may be hard to see');
    expect(contrastNote('ok')).toBeNull();
    expect(contrastNote(null)).toBeNull();
    expect(contrastNote(undefined)).toBeNull();
  });
});
