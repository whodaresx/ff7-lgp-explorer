/**
 * Auto-updater for Tauri desktop app
 * No-op on web
 */

import { isTauri } from './platform'

export interface UpdateInfo {
  version: string
  date?: string
  body?: string
}

let updateModule: typeof import('@tauri-apps/plugin-updater') | null = null

async function getUpdateModule() {
  if (!updateModule && isTauri()) {
    updateModule = await import('@tauri-apps/plugin-updater')
  }
  return updateModule
}

/**
 * Check for available updates
 * Returns null on web or if no update available
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri()) return null

  try {
    const updater = await getUpdateModule()
    if (!updater) return null

    const update = await updater.check()
    if (!update) return null

    return {
      version: update.version,
      date: update.date?.toString(),
      body: update.body || undefined,
    }
  } catch (error) {
    console.error('Update check failed:', error)
    return null
  }
}

/**
 * Download and install update
 */
export async function installUpdate(
  onProgress?: (downloaded: number, total: number | null) => void
): Promise<boolean> {
  if (!isTauri()) return false

  try {
    const updater = await getUpdateModule()
    if (!updater) return false

    const update = await updater.check()
    if (!update) return false

    let downloaded = 0
    await update.downloadAndInstall((event) => {
      if (event.event === 'Progress' && onProgress) {
        downloaded += event.data.chunkLength
        onProgress(downloaded, event.data.contentLength || null)
      }
    })

    // Relaunch will be triggered automatically
    return true
  } catch (error) {
    console.error('Update installation failed:', error)
    return false
  }
}
