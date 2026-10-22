// The booking and shop pages (book.html, shop.html) as their own build, under /_ab/.
//
// They are served on aibarber.org (/book/{slug}, /shop/{slug} -> /_ab/*.html in vercel.json)
// AND, through each barber site's rewrites (lib/siteSubpages.ts), on the barber's own domain at
// /book and /shop. Every asset URL is /_ab/assets/..., the one asset path a barber site
// proxies, so these pages can't collide with anything on a barber site. Built after the main
// build into dist/_ab (npm run build runs both).
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export const SUBPAGES_BASE = '/_ab/';

export default defineConfig({
  base: SUBPAGES_BASE,
  plugins: [react()],
  // public/ (privacy.html etc.) belongs to the main build only.
  publicDir: false,
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  build: {
    outDir: 'dist/_ab',
    // dist/ already holds the main build.
    emptyOutDir: false,
    rollupOptions: {
      input: {
        book: path.resolve(__dirname, 'book.html'),
        shop: path.resolve(__dirname, 'shop.html'),
      },
      output: {
        manualChunks: { 'vendor-react': ['react', 'react-dom'] },
        // [name]-[hash].js|css, no dots but the extension: the only file names barber sites
        // proxy (lib/siteSubpages.ts SUBPAGE_ASSET_FILE). Shared chunks are named by hash only.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: (c) => (c.name === 'vendor-react' ? 'assets/vendor-react-[hash].js' : 'assets/chunk-[hash].js'),
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
