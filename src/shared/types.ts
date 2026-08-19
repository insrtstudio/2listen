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
  /** Morceaux ajoutés individuellement (hors dossiers surveillés). */
  files: string[]
  /** Chemins retirés de la bibliothèque (ignorés au scan). */
  excluded: string[]
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

/** Résultat d'analyse audio complète d'une piste (outil A/B). */
export interface AnalysisData {
  version: number
  /** Loudness intégrée (LUFS, ITU-R BS.1770, gating). */
  lufsI: number
  /** Max de loudness court terme 3 s (LUFS). */
  lufsSMax: number
  /** Plage de loudness EBU R128 (LU). */
  lra: number
  /** Crête échantillon (dBFS). */
  peakDb: number
  /** Crête inter-échantillons estimée (dBTP, interp. Catmull-Rom 4x). */
  truePeakDb: number
  /** RMS global (dBFS). */
  rmsDb: number
  /** Facteur de crête peak−RMS (dB) : plus il est bas, plus c'est compressé. */
  crestDb: number
  /** Peak-to-Loudness Ratio : truePeak − lufsI (dB). */
  plr: number
  /** Spectre moyen (dB), points log-espacés de 20 Hz à 20 kHz. */
  spectrum: number[]
  /** Fréquences des points du spectre (Hz). */
  freqs: number[]
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
  /** Outil A/B : pistes mémorisées. */
  compareA: TrackId | null
  compareB: TrackId | null
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

/** Pics de forme d'onde spectrale : 6 plans Uint8 par bucket.
 *  min/max : silhouette (centrée sur 128) ; low/mid/high : énergie RMS par
 *  bande (graves < 180 Hz, médiums, aigus > 3,5 kHz) ; trans : score de
 *  transitoire (crête × flux). */
export interface Peaks {
  buckets: number
  min: Uint8Array
  max: Uint8Array
  low: Uint8Array
  mid: Uint8Array
  high: Uint8Array
  trans: Uint8Array
}

export const AUDIO_EXTENSIONS = [
  'flac', 'alac', 'wav', 'wave', 'aiff', 'aif', 'aifc',
  'm4a', 'mp4', 'mp3', 'aac', 'ogg', 'oga', 'opus', 'wv', 'ape'
] as const

export const LOSSLESS_CODECS = /flac|alac|pcm|wav|aiff|lossless|wavpack|monkey/i
