
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider } from './contexts/AuthContext.tsx';
import RootErrorBoundary from './components/RootErrorBoundary.tsx';
import PasswordRecoveryModal from './components/PasswordRecoveryModal.tsx';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <RootErrorBoundary>
      <AuthProvider>
        <App />
        <PasswordRecoveryModal />
      </AuthProvider>
    </RootErrorBoundary>
  </React.StrictMode>
);