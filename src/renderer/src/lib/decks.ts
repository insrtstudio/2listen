import type { AnalysisData, Track } from '@shared/types'
import { claimScene, registerScene } from './audiofocus'
import { getAnalysis } from './analysis'
import { decodeTrack } from './decode'

export interface DeckSnapshot {
  track: Track | null
  analysis: AnalysisData | null
  loading: boolean
  playing: boolean
  rate: number
  volume: number
  cue: number
}

type Sub = () => void

/** Contexte partagé : les deux platines vivent sur la même horloge audio —
 *  c'est ce qui rend le beat sync précis à l'échantillon. */
let sharedCtx: AudioContext | null = null
function ctx(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext({ latencyHint: 'interactive' })
  return sharedCtx
}

/**
 * Platine WebAudio : le morceau est décodé en mémoire et lu par un
 * AudioBufferSourceNode. Le pitch (varispeed, comme une platine vinyle) est
 * un pur rééchantillonnage — aucun artefact, contrairement au pipeline média.
 * Position tenue par segments (offset + durée×rate) sur l'horloge du contexte.
 */
export class Deck {
  track: Track | null = null
  analysis: AnalysisData | null = null
  buffer: AudioBuffer | null = null
  loading = false
  playing = false
  rate = 1
  volume = 1
  cue = 0

  private src: AudioBufferSourceNode | null = null
  private gain: GainNode | null = null
  private xf = 1
  /** bookkeeping de position : segment courant */
  private segStartCtx = 0
  private segStartPos = 0
  private pausedPos = 0
  private loadSeq = 0

  private subs = new Set<Sub>()
  private timeSubs = new Set<(t: number, d: number) => void>()
  private snapshot: DeckSnapshot = this.buildSnapshot()
  private ticker: ReturnType<typeof setInterval> | null = null

  constructor(readonly name: string) {}

  private ensureGain(): GainNode {
    if (!this.gain) {
      this.gain = ctx().createGain()
      this.gain.connect(ctx().destination)
      this.applyVolume()
    }
    return this.gain
  }

  private buildSnapshot(): DeckSnapshot {
    return {
      track: this.track,
      analysis: this.analysis,
      loading: this.loading,
      playing: this.playing,
      rate: this.rate,
      volume: this.volume,
      cue: this.cue
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

  private emitTime(): void {
    const d = this.buffer?.duration ?? this.track?.duration ?? 0
    for (const cb of this.timeSubs) cb(this.position(), d)
  }

  /** Position de lecture (secondes de morceau), exacte sur l'horloge partagée. */
  position(): number {
    if (!this.playing) return this.pausedPos
    return this.segStartPos + (ctx().currentTime - this.segStartCtx) * this.rate
  }

  duration(): number {
    return this.buffer?.duration ?? this.track?.duration ?? 0
  }

  async load(track: Track): Promise<void> {
    const seq = ++this.loadSeq
    this.stopSource()
    this.track = track
    this.analysis = null
    this.buffer = null
    this.playing = false
    this.pausedPos = 0
    this.cue = 0
    this.loading = true
    this.emit()
    const [buffer, analysis] = await Promise.all([decodeTrack(track.path), getAnalysis(track.id, track.path)])
    if (seq !== this.loadSeq) return // une autre piste a été chargée entre-temps
    this.buffer = buffer
    this.analysis = analysis
    this.loading = false
    this.emit()
    this.emitTime()
  }

  eject(): void {
    this.loadSeq++
    this.stopSource()
    this.track = null
    this.analysis = null
    this.buffer = null
    this.playing = false
    this.pausedPos = 0
    this.emit()
    this.emitTime()
  }

  private stopSource(): void {
    if (this.src) {
      this.src.onended = null
      try {
        this.src.stop()
      } catch {
        /* déjà arrêté */
      }
      this.src.disconnect()
      this.src = null
    }
    if (this.ticker) {
      clearInterval(this.ticker)
      this.ticker = null
    }
  }

  /** Démarre la lecture à `pos` (s). */
  private startAt(pos: number): void {
    if (!this.buffer) return
    this.stopSource()
    const c = ctx()
    void c.resume().catch(() => {})
    const src = c.createBufferSource()
    src.buffer = this.buffer
    src.playbackRate.value = this.rate
    src.connect(this.ensureGain())
    const startTime = c.currentTime
    const clamped = Math.max(0, Math.min(this.buffer.duration - 0.01, pos))
    src.start(startTime, clamped)
    src.onended = () => {
      if (this.src === src) {
        this.playing = false
        this.pausedPos = 0
        this.stopSource()
        this.emit()
      }
    }
    this.src = src
    this.segStartCtx = startTime
    this.segStartPos = clamped
    this.playing = true
    claimScene('decks')
    this.ticker = setInterval(() => this.emitTime(), 100)
    this.emit()
  }

  toggle(): void {
    if (!this.buffer) return
    if (this.playing) {
      this.pausedPos = this.position()
      this.stopSource()
      this.playing = false
      this.emit()
      this.emitTime()
    } else {
      // beat sync au lancement (façon rekordbox) : si LOCK est armé et que
      // l'autre platine joue, on démarre tempo calé ET en grille
      this.startAt(launchSync(this, this.pausedPos))
    }
  }

  pause(): void {
    if (this.playing) this.toggle()
  }

  /** CUE façon DJ : à l'arrêt pose le point ; en lecture, y retourne. */
  cuePress(): void {
    if (!this.buffer) return
    if (!this.playing) {
      this.cue = this.pausedPos
      this.emit()
    } else {
      this.startAt(launchSync(this, this.cue))
    }
  }

  seek = (frac: number): void => {
    const d = this.duration()
    if (d <= 0) return
    const pos = Math.max(0, Math.min(1, frac)) * d
    if (this.playing) this.startAt(pos)
    else {
      this.pausedPos = pos
      this.emitTime()
    }
  }

  /** Décale la position de `delta` secondes — précis, sans latence de seek. */
  nudgePosition(delta: number): void {
    if (!this.playing) {
      this.pausedPos = Math.max(0, this.pausedPos + delta)
      this.emitTime()
      return
    }
    this.startAt(this.position() + delta)
  }

  /**
   * Change le pitch. Sur un buffer source c'est un pur rééchantillonnage :
   * aucun artefact. Le bookkeeping ferme le segment courant à l'instant du
   * changement pour garder une position exacte.
   */
  setRate(rate: number, silent = false): void {
    const clamped = Math.max(0.92, Math.min(1.08, rate))
    if (this.playing && this.src) {
      const now = ctx().currentTime
      this.segStartPos = this.position()
      this.segStartCtx = now
      this.src.playbackRate.setValueAtTime(clamped, now)
    }
    this.rate = clamped
    if (!silent) this.emit()
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
    if (!this.gain) return
    // rampe courte : jamais de clic au crossfade
    this.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, this.volume * this.xf)), ctx().currentTime, 0.015)
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
  deckA.pause()
  deckB.pause()
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

/** Grille commune : diviseurs tels que les deux platines partagent le battement lent. */
function commonGrid(a: Deck, b: Deck): { divA: number; divB: number } | null {
  const ea = a.effectiveBpm()
  const eb = b.effectiveBpm()
  if (!ea || !eb) return null
  const ratio = ea / eb
  if (ratio > 1.5) return { divA: 2, divB: 1 }
  if (ratio < 0.66) return { divA: 1, divB: 2 }
  return { divA: 1, divB: 1 }
}

/** Position fractionnaire dans le battement (0–1) sur la grille divisée. */
function beatFrac(deck: Deck, div: number): number | null {
  const an = deck.analysis
  if (!an || !an.bpm) return null
  const beatSec = (60 / an.bpm) * div
  const t = deck.position() - an.beatPhase
  return ((t / beatSec) % 1 + 1) % 1
}

/** Erreur de phase signée (secondes, grille du slave), vers le battement le plus proche. */
function phaseError(master: Deck, slave: Deck): number | null {
  const grid = commonGrid(master, slave)
  if (!grid || !slave.analysis?.bpm) return null
  const [divM, divS] = master === deckA ? [grid.divA, grid.divB] : [grid.divB, grid.divA]
  const fm = beatFrac(master, divM)
  const fs = beatFrac(slave, divS)
  if (fm === null || fs === null) return null
  const beatSecS = (60 / slave.analysis.bpm) * divS
  let diff = fm - fs
  if (diff > 0.5) diff -= 1
  if (diff < -0.5) diff += 1
  return diff * beatSecS
}

/** Calage de phase immédiat, précis à l'échantillon (horloge partagée). */
export function phaseAlign(master: Deck, slave: Deck): void {
  const err = phaseError(master, slave)
  if (err === null) return
  slave.nudgePosition(err)
}

/** Le « maître » est la platine la plus présente au crossfader. */
export function masterSlave(): [Deck, Deck] {
  return crossfade <= 0.5 ? [deckA, deckB] : [deckB, deckA]
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

/**
 * Beat sync au lancement : si LOCK est armé et que l'autre platine joue,
 * adapte le tempo de `deck` (rapport 1x/2x/½x le plus proche) et décale la
 * position de départ pour tomber en grille avec le master — le morceau part
 * déjà calé, comme le Beat Sync de rekordbox.
 */
function launchSync(deck: Deck, pos: number): number {
  const other = deck === deckA ? deckB : deckA
  if (!lockOn || !other.playing) return pos
  const bpmD = deck.analysis?.bpm
  const bpmO = other.effectiveBpm()
  if (!bpmD || !bpmO || !deck.analysis || !other.analysis?.bpm) return pos
  // tempo : rapport le plus proche de 1 parmi 1x / 2x / ½x
  const rate = [bpmO / bpmD, bpmO / (bpmD * 2), (bpmO * 2) / bpmD].reduce((best, cand) =>
    Math.abs(Math.log(cand)) < Math.abs(Math.log(best)) ? cand : best
  )
  deck.setRate(rate, true)

  // phase : positionne le départ sur la grille du master
  const grid = commonGridFor(deck, other)
  if (!grid) return pos
  const beatSecD = (60 / deck.analysis.bpm) * grid.divSelf
  const beatSecO = (60 / other.analysis.bpm) * grid.divOther
  const fo = (((other.position() - other.analysis.beatPhase) / beatSecO) % 1 + 1) % 1
  const fd = (((pos - deck.analysis.beatPhase) / beatSecD) % 1 + 1) % 1
  let diff = fo - fd
  if (diff > 0.5) diff -= 1
  if (diff < -0.5) diff += 1
  return Math.max(0, pos + diff * beatSecD)
}

/** Diviseurs de grille commune vus depuis `self`. */
function commonGridFor(self: Deck, other: Deck): { divSelf: number; divOther: number } | null {
  const es = self.analysis?.bpm ? self.analysis.bpm * self.rate : null
  const eo = other.effectiveBpm()
  if (!es || !eo) return null
  const ratio = es / eo
  if (ratio > 1.5) return { divSelf: 2, divOther: 1 }
  if (ratio < 0.66) return { divSelf: 1, divOther: 2 }
  return { divSelf: 1, divOther: 1 }
}

/* ————— LOCK : recalage automatique continu ————— */
let lockOn = false
let lockTimer: ReturnType<typeof setInterval> | null = null
let lastPhaseErrMs = 0
const lockSubs = new Set<() => void>()

export function onLock(cb: () => void): () => void {
  lockSubs.add(cb)
  return () => lockSubs.delete(cb)
}

export function getBeatLock(): boolean {
  return lockOn
}

export function getPhaseErrMs(): number {
  return lastPhaseErrMs
}

export function setBeatLock(on: boolean): void {
  lockOn = on
  if (lockTimer) {
    clearInterval(lockTimer)
    lockTimer = null
  }
  if (on) {
    lockTimer = setInterval(() => {
      const [master, slave] = masterSlave()
      if (!master.playing || !slave.playing) return
      const err = phaseError(master, slave)
      if (err === null) return
      lastPhaseErrMs = Math.round(err * 1000)
      if (Math.abs(err) > 0.08) {
        // loin (départ, seek manuel) : recalage exact — l'horloge partagée
        // n'a pas de latence de seek, ça colle du premier coup
        slave.nudgePosition(err)
      } else if (Math.abs(err) > 0.004) {
        // dérive fine : micro-varispeed proportionnel (±1,5 %), pur
        // rééchantillonnage donc aucun artefact
        const nudge = Math.max(-0.015, Math.min(0.015, err * 1.2))
        const base = slave.rate
        slave.setRate(base * (1 + nudge), true)
        // retour au pitch nominal juste avant le tick suivant
        setTimeout(() => {
          if (lockOn) slave.setRate(base, true)
        }, 520)
      }
      for (const cb of lockSubs) cb()
    }, 600)
  } else {
    lastPhaseErrMs = 0
  }
  for (const cb of lockSubs) cb()
}

/**
 * SYNC ⇄ : les deux platines convergent vers un tempo commun (moyenne
 * géométrique — chaque pitch bouge deux fois moins), rapport half/double
 * choisi au plus proche, puis calage de phase immédiat.
 */
export function syncBoth(a: Deck, b: Deck): void {
  const bpmA = a.analysis?.bpm
  const bpmB = b.analysis?.bpm
  if (!bpmA || !bpmB) return
  const tB = [bpmB, bpmB * 2, bpmB / 2].reduce((best, cand) =>
    Math.abs(Math.log(bpmA / cand)) < Math.abs(Math.log(bpmA / best)) ? cand : best
  )
  const target = Math.sqrt(bpmA * tB)
  a.setRate(target / bpmA)
  b.setRate((bpmA * a.rate) / tB)
  const [master, slave] = masterSlave()
  phaseAlign(master, slave)
}
