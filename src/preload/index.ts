import { contextBridge, ipcRenderer } from 'electron'
import type { LibraryData, Playlist, ScanProgress, Settings, Track, UpdateState } from '../shared/types'

const api = {
  library: {
    get: (): Promise<LibraryData> => ipcRenderer.invoke('lib:get'),
    addRoot: (): Promise<string | null> => ipcRenderer.invoke('lib:addRoot'),
    removeRoot: (root: string): Promise<LibraryData> => ipcRenderer.invoke('lib:removeRoot', root),
    scan: (): Promise<Track[]> => ipcRenderer.invoke('lib:scan'),
    onScanProgress: (cb: (p: ScanProgress) => void): (() => void) => {
      const handler = (_: unknown, p: ScanProgress): void => cb(p)
      ipcRenderer.on('lib:scanProgress', handler)
      return () => ipcRenderer.removeListener('lib:scanProgress', handler)
    },
    updateTrack: (id: string, patch: Partial<Pick<Track, 'playCount' | 'lastPlayedAt' | 'rating'>>): Promise<void> =>
      ipcRenderer.invoke('lib:updateTrack', id, patch)
  },
  playlists: {
    save: (playlists: Playlist[]): Promise<void> => ipcRenderer.invoke('pl:save', playlists)
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (s: Settings): Promise<void> => ipcRenderer.invoke('settings:set', s)
  },
  url: {
    audio: (path: string): Promise<string> => ipcRenderer.invoke('url:audio', path),
    cover: (key: string): Promise<string> => ipcRenderer.invoke('url:cover', key)
  },
  peaks: {
    read: (id: string): Promise<ArrayBuffer | null> => ipcRenderer.invoke('peaks:read', id),
    write: (id: string, data: ArrayBuffer): Promise<void> => ipcRenderer.invoke('peaks:write', id, data)
  },
  track: {
    reveal: (path: string): Promise<void> => ipcRenderer.invoke('track:reveal', path)
  },
  update: {
    state: (): Promise<UpdateState> => ipcRenderer.invoke('update:state'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    check: (): Promise<void> => ipcRenderer.invoke('update:check'),
    openUrl: (url: string): Promise<void> => ipcRenderer.invoke('update:openUrl', url),
    onState: (cb: (s: UpdateState) => void): (() => void) => {
      const handler = (_: unknown, s: UpdateState): void => cb(s)
      ipcRenderer.on('update:state', handler)
      return () => ipcRenderer.removeListener('update:state', handler)
    }
  },
  app: {
    version: (): Promise<string> => ipcRenderer.invoke('app:version')
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('tl', api)
