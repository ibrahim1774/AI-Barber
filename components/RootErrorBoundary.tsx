import React from 'react';

/*
 * Root error boundary. Every screen is a React.lazy chunk inside
 * <Suspense fallback={null}> — after a Vercel redeploy, a tab holding a
 * stale index.html 404s on the old hashed chunk URLs, the dynamic import
 * throws during render, and with no boundary the app went permanently
 * blank. This catches ANY render/chunk error and offers a reload (which
 * fetches the fresh index.html + chunks).
 */

interface State {
  hasError: boolean;
}

export class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('[RootErrorBoundary]', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0a',
          color: '#fff',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>
            Something went wrong loading the page
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 15, marginBottom: 20 }}>
            This usually happens after we ship an update. Reloading fixes it —
            your website and account are safe.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#fff',
              color: '#000',
              fontWeight: 700,
              fontSize: 15,
              padding: '12px 28px',
              borderRadius: 10,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}

export default RootErrorBoundary;
