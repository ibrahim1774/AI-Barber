import React, { useState } from 'react';

interface PostDeploymentModalProps {
  deployedUrl: string;
  onCreateAccount: () => void;
  onSkip: () => void;
}

export const PostDeploymentModal: React.FC<PostDeploymentModalProps> = ({
  deployedUrl,
  onCreateAccount,
  onSkip,
}) => {
  const [copied, setCopied] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[150] px-4">
      <div className="bg-[#1a1a1a] border border-white/10 rounded-lg w-full max-w-md p-8 text-center">
        {/* Green checkmark */}
        <div className="mb-6 flex justify-center">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
            <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>

        {/* Heading */}
        <h2 className="text-2xl font-montserrat font-black uppercase tracking-[3px] mb-3">
          Site is <span className="text-green-500">Live!</span>
        </h2>

        <p className="text-[#999] text-sm mb-5">
          Your website has been published successfully.
        </p>

        {/* Red warning — push the user to actually copy the URL before
            they close or navigate away. */}
        <div
          className="flex items-center justify-center gap-2 border border-red-500/40 bg-red-500/10 px-3 py-2 mb-2"
          role="alert"
        >
          <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-red-300 text-xs font-montserrat font-black uppercase tracking-[0.18em]">
            Make sure you copy this
          </p>
        </div>

        {/* URL display */}
        <div className="flex items-center gap-2 bg-[#0d0d0d] border border-white/10 rounded px-3 py-2.5 mb-2">
          <span className="text-[#f4a100] text-xs font-mono truncate flex-1 text-left">{deployedUrl}</span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(deployedUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="shrink-0 text-[#888] hover:text-white transition-colors"
            aria-label="Copy URL"
          >
            {copied ? (
              <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2"/>
              </svg>
            )}
          </button>
        </div>

        {/* Standalone "Click to Copy" button — second affordance so the
            URL pill above doesn't get mistaken for static text. */}
        <button
          onClick={() => {
            navigator.clipboard.writeText(deployedUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="block w-full py-2.5 border border-white/15 hover:border-white/30 text-white font-montserrat font-black uppercase tracking-[2px] text-xs transition-colors mb-6"
        >
          {copied ? 'Copied' : 'Click to Copy'}
        </button>

        {/* Divider */}
        <div className="border-t border-white/10 my-6" />

        {/* Account creation prompt */}
        <p className="text-[#999] text-xs mb-5 leading-relaxed">
          Create a free account to manage your site, make edits, and republish anytime.
        </p>

        <button
          onClick={onCreateAccount}
          className="block w-full py-3 bg-white hover:bg-gray-100 text-[#1a1a1a] font-montserrat font-black uppercase tracking-[2px] text-xs transition-colors"
        >
          Create Account
        </button>
      </div>
    </div>
  );
};
