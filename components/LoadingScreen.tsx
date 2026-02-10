
import React, { useState, useEffect } from 'react';
import { ScissorsIcon } from './Icons';

export const LoadingScreen: React.FC = () => {
  const [progress, setProgress] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);

  const messages = [
    "Sharpening the blades...",
    "Designing luxury layouts...",
    "Generating premium AI imagery (2/2)...",
    "Crafting custom descriptions...",
    "Clipping the final code...",
    "Styling your unique identity...",
    "Preparing the barber chair...",
    "Applying high-end filters...",
    "Ensuring pixel-perfect results..."
  ];

  useEffect(() => {
    // Total time around 10 seconds given 2 images + text
    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(timer);
          return 100;
        }
        return prev + 1;
      });
    }, 100);

    const messageTimer = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % messages.length);
    }, 2500);

    return () => {
      clearInterval(timer);
      clearInterval(messageTimer);
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-[#0d0d0d] flex flex-col items-center justify-center z-[100] px-6">
      <div className="mb-8 animate-bounce">
        <ScissorsIcon className="w-16 h-16 text-[#f4a100]" />
      </div>
      
      <h2 className="text-2xl font-montserrat font-black uppercase tracking-[4px] mb-4 text-center">
        PRIME <span className="text-[#f4a100]">BARBER</span> AI
      </h2>
      
      <p className="text-[#f4a100] mb-8 animate-pulse text-xs uppercase tracking-[3px] h-6 text-center">
        {messages[messageIndex]}
      </p>

      <div className="w-full max-w-md h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden mb-4">
        <div 
          className="h-full bg-[#f4a100] transition-all duration-300 ease-out shadow-[0_0_15px_rgba(244,161,0,0.5)]"
          style={{ width: `${progress}%` }}
        />
      </div>
      
      <div className="text-white/40 font-mono text-xs tracking-widest">
        GENERATING LUXURY ASSETS: {progress}%
      </div>
    </div>
  );
};
