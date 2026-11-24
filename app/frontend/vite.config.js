import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import bootGuard from '../shared/bootGuardPlugin.mjs'

// FX-113: jspdf's output('pdfobjectnewwindow') loads pdfobject from cdnjs; Inspire only uses
// output('arraybuffer'), and the offline gate refuses any outside host, so drop that URL.
const PDFOBJECT_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdfobject/2.1.1/pdfobject.min.js'
const jspdfOffline = () => ({
  name: 'jspdf-offline',
  transform(code, id) {
    if (!/[\\/]node_modules[\\/]jspdf[\\/]/.test(id) || !code.includes('cdnjs.cloudflare.com')) return null
    const out = code.split(PDFOBJECT_CDN).join('')
    if (out.includes('cdnjs.cloudflare.com')) throw new Error(`jspdf-offline: ${id} names a cdnjs URL this plugin does not know`)
    return { code: out, map: null }
  }
})

export default defineConfig({
  plugins: [react(), tailwindcss(), bootGuard(), jspdfOffline()],
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
