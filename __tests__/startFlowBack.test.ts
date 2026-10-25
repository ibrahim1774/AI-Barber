import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', 'src');
const read = (f: string) => fs.readFileSync(path.join(SRC, f), 'utf8');
const SCREENS = ['booking-link', 'find-listing', 'manual', 'import-review', 'sign-in', 'sign-up', 'forgot-password'];

it('every start-flow screen after Start passes onBack to its shell', () => {
  for (const s of SCREENS) {
    const src = read(path.join('app', `${s}.tsx`));
    expect({ screen: s, back: /<(Screen|Page)[^>]*\sonBack=/.test(src) }).toEqual({ screen: s, back: true });
  }
});

it('the shells render the Back control top-left with the "Back" accessibility label', () => {
  expect(read('components/Screen.tsx')).toMatch(/accessibilityLabel="Back"/);
  expect(read('components/Page.tsx')).toMatch(/accessibilityLabel=\{backLabel\}/);
});

it('no start-flow screen says "AI Barber"', () => {
  for (const s of SCREENS) expect(read(path.join('app', `${s}.tsx`))).not.toMatch(/AI ?Barber/);
});
