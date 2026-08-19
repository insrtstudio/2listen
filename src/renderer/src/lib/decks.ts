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

/**
 * SYNC bilatéral : les deux platines convergent vers un tempo commun
 * (moyenne géométrique) — chaque pitch bouge deux fois moins qu'un esclavage
 * classique, donc reste bien plus souvent dans la plage ±8 %. Si un morceau
 * est en half/double-time, on se cale sur le rapport 2:1 le plus proche.
 */
export function syncBoth(a: Deck, b: Deck): void {
  const bpmA = a.analysis?.bpm
  const bpmB = b.analysis?.bpm
  if (!bpmA || !bpmB) return
  // rapport de B le plus proche de A (1x, 2x ou ½x) en distance log
  const tB = [bpmB, bpmB * 2, bpmB / 2].reduce((best, cand) =>
    Math.abs(Math.log(bpmA / cand)) < Math.abs(Math.log(bpmA / best)) ? cand : best
  )
  const target = Math.sqrt(bpmA * tB)
  a.setRate(target / bpmA)
  // si la borne ±8 % a tronqué A, B rejoint le tempo réellement atteint
  b.setRate((bpmA * a.rate) / tB)
}

/** Écart de battement résiduel entre les platines, en tenant compte du 2:1. */
export function beatDelta(a: Deck, b: Deck): { delta: number; ratio: 1 | 2 | 0.5 } | null {
  const ea = a.effectiveBpm()
  const eb = b.effectiveBpm()
  if (!ea || !eb) return null
  let best: { delta: number; ratio: 1 | 2 | 0.5 } = { delta: Math.abs(ea - eb), ratio: 1 }
  for (const ratio of [2, 0.5] as const) {
    const d = Math.abs(ea - eb * ratio)
    if (d < best.delta) best = { delta: d, ratio }
  }
  return best
}
