/** Types partagés entre le process principal, le preload et le renderer. */

export type TrackId = string

export interface Track {
  id: TrackId
  path: string
  /** Racine de bibliothèque à laquelle ce fichier appartient. */
  root: string
  size: number
  mtime: number
  title: string
  artist: string
  albumArtist: string
  album: string
  genre: string
  year: number | null
  trackNo: number | null
  discNo: number | null
  /** Secondes. */
  duration: number
  /** flac, alac, wav, aiff, mp3, aac, ogg, opus… */
  codec: string
  lossless: boolean
  sampleRate: number
  bitsPerSample: number
  channels: number
  /** kbps */
  bitrate: number
  /** Clé du cache de pochette (sha1) ou null. */
  cover: string | null
  addedAt: number
  playCount: number
  lastPlayedAt: number | null
  /** 0–5, 0 = non noté. */
  rating: number
}

export interface Playlist {
  id: string
  name: string
  trackIds: TrackId[]
  createdAt: number
  updatedAt: number
}

export interface LibraryData {
  version: number
  roots: string[]
  tracks: Track[]
  playlists: Playlist[]
}

export interface ScanProgress {
  phase: 'discover' | 'read' | 'done' | 'idle'
  found: number
  done: number
  total: number
  current: string
}

export interface Settings {
  volume: number
  repeat: 'off' | 'all' | 'one'
  shuffle: boolean
  theme: 'light' | 'dark'
  lastTrackId: TrackId | null
  /** Recrée le contexte audio à la fréquence du fichier (pas de rééchantillonnage applicatif). */
  matchSampleRate: boolean
  /** Préchargement de la piste suivante pour un enchaînement sans blanc. */
  gapless: boolean
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'none'
  version?: string
  percent?: number
  message?: string
  /** true quand l'installation silencieuse est impossible (build non signé). */
  manual?: boolean
  url?: string
}

/** Pics de forme d'onde : 3 canaux Uint8 (min, max, rms) centrés sur 128. */
export interface Peaks {
  buckets: number
  min: Uint8Array
  max: Uint8Array
  rms: Uint8Array
}

export const AUDIO_EXTENSIONS = [
  'flac', 'alac', 'wav', 'wave', 'aiff', 'aif', 'aifc',
  'm4a', 'mp4', 'mp3', 'aac', 'ogg', 'oga', 'opus', 'wv', 'ape'
] as const

export const LOSSLESS_CODECS = /flac|alac|pcm|wav|aiff|lossless|wavpack|monkey/i
