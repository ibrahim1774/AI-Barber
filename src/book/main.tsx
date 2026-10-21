import React from 'react';
import { createRoot } from 'react-dom/client';
import './book.css';
import { App } from './App';
import { createApi } from './api';

async function boot() {
  let api = createApi();
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('mock')) {
    const { mockFetch } = await import('./mock');
    api = createApi(mockFetch);
  }
  createRoot(document.getElementById('root')!).render(<App api={api} pathname={location.pathname} search={location.search} />);
}
boot();
