
import React, { useState } from 'react';
import { AppState, ShopInputs, WebsiteData } from './types.ts';
import { Dashboard } from './components/Dashboard.tsx';
import { LoadingScreen } from './components/LoadingScreen.tsx';
import { GeneratedWebsite } from './components/GeneratedWebsite.tsx';
import { generateContent } from './services/geminiService.ts';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>('dashboard');
  const [generatedData, setGeneratedData] = useState<WebsiteData | null>(null);

  const handleGenerate = async (inputs: ShopInputs) => {
    setState('loading');
    try {
      // Attempt generation. If process.env.API_KEY is missing or invalid, 
      // the error will be caught in the block below.
      const data = await generateContent(inputs);
      setGeneratedData(data);
      setState('generated');
    } catch (error: any) {
      console.error("Website generation failed:", error);
      
      const msg = error.message || "";
      
      // Handle the case where a user needs to pick a key via the AI Studio dialog
      if (msg.includes("Requested entity was not found.") && window.aistudio) {
        await window.aistudio.openSelectKey();
        setState('dashboard');
        return;
      }

      // Provide helpful feedback if the API call fails
      if (msg.includes("API key") || error.status === 403 || error.status === 401) {
        alert("Authentication Error: There was an issue with your API Key. If you just added it to Vercel, make sure you redeployed the app so the changes take effect.");
      } else {
        alert(`Generation Error: ${msg || "An unexpected error occurred. Please try again."}`);
      }
      
      setState('dashboard');
    }
  };

  const handleBack = () => {
    setState('dashboard');
    setGeneratedData(null);
  };

  return (
    <div className="min-h-screen bg-[#0d0d0d]">
      {state === 'dashboard' && <Dashboard onGenerate={handleGenerate} />}
      {state === 'loading' && <LoadingScreen />}
      {state === 'generated' && generatedData && (
        <GeneratedWebsite data={generatedData} onBack={handleBack} />
      )}
    </div>
  );
};

export default App;
