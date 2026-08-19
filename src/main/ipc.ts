import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { LibraryData, Settings } from '../shared/types'
import { isScanning, scan, trackId, vacuum } from './library'
import { audioUrl, coverUrl } from './protocol'
import { library, paths, settings } from './store'
import { checkNow, getUpdateState, installNow } from './updater'

export function registerIpc(win: () => BrowserWindow | null): void {
  ipcMain.handle('lib:get', (): LibraryData => library.get())

  ipcMain.handle('lib:addRoot', async () => {
    const w = win()
    if (!w) return null
    const res = await dialog.showOpenDialog(w, {
      title: 'Choisir un dossier de musique',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    const root = res.filePaths[0]
    const data = library.get()
    if (!data.roots.includes(root)) {
      library.set({ ...data, roots: [...data.roots, root] })
      await library.flush()
    }
    return root
  })

  ipcMain.handle('lib:removeRoot', async (_e, root: string) => {
    const data = library.get()
    library.set({
      ...data,
      roots: data.roots.filter((r) => r !== root),
      tracks: data.tracks.filter((t) => t.root !== root)
    })
    await library.flush()
    void vacuum()
    return library.get()
  })

  ipcMain.handle('lib:scan', async (e) => {
    if (isScanning()) return library.get().tracks
    const tracks = await scan((p) => {
      if (!e.sender.isDestroyed()) e.sender.send('lib:scanProgress', p)
    })
    void vacuum()
    return tracks
  })

  ipcMain.handle('lib:updateTrack', (_e, id: string, patch: Record<string, unknown>) => {
    // Seuls les champs "état d'écoute" sont modifiables depuis l'interface.
    const allowed = new Set(['playCount', 'lastPlayedAt', 'rating'])
    const data = library.get()
    const tracks = data.tracks.map((t) => {
      if (t.id !== id) return t
      const safe: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(patch)) if (allowed.has(k)) safe[k] = v
      return { ...t, ...safe }
    })
    library.set({ ...data, tracks })
  })

  ipcMain.handle('pl:save', (_e, playlists: LibraryData['playlists']) => {
    const data = library.get()
    const valid = new Set(data.tracks.map((t) => t.id))
    library.set({
      ...data,
      playlists: playlists.map((p) => ({ ...p, trackIds: p.trackIds.filter((id) => valid.has(id)) }))
    })
  })

  ipcMain.handle('settings:get', (): Settings => settings.get())
  ipcMain.handle('settings:set', (_e, next: Settings) => settings.set(next))

  ipcMain.handle('url:audio', (_e, path: string) => audioUrl(path))
  ipcMain.handle('url:cover', (_e, key: string) => coverUrl(key))

  // Cache des formes d'onde — calculées dans le renderer, persistées ici.
  ipcMain.handle('peaks:read', async (_e, id: string): Promise<ArrayBuffer | null> => {
    if (!/^[a-f0-9]{20}$/.test(id)) return null
    try {
      const buf = await fs.readFile(join(paths.peaks(), `${id}.peaks`))
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    } catch {
      return null
    }
  })
  ipcMain.handle('peaks:write', async (_e, id: string, data: ArrayBuffer) => {
    if (!/^[a-f0-9]{20}$/.test(id)) return
    if (data.byteLength > 4_000_000) return
    await fs.writeFile(join(paths.peaks(), `${id}.peaks`), Buffer.from(data))
  })

  ipcMain.handle('track:reveal', (_e, path: string) => {
    if (library.get().tracks.some((t) => t.path === path)) shell.showItemInFolder(path)
  })
  ipcMain.handle('track:idForPath', (_e, path: string) => trackId(path))

  ipcMain.handle('update:state', () => getUpdateState())
  ipcMain.handle('update:install', () => installNow())
  ipcMain.handle('update:check', () => checkNow(true))
  ipcMain.handle('update:openUrl', (_e, url: string) => {
    if (/^https:\/\/github\.com\//.test(url)) void shell.openExternal(url)
  })

  ipcMain.handle('app:version', () => process.env.npm_package_version ?? require('electron').app.getVersion())
}
