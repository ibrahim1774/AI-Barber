import React, { useState } from 'react';
import { SiteInstance } from '../types';

interface DomainManagerProps {
  site: SiteInstance;
  onDomainPurchased: (domain: string, orderId: string) => void;
}

export const DomainManager: React.FC<DomainManagerProps> = ({ site, onDomainPurchased }) => {
  const [domainInput, setDomainInput] = useState('');
  const [tld, setTld] = useState('.com');
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState<{
    available: boolean;
    domain: string;
    price?: number;
    renewalPrice?: number;
  } | null>(null);

  // If domain is already connected, show connected state
  if (site.customDomain) {
    return (
      <div className="mt-8">
        <h3 className="text-[10px] text-[#888] font-black uppercase tracking-[3px] mb-4">Custom Domain</h3>
        <div className="flex items-center gap-3 bg-[#1a1a1a] border border-green-500/30 rounded px-4 py-3">
          <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
          <a
            href={`https://${site.customDomain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 text-sm font-mono transition-colors"
          >
            {site.customDomain}
          </a>
          <span className="ml-auto text-green-500 text-[10px] font-bold uppercase tracking-wider bg-green-500/10 px-2 py-1 rounded">
            Connected
          </span>
        </div>
      </div>
    );
  }

  const sanitizeInput = (val: string) => {
    return val.toLowerCase().replace(/[^a-z0-9-]/g, '');
  };

  const handleSearch = async () => {
    const sanitized = sanitizeInput(domainInput);
    if (!sanitized) return;

    const fullDomain = `${sanitized}${tld}`;
    setIsChecking(true);
    setResult(null);

    try {
      const response = await fetch('/api/check-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: fullDomain }),
      });

      const data = await response.json();
      setResult({
        available: data.available,
        domain: fullDomain,
        price: data.price,
        renewalPrice: data.renewalPrice,
      });
    } catch (err) {
      console.error('[DomainManager] Check failed:', err);
      setResult({ available: false, domain: fullDomain });
    } finally {
      setIsChecking(false);
    }
  };

  const handleBuy = async () => {
    if (!result?.available || !result.price) return;

    // Extract project name from deployed URL
    const projectName = site.deployedUrl
      ?.replace('https://', '')
      .replace('.vercel.app', '')
      .split('.')[0] || '';

    try {
      const response = await fetch('/api/create-domain-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: result.domain,
          vercelPrice: result.price,
          siteId: site.id,
          projectName,
        }),
      });

      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error('[DomainManager] Checkout creation failed:', err);
    }
  };

  const displayPrice = result?.price ? Math.round((result.price + 5) * 100) / 100 : 0;
  const displayRenewal = result?.renewalPrice ? Math.round((result.renewalPrice + 5) * 100) / 100 : 0;

  return (
    <div className="mt-8">
      <h3 className="text-[10px] text-[#888] font-black uppercase tracking-[3px] mb-4">Custom Domain</h3>

      {/* Search bar */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="yourbusiness"
          value={domainInput}
          onChange={(e) => setDomainInput(sanitizeInput(e.target.value))}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="flex-1 bg-[#0d0d0d] border border-white/10 rounded px-3 py-2.5 text-white text-sm outline-none focus:border-[#f4a100] transition-colors placeholder:text-[#555]"
        />
        <select
          value={tld}
          onChange={(e) => setTld(e.target.value)}
          className="bg-[#0d0d0d] border border-white/10 rounded px-2 py-2.5 text-white text-sm outline-none focus:border-[#f4a100] transition-colors"
        >
          <option value=".com">.com</option>
          <option value=".co.uk">.co.uk</option>
          <option value=".net">.net</option>
          <option value=".org">.org</option>
        </select>
        <button
          onClick={handleSearch}
          disabled={!domainInput || isChecking}
          className="flex items-center gap-2 bg-[#333] hover:bg-[#444] text-white px-4 py-2.5 rounded text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isChecking ? (
            <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
          Search
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className={`mt-4 p-4 rounded border ${result.available ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
          {result.available ? (
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <div>
                  <span className="text-white text-sm font-bold">{result.domain}</span>
                  <span className="text-green-400 text-xs ml-2">is available!</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-white text-sm font-bold">${displayPrice}/yr</div>
                {displayRenewal > 0 && (
                  <div className="text-[#888] text-[10px]">Renewal: ${displayRenewal}/yr</div>
                )}
              </div>
              <button
                onClick={handleBuy}
                className="w-full mt-2 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider transition-colors rounded"
              >
                Buy Domain — ${displayPrice}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span className="text-white text-sm">{result.domain}</span>
              <span className="text-red-400 text-xs">is not available</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
