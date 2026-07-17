import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/*
 * Set-new-password prompt for the Supabase recovery flow. The "Forgot
 * password?" email link signs the visitor in with a recovery session and
 * fires PASSWORD_RECOVERY on the auth listener; this modal listens for
 * that event itself (self-contained — no AuthContext changes) and lets
 * them choose a new password.
 */

export const PasswordRecoveryModal: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setOpen(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) return setError('Password must be at least 6 characters');
    if (password !== confirm) return setError('Passwords do not match');
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) return setError(error.message);
    setDone(true);
    setTimeout(() => setOpen(false), 1800);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[300] px-4">
      <div className="bg-[#1a1a1a] border border-white/10 rounded-lg w-full max-w-md p-8">
        <h2 className="text-xs font-black uppercase tracking-[3px] text-[#f4a100] mb-6 pb-3 border-b border-white/10">
          Set a New Password
        </h2>
        {done ? (
          <p className="text-emerald-400 text-sm font-bold">Password updated — you're signed in.</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password"
              className="w-full bg-black/40 border border-white/15 rounded px-4 py-3 text-white text-sm outline-none focus:border-[#f4a100]"
              autoFocus
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              className="w-full bg-black/40 border border-white/15 rounded px-4 py-3 text-white text-sm outline-none focus:border-[#f4a100]"
            />
            {error && <p className="text-red-400 text-xs font-bold">{error}</p>}
            <button
              type="submit"
              disabled={saving}
              className="w-full bg-[#f4a100] text-black font-black uppercase tracking-[2px] text-xs py-3.5 rounded hover:bg-white transition-colors disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save New Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default PasswordRecoveryModal;
