import { MIN_PASSWORD, PASSWORD_TOO_SHORT } from '@/lib/auth';
import { isValidEmail } from '@/lib/recovery';

export type SignUpField = 'email' | 'password';

/** The first problem with the sign-up form, checked in on-screen order, or null. The phone number is optional (App Store 5.1.1(v)), so it is never an error. */
export function validateSignUp(v: { phone?: string; email: string; password: string }): { field: SignUpField; message: string } | null {
  if (!v.email.trim()) return { field: 'email', message: 'Enter your email address.' };
  if (!isValidEmail(v.email)) return { field: 'email', message: 'That email address doesn’t look right. Check it and try again.' };
  if (v.password.length < MIN_PASSWORD) return { field: 'password', message: PASSWORD_TOO_SHORT };
  return null;
}
