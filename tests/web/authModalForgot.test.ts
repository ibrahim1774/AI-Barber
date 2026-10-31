import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The home page's Sign in button opens AuthModal in sign-in-only mode. A forgotten password
// must still have a way out there, and the existing sign-in/sign-up toggle must stay hidden.
const src = fs.readFileSync(path.join(__dirname, '../../components/AuthModal.tsx'), 'utf8');

describe('AuthModal forgot password', () => {
  it('renders one shared forgot control with the reset handler', () => {
    expect(src).toMatch(/const forgotControl = resetSent[\s\S]*onClick=\{handleForgotPassword\}[\s\S]*Forgot password\?/);
  });
  it('shows it in sign-in-only mode on the sign-in tab', () => {
    expect(src).toMatch(/\{signInOnly && mode === 'signin' && \(\s*<p[^>]*>\{forgotControl\}<\/p>\s*\)\}/);
  });
  it('keeps the sign-up toggle hidden in sign-in-only mode and the control in the normal toggle', () => {
    expect(src).toMatch(/\{!signInOnly && \(/);
    expect(src).toMatch(/<span className="block mt-2">\{forgotControl\}<\/span>/);
  });
  it('still sends the recovery email back to this origin', () => {
    expect(src).toMatch(/resetPasswordForEmail\(email\.trim\(\), \{\s*redirectTo: window\.location\.origin,/);
  });
});
