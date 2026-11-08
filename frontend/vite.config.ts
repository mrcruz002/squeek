import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The contract ABIs live in ../abi (single source of truth, shared with
    // the Foundry project) and are imported directly from src/abi.ts, so the
    // dev server must be allowed to serve files from the parent directory.
    fs: {
      allow: ['..'],
    },
  },
})
