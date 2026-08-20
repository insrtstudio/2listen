import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode
} from 'react'
import type { Playlist, ScanProgress, Settings, TagEdit, Track, UpdateState } from '@shared/types'
import { player } from './player'

export type View =
  | { kind: 'tracks' }
  | { kind: 'albums' }
  | { kind: 'artists' }
  | { kind: 'album'; artist: string; album: string }
  | { kind: 'artist'; artist: string }
  | { kind: 'playlist'; id: string }
  | { kind: 'compare' }
  | { kind: 'mix' }

interface Store {
  tracks: Track[]
  roots: string[]
  excludedCount: number
  playlists: Playlist[]
  scan: ScanProgress
  settings: Settings
  update: UpdateState
  view: View
  search: string
  version: string
  setView: (v: View) => void
  setSearch: (s: string) => void
  addRoot: () => Promise<void>
  addFiles: () => Promise<void>
  addPaths: (paths: string[]) => Promise<void>
  removeTracks: (ids: string[]) => Promise<void>
  restoreExcluded: () => Promise<void>
  removeRoot: (root: string) => Promise<void>
  rescan: () => Promise<void>
  patchSettings: (patch: Partial<Settings>) => void
  createPlaylist: (name: string) => string
  renamePlaylist: (id: string, name: string) => void
  deletePlaylist: (id: string) => void
  addToPlaylist: (id: string, trackIds: string[]) => void
  removeFromPlaylist: (id: string, trackIds: string[]) => void
  movePlaylistTrack: (id: string, from: number, to: number) => void
  setRating: (trackId: string, rating: number) => void
  applyTagEdits: (trackId: string, patch: TagEdit) => Promise<void>
}

const Ctx = createContext<Store | null>(null)

const idleScan: ScanProgress = { phase: 'idle', found: 0, done: 0, total: 0, current: '' }

const newId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 20)

export function StoreProvider({ children }: { children: ReactNode }): ReactNode {
  const [tracks, setTracks] = useState<Track[]>([])
  const [roots, setRoots] = useState<string[]>([])
  const [excludedCount, setExcludedCount] = useState(0)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [scan, setScan] = useState<ScanProgress>(idleScan)
  const [settings, setSettings] = useState<Settings>({
    volume: 0.85, repeat: 'off', shuffle: false, theme: 'light',
    lastTrackId: null, matchSampleRate: true, gapless: true,
    compareA: null, compareB: null
  })
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' })
  const [view, setView] = useState<View>({ kind: 'tracks' })
  const [search, setSearch] = useState('')
  const [version, setVersion] = useState('')
  const loaded = useRef(false)

  useEffect(() => {
    void (async () => {
      const [lib, st, up, ver] = await Promise.all([
        window.tl.library.get(),
        window.tl.settings.get(),
        window.tl.update.state(),
        window.tl.app.version()
      ])
      setTracks(lib.tracks)
      setRoots(lib.roots)
      setExcludedCount(lib.excluded?.length ?? 0)
      setPlaylists(lib.playlists)
      setSettings(st)
      setUpdate(up)
      setVersion(ver)
      player.setVolume(st.volume)
      player.setRepeat(st.repeat)
      player.setShuffle(st.shuffle)
      loaded.current = true
      // Un rescan silencieux au lancement récupère les fichiers ajoutés hors app.
      if (lib.roots.length > 0 || (lib.files?.length ?? 0) > 0) {
        const fresh = await window.tl.library.scan()
        setTracks(fresh)
      }
    })()
    const offScan = window.tl.library.onScanProgress(setScan)
    const offUpdate = window.tl.update.onState(setUpdate)
    return () => {
      offScan()
      offUpdate()
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      if (loaded.current) void window.tl.settings.set(next)
      if (patch.volume !== undefined) player.setVolume(patch.volume)
      if (patch.repeat !== undefined) player.setRepeat(patch.repeat)
      if (patch.shuffle !== undefined) player.setShuffle(patch.shuffle)
      return next
    })
  }, [])

  // Mises à jour fonctionnelles : deux actions enchaînées dans le même tick
  // (créer une playlist puis y ajouter des pistes) voient chacune l'état frais.
  const persistPlaylists = useCallback((updater: (prev: Playlist[]) => Playlist[]) => {
    setPlaylists((prev) => {
      const next = updater(prev)
      void window.tl.playlists.save(next)
      return next
    })
  }, [])

  const addRoot = useCallback(async () => {
    const root = await window.tl.library.addRoot()
    if (!root) return
    setRoots((r) => (r.includes(root) ? r : [...r, root]))
    const fresh = await window.tl.library.scan()
    setTracks(fresh)
  }, [])

  const addFiles = useCallback(async () => {
    const added = await window.tl.library.addFiles()
    if (added.length === 0) return
    const fresh = await window.tl.library.scan()
    setTracks(fresh)
  }, [])

  const addPaths = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return
    const fresh = await window.tl.dnd.addPaths(paths)
    setTracks(fresh)
  }, [])

  const removeTracks = useCallback(async (ids: string[]) => {
    const lib = await window.tl.library.removeTracks(ids)
    setTracks(lib.tracks)
    setPlaylists(lib.playlists)
    setExcludedCount(lib.excluded.length)
  }, [])

  const restoreExcluded = useCallback(async () => {
    const fresh = await window.tl.library.restoreExcluded()
    setTracks(fresh)
    setExcludedCount(0)
  }, [])

  const removeRoot = useCallback(async (root: string) => {
    const lib = await window.tl.library.removeRoot(root)
    setRoots(lib.roots)
    setTracks(lib.tracks)
    setPlaylists(lib.playlists)
  }, [])

  const rescan = useCallback(async () => {
    const fresh = await window.tl.library.scan()
    setTracks(fresh)
  }, [])

  const createPlaylist = useCallback((name: string): string => {
    const id = newId()
    const now = Date.now()
    persistPlaylists((prev) => [...prev, { id, name: name.trim() || 'Playlist', trackIds: [], createdAt: now, updatedAt: now }])
    return id
  }, [persistPlaylists])

  const renamePlaylist = useCallback((id: string, name: string) => {
    persistPlaylists((prev) => prev.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name, updatedAt: Date.now() } : p)))
  }, [persistPlaylists])

  const deletePlaylist = useCallback((id: string) => {
    persistPlaylists((prev) => prev.filter((p) => p.id !== id))
    setView((v) => (v.kind === 'playlist' && v.id === id ? { kind: 'tracks' } : v))
  }, [persistPlaylists])

  const addToPlaylist = useCallback((id: string, trackIds: string[]) => {
    persistPlaylists((prev) => prev.map((p) => {
      if (p.id !== id) return p
      const have = new Set(p.trackIds)
      const added = trackIds.filter((t) => !have.has(t))
      return added.length ? { ...p, trackIds: [...p.trackIds, ...added], updatedAt: Date.now() } : p
    }))
  }, [persistPlaylists])

  const removeFromPlaylist = useCallback((id: string, trackIds: string[]) => {
    const drop = new Set(trackIds)
    persistPlaylists((prev) => prev.map((p) =>
      p.id === id ? { ...p, trackIds: p.trackIds.filter((t) => !drop.has(t)), updatedAt: Date.now() } : p
    ))
  }, [persistPlaylists])

  const movePlaylistTrack = useCallback((id: string, from: number, to: number) => {
    persistPlaylists((prev) => prev.map((p) => {
      if (p.id !== id) return p
      const ids = [...p.trackIds]
      const [moved] = ids.splice(from, 1)
      ids.splice(to, 0, moved)
      return { ...p, trackIds: ids, updatedAt: Date.now() }
    }))
  }, [persistPlaylists])

  const applyTagEdits = useCallback(async (trackId: string, patch: TagEdit) => {
    const fresh = await window.tl.library.editTags(trackId, patch)
    setTracks(fresh)
  }, [])

  const setRating = useCallback((trackId: string, rating: number) => {
    setTracks((ts) => ts.map((t) => (t.id === trackId ? { ...t, rating } : t)))
    void window.tl.library.updateTrack(trackId, { rating })
  }, [])

  const value = useMemo<Store>(() => ({
    tracks, roots, excludedCount, playlists, scan, settings, update, view, search, version,
    setView, setSearch, addRoot, addFiles, addPaths, removeTracks, restoreExcluded, removeRoot, rescan, patchSettings,
    createPlaylist, renamePlaylist, deletePlaylist, addToPlaylist,
    removeFromPlaylist, movePlaylistTrack, setRating, applyTagEdits
  }), [tracks, roots, excludedCount, playlists, scan, settings, update, view, search, version,
    addRoot, addFiles, addPaths, removeTracks, restoreExcluded, removeRoot, rescan, patchSettings, createPlaylist, renamePlaylist,
    deletePlaylist, addToPlaylist, removeFromPlaylist, movePlaylistTrack, setRating, applyTagEdits])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const store = useContext(Ctx)
  if (!store) throw new Error('useStore hors StoreProvider')
  return store
}
