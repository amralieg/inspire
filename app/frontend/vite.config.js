import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import bootGuard from '../shared/bootGuardPlugin.mjs'

export default defineConfig({
  plugins: [react(), tailwindcss(), bootGuard()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
    // FX-113: jspdf's doc.html() deps are never used; ship neither chunk (see jspdfHtmlStub.js).
    alias: {
      html2canvas: fileURLToPath(new URL('./src/lib/docgen/jspdfHtmlStub.js', import.meta.url)),
      dompurify: fileURLToPath(new URL('./src/lib/docgen/jspdfHtmlStub.js', import.meta.url))
    }
  },
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(fileURLToPath(new URL('.', import.meta.url))), fileURLToPath(new URL('../agent/agent/app_shell', import.meta.url))]
    },
    proxy: {
      '/api': 'http://localhost:8080'
    }
  },
  // `vite preview` does not use `server.proxy` — without this, POST /api/* hits Vite and returns "Cannot POST /api/..."
  preview: {
    proxy: {
      '/api': 'http://localhost:8080'
    }
  }
})
