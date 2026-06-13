import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        //proxy: {
        //  '/api': {
        //    target: 'http://localhost:3001',
        //    changeOrigin: true,
        //  },
        //},
      },
      plugins: [react()],
      // Treat .html files as static assets — prevents Vite v6's
      // import-analysis plugin from trying to parse index.html as a
      // JS module (which fails on inline <script> closing tags). Does
      // not affect the entry index.html which still goes through
      // Vite's HTML transform pipeline.
      assetsInclude: ['**/*.html'],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        // Split heavy deps into vendor chunks so the browser downloads
        // them in parallel + caches them across deploys. Lucide-react
        // intentionally NOT chunked so tree-shaking strips unused icons.
        rollupOptions: {
          output: {
            manualChunks: {
              'vendor-react': ['react', 'react-dom'],
              'vendor-stripe': ['@stripe/stripe-js', '@stripe/react-stripe-js'],
              'vendor-supabase': ['@supabase/supabase-js'],
            },
          },
        },
      },
    };
});
