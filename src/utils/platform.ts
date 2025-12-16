/**
 * Platform detection utilities
 * Detects whether running in Tauri desktop or web browser
 */

// Runtime detection - checks if Tauri IPC is available
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  )
}

// Build-time detection (set by Vite define)
declare const __TAURI_BUILD__: boolean
export const IS_TAURI_BUILD =
  typeof __TAURI_BUILD__ !== 'undefined' && __TAURI_BUILD__

// Platform info
export function getPlatformInfo(): { platform: 'web' | 'desktop'; os?: string } {
  if (isTauri()) {
    return { platform: 'desktop' }
  }
  return { platform: 'web' }
}
