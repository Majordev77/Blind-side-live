import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  plugins: [react()],
  // Relative paths so the build works from any folder (GitHub Pages, Static Web Apps, a file share).
  base: './',
  // The match data lives in ../data at the repository root.
  server: { fs: { allow: [repoRoot] } },
  test: { environment: 'node' },
})
