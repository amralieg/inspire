import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const FONT_LICENSES = { inter: '@fontsource-variable/inter/LICENSE', newsreader: '@fontsource-variable/newsreader/LICENSE' };

const fontLicenses = () => ({
  name: 'font-licenses',
  generateBundle() {
    for (const [family, file] of Object.entries(FONT_LICENSES)) {
      this.emitFile({ type: 'asset', fileName: `assets/fonts/${family}-LICENSE`, source: readFileSync(new URL(`./node_modules/${file}`, import.meta.url)) });
    }
  },
});

const assetName = (asset) => ((asset.names || [asset.name]).some((name) => String(name).endsWith('.woff2')) ? 'assets/fonts/[name][extname]' : 'assets/[name][extname]');

export default defineConfig({
  plugins: [react(), fontLicenses()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { entryFileNames: 'assets/app.js', chunkFileNames: 'assets/[name].js', assetFileNames: assetName } },
  },
});
