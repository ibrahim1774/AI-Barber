// Forgot password: the recovery link parser, the reset email's error mapping,
// the Resend cooldown, the new-password checks, and URL scrubbing for analytics.
import * as analytics from '@/lib/analytics';
import {
  friendlyResetError, newPasswordProblem, PASSWORD_TOO_SHORT, PASSWORDS_DIFFER, RESET_BAD_EMAIL, RESET_FALLBACK,
  RESET_RATE_LIMITED, requestPasswordReset, setNewPassword, startRecoverySession,
} from '@/lib/auth';
import { cooldownLeft, parseRecoveryUrl, RESET_REDIRECT, scrubEventUrls, scrubUrl } from '@/lib/recovery';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sb, supabase } = require('@/lib/supabase');

const OFFLINE = "Couldn't reach AI Barber — check your connection and try again.";

beforeEach(() => {
  jest.restoreAllMocks();
  sb.reset();
});

describe('parseRecoveryUrl', () => {
  it('reads a session fragment', () => {
    expect(
      parseRecoveryUrl(
        'aibarber://reset-password#access_token=eyJ.a.b&expires_at=1&expires_in=3600&refresh_token=r3fr%2Bsh&token_type=bearer&type=recovery',
      ),
    ).toEqual({ kind: 'session', accessToken: 'eyJ.a.b', refreshToken: 'r3fr+sh' });
  });

  it('reads an error fragment (description decoded, + as space)', () => {
    expect(
      parseRecoveryUrl(
        'aibarber://reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      ),
    ).toEqual({ kind: 'error', message: 'Email link is invalid or has expired' });
    expect(parseRecoveryUrl('aibarber://reset-password?error=server_error')).toEqual({
      kind: 'error',
      message: 'This reset link has expired or was already used.',
    });
  });

  it('no fragment, or a session that is not a recovery, is none', () => {
    expect(parseRecoveryUrl('aibarber://reset-password')).toEqual({ kind: 'none' });
    expect(parseRecoveryUrl('aibarber://reset-password#')).toEqual({ kind: 'none' });
    expect(parseRecoveryUrl('aibarber://reset-password#access_token=a&refresh_token=b&type=signup')).toEqual({
      kind: 'none',
    });
    expect(parseRecoveryUrl('aibarber://reset-password#access_token=a')).toEqual({ kind: 'none' });
    expect(parseRecoveryUrl(null)).toEqual({ kind: 'none' });
    expect(parseRecoveryUrl('')).toEqual({ kind: 'none' });
  });

  it('a malformed URL never throws', () => {
    expect(parseRecoveryUrl('aibarber://reset-password#access_token=%E0%A4%A&refresh_token=%')).toEqual({
      kind: 'session',
      accessToken: '%E0%A4%A',
      refreshToken: '%',
    });
    expect(parseRecoveryUrl('not a url at all ### & = =')).toEqual({ kind: 'none' });
    expect(parseRecoveryUrl('#&&==&')).toEqual({ kind: 'none' });
  });
});

describe('requestPasswordReset', () => {
  it('sends the in-app redirect, trimmed, and tracks without the email', async () => {
    const trackSpy = jest.spyOn(analytics, 'track');
    await requestPasswordReset('  barber@example.com ');
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('barber@example.com', {
      redirectTo: 'aibarber://reset-password',
    });
    expect(RESET_REDIRECT).toBe('aibarber://reset-password');
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

describe('recovery session and new password', () => {
  it('startRecoverySession sets the session, then rotates the refresh token', async () => {
    await startRecoverySession('acc', 'ref');
    expect(supabase.auth.setSession).toHaveBeenCalledWith({ access_token: 'acc', refresh_token: 'ref' });
    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('a rejected link (fake tokens) fails with the expired message', async () => {
    supabase.auth.setSession.mockResolvedValueOnce({ data: { session: null, user: null }, error: { message: 'Invalid JWT' } });
    await expect(startRecoverySession('fake', 'fake')).rejects.toThrow('This reset link has expired or was already used.');
    expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
  });

  it('newPasswordProblem: 6 characters minimum, both fields equal', () => {
    expect(newPasswordProblem('12345', '12345')).toBe(PASSWORD_TOO_SHORT);
    expect(newPasswordProblem('123456', '123457')).toBe(PASSWORDS_DIFFER);
    expect(newPasswordProblem('123456', '123456')).toBeNull();
  });

  it('setNewPassword updates, identifies and tracks completion', async () => {
    await startRecoverySession('acc', 'ref');
    const identify = jest.spyOn(analytics, 'identifyUser');
    const trackSpy = jest.spyOn(analytics, 'track');
    await setNewPassword('n3w-pass');
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'n3w-pass' });
    expect(identify).toHaveBeenCalledWith('user-recovery');
    expect(trackSpy).toHaveBeenCalledWith('password_reset_completed');
  });

  it("setNewPassword surfaces the server's reason", async () => {
    supabase.auth.updateUser.mockResolvedValueOnce({
      data: { user: null },
      error: { status: 422, code: 'same_password', message: 'New password should be different from the old password.' },
    });
    const trackSpy = jest.spyOn(analytics, 'track');
    await expect(setNewPassword('same-old')).rejects.toThrow('New password should be different from the old password.');
    expect(trackSpy).not.toHaveBeenCalledWith('password_reset_completed');
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
