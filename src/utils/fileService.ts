/**
 * Platform-agnostic file operations
 * Abstracts file I/O for both web and Tauri
 */

import { isTauri } from './platform'

// Lazy-loaded Tauri modules (avoid import errors on web)
let tauriDialog: typeof import('@tauri-apps/plugin-dialog') | null = null
let tauriFs: typeof import('@tauri-apps/plugin-fs') | null = null

async function getTauriDialog() {
  if (!tauriDialog) {
    tauriDialog = await import('@tauri-apps/plugin-dialog')
  }
  return tauriDialog
}

async function getTauriFs() {
  if (!tauriFs) {
    tauriFs = await import('@tauri-apps/plugin-fs')
  }
  return tauriFs
}

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface FileOpenResult {
  name: string
  data: ArrayBuffer
  path?: string // Only available in Tauri
}

export interface FileSaveOptions {
  defaultName?: string
  filters?: FileFilter[]
}

/**
 * Open a file using native dialog (Tauri) or file input (web)
 */
export async function openFile(
  filters?: FileFilter[]
): Promise<FileOpenResult | null> {
  if (isTauri()) {
    const dialog = await getTauriDialog()
    const fs = await getTauriFs()

    const path = await dialog.open({
      multiple: false,
      filters: filters || [{ name: 'LGP Archive', extensions: ['lgp'] }],
    })

    if (!path || Array.isArray(path)) return null

    const data = await fs.readFile(path)
    const name = path.split(/[/\\]/).pop() || 'archive.lgp'

    return { name, data: data.buffer as ArrayBuffer, path }
  } else {
    // Web: use file input
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      if (filters && filters.length > 0) {
        input.accept = filters
          .flatMap((f) => f.extensions.map((e) => `.${e}`))
          .join(',')
      }
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) {
          resolve(null)
          return
        }
        const data = await file.arrayBuffer()
        resolve({ name: file.name, data })
      }
      input.click()
    })
  }
}

/**
 * Save a file using native dialog (Tauri) or download (web)
 */
export async function saveFile(
  data: ArrayBuffer | Uint8Array,
  options?: FileSaveOptions
): Promise<boolean> {
  if (isTauri()) {
    const dialog = await getTauriDialog()
    const fs = await getTauriFs()

    const path = await dialog.save({
      defaultPath: options?.defaultName,
      filters: options?.filters || [
        { name: 'LGP Archive', extensions: ['lgp'] },
      ],
    })

    if (!path) return false

    const uint8Data = data instanceof Uint8Array ? data : new Uint8Array(data)
    await fs.writeFile(path, uint8Data)
    return true
  } else {
    // Web: blob download
    const blob = new Blob([data], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = options?.defaultName || 'archive.lgp'
    a.click()
    URL.revokeObjectURL(url)
    return true
  }
}

/**
 * Extract single file
 */
export async function extractSingleFile(
  data: Uint8Array,
  filename: string,
  mimeType?: string
): Promise<boolean> {
  if (isTauri()) {
    const dialog = await getTauriDialog()
    const fs = await getTauriFs()

    const path = await dialog.save({
      defaultPath: filename,
    })

    if (!path) return false

    await fs.writeFile(path, data)
    return true
  } else {
    // Web: blob download
    const blob = new Blob([data], {
      type: mimeType || 'application/octet-stream',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    return true
  }
}

/**
 * Extract multiple files
 * On Tauri: native folder picker + direct writes
 * On web: JSZip + download
 */
export async function extractMultipleFiles(
  files: Array<{ filename: string; data: Uint8Array }>,
  archiveName: string
): Promise<boolean> {
  if (isTauri()) {
    const dialog = await getTauriDialog()
    const fs = await getTauriFs()

    // Open folder picker
    const folder = await dialog.open({
      directory: true,
      title: 'Select extraction folder',
    })

    if (!folder || Array.isArray(folder)) return false

    // Write each file directly
    for (const file of files) {
      const filePath = `${folder}/${file.filename}`
      await fs.writeFile(filePath, file.data)
    }

    return true
  } else {
    // Web: use JSZip
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()

    for (const file of files) {
      zip.file(file.filename, file.data)
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(zipBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${archiveName.replace('.lgp', '')}_extract.zip`
    a.click()
    URL.revokeObjectURL(url)
    return true
  }
}

/**
 * Open file for replace operation (any file type)
 */
export async function openFileForReplace(): Promise<{
  name: string
  data: Uint8Array
} | null> {
  if (isTauri()) {
    const dialog = await getTauriDialog()
    const fs = await getTauriFs()

    const path = await dialog.open({
      multiple: false,
    })

    if (!path || Array.isArray(path)) return null

    const data = await fs.readFile(path)
    const name = path.split(/[/\\]/).pop() || 'file'

    return { name, data }
  } else {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) {
          resolve(null)
          return
        }
        const data = new Uint8Array(await file.arrayBuffer())
        resolve({ name: file.name, data })
      }
      input.click()
    })
  }
}

/**
 * Open multiple files for add/insert operation
 */
export async function openFilesForAdd(): Promise<Array<{
  name: string
  data: Uint8Array
}> | null> {
  if (isTauri()) {
    const dialog = await getTauriDialog()
    const fs = await getTauriFs()

    const paths = await dialog.open({
      multiple: true,
    })

    if (!paths || !Array.isArray(paths) || paths.length === 0) return null

    const results: Array<{ name: string; data: Uint8Array }> = []
    for (const path of paths) {
      const data = await fs.readFile(path)
      const name = path.split(/[/\\]/).pop() || 'file'
      results.push({ name, data })
    }

    return results
  } else {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.onchange = async (e) => {
        const files = (e.target as HTMLInputElement).files
        if (!files || files.length === 0) {
          resolve(null)
          return
        }

        const results: Array<{ name: string; data: Uint8Array }> = []
        for (const file of Array.from(files)) {
          const data = new Uint8Array(await file.arrayBuffer())
          results.push({ name: file.name, data })
        }
        resolve(results)
      }
      input.click()
    })
  }
}
