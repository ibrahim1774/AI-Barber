import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'signin' | 'signup';
  onSuccess?: () => void;
  signInOnly?: boolean;
  // Pre-filled email — used by the /recover flow to lock the signup
  // email to whatever was on the visitor's Stripe session, so the
  // newly-created Supabase user matches the customer who already paid.
  initialEmail?: string;
  // When true (and initialEmail is set), the email field is read-only.
  // Used by the post-payment signup so the account email is guaranteed
  // to equal the Stripe customer email — the precondition for both the
  // same-session site upsert and the email-based recovery to work.
  lockEmail?: boolean;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, initialMode = 'signup', onSuccess, signInOnly = false, initialEmail, lockEmail = false }) => {
  const [mode, setMode] = useState<'signin' | 'signup'>(signInOnly ? 'signin' : initialMode);
  const [email, setEmail] = useState(initialEmail || '');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { signIn, signUp } = useAuth();

  // Sync mode to props whenever the modal opens or the caller's
  // intent changes. Without this, mode is locked to whatever it was
  // at first mount (typically 'signup') because useState only reads
  // the initial value once — so clicking "Sign In" from the homepage
  // header was still showing the Create Account form underneath.
  useEffect(() => {
    if (isOpen) {
      setMode(signInOnly ? 'signin' : initialMode);
      setError('');
      if (initialEmail) setEmail(initialEmail);
    }
  }, [isOpen, signInOnly, initialMode, initialEmail]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      if (mode === 'signup') {
        if (password.length < 6) {
          setError('Password must be at least 6 characters');
          setIsSubmitting(false);
          return;
        }
        const { error } = await signUp(email, password, fullName);
        if (error) {
          setError(error.message);
          setIsSubmitting(false);
          return;
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          setError(error.message);
          setIsSubmitting(false);
          return;
        }
      }

      // Success
      setEmail('');
      setPassword('');
      setFullName('');
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode(mode === 'signin' ? 'signup' : 'signin');
    setError('');
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[200] px-4">
      <div className="bg-[#1a1a1a] border border-white/10 rounded-lg w-full max-w-md p-8 relative">
        {/* Close button */}
        <button onClick={onClose} className="absolute top-4 right-4 text-[#666] hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Tab toggle (hidden in signInOnly mode) */}
        {signInOnly ? (
          <h2 className="text-xs font-black uppercase tracking-[3px] text-[#f4a100] mb-8 pb-3 border-b border-white/10">Sign In</h2>
        ) : (
          <div className="flex mb-8 border-b border-white/10">
            <button
              onClick={() => { setMode('signin'); setError(''); }}
              className={`flex-1 pb-3 text-xs font-black uppercase tracking-[3px] transition-colors ${mode === 'signin' ? 'text-[#f4a100] border-b-2 border-[#f4a100]' : 'text-[#666] hover:text-white'}`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode('signup'); setError(''); }}
              className={`flex-1 pb-3 text-xs font-black uppercase tracking-[3px] transition-colors ${mode === 'signup' ? 'text-[#f4a100] border-b-2 border-[#f4a100]' : 'text-[#666] hover:text-white'}`}
            >
              Sign Up
            </button>
          </div>
        )}

        {/* Save-your-credentials reminder — sign up only. */}
        {mode === 'signup' && (
          <div
            className="flex items-center justify-center gap-2 border border-red-500/40 bg-red-500/10 px-3 py-2.5 mb-5"
            role="alert"
          >
            <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-red-300 text-xs font-bold leading-snug">
              Please save the email &amp; password you use here — you'll need them to sign back in.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Full name (signup only) */}
          {mode === 'signup' && (
            <div className="relative">
              <svg className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-[#666]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <input
                type="text"
                placeholder="Full Name (optional)"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full bg-transparent border-b border-white/20 focus:border-blue-500 py-3 pl-7 text-white text-sm outline-none transition-colors placeholder:text-[#555]"
              />
            </div>
          )}

          {/* Email */}
          <div className="relative">
            <svg className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-[#666]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              readOnly={lockEmail && !!email}
              title={lockEmail && !!email ? 'This is the email you paid with — your site is attached to it.' : undefined}
              className={`w-full bg-transparent border-b border-white/20 focus:border-blue-500 py-3 pl-7 text-white text-sm outline-none transition-colors placeholder:text-[#555] ${lockEmail && !!email ? 'opacity-70 cursor-not-allowed' : ''}`}
            />
            {lockEmail && !!email && mode === 'signup' && (
              <p className="text-[#888] text-[10px] mt-1.5 pl-7">Using the email you paid with, so your site stays attached.</p>
            )}
          </div>

          {/* Password */}
          <div className="relative">
            <svg className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-[#666]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <input
              type="password"
              required
              placeholder={mode === 'signup' ? 'Password (min 6 characters)' : 'Password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-transparent border-b border-white/20 focus:border-blue-500 py-3 pl-7 text-white text-sm outline-none transition-colors placeholder:text-[#555]"
            />
          </div>

          {/* Error message */}
          {error && (
            <p className="text-red-400 text-xs">{error}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 mt-2 bg-[#f4a100] text-[#1a1a1a] font-montserrat font-black uppercase tracking-[3px] text-xs hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? (mode === 'signup' ? 'Creating Account...' : 'Signing In...')
              : (mode === 'signup' ? 'Create Account' : 'Sign In')
            }
          </button>
        </form>

        {/* Toggle link (hidden in signInOnly mode) */}
        {!signInOnly && (
          <p className="text-center text-[#666] text-xs mt-6">
            {mode === 'signin' ? (
              <>Don't have an account?{' '}<button onClick={switchMode} className="text-[#f4a100] hover:text-white transition-colors">Sign Up</button></>
            ) : (
              <>Already have an account?{' '}<button onClick={switchMode} className="text-[#f4a100] hover:text-white transition-colors">Sign In</button></>
            )}
          </p>
        )}
      </div>
    </div>
  );
};
