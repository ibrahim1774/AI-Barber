import React, { useState, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import { GeneratorForm } from './GeneratorForm';
import { BooksyGeneratorForm } from './BooksyGeneratorForm';
import { ShopInputs, WebsiteData, SiteInstance } from '../types';
import { generateContent } from '../services/geminiService';
import { publishSite } from '../services/publishService';

const SUPABASE_URL = (import.meta as any).env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string;

// Isolated client for creating customer accounts without touching the
// admin's own session. persistSession=false + a unique storageKey
// guarantees signUp doesn't overwrite whatever auth state the main
// supabase client is holding.
const adminSignupClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    storageKey: 'admin-generate-ephemeral',
  },
});

function generateTempPassword(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

type Step = 'setup' | 'generating' | 'publishing' | 'done' | 'error';
type Mode = 'full' | 'booksy';

export const AdminGenerator: React.FC = () => {
  const [step, setStep] = useState<Step>('setup');
  const [mode, setMode] = useState<Mode>('full');
  const initialPassword = useMemo(() => generateTempPassword(), []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(initialPassword);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = (label: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const handleGenerate = async (inputs: ShopInputs, scraped?: WebsiteData) => {
    if (!email || !email.includes('@')) {
      setErrorMessage('Customer email is required and must contain @.');
      setStep('error');
      return;
    }
    if (!password || password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      setStep('error');
      return;
    }

    setStep('generating');
    setErrorMessage(null);

    try {
      const data = scraped ?? (await generateContent(inputs));

      const { data: signUpData, error: signUpError } = await adminSignupClient.auth.signUp({
        email,
        password,
        options: { data: { full_name: '' } },
      });
      if (signUpError) {
        throw new Error(`Account creation failed: ${signUpError.message}`);
      }
      const newUserId = signUpData.user?.id;
      if (!newUserId) {
        throw new Error('Supabase signUp returned no user id.');
      }

      // RLS on the `sites` table requires `auth.uid() = user_id` for
      // INSERT/UPDATE. To attach the new site to the new customer we
      // must do the upsert through a client that's authenticated AS
      // the customer. signUp auto-signs-in only when "Confirm email"
      // is OFF; if it's ON we try signInWithPassword as a fallback,
      // which fails clearly so the operator knows what to fix.
      if (!signUpData.session) {
        const { error: signInError } = await adminSignupClient.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) {
          throw new Error(
            `Site won't attach — customer needs to confirm their email first. Fix: Supabase dashboard → Authentication → Providers → Email → turn OFF "Confirm email". Then retry. (Underlying: ${signInError.message})`
          );
        }
      }

      const siteId = `admin-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const site: SiteInstance = {
        id: siteId,
        data,
        formInputs: inputs,
        lastSaved: Date.now(),
        deployedUrl: null,
        deploymentStatus: 'deploying',
        customDomain: null,
        domainOrderId: null,
      };

      setStep('publishing');
      // skipIndexedDB=true: admin flow never writes to the operator's
      // browser-local IndexedDB (would otherwise pollute customer
      // dashboards via the local→Supabase sync — see PR #18 fix).
      // publishSite's internal dualWriteSave Supabase write goes
      // through the shared client and silently fails RLS — harmless
      // (fire-and-forget); the canonical save is below using the
      // ephemeral client that's authenticated as the customer.
      const { url } = await publishSite(site, newUserId, { skipIndexedDB: true });

      const deployedSite: SiteInstance = {
        ...site,
        deployedUrl: url,
        deploymentStatus: 'deployed',
        lastSaved: Date.now(),
      };
      // Note: custom_domain + domain_order_id are intentionally omitted —
      // they're in the migration file but were never applied to the
      // live Supabase schema, and including them throws "Could not
      // find the 'domain_order_id' column in the schema cache". The
      // customer flow silently swallows the same error via .catch.
      // If those columns are ever added later, restore them here.
      const { error: upsertError } = await adminSignupClient.from('sites').upsert(
        {
          id: deployedSite.id,
          user_id: newUserId,
          company_name: deployedSite.data.shopName,
          industry: 'barbershop',
          service_area: deployedSite.data.area,
          phone: deployedSite.data.phone,
          brand_colour: '#f4a100',
          site_data: deployedSite.data,
          deployed_url: deployedSite.deployedUrl,
          deployment_status: deployedSite.deploymentStatus,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
      if (upsertError) {
        throw new Error(`Site attach failed: ${upsertError.message}`);
      }

      // Sign the ephemeral client back out so it's clean for the
      // next admin run. persistSession=false already prevents any
      // global leak, but explicit signOut is tidy.
      await adminSignupClient.auth.signOut();

      setResultUrl(url);
      setStep('done');
    } catch (err: any) {
      console.error('[AdminGenerator] flow failed:', err);
      setErrorMessage(err?.message || 'Unknown error.');
      setStep('error');
    }
  };

  const reset = () => {
    setStep('setup');
    setEmail('');
    setPassword(generateTempPassword());
    setResultUrl(null);
    setErrorMessage(null);
  };

  if (step === 'done' && resultUrl) {
    const credsBlock = `Site: ${resultUrl}\nEmail: ${email}\nPassword: ${password}`;
    return (
      <div className="min-h-screen bg-[#0d0d0d] text-white px-6 py-16">
        <div className="max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[3px] text-green-400 bg-green-500/10 border border-green-500/30 px-2 py-1 rounded mb-4">
            Done
          </div>
          <h1 className="text-3xl font-montserrat font-black uppercase tracking-[3px] mb-2">
            Site is live + account attached.
          </h1>
          <p className="text-[#888] text-sm mb-10">Send these to the customer:</p>

          <div className="bg-[#1a1a1a] border border-white/10 rounded p-6 space-y-5">
            <div>
              <div className="text-[10px] text-[#888] font-bold uppercase tracking-wider mb-1.5">Site URL</div>
              <div className="flex items-center gap-3">
                <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 font-mono text-sm break-all">{resultUrl}</a>
                <button onClick={() => handleCopy('url', resultUrl)} className="ml-auto shrink-0 text-xs px-3 py-1.5 bg-[#333] hover:bg-[#444] rounded uppercase font-bold tracking-wider">
                  {copiedField === 'url' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#888] font-bold uppercase tracking-wider mb-1.5">Customer email</div>
              <div className="flex items-center gap-3">
                <span className="text-white font-mono text-sm break-all">{email}</span>
                <button onClick={() => handleCopy('email', email)} className="ml-auto shrink-0 text-xs px-3 py-1.5 bg-[#333] hover:bg-[#444] rounded uppercase font-bold tracking-wider">
                  {copiedField === 'email' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#888] font-bold uppercase tracking-wider mb-1.5">Temp password</div>
              <div className="flex items-center gap-3">
                <span className="text-white font-mono text-sm break-all">{password}</span>
                <button onClick={() => handleCopy('password', password)} className="ml-auto shrink-0 text-xs px-3 py-1.5 bg-[#333] hover:bg-[#444] rounded uppercase font-bold tracking-wider">
                  {copiedField === 'password' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={() => handleCopy('block', credsBlock)}
            className="mt-4 w-full py-3 bg-[#f4a100] text-[#1a1a1a] font-montserrat font-black uppercase tracking-[2px] text-xs hover:bg-white transition-colors"
          >
            {copiedField === 'block' ? 'Copied All' : 'Copy All Three As One Block'}
          </button>

          <p className="text-[#666] text-xs mt-6 leading-relaxed">
            If your Supabase project has &quot;Confirm email&quot; turned ON, the customer must click the verification email in their inbox before they can log in. If it&apos;s OFF, the password above works immediately.
          </p>

          <button onClick={reset} className="mt-8 text-[#888] hover:text-white text-xs uppercase tracking-wider">
            ← Generate another site
          </button>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="min-h-screen bg-[#0d0d0d] text-white px-6 py-16">
        <div className="max-w-xl mx-auto">
          <h1 className="text-2xl font-montserrat font-black uppercase tracking-[3px] text-red-400 mb-4">Failed.</h1>
          <div className="bg-red-500/10 border border-red-500/30 rounded p-4 text-sm text-white mb-6 font-mono break-words">
            {errorMessage || 'Unknown error.'}
          </div>
          <button onClick={() => setStep('setup')} className="text-[#888] hover:text-white text-xs uppercase tracking-wider">
            ← Back to setup
          </button>
        </div>
      </div>
    );
  }

  if (step === 'generating' || step === 'publishing') {
    return (
      <div className="min-h-screen bg-[#0d0d0d] text-white flex flex-col items-center justify-center px-6">
        <svg className="w-14 h-14 text-[#f4a100] animate-spin mb-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <p className="text-[#888] text-xs uppercase tracking-[4px]">
          {step === 'generating' ? 'Generating site' : 'Creating account + publishing'}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-white">
      <div className="max-w-3xl mx-auto px-6 pt-12 pb-6">
        <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[3px] text-[#f4a100] bg-[#f4a100]/10 border border-[#f4a100]/30 px-2 py-1 rounded mb-4">
          Admin Mode
        </div>
        <h1 className="text-3xl font-montserrat font-black uppercase tracking-[3px] mb-2">
          Generate For Customer
        </h1>
        <p className="text-[#888] text-sm mb-8 leading-relaxed">
          Builds a site, creates the customer&apos;s account, publishes it, attaches it to them. No payment screen. Use the form below as you normally would — Booksy/Fresha/Square import works the same.
        </p>

        <div className="bg-[#1a1a1a] border border-white/10 rounded p-6 mb-2 space-y-5">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[3px] text-[#888] mb-2">
              Customer email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value.trim())}
              placeholder="customer@example.com"
              className="w-full bg-[#0d0d0d] border border-white/10 rounded px-3 py-2.5 text-white text-sm outline-none focus:border-[#f4a100] transition-colors placeholder:text-[#555]"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[3px] text-[#888] mb-2">
              Temp password
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="flex-1 bg-[#0d0d0d] border border-white/10 rounded px-3 py-2.5 text-white text-sm font-mono outline-none focus:border-[#f4a100] transition-colors"
              />
              <button
                onClick={() => setPassword(generateTempPassword())}
                className="px-4 py-2.5 bg-[#333] hover:bg-[#444] text-white text-xs font-bold uppercase tracking-wider rounded transition-colors"
              >
                ↻ New
              </button>
            </div>
            <p className="text-[#666] text-[10px] mt-2">
              Auto-generated. Edit if you want, or click ↻ for a fresh one.
            </p>
          </div>
        </div>
        <p className="text-[#666] text-xs mb-6">
          Fill the shop form below, then click Generate. The site builds → account is created → site goes live → you get the URL + creds to hand off.
        </p>

        <div className="flex gap-2 mb-2">
          <button
            type="button"
            onClick={() => setMode('full')}
            className={`flex-1 py-3 px-4 text-xs font-bold uppercase tracking-[2px] rounded border transition-colors ${
              mode === 'full'
                ? 'bg-[#f4a100] text-[#1a1a1a] border-[#f4a100]'
                : 'bg-[#0d0d0d] text-[#888] border-white/10 hover:border-white/30'
            }`}
          >
            Full AI Barber form
          </button>
          <button
            type="button"
            onClick={() => setMode('booksy')}
            className={`flex-1 py-3 px-4 text-xs font-bold uppercase tracking-[2px] rounded border transition-colors ${
              mode === 'booksy'
                ? 'bg-[#f4a100] text-[#1a1a1a] border-[#f4a100]'
                : 'bg-[#0d0d0d] text-[#888] border-white/10 hover:border-white/30'
            }`}
          >
            Paste Booksy link
          </button>
        </div>
        <p className="text-[#666] text-[10px] mb-8">
          {mode === 'full'
            ? 'Build from scratch — fill in shop name, location, services, and a Booksy/Fresha/Square link is optional.'
            : 'Paste the customer’s Booksy / Fresha / Square / Vagaro / StyleSeat link. We scrape everything and build the site automatically.'}
        </p>
      </div>

      {mode === 'full' ? (
        <GeneratorForm onGenerate={handleGenerate} />
      ) : (
        <BooksyGeneratorForm onGenerate={handleGenerate} />
      )}
    </div>
  );
};
