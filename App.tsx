
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
      // Direct check for API_KEY to provide better onboarding for new deployments
      if (!process.env.API_KEY && !window.aistudio) {
        throw new Error("Configuration Missing: API_KEY environment variable not found. Please add 'API_KEY' in your Vercel Dashboard -> Settings -> Environment Variables and redeploy.");
      }

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

      // Targeted alerts for deployment configuration issues
      if (msg.includes("Configuration Missing")) {
        alert(msg);
      } else if (msg.includes("API key not valid") || error.status === 403) {
        alert("The API Key in your project settings appears to be invalid. Please verify it in the Google AI Studio dashboard.");
      } else {
        alert(`Generation Error: ${msg || "An unknown error occurred. Please try again later."}`);
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