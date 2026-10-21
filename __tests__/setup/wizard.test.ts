import { STEPS, back, currentStep, initialWizard, next, progressLabel, setSwitch, skip } from '@/lib/setup/wizard';

describe('wizard state', () => {
  it('starts on services; the Book-button switch needs opting in when another link exists', () => {
    expect(currentStep(initialWizard(false))).toBe('services');
    expect(initialWizard(false).switchBookButton).toBe(true);
    expect(initialWizard(true).switchBookButton).toBe(false);
    expect(setSwitch(initialWizard(true), true).switchBookButton).toBe(true);
  });
  it('walks the five steps and finishes after the last', () => {
    let s = initialWizard(false);
    const seen = [currentStep(s)];
    while (!s.done) {
      s = next(s);
      if (!s.done) seen.push(currentStep(s));
    }
    expect(seen).toEqual([...STEPS]);
    expect(s.skipped).toEqual([]);
  });
  it('remembers skipped steps and clears them when later completed', () => {
    let s = skip(initialWizard(false));
    expect(s.skipped).toEqual(['services']);
    s = back(s);
    expect(currentStep(s)).toBe('services');
    s = next(s);
    expect(s.skipped).toEqual([]);
  });
  it('can be skipped to the end', () => {
    let s = initialWizard(false);
    for (let i = 0; i < STEPS.length; i++) s = skip(s);
    expect(s.done).toBe(true);
    expect(s.skipped).toEqual([...STEPS]);
  });
  it('does not go back before the first step', () => {
    expect(back(initialWizard(false)).index).toBe(0);
    expect(progressLabel(initialWizard(false))).toBe('Step 1 of 5');
  });
});
