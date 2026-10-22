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
        // The booking and shop pages (book.html, shop.html) are a separate build under /_ab/
        // (vite.subpages.config.ts) so they also work on barber domains; npm run build runs both.
        // Split heavy deps into vendor chunks so the browser downloads
        // them in parallel + caches them across deploys. Lucide-react
        // intentionally NOT chunked so tree-shaking strips unused icons.
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'index.html'),
          },
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
