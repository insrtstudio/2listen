import type { AnalysisData, Track } from '@shared/types'
import { claimScene, registerScene } from './audiofocus'

export interface EqMove {
  freq: number
  gainDb: number
  type: 'lowshelf' | 'peaking' | 'highshelf'
  label: string
}

export interface CompMove {
  thresholdDb: number
  ratio: number
  makeupDb: number
  label: string
}

export interface Corrections {
  eq: EqMove[]
  comp: CompMove | null
}

/** Bandes de correction : centre, type de filtre, libellé. */
const BANDS: Array<{ f0: number; f1: number; freq: number; type: EqMove['type']; label: string }> = [
  { f0: 20, f1: 120, freq: 80, type: 'lowshelf', label: 'graves' },
  { f0: 120, f1: 500, freq: 250, type: 'peaking', label: 'bas-médiums' },
  { f0: 500, f1: 2000, freq: 1000, type: 'peaking', label: 'médiums' },
  { f0: 2000, f1: 6000, freq: 3500, type: 'peaking', label: 'hauts-médiums' },
  { f0: 6000, f1: 20000, freq: 9000, type: 'highshelf', label: 'aigus' }
]

/**
 * Déduit des corrections applicables des écarts A vs référence :
 * EQ par bande (écarts > 1,5 dB, bornés à ±6 dB) et compression si le mix
 * est nettement plus dynamique que la référence, avec make-up qui ramène
 * la loudness au niveau de la référence.
 */
export function computeCorrections(a: AnalysisData, b: AnalysisData): Corrections {
  const offset = a.lufsI - b.lufsI // alignement : on compare la forme
  const eq: EqMove[] = []
  for (const band of BANDS) {
    let sum = 0
    let cnt = 0
    a.freqs.forEach((f, i) => {
      if (f >= band.f0 && f < band.f1) {
        sum += a.spectrum[i] - offset - b.spectrum[i]
        cnt++
      }
    })
    const delta = sum / (cnt || 1)
    if (Math.abs(delta) >= 1.5) {
      const gainDb = Math.round(Math.max(-6, Math.min(6, -delta)) * 10) / 10
      eq.push({ freq: band.freq, gainDb, type: band.type, label: band.label })
    }
  }

  let comp: CompMove | null = null
  const excessCrest = a.crestDb - b.crestDb
  if (excessCrest > 2) {
    // rabote l'excès de crête, en douceur (ratio 3:1)
    const thresholdDb = Math.max(-40, a.peakDb - excessCrest - 6)
    const makeupDb = Math.round(Math.max(-6, Math.min(6, b.lufsI - a.lufsI)) * 10) / 10
    comp = {
      thresholdDb: Math.round(thresholdDb * 10) / 10,
      ratio: 3,
      makeupDb,
      label: `compression ${excessCrest.toFixed(1)} dB de crête en trop`
    }
  }
  return { eq, comp }
}

/**
 * Moteur de prévisualisation : un <audio> dédié routé dans un graphe WebAudio
 * (5 filtres + compresseur + gain de make-up). La chaîne se bypass pour
 * écouter le même morceau brut, à position identique.
 */
class PreviewEngine {
  private audio = new Audio()
  private ctx: AudioContext | null = null
  private filters: BiquadFilterNode[] = []
  private compressor: DynamicsCompressorNode | null = null
  private makeup: GainNode | null = null
  playing = false
  corrected = true
  private subs = new Set<() => void>()

  constructor() {
    this.audio.preload = 'auto'
    this.audio.addEventListener('play', () => {
      claimScene('preview')
      this.playing = true
      this.emit()
    })
    this.audio.addEventListener('pause', () => {
      this.playing = false
      this.emit()
    })
    registerScene('preview', () => {
      if (!this.audio.paused) this.audio.pause()
    })
  }

  private emit(): void {
    for (const s of this.subs) s()
  }

  subscribe = (cb: () => void): (() => void) => {
    this.subs.add(cb)
    return () => this.subs.delete(cb)
  }

  private ensureGraph(): void {
    if (this.ctx) return
    this.ctx = new AudioContext()
    const src = this.ctx.createMediaElementSource(this.audio)
    this.filters = BANDS.map((b) => {
      const f = this.ctx!.createBiquadFilter()
      f.type = b.type
      f.frequency.value = b.freq
      f.Q.value = 0.9
      f.gain.value = 0
      return f
    })
    this.compressor = this.ctx.createDynamicsCompressor()
    this.compressor.attack.value = 0.008
    this.compressor.release.value = 0.18
    this.compressor.knee.value = 6
    this.makeup = this.ctx.createGain()
    let node: AudioNode = src
    for (const f of this.filters) {
      node.connect(f)
      node = f
    }
    node.connect(this.compressor)
    this.compressor.connect(this.makeup)
    this.makeup.connect(this.ctx.destination)
  }

  private apply(corrections: Corrections | null): void {
    if (!this.ctx || !this.compressor || !this.makeup) return
    const active = this.corrected && corrections
    for (let i = 0; i < BANDS.length; i++) {
      const move = active ? corrections.eq.find((m) => m.freq === BANDS[i].freq) : undefined
      this.filters[i].gain.value = move ? move.gainDb : 0
    }
    if (active && corrections.comp) {
      this.compressor.threshold.value = corrections.comp.thresholdDb
      this.compressor.ratio.value = corrections.comp.ratio
      this.makeup.gain.value = Math.pow(10, corrections.comp.makeupDb / 20)
    } else {
      this.compressor.threshold.value = 0 // inactif
      this.compressor.ratio.value = 1
      this.makeup.gain.value = 1
    }
  }

  private corrections: Corrections | null = null

  async play(track: Track, fraction: number, corrections: Corrections, corrected: boolean): Promise<void> {
    this.ensureGraph()
    this.corrections = corrections
    this.corrected = corrected
    this.apply(corrections)
    const url = await window.tl.url.audio(track.path)
    if (this.audio.src !== url) this.audio.src = url
    const target = Math.max(0, Math.min(0.999, fraction)) * (track.duration || 0)
    if (this.audio.readyState >= 1) {
      this.audio.currentTime = target
    } else {
      const once = (): void => {
        this.audio.currentTime = target
        this.audio.removeEventListener('loadedmetadata', once)
      }
      this.audio.addEventListener('loadedmetadata', once)
    }
    await this.ctx!.resume().catch(() => {})
    await this.audio.play().catch(() => {})
  }

  setCorrected(on: boolean): void {
    this.corrected = on
    this.apply(this.corrections)
    this.emit()
  }

  pause(): void {
    this.audio.pause()
  }

  fraction(): number {
    const d = this.audio.duration || 0
    return d > 0 ? this.audio.currentTime / d : 0
  }
}

export const preview = new PreviewEngine()
