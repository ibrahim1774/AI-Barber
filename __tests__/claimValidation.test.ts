import {
  CONFIRM_DIFFERENT, CONFIRM_REQUIRED, EMAIL_INVALID, EMAIL_REQUIRED, NAME_REQUIRED, PASSWORD_LONG, PASSWORD_REQUIRED, PASSWORD_SHORT,
  PHONE_INVALID, cleanPhone, firstErrorField, normalizePhone, validateClaim, type ClaimValues,
} from '@/lib/claimValidation';

const good: ClaimValues = { name: 'Jo Barber', email: 'jo@example.com', phone: '(512) 555-0142', password: 'hunter22!', confirm: 'hunter22!' };
const bad = (over: Partial<ClaimValues>) => validateClaim('signup', { ...good, ...over });

describe('sign up needs all four fields, the password twice', () => {
  test('a complete form has no errors', () => {
    expect(validateClaim('signup', good)).toEqual({});
  });
  test('an empty form flags every required field at once, in on-screen order', () => {
    const e = validateClaim('signup', { name: '', email: '', phone: '', password: '', confirm: '' });
    expect(e).toEqual({ name: NAME_REQUIRED, email: EMAIL_REQUIRED, phone: PHONE_INVALID, password: PASSWORD_REQUIRED });
    expect(firstErrorField(e)).toBe('name');
  });
  test.each([
    ['blank name', { name: '   ' }, 'name', NAME_REQUIRED],
    ['no email', { email: '  ' }, 'email', EMAIL_REQUIRED],
    ['email without a domain', { email: 'jo@example' }, 'email', EMAIL_INVALID],
    ['email with a space', { email: 'jo @example.com' }, 'email', EMAIL_INVALID],
    ['phone too short (6 digits)', { phone: '555-012' }, 'phone', PHONE_INVALID],
    ['phone with letters', { phone: '555-CALL-NOW' }, 'phone', PHONE_INVALID],
    ['phone 16 digits', { phone: '1234567890123456' }, 'phone', PHONE_INVALID],
    ['password of 7', { password: '1234567', confirm: '1234567' }, 'password', PASSWORD_SHORT],
    ['password of 73', { password: 'x'.repeat(73), confirm: 'x'.repeat(73) }, 'password', PASSWORD_LONG],
    ['no confirmation', { confirm: '' }, 'confirm', CONFIRM_REQUIRED],
    ['different confirmation', { confirm: 'hunter22?' }, 'confirm', CONFIRM_DIFFERENT],
  ] as const)('%s', (_n, over, field, message) => {
    expect(bad(over)[field]).toBe(message);
  });
  test('boundaries: 7 digits, 8 and 72 characters are fine', () => {
    expect(bad({ phone: '5550142' })).toEqual({});
    expect(bad({ password: '12345678', confirm: '12345678' })).toEqual({});
    expect(bad({ password: 'x'.repeat(72), confirm: 'x'.repeat(72) })).toEqual({});
  });
  test('a bad password does not also complain about the confirmation', () => {
    expect(bad({ password: 'short', confirm: 'other' })).toEqual({ password: PASSWORD_SHORT });
  });
});

describe('sign in needs only email and password', () => {
  test('name, phone and confirmation are never asked', () => {
    expect(validateClaim('signin', { name: '', email: 'jo@example.com', phone: '', password: 'x', confirm: '' })).toEqual({});
  });
  test('missing email or password is flagged', () => {
    expect(validateClaim('signin', { ...good, email: '', password: '' })).toEqual({ email: EMAIL_REQUIRED, password: PASSWORD_REQUIRED });
  });
});

describe('phone normalisation mirrors the server and sends E.164', () => {
  test.each([
    ['(512) 555-0142', '+15125550142'],
    ['512.555.0142', '+15125550142'],
    ['1 512 555 0142', '+15125550142'],
    ['+44 7700 900123', '+447700900123'],
    ['+1 (512) 555-0142', '+15125550142'],
    ['442079460958', '+442079460958'],
    ['5550142', '5550142'],
  ])('%s -> %s', (raw, out) => {
    expect(normalizePhone(raw)).toBe(out);
  });
  test.each(['', '12345', 'abc', '+0123456789', '12+3456789', '5'.repeat(41)])('%s is not a phone', (raw) => {
    expect(cleanPhone(raw)).toBeNull();
    expect(normalizePhone(raw)).toBeNull();
  });
});
