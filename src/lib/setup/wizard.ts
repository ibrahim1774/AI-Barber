export const STEPS = ['services', 'hours', 'team', 'pay', 'share'] as const;
export type StepKey = (typeof STEPS)[number];

export const STEP_TITLES: Record<StepKey, string> = {
  services: 'Your services',
  hours: 'Your hours',
  team: 'Who takes bookings?',
  pay: 'How do you want to get paid?',
  share: 'Share your booking link',
};

export type WizardState = {
  index: number;
  done: boolean;
  /** Steps the barber skipped (so Setup can point them back). */
  skipped: StepKey[];
  /** Step 1's "Switch your Book button to AI Barber bookings". Only true when the barber chose it. */
  switchBookButton: boolean;
};

export function initialWizard(hasExistingBookingLink: boolean): WizardState {
  // Without another booking link there is nothing to double-book against, so it starts on; with one, the barber must opt in.
  return { index: 0, done: false, skipped: [], switchBookButton: !hasExistingBookingLink };
}

export const currentStep = (s: WizardState): StepKey => STEPS[Math.min(s.index, STEPS.length - 1)];

/** Continue: completes the step and moves on; after the last one the wizard is done. */
export function next(s: WizardState): WizardState {
  const skipped = s.skipped.filter((k) => k !== currentStep(s));
  return s.index >= STEPS.length - 1 ? { ...s, skipped, done: true } : { ...s, skipped, index: s.index + 1 };
}

/** Skip: same as Continue, but remembered. */
export function skip(s: WizardState): WizardState {
  const step = currentStep(s);
  const n = next(s);
  return { ...n, skipped: s.skipped.includes(step) ? n.skipped : [...n.skipped, step] };
}

export function back(s: WizardState): WizardState {
  return s.index === 0 ? s : { ...s, index: s.index - 1 };
}

export function setSwitch(s: WizardState, on: boolean): WizardState {
  return { ...s, switchBookButton: on };
}

export const progressLabel = (s: WizardState) => `Step ${Math.min(s.index, STEPS.length - 1) + 1} of ${STEPS.length}`;
