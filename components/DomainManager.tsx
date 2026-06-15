import React from 'react';
import { SiteInstance } from '../types';

interface DomainManagerProps {
  site: SiteInstance;
  onDomainPurchased: (domain: string, orderId: string) => void;
}

export const DomainManager: React.FC<DomainManagerProps> = ({ site }) => {
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

  return (
    <div className="mt-8">
      <h3 className="text-[10px] text-[#888] font-black uppercase tracking-[3px] mb-4">Custom Domain</h3>
      <div className="bg-[#1a1a1a] border border-white/10 rounded p-5">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-[#f4a100] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
          <div className="flex-1">
            <p className="text-white text-sm leading-relaxed">
              Want a custom domain like <span className="font-mono text-[#f4a100]">xyzbarbershop.com</span> instead of the default URL above? Reach out to support and we&apos;ll set it up for you.
            </p>
            <p className="text-[#999] text-sm mt-3">
              <span className="text-white font-bold">$30/year</span> for the custom domain name.
            </p>
            <p className="text-[#888] text-xs mt-4">
              Contact us via the Support card below to request a custom domain for your barbershop.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
