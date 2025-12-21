import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

const host = process.env.TAURI_DEV_HOST
const isTauri = process.env.TAURI_ENV_PLATFORM !== undefined

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Only set base path for web builds (GitHub Pages)
  base: isTauri ? '/' : (process.env.BASE_URL || '/ff7-lgp-explorer/'),

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
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
