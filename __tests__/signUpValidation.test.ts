import { validateSignUp } from '@/lib/signUpValidation';

describe('validateSignUp (fields flagged in on-screen order)', () => {
  it('all empty: the email is flagged first (the phone number is optional)', () => {
    expect(validateSignUp({ phone: '', email: '', password: '' })).toEqual({ field: 'email', message: 'Enter your email address.' });
  });
  it('an empty phone is never an error', () => {
    expect(validateSignUp({ phone: '', email: 'a@b.co', password: '123456' })).toBeNull();
    expect(validateSignUp({ phone: '   ', email: 'a@b.co', password: '123456' })).toBeNull();
    expect(validateSignUp({ email: 'a@b.co', password: '123456' })).toBeNull();
  });
  it('the sign-up screen labels the phone field optional', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../src/app/sign-up.tsx'), 'utf8');
    expect(src).toContain('label="Phone Number (optional)"');
  });
  it('phone ok, email empty', () => {
    expect(validateSignUp({ phone: '555', email: ' ', password: '' })).toEqual({ field: 'email', message: 'Enter your email address.' });
  });
  it('a bad email is flagged before the password', () => {
    expect(validateSignUp({ phone: '555', email: 'not-an-email', password: '' })).toEqual({
      field: 'email', message: 'That email address doesn’t look right. Check it and try again.',
    });
  });
  it('short password last', () => {
    expect(validateSignUp({ phone: '555', email: 'a@b.co', password: '123' })).toEqual({
      field: 'password', message: 'Password must be at least 6 characters',
    });
  });
  it('valid is null', () => {
    expect(validateSignUp({ phone: '555', email: 'a@b.co', password: '123456' })).toBeNull();
  });
});
