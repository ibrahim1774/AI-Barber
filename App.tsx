
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
      const data = await generateContent(inputs);
      setGeneratedData(data);
      setState('generated');
    } catch (error: any) {
      console.error("Website generation failed:", error);
      alert(`Generation Error: ${error.message || "An unexpected error occurred. Please try again."}`);
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
