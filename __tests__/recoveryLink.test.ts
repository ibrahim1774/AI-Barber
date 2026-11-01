import { LINK_EXPIRED_MESSAGE, parseRecoveryUrl } from '@/lib/recoveryLink';
import { newPasswordProblem, PASSWORD_TOO_SHORT, PASSWORDS_DIFFER } from '@/lib/auth';

describe('parseRecoveryUrl', () => {
  it('fragment tokens (implicit flow)', () => {
    expect(parseRecoveryUrl('#access_token=AAA&refresh_token=RRR&expires_in=3600&token_type=bearer&type=recovery', '')).toEqual({ kind: 'tokens', accessToken: 'AAA', refreshToken: 'RRR' });
  });
  it('a fragment of another type is not a recovery', () => {
    expect(parseRecoveryUrl('#access_token=AAA&refresh_token=RRR&type=signup', '')).toEqual({ kind: 'none' });
  });
  it('PKCE-style ?code=', () => expect(parseRecoveryUrl('', '?code=abc123')).toEqual({ kind: 'code', code: 'abc123' }));
  it('expired / used link error in the fragment', () => {
    expect(parseRecoveryUrl('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', '')).toEqual({ kind: 'error', code: 'otp_expired' });
  });
  it('error in the query string', () => expect(parseRecoveryUrl('', '?error=access_denied')).toEqual({ kind: 'error', code: 'access_denied' }));
  it('nothing useful', () => {
    expect(parseRecoveryUrl('', '')).toEqual({ kind: 'none' });
    expect(parseRecoveryUrl('#foo=bar', '?x=1')).toEqual({ kind: 'none' });
  });
  it('an error wins over tokens', () => expect(parseRecoveryUrl('#error=access_denied&access_token=A&refresh_token=R', '').kind).toBe('error'));
  it('the expired copy asks for a new code', () => expect(LINK_EXPIRED_MESSAGE).toBe('This link has expired or was already used. Request a new code.'));
});

describe('new password validation (min 8, must match)', () => {
  it('too short', () => expect(newPasswordProblem('short', 'short')).toBe(PASSWORD_TOO_SHORT));
  it('mismatch', () => expect(newPasswordProblem('longenough1', 'longenough2')).toBe(PASSWORDS_DIFFER));
  it('ok', () => expect(newPasswordProblem('longenough1', 'longenough1')).toBeNull());
});

describe('reset email return address', () => {
  it('phone calls resetPasswordForEmail with no options; the browser passes redirectTo', async () => {
    const calls: unknown[][] = [];
    jest.resetModules();
    jest.doMock('@/lib/supabase', () => ({ supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: null } }), resetPasswordForEmail: (...a: unknown[]) => { calls.push(a); return Promise.resolve({ error: null }); } } } }));
    const { requestPasswordReset } = require('@/lib/auth');
    await requestPasswordReset('a@b.co');
    await requestPasswordReset('a@b.co', 'https://x.test/app/reset-password');
    expect(calls[0]).toEqual(['a@b.co']);
    expect(calls[1]).toEqual(['a@b.co', { redirectTo: 'https://x.test/app/reset-password' }]);
  });
  it('the forgot-password screen only passes it on web', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src/app/forgot-password.tsx'), 'utf8');
    expect(src).toContain("Platform.OS === 'web' ? `${window.location.origin}/app/reset-password` : undefined");
  });
});
