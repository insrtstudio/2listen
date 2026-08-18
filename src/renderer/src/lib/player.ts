import type { Track } from '@shared/types'

export interface PlayerSnapshot {
  track: Track | null
  playing: boolean
  /** true si la lecture est lancée mais que l'horloge audio n'avance pas
   *  (périphérique de sortie système bloqué — interfaces pro éteintes, etc.) */
  stalled: boolean
  queue: Track[]
  index: number
  repeat: 'off' | 'all' | 'one'
  shuffle: boolean
  volume: number
}

type Sub = () => void

/**
 * Moteur de lecture hors React : deux éléments <audio> qui alternent, le
 * suivant est préchargé pendant la lecture pour un enchaînement sans blanc.
 * La position n'est jamais mise dans l'état React (voir onTime).
 */
class Player {
  private a = new Audio()
  private b = new Audio()
  private active = this.a
  private preloadedFor: string | null = null

  private queue: Track[] = []
  private order: number[] = []
  private pos = -1

  track: Track | null = null
  playing = false
  stalled = false
  private stallTimer: ReturnType<typeof setTimeout> | null = null
  repeat: 'off' | 'all' | 'one' = 'off'
  shuffle = false
  volume = 0.85

  private subs = new Set<Sub>()
  private timeSubs = new Set<(t: number, d: number) => void>()
  private snapshot: PlayerSnapshot = this.buildSnapshot()

  constructor() {
    for (const el of [this.a, this.b]) {
      el.preload = 'auto'
      el.addEventListener('ended', () => this.onEnded())
      el.addEventListener('timeupdate', () => {
        if (el !== this.active) return
        for (const cb of this.timeSubs) cb(el.currentTime, el.duration || this.track?.duration || 0)
      })
      el.addEventListener('play', () => this.setPlaying(true, el))
      el.addEventListener('pause', () => this.setPlaying(false, el))
      el.addEventListener('error', () => {
        if (el === this.active && this.track) this.next()
      })
    }
    void navigator.mediaSession?.setActionHandler?.('play', () => this.toggle())
    navigator.mediaSession?.setActionHandler('pause', () => this.toggle())
    navigator.mediaSession?.setActionHandler('previoustrack', () => this.prev())
    navigator.mediaSession?.setActionHandler('nexttrack', () => this.next())
  }

  private setPlaying(v: boolean, el: HTMLAudioElement): void {
    if (el !== this.active) return
    if (this.playing !== v) {
      this.playing = v
      this.emit()
    }
    this.watchStall()
  }

  /** 3 s après un play, si currentTime est resté à ~0, la sortie est bloquée. */
  private watchStall(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer)
    if (!this.playing) {
      if (this.stalled) {
        this.stalled = false
        this.emit()
      }
      return
    }
    const at = this.active.currentTime
    this.stallTimer = setTimeout(() => {
      const nowStalled = this.playing && this.active.currentTime - at < 0.05
      if (nowStalled !== this.stalled) {
        this.stalled = nowStalled
        this.emit()
      }
      if (nowStalled) this.watchStall() // re-teste : l'appareil peut se réveiller
    }, 3000)
  }

  private buildSnapshot(): PlayerSnapshot {
    return {
      track: this.track,
      playing: this.playing,
      stalled: this.stalled,
      queue: this.queue,
      index: this.pos >= 0 ? this.order[this.pos] : -1,
      repeat: this.repeat,
      shuffle: this.shuffle,
      volume: this.volume
    }
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot()
    for (const s of this.subs) s()
  }

  subscribe = (cb: Sub): (() => void) => {
    this.subs.add(cb)
    return () => this.subs.delete(cb)
  }

  getSnapshot = (): PlayerSnapshot => this.snapshot

  onTime(cb: (t: number, d: number) => void): () => void {
    this.timeSubs.add(cb)
    return () => this.timeSubs.delete(cb)
  }

  private rebuildOrder(startIndex: number): void {
    const n = this.queue.length
    const base = Array.from({ length: n }, (_, i) => i)
    if (!this.shuffle) {
      this.order = base
      this.pos = startIndex
      return
    }
    const rest = base.filter((i) => i !== startIndex)
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[rest[i], rest[j]] = [rest[j], rest[i]]
    }
    this.order = startIndex >= 0 ? [startIndex, ...rest] : rest
    this.pos = startIndex >= 0 ? 0 : -1
  }

  /** Lance `queue[index]` et mémorise la file (une vue = une file). */
  async playQueue(queue: Track[], index: number): Promise<void> {
    this.queue = queue
    this.rebuildOrder(index)
    await this.load(queue[index], true)
  }

  private async load(track: Track, autoplay: boolean): Promise<void> {
    this.track = track
    const url = await window.tl.url.audio(track.path)

    // Le préchargement gapless a peut-être déjà ce fichier prêt dans l'autre élément.
    const other = this.active === this.a ? this.b : this.a
    if (this.preloadedFor === track.id && other.src) {
      this.active.pause()
      this.active.removeAttribute('src')
      this.active = other
    } else {
      this.active.src = url
    }
    this.preloadedFor = null
    this.active.volume = this.volume
    this.active.currentTime = 0
    if (autoplay) void this.active.play().catch(() => {})
    this.emit()
    this.updateMediaSession(track)
    void window.tl.library.updateTrack(track.id, {
      playCount: track.playCount + 1,
      lastPlayedAt: Date.now()
    })
    void this.preloadNext()
  }

  private nextIndex(loop: boolean): number {
    if (this.queue.length === 0) return -1
    if (this.pos + 1 < this.order.length) return this.order[this.pos + 1]
    return loop || this.repeat === 'all' ? this.order[0] : -1
  }

  private async preloadNext(): Promise<void> {
    const ni = this.nextIndex(false)
    if (ni < 0) {
      this.preloadedFor = null
      return
    }
    const next = this.queue[ni]
    const other = this.active === this.a ? this.b : this.a
    if (this.preloadedFor === next.id) return
    other.src = await window.tl.url.audio(next.path)
    other.volume = this.volume
    this.preloadedFor = next.id
  }

  private onEnded(): void {
    if (this.repeat === 'one' && this.track) {
      this.active.currentTime = 0
      void this.active.play()
      return
    }
    this.next(true)
  }

  next(fromEnded = false): void {
    const ni = this.nextIndex(false)
    if (ni < 0) {
      if (!fromEnded) return
      this.playing = false
      this.emit()
      return
    }
    this.pos = this.pos + 1 < this.order.length ? this.pos + 1 : 0
    void this.load(this.queue[ni], true)
  }

  prev(): void {
    if (this.active.currentTime > 3 || this.pos <= 0) {
      this.active.currentTime = 0
      return
    }
    this.pos -= 1
    void this.load(this.queue[this.order[this.pos]], true)
  }

  toggle(): void {
    if (!this.track) return
    if (this.active.paused) void this.active.play().catch(() => {})
    else this.active.pause()
  }

  seek(frac: number): void {
    const d = this.active.duration || this.track?.duration || 0
    if (d > 0) this.active.currentTime = Math.max(0, Math.min(1, frac)) * d
  }

  currentTime(): number {
    return this.active.currentTime
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    this.a.volume = this.volume
    this.b.volume = this.volume
    this.emit()
  }

  setRepeat(mode: 'off' | 'all' | 'one'): void {
    this.repeat = mode
    this.emit()
  }

  setShuffle(on: boolean): void {
    this.shuffle = on
    const currentIdx = this.pos >= 0 ? this.order[this.pos] : -1
    this.rebuildOrder(currentIdx)
    this.preloadedFor = null
    void this.preloadNext()
    this.emit()
  }

  private updateMediaSession(track: Track): void {
    if (!navigator.mediaSession) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album
    })
  }
}

export const player = new Player()
// sonde de debug (lecture seule) pour les tests automatisés
;(window as unknown as Record<string, unknown>).__tl_probe = () => {
  const a = (player as unknown as { active: HTMLAudioElement }).active
  return {
    playing: player.playing,
    track: player.track?.title ?? null,
    t: player.currentTime(),
    ready: a.readyState,
    net: a.networkState,
    err: a.error ? { code: a.error.code, msg: a.error.message } : null,
    dur: a.duration,
    src: a.src.slice(0, 60)
  }
}
