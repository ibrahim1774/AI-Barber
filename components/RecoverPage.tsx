import React, { useState } from 'react';
import { Loader2, ArrowRight, Check, AlertCircle, Sparkles } from 'lucide-react';
import { SiteInstance } from '../types';

interface RecoverPageProps {
  // Called with the recovered SiteInstance + the customer's email.
  // App.tsx sets activeSite + opens the AuthModal in signup mode
  // with the email pre-filled — handleAuthSuccess then upserts the
  // recovered SiteInstance into Supabase under the new user.id.
  onRecovered: (siteInstance: SiteInstance, customerEmail: string | null) => void;
}

const SANS = '"Manrope", "Inter", system-ui, sans-serif';
const SERIF = '"Instrument Serif", "Times New Roman", Georgia, serif';
const GOLD = '#f4a100';
const BG = '#0a0a0a';

export const RecoverPage: React.FC<RecoverPageProps> = ({ onRecovered }) => {
  const [email, setEmail] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [mode, setMode] = useState<'email' | 'session'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [foundShop, setFoundShop] = useState<string | null>(null);
  const [foundUrl, setFoundUrl] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFoundShop(null);
    setFoundUrl(null);

    const payload: Record<string, string> =
      mode === 'email'
        ? { email: email.trim() }
        : { sessionId: sessionId.trim() };

    if ((mode === 'email' && !payload.email) || (mode === 'session' && !payload.sessionId)) {
      setError('Please fill in the field above.');
      return;
    }

    setBusy(true);
    try {
      const resp = await fetch('/api/recover-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setError(data.error || `Recovery failed (HTTP ${resp.status})`);
        return;
      }
      // Show the found-site confirmation briefly, then hand off to
      // the parent (which opens the signup modal).
      setFoundShop(data.shopName || 'Your site');
      setFoundUrl(data.deployedUrl || null);
      // 800ms of dwell so the visitor sees "we found it!" before the
      // modal pops — feels like a confirmation, not a jarring jump.
      setTimeout(() => {
        onRecovered(data.siteInstance as SiteInstance, data.customerEmail || payload.email || null);
      }, 800);
    } catch (err: any) {
      setError(err?.message || 'Network error. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-5 md:px-8 py-12"
      style={{ background: BG, color: 'white', fontFamily: SANS }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-7">
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-4"
            style={{ background: 'rgba(244,161,0,0.12)', border: `1px solid rgba(244,161,0,0.35)` }}
          >
            <Sparkles size={11} style={{ color: GOLD }} />
            <span className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: GOLD }}>
              Recover your paid site
            </span>
          </div>
          <h1
            className="text-3xl md:text-4xl font-black tracking-tight leading-[1.05] mb-2"
            style={{ color: 'white', letterSpacing: '-0.02em' }}
          >
            Already paid?{' '}
            <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, color: GOLD }}>
              Find your site.
            </span>
          </h1>
          <p className="text-[13px] md:text-[14px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
            If your card was charged but you saw "Publishing Failed,"
            your site is still live. Enter your email below and we'll
            link it to a new account so you can edit it from your dashboard.
          </p>
        </div>

        {/* Mode toggle */}
        <div
          className="grid grid-cols-2 gap-1 p-1 mb-4 rounded-md"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {([
            { key: 'email', label: 'Use email' },
            { key: 'session', label: 'Use Stripe receipt ID' },
          ] as const).map(opt => {
            const active = mode === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => { setMode(opt.key); setError(null); }}
                className="py-2 px-2 text-center transition-all rounded"
                style={{
                  background: active ? GOLD : 'transparent',
                  color: active ? '#0a0a0a' : 'rgba(255,255,255,0.7)',
                  fontFamily: 'inherit',
                }}
              >
                <span className="text-[10px] font-black uppercase tracking-[0.18em]">{opt.label}</span>
              </button>
            );
          })}
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'email' ? (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.22em] mb-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Email used at checkout
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                disabled={busy}
                className="w-full px-4 py-3 bg-transparent text-white placeholder-white/30 text-[14px] outline-none transition-colors"
                style={{
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '4px',
                  fontFamily: 'inherit',
                }}
              />
            </div>
          ) : (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.22em] mb-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Stripe session ID
              </label>
              <input
                type="text"
                value={sessionId}
                onChange={e => setSessionId(e.target.value)}
                placeholder="cs_live_…"
                required
                disabled={busy}
                spellCheck={false}
                className="w-full px-4 py-3 bg-transparent text-white placeholder-white/30 text-[13px] outline-none transition-colors font-mono"
                style={{
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '4px',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                }}
              />
              <p className="mt-1.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Find this in your Stripe receipt email — starts with <code>cs_</code>.
              </p>
            </div>
          )}

          {error && (
            <div
              className="flex items-start gap-2 p-3 rounded text-[12px]"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}
            >
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {foundShop && foundUrl && (
            <div
              className="flex items-start gap-2 p-3 rounded text-[12px]"
              style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.35)', color: '#86efac' }}
            >
              <Check size={14} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Found it — {foundShop}</div>
                <div className="opacity-80 mt-0.5 break-all">{foundUrl}</div>
                <div className="mt-1.5 text-white/70">Opening sign-up to finish linking…</div>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !!foundShop}
            className="w-full inline-flex items-center justify-center gap-2 px-7 py-3.5 font-black uppercase tracking-[0.22em] text-[11px] transition disabled:opacity-50"
            style={{
              background: GOLD,
              color: '#0a0a0a',
              border: '1px solid transparent',
              fontFamily: 'inherit',
            }}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
            <span>{busy ? 'Searching…' : 'Find My Site'}</span>
          </button>
        </form>

        <p className="mt-6 text-center text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Can't find it? Email{' '}
          <a href="mailto:support@davoxa.com" style={{ color: GOLD }}>
            support@davoxa.com
          </a>{' '}
          and we'll finish recovery manually.
        </p>
      </div>
    </div>
  );
};

export default RecoverPage;
