import React, { useEffect, useState } from 'react';
import { SiteInstance } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { fetchUserSites } from '../services/supabaseDataService';
import { getAllSites as getAllLocalSites } from '../services/indexedDBService';
import { ScissorsIcon } from './Icons';
import { DomainManager } from './DomainManager';
import { dualWriteSave } from '../services/saveService';

interface ManagementDashboardProps {
  onEditSite: (site: SiteInstance) => void;
  onCreateNewSite: () => void;
  onSignOut: () => void;
}

function getRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const ManagementDashboard: React.FC<ManagementDashboardProps> = ({
  onEditSite,
  onCreateNewSite,
  onSignOut,
}) => {
  const { user, profile } = useAuth();
  const [sites, setSites] = useState<SiteInstance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showDropdown, setShowDropdown] = useState(false);

  const firstName = profile?.full_name?.split(' ')[0] || profile?.email?.split('@')[0] || 'there';
  const userInitial = (profile?.full_name?.[0] || profile?.email?.[0] || 'U').toUpperCase();

  useEffect(() => {
    loadSites();
  }, [user]);

  const loadSites = async () => {
    setIsLoading(true);
    try {
      let allSites: SiteInstance[] = [];

      // Try Supabase first
      if (user) {
        try {
          allSites = await fetchUserSites(user.id);
        } catch (err) {
          console.error('[Dashboard] Supabase fetch failed:', err);
        }
      }

      // Also check IndexedDB — prefer whichever source has the fresher data
      try {
        const localSites = await getAllLocalSites();
        for (const local of localSites) {
          const existingIdx = allSites.findIndex(s => s.id === local.id);
          if (existingIdx === -1) {
            // Site only in IndexedDB — add and sync to Supabase
            allSites.push(local);
            if (user) {
              dualWriteSave(local, user.id).catch(err =>
                console.error('[Dashboard] Sync local site failed:', err)
              );
            }
          } else if (local.lastSaved > allSites[existingIdx].lastSaved) {
            // IndexedDB version is newer (e.g. Supabase save failed for large images) — prefer it
            allSites[existingIdx] = local;
            if (user) {
              dualWriteSave(local, user.id).catch(err =>
                console.error('[Dashboard] Re-sync fresher local site failed:', err)
              );
            }
          }
        }
      } catch (err) {
        console.error('[Dashboard] IndexedDB fetch failed:', err);
      }

      setSites(allSites);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDomainPurchased = (domain: string, orderId: string) => {
    setSites(prev => prev.map(s => ({
      ...s,
      customDomain: domain,
      domainOrderId: orderId,
    })));
  };

  const activeSite = sites[0] || null;

  return (
    <div className="min-h-screen bg-[#0d0d0d]">
      {/* Top Nav */}
      <nav className="bg-[#111] border-b border-white/10 px-4 md:px-6 py-3">
        <div className="container mx-auto flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <ScissorsIcon className="w-5 h-5 text-[#f4a100]" />
            <span className="text-xs font-montserrat font-black uppercase tracking-[2px] text-white">
              Prime<span className="text-[#f4a100]">Barber</span> AI
            </span>
          </div>

          {/* User dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center gap-2 text-white hover:text-[#f4a100] transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                {userInitial}
              </div>
              <span className="text-sm font-bold hidden sm:inline">{firstName}</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showDropdown && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
                <div className="absolute right-0 mt-2 w-48 bg-[#1a1a1a] border border-white/10 rounded shadow-xl z-50">
                  <button
                    onClick={() => { setShowDropdown(false); }}
                    className="block w-full text-left px-4 py-2.5 text-sm text-white hover:bg-white/5 transition-colors"
                  >
                    Dashboard
                  </button>
                  <button
                    onClick={() => { setShowDropdown(false); onSignOut(); }}
                    className="block w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-white/5 transition-colors"
                  >
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Content */}
      <div className="container mx-auto px-4 md:px-6 py-8 md:py-12 max-w-5xl">
        {/* Welcome */}
        <div className="mb-8">
          <h1 className="text-xl md:text-3xl font-montserrat font-black text-white uppercase tracking-[2px]">
            Welcome back, <span className="text-[#f4a100]">{firstName}</span>
          </h1>
          <p className="text-[#888] text-sm mt-2">Manage your website and settings</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#f4a100] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : activeSite ? (
          <>
            {/* Site Overview Card */}
            <div className="bg-[#1a1a1a] border border-white/10 rounded-lg overflow-hidden mb-8">
              <div className="grid md:grid-cols-2">
                {/* Left: Site Preview */}
                <div className="border-b md:border-b-0 md:border-r border-white/10 p-4 md:p-6">
                  <div className="bg-[#0d0d0d] border border-white/5 rounded overflow-hidden aspect-video">
                    {activeSite.deployedUrl ? (
                      <iframe
                        src={activeSite.deployedUrl}
                        title="Site Preview"
                        className="w-full h-full pointer-events-none"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center">
                        <svg className="w-12 h-12 text-[#333] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                        </svg>
                        <span className="text-[#555] text-xs">Not yet published</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Site Details */}
                <div className="p-4 md:p-6 flex flex-col justify-center">
                  <div className="flex items-center gap-3 mb-4">
                    <h2 className="text-lg md:text-xl font-montserrat font-black text-white uppercase tracking-[1px]">
                      {activeSite.data.shopName}
                    </h2>
                    {activeSite.deploymentStatus === 'deployed' ? (
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-green-400 bg-green-500/10 border border-green-500/30 px-2 py-0.5 rounded">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        Live
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-yellow-400 bg-yellow-500/10 border border-yellow-500/30 px-2 py-0.5 rounded">
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                        Draft
                      </span>
                    )}
                  </div>

                  {activeSite.deployedUrl && (
                    <a
                      href={activeSite.deployedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-sm mb-4 transition-colors"
                    >
                      {activeSite.deployedUrl}
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  )}

                  <div className="flex items-center gap-1.5 text-[#888] text-xs mb-6">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Last edited {getRelativeTime(activeSite.lastSaved)}
                  </div>

                  <button
                    onClick={() => onEditSite(activeSite)}
                    className="w-full py-3 bg-white hover:bg-gray-100 text-[#1a1a1a] font-montserrat font-black uppercase tracking-[2px] text-xs transition-colors"
                  >
                    Edit Website
                  </button>
                </div>
              </div>
            </div>

            {/* Domain Manager (only for deployed sites) */}
            {activeSite.deploymentStatus === 'deployed' && (
              <DomainManager
                site={activeSite}
                onDomainPurchased={handleDomainPurchased}
              />
            )}

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
              <div className="bg-[#1a1a1a] border border-white/10 rounded-lg p-5">
                <div className="flex items-center gap-2 mb-2">
                  <svg className={`w-4 h-4 ${activeSite.deploymentStatus === 'deployed' ? 'text-green-500' : 'text-yellow-500'}`} fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                  <span className="text-[10px] text-[#888] font-bold uppercase tracking-wider">Site Status</span>
                </div>
                <p className="text-white font-bold text-lg capitalize">
                  {activeSite.deploymentStatus === 'deployed' ? 'Live' : 'Draft'}
                </p>
              </div>

              <div className="bg-[#1a1a1a] border border-white/10 rounded-lg p-5">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-[#f4a100]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span className="text-[10px] text-[#888] font-bold uppercase tracking-wider">Support</span>
                </div>
                <p className="text-[#999] text-xs mb-1">Questions / Support / Cancellations</p>
                <a href="mailto:Ibrahim3709@gmail.com" className="text-blue-400 hover:text-blue-300 text-sm transition-colors">
                  Ibrahim3709@gmail.com
                </a>
              </div>

              <div className="bg-[#1a1a1a] border border-white/10 rounded-lg p-5">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-[#f4a100]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-[10px] text-[#888] font-bold uppercase tracking-wider">Last Published</span>
                </div>
                <p className="text-white font-bold text-lg">
                  {activeSite.deploymentStatus === 'deployed'
                    ? getRelativeTime(activeSite.lastSaved)
                    : 'Not yet published'
                  }
                </p>
              </div>
            </div>
          </>
        ) : (
          /* No sites */
          <div className="text-center py-20">
            <svg className="w-16 h-16 text-[#333] mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            <h3 className="text-white font-bold text-lg mb-2">No sites yet</h3>
            <p className="text-[#888] text-sm mb-6">Create your first barbershop website to get started.</p>
            <button
              onClick={onCreateNewSite}
              className="py-3 px-8 bg-[#f4a100] text-[#1a1a1a] font-montserrat font-black uppercase tracking-[2px] text-xs hover:bg-white transition-colors"
            >
              Create Website
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
