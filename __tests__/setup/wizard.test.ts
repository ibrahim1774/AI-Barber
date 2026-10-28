import { STEPS, back, currentStep, initialWizard, next, progressLabel, setSwitch } from '@/lib/setup/wizard';

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
  });
  it('has no way to skip a step: only Continue moves forward, Back returns', () => {
    expect(require('@/lib/setup/wizard').skip).toBeUndefined();
    let s = next(initialWizard(false));
    expect(currentStep(s)).toBe('hours');
    s = back(s);
    expect(currentStep(s)).toBe('services');
  });
  it('does not go back before the first step', () => {
    expect(back(initialWizard(false)).index).toBe(0);
    expect(progressLabel(initialWizard(false))).toBe('Step 1 of 5');
  });
});
