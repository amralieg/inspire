import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
