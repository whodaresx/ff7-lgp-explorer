import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const host = process.env.TAURI_DEV_HOST
const isTauri = process.env.TAURI_ENV_PLATFORM !== undefined

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Only set base path for web builds (GitHub Pages)
  base: isTauri ? '/' : '/ff7-lgp-explorer/',

  // Tauri-specific dev server settings
  clearScreen: false,
  server: {
    port: isTauri ? 1420 : 5173,
    strictPort: isTauri,
    host: host || (isTauri ? false : '0.0.0.0'),
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },

  // Define platform detection at build time
  define: {
    __TAURI_BUILD__: JSON.stringify(isTauri),
  },
})
