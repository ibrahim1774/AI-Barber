import React, { useState, useEffect } from 'react';
import { SiteInstance } from '../types';
import { publishSite } from '../services/publishService';
import { dualWriteSave } from '../services/saveService';

interface PublishOverlayProps {
  site: SiteInstance;
  userId: string | null;
  onComplete: (url: string) => void;
  onError: () => void;
  onClose: () => void;
}

export const PublishOverlay: React.FC<PublishOverlayProps> = ({
  site,
  userId,
  onComplete,
  onError,
  onClose,
}) => {
  const [phase, setPhase] = useState<'publishing' | 'countdown' | 'success' | 'error'>('publishing');
  const [countdown, setCountdown] = useState(3);
  const [errorMessage, setErrorMessage] = useState('');
  const [deployedUrl, setDeployedUrl] = useState('');

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const result = await publishSite(site, userId);

        if (cancelled) return;

        setDeployedUrl(result.url);

        // Update site with new deployment info and save
        const updatedSite: SiteInstance = {
          ...site,
          deployedUrl: result.url,
          deploymentStatus: 'deployed',
          lastSaved: Date.now(),
        };
        dualWriteSave(updatedSite, userId).catch(err =>
          console.error('[PublishOverlay] Post-publish save error:', err)
        );

        // Start countdown
        setPhase('countdown');
        let remaining = 3;
        const interval = setInterval(() => {
          remaining -= 1;
          setCountdown(remaining);
          if (remaining <= 0) {
            clearInterval(interval);
            setPhase('success');
            onComplete(result.url);
            // Auto-open the live site after 1 second
            setTimeout(() => {
              window.open(result.url, '_blank');
            }, 1000);
          }
        }, 1000);
      } catch (err: any) {
        if (cancelled) return;
        console.error('[Publish] Error:', err);
        setErrorMessage(err.message || 'Publishing failed');
        setPhase('error');
        onError();
      }
    };

    run();

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="fixed inset-0 bg-[#0d0d0d]/95 backdrop-blur-sm flex flex-col items-center justify-center z-[200] px-6">
      {phase === 'publishing' && (
        <>
          <div className="mb-6">
            <svg className="w-14 h-14 text-blue-500 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <h2 className="text-xl font-montserrat font-black uppercase tracking-[3px] mb-3 text-center">
            Publishing your <span className="text-blue-500">changes</span>...
          </h2>
          <p className="text-[#888] text-sm text-center">
            Uploading images and deploying your site
          </p>
        </>
      )}

      {phase === 'countdown' && (
        <>
          <div className="mb-6">
            <svg className="w-14 h-14 text-blue-500 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <h2 className="text-xl font-montserrat font-black uppercase tracking-[3px] mb-3 text-center">
            Deploying... <span className="text-blue-500">{countdown}s</span>
          </h2>
        </>
      )}

      {phase === 'success' && (
        <>
          <div className="mb-6">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <h2 className="text-xl font-montserrat font-black uppercase tracking-[3px] mb-3 text-center">
            Your changes are <span className="text-green-500">live!</span>
          </h2>
          <p className="text-[#999] text-sm mb-6 text-center">{deployedUrl}</p>
          <button
            onClick={onClose}
            className="px-8 py-3 bg-white/10 hover:bg-white/20 text-white text-xs font-black uppercase tracking-wider transition-colors"
          >
            Back to Editor
          </button>
        </>
      )}

      {phase === 'error' && (
        <>
          <div className="mb-6">
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
              <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <h2 className="text-xl font-montserrat font-black uppercase tracking-[3px] mb-3 text-center">
            Publishing <span className="text-red-500">Failed</span>
          </h2>
          <p className="text-red-400 text-sm mb-6 text-center max-w-md">
            {errorMessage}
          </p>
          <button
            onClick={onClose}
            className="px-8 py-3 bg-white/10 hover:bg-white/20 text-white text-xs font-black uppercase tracking-wider transition-colors"
          >
            Dismiss
          </button>
        </>
      )}
    </div>
  );
};
