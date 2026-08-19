import { createHash } from 'node:crypto'
import { promises as fs, type Dirent } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { parseFile, type IAudioMetadata } from 'music-metadata'
import { AUDIO_EXTENSIONS, LOSSLESS_CODECS, type ScanProgress, type Track } from '../shared/types'
import { library, paths } from './store'

const EXT = new Set<string>(AUDIO_EXTENSIONS as readonly string[])
/** Dossiers systèmes / caches qu'il ne sert à rien de parcourir. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.Trash', 'Library', '.Spotlight-V100', '.fseventsd'])

const sha1 = (value: string | Buffer): string => createHash('sha1').update(value).digest('hex')

export const trackId = (path: string): string => sha1(path).slice(0, 20)

async function* walk(dir: string, depth = 0): AsyncGenerator<string> {
  if (depth > 24) return
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      yield* walk(full, depth + 1)
    } else if (entry.isFile()) {
      if (entry.name.startsWith('._')) continue // AppleDouble
      const ext = extname(entry.name).slice(1).toLowerCase()
      if (EXT.has(ext)) yield full
    }
  }
}

async function saveCover(meta: IAudioMetadata): Promise<string | null> {
  const pic = meta.common.picture?.[0]
  if (!pic) return null
  const data = Buffer.from(pic.data)
  const key = sha1(data)
  const ext = pic.format?.includes('png') ? 'png' : 'jpg'
  const file = join(paths.covers(), `${key}.${ext}`)
  try {
    await fs.access(file)
  } catch {
    await fs.writeFile(file, data)
  }
  return `${key}.${ext}`
}

function guessCodec(meta: IAudioMetadata, path: string): string {
  const raw = (meta.format.codec || meta.format.container || extname(path).slice(1)).toUpperCase()
  if (/MPEG.*LAYER 3|MP3/.test(raw)) return 'MP3'
  if (/ALAC/.test(raw)) return 'ALAC'
  if (/AAC|MP4A/.test(raw)) return 'AAC'
  if (/PCM/.test(raw)) return extname(path).slice(1).toUpperCase() || 'PCM'
  return raw
}

async function readTrack(path: string, root: string, stat: { size: number; mtimeMs: number }): Promise<Track> {
  let meta: IAudioMetadata | null = null
  try {
    meta = await parseFile(path, { duration: false })
  } catch {
    meta = null
  }
  const c = meta?.common
  const f = meta?.format
  const codec = meta ? guessCodec(meta, path) : extname(path).slice(1).toUpperCase()
  const lossless = f?.lossless ?? LOSSLESS_CODECS.test(codec)
  return {
    id: trackId(path),
    path,
    root,
    size: stat.size,
    mtime: Math.round(stat.mtimeMs),
    title: c?.title?.trim() || basename(path, extname(path)),
    artist: c?.artist?.trim() || 'Artiste inconnu',
    albumArtist: c?.albumartist?.trim() || c?.artist?.trim() || 'Artiste inconnu',
    album: c?.album?.trim() || 'Sans album',
    genre: c?.genre?.[0]?.trim() || '',
    year: c?.year ?? null,
    trackNo: c?.track?.no ?? null,
    discNo: c?.disk?.no ?? null,
    duration: f?.duration ?? 0,
    codec,
    lossless,
    sampleRate: f?.sampleRate ?? 0,
    bitsPerSample: f?.bitsPerSample ?? 0,
    channels: f?.numberOfChannels ?? 2,
    bitrate: f?.bitrate ? Math.round(f.bitrate / 1000) : 0,
    cover: meta ? await saveCover(meta) : null,
    addedAt: Date.now(),
    playCount: 0,
    lastPlayedAt: null,
    rating: 0
  }
}

/** Petit pool : lire les tags sature le disque bien avant le CPU. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

let scanning = false

export function isScanning(): boolean {
  return scanning
}

/**
 * Scan incrémental : les fichiers dont la taille et la date n'ont pas bougé
 * gardent leur entrée (et donc leurs compteurs d'écoute et leur note).
 */
export async function scan(onProgress: (p: ScanProgress) => void): Promise<Track[]> {
  if (scanning) return library.get().tracks
  scanning = true
  try {
    const data = library.get()
    const known = new Map(data.tracks.map((t) => [t.path, t]))
    const excluded = new Set(data.excluded)
    const seen = new Set<string>()
    const toRead: { path: string; root: string; size: number; mtimeMs: number }[] = []

    let found = 0
    onProgress({ phase: 'discover', found: 0, done: 0, total: 0, current: '' })
    const consider = async (file: string, root: string): Promise<void> => {
      if (excluded.has(file)) return
      seen.add(file)
      found++
      if (found % 50 === 0) onProgress({ phase: 'discover', found, done: 0, total: 0, current: file })
      let stat
      try {
        stat = await fs.stat(file)
      } catch {
        return
      }
      const prev = known.get(file)
      if (prev && prev.size === stat.size && prev.mtime === Math.round(stat.mtimeMs)) return
      toRead.push({ path: file, root, size: stat.size, mtimeMs: stat.mtimeMs })
    }
    for (const root of data.roots) {
      for await (const file of walk(root)) await consider(file, root)
    }
    // morceaux ajoutés individuellement : leur « racine » est leur dossier parent
    for (const file of data.files) await consider(file, join(file, '..'))

    let done = 0
    const total = toRead.length
    onProgress({ phase: 'read', found, done, total, current: '' })
    const fresh = await pool(toRead, 6, async (item) => {
      const track = await readTrack(item.path, item.root, item)
      const prev = known.get(item.path)
      done++
      if (done % 10 === 0 || done === total) {
        onProgress({ phase: 'read', found, done, total, current: item.path })
      }
      // On conserve l'historique d'écoute d'un fichier simplement ré-encodé.
      return prev
        ? { ...track, addedAt: prev.addedAt, playCount: prev.playCount, lastPlayedAt: prev.lastPlayedAt, rating: prev.rating }
        : track
    })

    const byPath = new Map<string, Track>()
    for (const t of data.tracks) if (seen.has(t.path)) byPath.set(t.path, t)
    for (const t of fresh) byPath.set(t.path, t)
    // les corrections de métadonnées de l'utilisateur priment sur les tags lus
    const edits = data.edits ?? {}
    const tracks = [...byPath.values()].map((t) => (edits[t.id] ? { ...t, ...edits[t.id] } : t))

    const validIds = new Set(tracks.map((t) => t.id))
    const playlists = data.playlists.map((p) => ({
      ...p,
      trackIds: p.trackIds.filter((id) => validIds.has(id))
    }))

    library.set({ ...data, tracks, playlists })
    await library.flush()
    onProgress({ phase: 'done', found, done: total, total, current: '' })
    return tracks
  } finally {
    scanning = false
  }
}

/** Supprime les pochettes et les pics qui ne sont plus référencés. */
export async function vacuum(): Promise<void> {
  const data = library.get()
  const covers = new Set(data.tracks.map((t) => t.cover).filter(Boolean) as string[])
  const peaks = new Set(data.tracks.flatMap((t) => [`${t.id}.peaks`, `${t.id}.anal.json`]))
  const empty = new Set<string>()
  for (const [dir, keep] of [[paths.covers(), covers], [paths.peaks(), peaks], [paths.decodeTmp(), empty]] as const) {
    let files: string[] = []
    try {
      files = await fs.readdir(dir)
    } catch {
      continue
    }
    await Promise.all(files.map((f) => (keep.has(f) ? null : fs.rm(join(dir, f), { force: true }))))
  }
}
