import { BrowserWindow, app, dialog, ipcMain, screen, shell, systemPreferences } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { LibraryData, Settings, TagEdit } from '../shared/types'
import { isScanning, scan, trackId, vacuum } from './library'
import { AUDIO_EXTENSIONS } from '../shared/types'
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

  ipcMain.handle('lib:addFiles', async () => {
    const w = win()
    if (!w) return []
    const res = await dialog.showOpenDialog(w, {
      title: 'Ajouter des morceaux',
      buttonLabel: 'Ajouter',
      properties: ['openFile', 'multiSelections'],
      // seuls les formats audio gérés sont sélectionnables
      filters: [{ name: 'Audio', extensions: [...AUDIO_EXTENSIONS] }]
    })
    if (res.canceled || res.filePaths.length === 0) return []
    const data = library.get()
    const have = new Set(data.files)
    const added = res.filePaths.filter((f) => !have.has(f))
    library.set({
      ...data,
      files: [...data.files, ...added],
      // ré-ajouter un morceau annule son exclusion éventuelle
      excluded: data.excluded.filter((p) => !res.filePaths.includes(p))
    })
    await library.flush()
    return added
  })

  ipcMain.handle('lib:addPaths', async (_e, paths: string[]) => {
    if (!Array.isArray(paths)) return library.get().tracks
    const exts = new Set<string>(AUDIO_EXTENSIONS as readonly string[])
    const valid: string[] = []
    for (const p of paths.slice(0, 500)) {
      if (typeof p !== 'string') continue
      const ext = p.split('.').pop()?.toLowerCase() ?? ''
      if (!exts.has(ext)) continue
      try {
        const st = await fs.stat(p)
        if (st.isFile()) valid.push(p)
      } catch {
        /* introuvable */
      }
    }
    if (valid.length > 0) {
      const data = library.get()
      const have = new Set(data.files)
      library.set({
        ...data,
        files: [...data.files, ...valid.filter((f) => !have.has(f))],
        excluded: data.excluded.filter((p) => !valid.includes(p))
      })
      await library.flush()
      return scan(() => {})
    }
    return library.get().tracks
  })

  ipcMain.handle('lib:removeTracks', async (_e, ids: string[]) => {
    const drop = new Set(ids)
    const data = library.get()
    const removedPaths = data.tracks.filter((t) => drop.has(t.id)).map((t) => t.path)
    library.set({
      ...data,
      tracks: data.tracks.filter((t) => !drop.has(t.id)),
      files: data.files.filter((f) => !removedPaths.includes(f)),
      // mémorise l'exclusion pour que le prochain scan ne les ré-importe pas
      excluded: [...new Set([...data.excluded, ...removedPaths])],
      playlists: data.playlists.map((p) => ({ ...p, trackIds: p.trackIds.filter((id) => !drop.has(id)) }))
    })
    await library.flush()
    void vacuum()
    return library.get()
  })

  ipcMain.handle('lib:restoreExcluded', async () => {
    const data = library.get()
    library.set({ ...data, excluded: [] })
    await library.flush()
    return scan(() => {})
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

  const applyTagEdits = async (ids: string[], patch: TagEdit): Promise<void> => {
    const allowed = new Set(['title', 'artist', 'albumArtist', 'album', 'genre', 'year', 'cover'])
    const safe: TagEdit = {}
    for (const [k, v] of Object.entries(patch)) {
      if (allowed.has(k)) (safe as Record<string, unknown>)[k] = v
    }
    const want = new Set(ids)
    const data = library.get()
    const edits = { ...(data.edits ?? {}) }
    for (const id of want) edits[id] = { ...(edits[id] ?? {}), ...safe }
    library.set({
      ...data,
      edits,
      tracks: data.tracks.map((t) => (want.has(t.id) ? { ...t, ...safe } : t))
    })
    await library.flush()
  }

  ipcMain.handle('lib:editTags', async (_e, id: string, patch: TagEdit) => {
    await applyTagEdits([id], patch)
    return library.get().tracks
  })

  // Édition groupée : le même correctif appliqué à plusieurs pistes d'un coup.
  ipcMain.handle('lib:editTagsMany', async (_e, ids: string[], patch: TagEdit) => {
    if (Array.isArray(ids) && ids.length > 0) await applyTagEdits(ids.filter((i) => typeof i === 'string'), patch)
    return library.get().tracks
  })

  // pochette personnalisée : image choisie → cache des covers, clé retournée
  ipcMain.handle('cover:pick', async () => {
    const w = win()
    if (!w) return null
    const res = await dialog.showOpenDialog(w, {
      title: 'Choisir une pochette',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    const buf = await fs.readFile(res.filePaths[0])
    if (buf.byteLength > 20_000_000) return null
    const key = `${createHash('sha1').update(buf).digest('hex')}${extname(res.filePaths[0]).toLowerCase() === '.png' ? '.png' : '.jpg'}`
    await fs.writeFile(join(paths.covers(), key), buf)
    return key
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

  // Décodage de secours : les codecs que Chromium ne décode pas hors lecture
  // (ALAC…) passent par CoreAudio via afconvert → WAV float temporaire.
  const execFileP = promisify(execFile)
  ipcMain.handle('audio:wavFallback', async (_e, path: string): Promise<string | null> => {
    const data = library.get()
    const inLibrary =
      data.files.includes(path) || data.tracks.some((t) => t.path === path) || data.roots.some((r) => path.startsWith(r))
    if (!inLibrary) return null
    const out = join(paths.decodeTmp(), `${trackId(path)}.wav`)
    try {
      await fs.access(out)
      return out
    } catch {
      /* à convertir */
    }
    try {
      await execFileP('afconvert', ['-f', 'WAVE', '-d', 'LEF32', path, out], { timeout: 120_000 })
      return out
    } catch (err) {
      console.error('[decode] afconvert a échoué', path, err)
      return null
    }
  })

  // Cache des analyses A/B (JSON), rangé avec les pics.
  ipcMain.handle('analysis:read', async (_e, id: string): Promise<string | null> => {
    if (!/^[a-f0-9]{20}$/.test(id)) return null
    try {
      return await fs.readFile(join(paths.peaks(), `${id}.anal.json`), 'utf8')
    } catch {
      return null
    }
  })
  ipcMain.handle('analysis:write', async (_e, id: string, json: string) => {
    if (!/^[a-f0-9]{20}$/.test(id) || json.length > 500_000) return
    await fs.writeFile(join(paths.peaks(), `${id}.anal.json`), json, 'utf8')
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

  // ---- Mode streamer ------------------------------------------------------
  // Le clip est encodé par MediaRecorder côté renderer ; les morceaux arrivent
  // ici au fil de l'eau et sont écrits dans un fichier temporaire (jamais
  // tout le clip en mémoire). À la fin : dialogue « Enregistrer sous ».
  const clips = new Map<string, { path: string; queue: Promise<void> }>()
  const clipTmpDir = (): string => join(app.getPath('temp'), '2listen-clips')

  ipcMain.handle('clip:start', async (_e, ext: string): Promise<string> => {
    const safeExt = /^[a-z0-9]{2,5}$/i.test(ext) ? ext.toLowerCase() : 'mp4'
    await fs.mkdir(clipTmpDir(), { recursive: true })
    const id = createHash('sha1').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 16)
    const path = join(clipTmpDir(), `clip-${id}.${safeExt}`)
    await fs.writeFile(path, new Uint8Array(0))
    clips.set(id, { path, queue: Promise.resolve() })
    return id
  })

  ipcMain.handle('clip:chunk', (_e, id: string, data: ArrayBuffer): Promise<void> => {
    const clip = clips.get(id)
    if (!clip) return Promise.resolve()
    // écritures sérialisées : l'ordre des morceaux est celui de l'encodeur
    clip.queue = clip.queue.then(() => fs.appendFile(clip.path, new Uint8Array(data)))
    return clip.queue
  })

  ipcMain.handle('clip:cancel', async (_e, id: string) => {
    const clip = clips.get(id)
    if (!clip) return
    clips.delete(id)
    await clip.queue.catch(() => {})
    await fs.rm(clip.path, { force: true })
  })

  ipcMain.handle('clip:finish', async (_e, id: string, suggestedName: string): Promise<string | null> => {
    const clip = clips.get(id)
    if (!clip) return null
    clips.delete(id)
    await clip.queue.catch(() => {})
    const ext = extname(clip.path).slice(1)
    const w = win()
    if (!w) return null
    const name = basename(suggestedName).replace(/[/\\:*?"<>|]+/g, '-').trim() || `clip.${ext}`
    // Tests : TL_CLIP_OUT=/chemin.mp4 exporte sans dialogue.
    if (process.env.TL_CLIP_OUT) {
      await fs.rename(clip.path, process.env.TL_CLIP_OUT)
      return process.env.TL_CLIP_OUT
    }
    let videos = app.getPath('videos')
    try {
      await fs.access(videos)
    } catch {
      videos = app.getPath('home')
    }
    const res = await dialog.showSaveDialog(w, {
      title: 'Exporter le clip',
      defaultPath: join(videos, name.endsWith(`.${ext}`) ? name : `${name}.${ext}`),
      filters: [{ name: ext === 'mp4' ? 'Vidéo MP4' : 'Vidéo WebM', extensions: [ext] }]
    })
    if (res.canceled || !res.filePath) {
      await fs.rm(clip.path, { force: true })
      return null
    }
    try {
      await fs.rename(clip.path, res.filePath)
    } catch {
      // autre volume : copie puis suppression
      await fs.copyFile(clip.path, res.filePath)
      await fs.rm(clip.path, { force: true })
    }
    return res.filePath
  })

  // Autorisation caméra/micro macOS (TCC). Sans effet ailleurs.
  ipcMain.handle('media:access', async (_e, kind: 'camera' | 'microphone'): Promise<boolean> => {
    if (process.platform !== 'darwin') return true
    if (kind !== 'camera' && kind !== 'microphone') return false
    try {
      return await systemPreferences.askForMediaAccess(kind)
    } catch {
      return false
    }
  })

  // La fenêtre épouse le format de la scène (4:5, 1:1, 9:16) + les barres de
  // l'interface (extraH). Bornes et taille mini d'origine restaurées à la sortie.
  let savedBounds: Electron.Rectangle | null = null
  let savedMin: [number, number] | null = null
  ipcMain.handle('win:streamer', (_e, on: boolean, ratio: number, extraH: number) => {
    const w = win()
    if (!w) return
    if (!on) {
      w.setAspectRatio(0)
      if (savedMin) w.setMinimumSize(savedMin[0], savedMin[1])
      if (savedBounds) w.setBounds(savedBounds, true)
      savedBounds = null
      savedMin = null
      return
    }
    if (!savedBounds) {
      savedBounds = w.getBounds()
      const [mw, mh] = w.getMinimumSize()
      savedMin = [mw, mh]
    }
    const r = Math.max(0.3, Math.min(3, Number(ratio) || 0.8))
    const extra = Math.max(0, Math.round(Number(extraH) || 0))
    w.setMinimumSize(420, Math.round(420 / r) + extra)
    w.setAspectRatio(r, { width: 0, height: extra })
    // la plus grande scène qui tient dans l'espace de travail, centrée sur la position actuelle
    const cur = w.getBounds()
    const area = screen.getDisplayMatching(cur).workArea
    let stageW = Math.min(area.width - 24, 640)
    let stageH = Math.round(stageW / r)
    if (stageH + extra > area.height - 24) {
      stageH = area.height - 24 - extra
      stageW = Math.round(stageH * r)
    }
    const width = stageW
    const height = stageH + extra
    const cx = cur.x + cur.width / 2
    const cy = cur.y + cur.height / 2
    const x = Math.round(Math.max(area.x, Math.min(area.x + area.width - width, cx - width / 2)))
    const y = Math.round(Math.max(area.y, Math.min(area.y + area.height - height, cy - height / 2)))
    w.setBounds({ x, y, width, height }, true)
  })

  ipcMain.handle('app:version', () => process.env.npm_package_version ?? require('electron').app.getVersion())
}
