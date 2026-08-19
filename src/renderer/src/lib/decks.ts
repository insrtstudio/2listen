import type { AnalysisData, Track } from '@shared/types'
import { claimScene, registerScene } from './audiofocus'
import { getAnalysis } from './analysis'

export interface DeckSnapshot {
  track: Track | null
  analysis: AnalysisData | null
  analyzing: boolean
  playing: boolean
  rate: number
  volume: number
  cue: number
  masterTempo: boolean
}

type Sub = () => void

/**
 * Platine de mix : élément audio indépendant, pitch ±8 % (playbackRate),
 * point de cue, master tempo (préservation de la hauteur), analyse
 * BPM/tonalité chargée avec la piste. Le crossfader module le volume
 * des deux platines (courbe équal-power).
 */
export class Deck {
  readonly audio = new Audio()
  track: Track | null = null
  analysis: AnalysisData | null = null
  analyzing = false
  playing = false
  rate = 1
  volume = 1
  cue = 0
  masterTempo = false
  /** gain issu du crossfader (0–1), appliqué en plus du volume de la platine */
  private xf = 1

  private subs = new Set<Sub>()
  private timeSubs = new Set<(t: number, d: number) => void>()
  private snapshot: DeckSnapshot = this.buildSnapshot()

  constructor(readonly name: string) {
    this.audio.preload = 'auto'
    // DJ : par défaut le pitch change la hauteur, comme une platine vinyle
    this.audio.preservesPitch = false
    this.audio.addEventListener('play', () => {
      claimScene('decks')
      this.playing = true
      this.emit()
    })
    this.audio.addEventListener('pause', () => {
      this.playing = false
      this.emit()
    })
    this.audio.addEventListener('ended', () => {
      this.playing = false
      this.emit()
    })
    this.audio.addEventListener('timeupdate', () => {
      for (const cb of this.timeSubs) cb(this.audio.currentTime, this.audio.duration || this.track?.duration || 0)
    })
  }

  private buildSnapshot(): DeckSnapshot {
    return {
      track: this.track,
      analysis: this.analysis,
      analyzing: this.analyzing,
      playing: this.playing,
      rate: this.rate,
      volume: this.volume,
      cue: this.cue,
      masterTempo: this.masterTempo
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

  getSnapshot = (): DeckSnapshot => this.snapshot

  onTime = (cb: (t: number, d: number) => void): (() => void) => {
    this.timeSubs.add(cb)
    return () => this.timeSubs.delete(cb)
  }

  async load(track: Track): Promise<void> {
    this.track = track
    this.analysis = null
    this.analyzing = true
    this.cue = 0
    this.audio.src = await window.tl.url.audio(track.path)
    this.applyVolume()
    this.emit()
    const analysis = await getAnalysis(track.id, track.path)
    if (this.track?.id === track.id) {
      this.analysis = analysis
      this.analyzing = false
      this.emit()
    }
  }

  eject(): void {
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.track = null
    this.analysis = null
    this.playing = false
    this.emit()
  }

  toggle(): void {
    if (!this.track) return
    if (this.audio.paused) void this.audio.play().catch(() => {})
    else this.audio.pause()
  }

  /** CUE façon DJ : à l'arrêt pose le point ; en lecture, y retourne. */
  cuePress(): void {
    if (!this.track) return
    if (this.audio.paused) {
      this.cue = this.audio.currentTime
      this.emit()
    } else {
      this.audio.currentTime = this.cue
    }
  }

  seek = (frac: number): void => {
    const d = this.audio.duration || this.track?.duration || 0
    if (d > 0) this.audio.currentTime = Math.max(0, Math.min(1, frac)) * d
  }

  setRate(rate: number): void {
    this.rate = Math.max(0.92, Math.min(1.08, rate))
    this.audio.playbackRate = this.rate
    this.emit()
  }

  setMasterTempo(on: boolean): void {
    this.masterTempo = on
    this.audio.preservesPitch = on
    this.emit()
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    this.applyVolume()
    this.emit()
  }

  setCrossfadeGain(g: number): void {
    this.xf = g
    this.applyVolume()
  }

  private applyVolume(): void {
    this.audio.volume = Math.max(0, Math.min(1, this.volume * this.xf))
  }

  /** BPM effectif (tempo détecté × pitch). */
  effectiveBpm(): number | null {
    if (!this.analysis || !this.analysis.bpm) return null
    return Math.round(this.analysis.bpm * this.rate * 10) / 10
  }
}

export const deckA = new Deck('A')
export const deckB = new Deck('B')

registerScene('decks', () => {
  deckA.audio.pause()
  deckB.audio.pause()
})

let crossfade = 0.5

/** Crossfader 0 (tout A) → 1 (tout B), courbe équal-power. */
export function setCrossfade(x: number): void {
  crossfade = Math.max(0, Math.min(1, x))
  deckA.setCrossfadeGain(Math.cos((crossfade * Math.PI) / 2))
  deckB.setCrossfadeGain(Math.sin((crossfade * Math.PI) / 2))
}

export function getCrossfade(): number {
  return crossfade
}

setCrossfade(0.5)

/** SYNC : cale le tempo de `deck` sur celui de l'autre platine. */
export function sync(deck: Deck, other: Deck): void {
  const from = deck.analysis?.bpm
  const to = other.effectiveBpm()
  if (!from || !to) return
  deck.setRate(to / from)
}
