import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { msw } from 'msw/vite'

export default defineConfig({
  cacheDir: process.env.ZURASHITABI_VITE_CACHE_DIR,
  plugins: [react(), msw()],
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react-router-dom', '@tanstack/react-query'] },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
})
