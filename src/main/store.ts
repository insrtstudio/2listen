import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { LibraryData, Settings } from '../shared/types'

const DATA_VERSION = 1

export const paths = {
  userData: () => app.getPath('userData'),
  library: () => join(app.getPath('userData'), 'library.json'),
  settings: () => join(app.getPath('userData'), 'settings.json'),
  covers: () => join(app.getPath('userData'), 'covers'),
  peaks: () => join(app.getPath('userData'), 'peaks'),
  decodeTmp: () => join(app.getPath('userData'), 'decode-tmp')
}

export const defaultSettings: Settings = {
  volume: 0.85,
  repeat: 'off',
  shuffle: false,
  theme: 'light',
  lastTrackId: null,
  matchSampleRate: true,
  gapless: true,
  compareA: null,
  compareB: null
}

const emptyLibrary: LibraryData = { version: DATA_VERSION, roots: [], files: [], excluded: [], tracks: [], playlists: [], edits: {} }

/**
 * Écriture atomique et débattue : la bibliothèque tient en mémoire, le disque
 * n'est touché qu'après une accalmie de 400 ms (un scan écrit des milliers de
 * pistes, on ne veut pas un fsync par piste).
 */
class Persisted<T> {
  private data: T
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(private file: string, private fallback: T) {
    this.data = fallback
  }

  async load(): Promise<T> {
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as T
      this.data = { ...this.fallback, ...parsed }
    } catch {
      this.data = this.fallback
    }
    return this.data
  }

  get(): T {
    return this.data
  }

  set(next: T): void {
    this.data = next
    this.schedule()
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), 400)
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const snapshot = JSON.stringify(this.data)
    this.writing = this.writing.then(async () => {
      const tmp = `${this.file}.tmp`
      await fs.mkdir(join(this.file, '..'), { recursive: true })
      await fs.writeFile(tmp, snapshot, 'utf8')
      await fs.rename(tmp, this.file)
    }).catch((err) => {
      console.error('[store] écriture impossible', this.file, err)
    })
    return this.writing
  }
}

let libraryStore: Persisted<LibraryData>
let settingsStore: Persisted<Settings>

export async function initStores(): Promise<void> {
  libraryStore = new Persisted<LibraryData>(paths.library(), emptyLibrary)
  settingsStore = new Persisted<Settings>(paths.settings(), defaultSettings)
  await Promise.all([libraryStore.load(), settingsStore.load()])
  await Promise.all([
    fs.mkdir(paths.covers(), { recursive: true }),
    fs.mkdir(paths.peaks(), { recursive: true }),
    fs.mkdir(paths.decodeTmp(), { recursive: true })
  ])
}

export const library = {
  get: (): LibraryData => libraryStore.get(),
  set: (next: LibraryData): void => libraryStore.set(next),
  flush: (): Promise<void> => libraryStore.flush()
}

export const settings = {
  get: (): Settings => settingsStore.get(),
  set: (next: Settings): void => settingsStore.set(next),
  flush: (): Promise<void> => settingsStore.flush()
}
