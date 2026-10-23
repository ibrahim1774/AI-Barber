import { validateSignUp } from '@/lib/signUpValidation';

describe('validateSignUp (fields flagged in on-screen order)', () => {
  it('all empty: phone first, with a specific message', () => {
    expect(validateSignUp({ phone: '', email: '', password: '' })).toEqual({ field: 'phone', message: 'Enter your phone number.' });
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
