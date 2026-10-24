// Forgot password: the reset email's error mapping, the emailed code
// (verifyOtp → updateUser), the Resend cooldown, the new-password checks, and
// URL scrubbing for analytics.
import * as analytics from '@/lib/analytics';
import {
  friendlyCodeError, friendlyResetError, newPasswordProblem, PASSWORD_TOO_SHORT, PASSWORDS_DIFFER, RESET_BAD_EMAIL,
  RESET_CODE_INCOMPLETE, RESET_FALLBACK, RESET_RATE_LIMITED, RESET_WRONG_CODE, requestPasswordReset,
  resetPasswordWithCode, setNewPassword,
} from '@/lib/auth';
import {
  cooldownLeft, isCodeComplete, sanitizeCode, scrubEventUrls, scrubUrl, setPrefillEmail, takePrefillEmail,
} from '@/lib/recovery';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sb, supabase } = require('@/lib/supabase');

const OFFLINE = "Couldn't reach Prime Barber — check your connection and try again.";

beforeEach(() => {
  jest.restoreAllMocks();
  sb.reset();
});

describe('requestPasswordReset', () => {
  it('sends without a redirect (no link into the app), trimmed, and tracks without the email', async () => {
    const trackSpy = jest.spyOn(analytics, 'track');
    await requestPasswordReset('  barber@example.com ');
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('barber@example.com');
    expect(trackSpy).toHaveBeenCalledWith('password_reset_requested');
    expect(JSON.stringify(trackSpy.mock.calls)).not.toContain('barber@example.com');
  });

  it('an invalid email is refused before sending', async () => {
    for (const bad of ['', '   ', 'barber', 'barber@', 'barber@example', 'a b@c.d']) {
      await expect(requestPasswordReset(bad)).rejects.toThrow(RESET_BAD_EMAIL);
    }
    expect(supabase.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' }, RESET_RATE_LIMITED],
    [{ status: 429, message: 'For security purposes, you can only request this after 42 seconds.' }, RESET_RATE_LIMITED],
    [{ name: 'AuthRetryableFetchError', status: 0, message: 'Network request failed' }, OFFLINE],
    [{ status: 400, code: 'email_address_invalid', message: 'Email address "x" is invalid' }, RESET_BAD_EMAIL],
    [{ status: 500, code: 'unexpected_failure', message: 'Error sending recovery email' }, RESET_FALLBACK],
  ])('a returned error %j → friendly text', async (error, text) => {
    supabase.auth.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error });
    const trackSpy = jest.spyOn(analytics, 'track');
    await expect(requestPasswordReset('barber@example.com')).rejects.toThrow(text);
    expect(trackSpy).not.toHaveBeenCalled();
  });

  it('a thrown fetch failure is the offline message', async () => {
    supabase.auth.resetPasswordForEmail.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(requestPasswordReset('barber@example.com')).rejects.toThrow(OFFLINE);
  });

  it('friendlyResetError never echoes server text', () => {
    expect(friendlyResetError({ message: 'Something odd with barber@example.com' })).toBe(RESET_FALLBACK);
    expect(RESET_RATE_LIMITED).toBe('Too many requests. Please wait a minute and try again.');
  });
});

describe('cooldownLeft', () => {
  it('counts 60 s down from the send, never below 0', () => {
    const at = 1_000_000;
    expect(cooldownLeft(null, at)).toBe(0);
    expect(cooldownLeft(at, at)).toBe(60);
    expect(cooldownLeft(at, at + 1)).toBe(60);
    expect(cooldownLeft(at, at + 1000)).toBe(59);
    expect(cooldownLeft(at, at + 59_001)).toBe(1);
    expect(cooldownLeft(at, at + 60_000)).toBe(0);
    expect(cooldownLeft(at, at + 3_600_000)).toBe(0);
    // A clock that went backwards still caps at the full cooldown.
    expect(cooldownLeft(at, at - 30_000)).toBe(60);
    expect(cooldownLeft(at, at + 5_000, 10)).toBe(5);
  });
});

describe('the emailed code', () => {
  it('sanitizeCode keeps digits only, at most 10', () => {
    expect(sanitizeCode('123 456')).toBe('123456');
    expect(sanitizeCode(' 12-34-56 ')).toBe('123456');
    expect(sanitizeCode('Your code: 987654.')).toBe('987654');
    expect(sanitizeCode('abc')).toBe('');
    expect(sanitizeCode('123456789012')).toBe('1234567890');
    expect(sanitizeCode('١٢٣')).toBe(''); // non-ASCII digits are not accepted by Supabase
  });

  it('isCodeComplete: 6 to 10 digits', () => {
    expect(isCodeComplete('12345')).toBe(false);
    expect(isCodeComplete('123456')).toBe(true);
    expect(isCodeComplete('1234567890')).toBe(true);
    expect(isCodeComplete('12345678901')).toBe(false);
    expect(isCodeComplete('12345a')).toBe(false);
  });

  it('verifyOtp, then updateUser, then sign-in side effects', async () => {
    const identify = jest.spyOn(analytics, 'identifyUser');
    const trackSpy = jest.spyOn(analytics, 'track');
    const calls: string[] = [];
    supabase.auth.verifyOtp.mockImplementationOnce(async (args: unknown) => {
      calls.push('verifyOtp');
      const session = { access_token: 'otp', user: { id: 'user-recovery' } };
      sb.setSession(session);
      expect(args).toEqual({ email: 'barber@example.com', token: '123456', type: 'recovery' });
      return { data: { session, user: session.user }, error: null };
    });
    supabase.auth.updateUser.mockImplementationOnce(async (args: unknown) => {
      calls.push('updateUser');
      expect(args).toEqual({ password: 'n3w-pass' });
      return { data: { user: { id: 'user-recovery' } }, error: null };
    });
    const onVerified = jest.fn();
    await resetPasswordWithCode(' barber@example.com ', '123 456', 'n3w-pass', 'n3w-pass', { onVerified });
    expect(calls).toEqual(['verifyOtp', 'updateUser']);
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(identify).toHaveBeenCalledWith('user-recovery');
    expect(trackSpy).toHaveBeenCalledWith('password_reset_code_entered', { ok: true });
    expect(trackSpy).toHaveBeenCalledWith('password_reset_completed');
    expect(JSON.stringify(trackSpy.mock.calls)).not.toContain('barber@example.com');
  });

  it('a wrong or expired code → the code message, and updateUser is never called', async () => {
    supabase.auth.verifyOtp.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' },
    });
    const trackSpy = jest.spyOn(analytics, 'track');
    const onVerified = jest.fn();
    await expect(resetPasswordWithCode('barber@example.com', '000000', 'n3w-pass', 'n3w-pass', { onVerified })).rejects.toThrow(
      RESET_WRONG_CODE,
    );
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
    expect(onVerified).not.toHaveBeenCalled();
    expect(trackSpy).toHaveBeenCalledWith('password_reset_code_entered', { ok: false });
    expect(RESET_WRONG_CODE).toBe('That code is wrong or has expired. Check the email or send a new code.');
  });

  it('a thrown verifyOtp (offline) never reaches updateUser', async () => {
    supabase.auth.verifyOtp.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(resetPasswordWithCode('barber@example.com', '123456', 'n3w-pass', 'n3w-pass')).rejects.toThrow(OFFLINE);
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' }, RESET_WRONG_CODE],
    [{ status: 400, message: 'Invalid OTP' }, RESET_WRONG_CODE],
    [{ status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' }, RESET_RATE_LIMITED],
    [{ name: 'AuthRetryableFetchError', status: 0, message: 'Network request failed' }, OFFLINE],
    [{ status: 500, code: 'unexpected_failure', message: 'Database error' }, RESET_FALLBACK],
  ])('friendlyCodeError %j', (err, text) => {
    expect(friendlyCodeError(err)).toBe(text);
  });

  it('checks the code and passwords before any network call', async () => {
    await expect(resetPasswordWithCode('barber@example.com', '12345', 'n3w-pass', 'n3w-pass')).rejects.toThrow(
      RESET_CODE_INCOMPLETE,
    );
    await expect(resetPasswordWithCode('barber@example.com', '123456', '12345', '12345')).rejects.toThrow(PASSWORD_TOO_SHORT);
    await expect(resetPasswordWithCode('barber@example.com', '123456', '123456', '123457')).rejects.toThrow(PASSWORDS_DIFFER);
    expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it('a verified code is a full sign-in even when the new password is rejected', async () => {
    const identify = jest.spyOn(analytics, 'identifyUser');
    supabase.auth.verifyOtp.mockImplementationOnce(async () => {
      const session = { access_token: 'otp', user: { id: 'user-half' } };
      sb.setSession(session);
      return { data: { session, user: session.user }, error: null };
    });
    supabase.auth.updateUser.mockResolvedValueOnce({
      data: { user: null },
      error: { status: 422, code: 'weak_password', message: 'Password should be at least 8 characters.' },
    });
    await expect(resetPasswordWithCode('barber@example.com', '123456', 'short1', 'short1')).rejects.toThrow(
      'Password should be at least 8 characters.',
    );
    expect(identify).toHaveBeenCalledWith('user-half');
  });

  it('a retry after a rejected password skips verifyOtp (a code works once)', async () => {
    supabase.auth.updateUser.mockResolvedValueOnce({
      data: { user: null },
      error: { status: 422, code: 'same_password', message: 'New password should be different from the old password.' },
    });
    let verified = false;
    const opts = () => ({ alreadyVerified: verified, onVerified: () => (verified = true) });
    await expect(resetPasswordWithCode('barber@example.com', '123456', 'same-old', 'same-old', opts())).rejects.toThrow(
      'New password should be different from the old password.',
    );
    expect(verified).toBe(true);
    await resetPasswordWithCode('barber@example.com', '', 'n3w-pass', 'n3w-pass', opts());
    expect(supabase.auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(supabase.auth.updateUser).toHaveBeenCalledTimes(2);
  });

  it('newPasswordProblem: 6 characters minimum, both fields equal', () => {
    expect(newPasswordProblem('12345', '12345')).toBe(PASSWORD_TOO_SHORT);
    expect(newPasswordProblem('123456', '123457')).toBe(PASSWORDS_DIFFER);
    expect(newPasswordProblem('123456', '123456')).toBeNull();
  });

  it("setNewPassword surfaces the server's reason and doesn't track completion", async () => {
    supabase.auth.updateUser.mockResolvedValueOnce({
      data: { user: null },
      error: { status: 422, code: 'weak_password', message: 'Password should be at least 8 characters.' },
    });
    const trackSpy = jest.spyOn(analytics, 'track');
    await expect(setNewPassword('short1')).rejects.toThrow('Password should be at least 8 characters.');
    expect(trackSpy).not.toHaveBeenCalledWith('password_reset_completed');
  });

  it('the sign-in email reaches /forgot-password in memory, once', () => {
    setPrefillEmail('  barber@example.com ');
    expect(takePrefillEmail()).toBe('barber@example.com');
    expect(takePrefillEmail()).toBe('');
  });
});

describe('scrubbing URLs for analytics', () => {
  it('drops query and fragment from URLs only', () => {
    expect(scrubUrl('aibarber://reset-password#access_token=x&refresh_token=y')).toBe('aibarber://reset-password');
    expect(scrubUrl('https://a.b/c?x=1#y')).toBe('https://a.b/c');
    expect(scrubUrl('Error: what? #1')).toBe('Error: what? #1');
    expect(scrubUrl('/reset-password')).toBe('/reset-password');
  });

  it("PostHog's Application Opened never carries the tokens", () => {
    const ev = {
      event: 'Application Opened',
      properties: { url: 'aibarber://reset-password#access_token=x&refresh_token=y', version: '1.0.0', n: 1 },
    };
    const out = scrubEventUrls(ev);
    expect(out.properties).toEqual({ url: 'aibarber://reset-password', version: '1.0.0', n: 1 });
    expect(JSON.stringify(out)).not.toMatch(/access_token|refresh_token/);
    const clean = { event: 'x', properties: { a: 'b' } };
    expect(scrubEventUrls(clean)).toBe(clean);
    expect(scrubEventUrls(null)).toBeNull();
  });
});
