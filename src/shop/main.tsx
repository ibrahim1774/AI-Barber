import React from 'react';
import { createRoot } from 'react-dom/client';
import './shop.css';
import '../site/look.css';
import { App } from './App';
import { createShopApi } from './api';

async function boot() {
  let api = createShopApi();
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('mock')) {
    const { mockFetch } = await import('./mock');
    api = createShopApi(mockFetch);
  }
  createRoot(document.getElementById('root')!).render(<App api={api} pathname={location.pathname} search={location.search} />);
}
boot();
