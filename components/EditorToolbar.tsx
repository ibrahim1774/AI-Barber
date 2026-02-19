import React from 'react';
import { SaveStatus } from '../types';

interface EditorToolbarProps {
  saveStatus: SaveStatus;
  onSave: () => void;
  onPublish: () => void;
  onBack: () => void;
  isPublishing: boolean;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  saveStatus,
  onSave,
  onPublish,
  onBack,
  isPublishing,
}) => {
  return (
    <div className="fixed top-0 left-0 w-full bg-[#111111] border-b border-white/10 py-2.5 md:py-3 px-4 z-[70] flex items-center justify-between">
      {/* Left: Back to Dashboard */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-[#999] hover:text-white text-xs uppercase tracking-wider transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        <span className="hidden sm:inline font-bold">Back to Dashboard</span>
      </button>

      {/* Right: Save status + Save + Publish */}
      <div className="flex items-center gap-3">
        {/* Save Status Badge */}
        <div className="flex items-center gap-1.5">
          {saveStatus === 'idle' && (
            <span className="text-[#666] text-[10px] uppercase tracking-wider font-bold">Editor</span>
          )}
          {saveStatus === 'saving' && (
            <span className="flex items-center gap-1.5 text-blue-400 text-[10px] uppercase tracking-wider font-bold">
              <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Saving
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1.5 text-green-400 text-[10px] uppercase tracking-wider font-bold">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="text-red-400 text-[10px] uppercase tracking-wider font-bold">Save Error</span>
          )}
        </div>

        {/* Save Button */}
        <button
          onClick={onSave}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-[10px] font-black uppercase tracking-wider transition-colors rounded-sm"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
          </svg>
          Save
        </button>

        {/* Publish Button */}
        <button
          onClick={onPublish}
          disabled={isPublishing}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black uppercase tracking-wider transition-colors rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l14 9-14 9V3z" />
          </svg>
          Publish
        </button>
      </div>
    </div>
  );
};
