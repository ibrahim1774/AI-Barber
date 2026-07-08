import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Loader2, Globe, KeyRound, CheckCircle2, Copy, Check, RotateCcw } from 'lucide-react';

/*
 * /onboard — set up a Client Site portal from the browser.
 *
 * Operator page (deliberately open, like /admin-generate): paste the site's
 * Vercel URL, type the client's email + password, and the server pulls the
 * live files into the editable bucket, creates the login, and links the
 * site. Success card shows exactly what to send the client.
 *
 * No Supabase in the browser here — everything runs through
 * /api/client-site-onboard with the server's service credentials.
 */

const SANS = '"Manrope", "Inter", system-ui, sans-serif';
const GOLD = '#e8c074';
const BG = '#0a0a0a';

function generatePassword(): string {
  const words = ['Fresh', 'Prime', 'Sharp', 'Bright', 'Solid', 'Swift', 'Grand', 'Bold'];
  const buf = new Uint32Array(3);
  crypto.getRandomValues(buf);
  const word = words[buf[0] % words.length];
  // Two padded base36 blocks ≈ 41 bits of entropy on top of the word —
  // still easy to read out over the phone, no longer enumerable.
  const block = (n: number) => (n % 36 ** 4).toString(36).padStart(4, '0');
  return `${word}-${block(buf[1])}-${block(buf[2])}`;
}

const inputCls =
  'w-full rounded-lg border border-white/15 bg-transparent px-3.5 py-3 text-[14px] text-white placeholder-white/30 outline-none focus:border-white/40';

const CopyRow: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        // Only show the checkmark when the copy actually landed — a false
        // "Copied" makes the operator paste stale clipboard content.
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          try {
            const ta = document.createElement('textarea');
            ta.value = value;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          } catch {
            return; // value stays visible on screen — copy it manually
          }
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-left hover:bg-white/[0.08]"
    >
      <span className="min-w-0">
        <span className="block text-[9px] font-bold uppercase tracking-[0.2em] text-white/35">{label}</span>
        <span className="block truncate text-[13.5px] text-white">{value}</span>
      </span>
      {copied ? <Check size={14} className="shrink-0 text-emerald-400" /> : <Copy size={14} className="shrink-0 text-white/40" />}
    </button>
  );
};

interface OnboardResult {
  slug: string;
  name: string;
  liveUrl: string;
  files: number;
  pages: number;
  // Snapshot of what was actually submitted — the form fields stay editable
  // state, and showing live state on the success card could hand the client
  // credentials the server never saw.
  email: string;
  password: string;
}

export const OnboardClientSite: React.FC = () => {
  const [site, setSite] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OnboardResult | null>(null);

  const portalUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/edit`;

  // Warn before closing the tab mid-run: a generated password lives only in
  // this component's state until the success card is shown.
  const busyRef = useRef(false);
  busyRef.current = busy;
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (busyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (busyRef.current) return; // a second overlapping run would race the first
      const submitted = { site: site.trim(), email: email.trim(), password };
      setBusy(true);
      setError(null);
      try {
        const resp = await fetch('/api/client-site-onboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(submitted),
        });
        let json: { ok?: boolean; error?: string } & Partial<OnboardResult> = {};
        try {
          json = await resp.json();
        } catch {
          throw new Error(
            resp.ok
              ? 'Finished but the response was unreadable — try signing in at the portal to confirm.'
              : `Onboarding failed (${resp.status}). Try again in a minute.`
          );
        }
        if (!resp.ok || !json.ok) throw new Error(json.error || 'Onboarding failed');
        setResult({
          slug: json.slug || '',
          name: json.name || '',
          liveUrl: json.liveUrl || '',
          files: json.files || 0,
          pages: json.pages || 0,
          email: submitted.email,
          password: submitted.password,
        });
      } catch (err: any) {
        setError(err?.message || 'Onboarding failed');
      } finally {
        setBusy(false);
      }
    },
    [site, email, password]
  );

  if (result) {
    return (
      <div className="min-h-screen flex items-center justify-center px-5 py-10" style={{ background: BG, fontFamily: SANS }}>
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-7">
          <CheckCircle2 size={38} className="mb-3 text-emerald-400" />
          <h1 className="text-xl font-bold text-white">{result.name} is ready</h1>
          <p className="mt-1 mb-5 text-[12.5px] text-white/50">
            {result.pages} pages ({result.files} files) imported. Send the client these details — they can
            start editing right away.
          </p>
          <div className="space-y-2">
            <CopyRow label="Portal link" value={portalUrl} />
            <CopyRow label="Email" value={result.email} />
            <CopyRow label="Password" value={result.password} />
          </div>
          <a
            href={result.liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-white/45 hover:text-white/80"
          >
            <Globe size={12} /> {result.liveUrl.replace(/^https?:\/\//, '')}
          </a>
          <button
            onClick={() => {
              setResult(null);
              setSite('');
              setEmail('');
              setPassword('');
            }}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-white/70 hover:text-white"
          >
            <RotateCcw size={13} /> Onboard another site
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-10" style={{ background: BG, fontFamily: SANS }}>
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-7">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>
          Client Sites
        </p>
        <h1 className="mb-1 text-xl font-bold text-white">Onboard a client site</h1>
        <p className="mb-6 text-[12.5px] text-white/50">
          Paste the site&apos;s Vercel URL, set the client&apos;s login, and their edit portal is created
          automatically. Running it again for the same site (with its assigned email) re-imports the live
          files; password changes stay in the onboarding script.
        </p>

        <label htmlFor="onboard-site" className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
          Vercel site URL or project name
        </label>
        <input
          id="onboard-site"
          required
          autoFocus
          disabled={busy}
          value={site}
          onChange={(e) => setSite(e.target.value)}
          placeholder="mrperfect-atlanta.vercel.app"
          className={`${inputCls} mb-4 disabled:opacity-50`}
        />

        <label htmlFor="onboard-email" className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
          Client email
        </label>
        <input
          id="onboard-email"
          type="email"
          required
          disabled={busy}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="client@example.com"
          className={`${inputCls} mb-4 disabled:opacity-50`}
        />

        <label htmlFor="onboard-password" className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
          Client password
        </label>
        <div className="mb-5 flex gap-2">
          <input
            id="onboard-password"
            type="text"
            required
            minLength={8}
            disabled={busy}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className={`${inputCls} disabled:opacity-50`}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => setPassword(generatePassword())}
            title="Generate a password"
            className="shrink-0 rounded-lg border border-white/15 px-3.5 text-white/60 hover:text-white disabled:opacity-50"
          >
            <KeyRound size={15} />
          </button>
        </div>

        {error && <p role="alert" className="mb-4 text-[12px] text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg py-3 text-[12px] font-black uppercase tracking-[0.18em] transition disabled:opacity-60"
          style={{ background: GOLD, color: '#0a0a0a' }}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          {busy ? 'Setting everything up…' : 'Create client portal'}
        </button>
        {busy && (
          <p aria-live="polite" className="mt-3 text-center text-[11.5px] text-white/40">
            Pulling the live site and creating the account — this can take a minute or two. Keep this tab open.
          </p>
        )}
      </form>
    </div>
  );
};

export default OnboardClientSite;
