import type { AnalysisData, Track } from '@shared/types'
import { claimScene, registerScene } from './audiofocus'

export interface EqMove {
  freq: number
  gainDb: number
  q: number
  type: 'lowshelf' | 'peaking' | 'highshelf'
  label: string
}

export interface CompMove {
  thresholdDb: number
  ratio: number
  makeupDb: number
  label: string
}

export interface StereoMove {
  /** monoïse le canal Side sous cette fréquence (null = pas de correction) */
  bassMonoHz: number | null
  /** shelf haut sur le canal Side (dB) : élargit/resserre les aigus */
  sHighShelfDb: number
  /** gain global du canal Side (linéaire) : largeur d'ensemble */
  sWidthGain: number
  labels: string[]
}

export interface Corrections {
  eq: EqMove[]
  comp: CompMove | null
  stereo: StereoMove | null
}

const MAX_FILTERS = 8

const bandName = (f: number): string =>
  f < 120 ? 'graves' : f < 500 ? 'bas-médiums' : f < 2000 ? 'médiums' : f < 6000 ? 'hauts-médiums' : 'aigus'

/** Réponse en dB d'un biquad RBJ (fs 48 kHz) aux fréquences demandées. */
function biquadResponseDb(
  type: EqMove['type'],
  f0: number,
  q: number,
  gainDb: number,
  freqs: number[]
): number[] {
  const fs = 48000
  const A = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * f0) / fs
  const cosW = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
  if (type === 'peaking') {
    b0 = 1 + alpha * A
    b1 = -2 * cosW
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * cosW
    a2 = 1 - alpha / A
  } else if (type === 'lowshelf') {
    const s = 2 * Math.sqrt(A) * alpha
    b0 = A * (A + 1 - (A - 1) * cosW + s)
    b1 = 2 * A * (A - 1 - (A + 1) * cosW)
    b2 = A * (A + 1 - (A - 1) * cosW - s)
    a0 = A + 1 + (A - 1) * cosW + s
    a1 = -2 * (A - 1 + (A + 1) * cosW)
    a2 = A + 1 + (A - 1) * cosW - s
  } else {
    const s = 2 * Math.sqrt(A) * alpha
    b0 = A * (A + 1 + (A - 1) * cosW + s)
    b1 = -2 * A * (A - 1 + (A + 1) * cosW)
    b2 = A * (A + 1 + (A - 1) * cosW - s)
    a0 = A + 1 - (A - 1) * cosW + s
    a1 = 2 * (A - 1 - (A + 1) * cosW)
    a2 = A + 1 - (A - 1) * cosW - s
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0
  return freqs.map((f) => {
    const w = (2 * Math.PI * f) / fs
    const c1 = Math.cos(w), s1 = Math.sin(w)
    const c2 = Math.cos(2 * w), s2 = Math.sin(2 * w)
    const nr = b0 + b1 * c1 + b2 * c2
    const ni = b1 * s1 + b2 * s2
    const dr = 1 + a1 * c1 + a2 * c2
    const di = a1 * s1 + a2 * s2
    const mag2 = (nr * nr + ni * ni) / (dr * dr + di * di)
    return 10 * Math.log10(mag2 + 1e-20)
  })
}

/**
 * EQ matching chirurgical : fitting itératif de la courbe Δ (A alignée − B).
 * À chaque itération, la déviation dominante est localisée, sa LARGEUR mesurée
 * (points à mi-hauteur) donne le Q réel (jusqu'à 8), un filtre correctif est
 * posé à la fréquence exacte, sa réponse théorique est soustraite du résidu,
 * et on itère jusqu'à résidu < 1,2 dB ou 8 filtres.
 */
export function computeCorrections(a: AnalysisData, b: AnalysisData): Corrections {
  const offset = a.lufsI - b.lufsI // alignement : on compare la forme
  const freqs = a.freqs
  const n = freqs.length
  // résidu initial, légèrement lissé pour ne pas fitter le bruit de mesure
  const raw = freqs.map((_, i) => a.spectrum[i] - offset - b.spectrum[i])
  const residual = raw.map((_, i) => {
    let sum = 0
    let cnt = 0
    for (let k = Math.max(0, i - 1); k <= Math.min(n - 1, i + 1); k++) {
      sum += raw[k]
      cnt++
    }
    return sum / cnt
  })
  // pondération : le très grave et l'extrême aigu comptent un peu moins
  const weight = freqs.map((f) => (f < 40 || f > 16000 ? 0.3 : f < 60 || f > 12000 ? 0.7 : 1))

  const eq: EqMove[] = []
  for (let iter = 0; iter < MAX_FILTERS; iter++) {
    let pi = -1
    let pv = 0
    for (let i = 0; i < n; i++) {
      const v = Math.abs(residual[i]) * weight[i]
      if (freqs[i] < 30 || freqs[i] > 18000 || v <= pv) continue
      // pas d'empilement : on ne repose pas un filtre corrigeant le même signe
      // à moins d'une demi-octave d'un filtre déjà posé
      const stacked = eq.some(
        (m) => Math.abs(Math.log2(freqs[i] / m.freq)) < 0.45 && Math.sign(residual[i]) === -Math.sign(m.gainDb)
      )
      if (stacked) continue
      pv = v
      pi = i
    }
    if (pi < 0 || Math.abs(residual[pi]) < 1.2) break

    const peak = residual[pi]
    const sign = Math.sign(peak)
    // largeur à mi-hauteur, même signe
    let lo = pi
    while (lo > 0 && Math.sign(residual[lo - 1]) === sign && Math.abs(residual[lo - 1]) >= Math.abs(peak) / 2) lo--
    let hi = pi
    while (hi < n - 1 && Math.sign(residual[hi + 1]) === sign && Math.abs(residual[hi + 1]) >= Math.abs(peak) / 2) hi++
    const bwOct = Math.max(0.12, Math.log2(freqs[Math.min(n - 1, hi + 1)] / freqs[Math.max(0, lo - 1)]))
    // Q depuis la bande passante mesurée : Q = 2^(N/2) / (2^N − 1)
    let q = Math.pow(2, bwOct / 2) / (Math.pow(2, bwOct) - 1)
    q = Math.max(0.5, Math.min(8, q))

    // déviations très larges aux extrêmes : un shelf est plus musical
    let type: EqMove['type'] = 'peaking'
    if (bwOct > 2.2 && freqs[pi] < 150) {
      type = 'lowshelf'
      q = 0.72
    } else if (bwOct > 2.2 && freqs[pi] > 5000) {
      type = 'highshelf'
      q = 0.72
    }

    const gainDb = Math.round(Math.max(-12, Math.min(12, -peak * 0.85)) * 10) / 10
    const f0 = Math.round(freqs[pi])
    eq.push({ freq: f0, gainDb, q: Math.round(q * 10) / 10, type, label: bandName(f0) })

    // soustrait la réponse réelle du filtre du résidu
    const resp = biquadResponseDb(type, f0, q, gainDb, freqs)
    for (let i = 0; i < n; i++) residual[i] += resp[i]
  }
  eq.sort((x, y) => Math.abs(y.gainDb) - Math.abs(x.gainDb))

  /* ————— correction stéréo (matching M/S vs référence) ————— */
  let stereo: StereoMove | null = null
  {
    const labels: string[] = []
    let bassMonoHz: number | null = null
    let sHighShelfDb = 0
    let sWidthGain = 1
    // basses trop larges vs référence : monoïsation sous 120 Hz
    if (a.widthLowDb > -20 && a.widthLowDb > b.widthLowDb + 3) {
      bassMonoHz = 120
      labels.push('basses → mono sous 120 Hz')
    }
    // largeur des aigus : shelf sur le canal Side
    const dHigh = b.widthHighDb - a.widthHighDb
    if (Math.abs(dHigh) >= 2 && a.widthHighDb > -55) {
      sHighShelfDb = Math.round(Math.max(-6, Math.min(6, dHigh)) * 10) / 10
      labels.push(`largeur aigus ${sHighShelfDb > 0 ? '+' : ''}${sHighShelfDb} dB`)
    }
    // largeur d'ensemble (médiums) : gain global du Side
    const dMid = b.widthMidDb - a.widthMidDb
    if (Math.abs(dMid) >= 2 && a.widthMidDb > -55) {
      sWidthGain = Math.round(Math.max(0.5, Math.min(1.8, Math.pow(10, dMid / 20))) * 100) / 100
      labels.push(`largeur globale ×${sWidthGain}`)
    }
    if (labels.length > 0) stereo = { bassMonoHz, sHighShelfDb, sWidthGain, labels }
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
  return { eq, comp, stereo }
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
  private sHighpass: BiquadFilterNode | null = null
  private sShelf: BiquadFilterNode | null = null
  private sWidth: GainNode | null = null
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
    const raw = this.ctx.createMediaElementSource(this.audio)

    // ————— matrice Mid/Side : M=(L+R)/2, S=(L-R)/2, retour L=M+S, R=M−S —————
    const split = this.ctx.createChannelSplitter(2)
    raw.connect(split)
    const mSum = this.ctx.createGain()
    const sSum = this.ctx.createGain()
    const lHalf = this.ctx.createGain()
    const rHalfM = this.ctx.createGain()
    const rHalfS = this.ctx.createGain()
    const lHalfS = this.ctx.createGain()
    lHalf.gain.value = 0.5
    rHalfM.gain.value = 0.5
    lHalfS.gain.value = 0.5
    rHalfS.gain.value = -0.5
    split.connect(lHalf, 0)
    split.connect(rHalfM, 1)
    lHalf.connect(mSum)
    rHalfM.connect(mSum)
    split.connect(lHalfS, 0)
    split.connect(rHalfS, 1)
    lHalfS.connect(sSum)
    rHalfS.connect(sSum)
    // chaîne du Side : highpass (bass mono) → shelf aigus → largeur globale
    this.sHighpass = this.ctx.createBiquadFilter()
    this.sHighpass.type = 'highpass'
    this.sHighpass.frequency.value = 10 // 10 Hz ≈ neutre
    this.sHighpass.Q.value = 0.71
    this.sShelf = this.ctx.createBiquadFilter()
    this.sShelf.type = 'highshelf'
    this.sShelf.frequency.value = 5000
    this.sShelf.gain.value = 0
    this.sWidth = this.ctx.createGain()
    sSum.connect(this.sHighpass)
    this.sHighpass.connect(this.sShelf)
    this.sShelf.connect(this.sWidth)
    // retour L/R
    const merger = this.ctx.createChannelMerger(2)
    const sNeg = this.ctx.createGain()
    sNeg.gain.value = -1
    mSum.connect(merger, 0, 0)
    this.sWidth.connect(merger, 0, 0)
    mSum.connect(merger, 0, 1)
    this.sWidth.connect(sNeg)
    sNeg.connect(merger, 0, 1)
    const src = merger
    // pool de filtres : configurés à la volée, gain 0 = transparent
    this.filters = Array.from({ length: MAX_FILTERS }, () => {
      const f = this.ctx!.createBiquadFilter()
      f.type = 'peaking'
      f.frequency.value = 1000
      f.Q.value = 1
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
    for (let i = 0; i < this.filters.length; i++) {
      const move = active ? corrections.eq[i] : undefined
      if (move) {
        this.filters[i].type = move.type
        this.filters[i].frequency.value = move.freq
        this.filters[i].Q.value = move.q
        this.filters[i].gain.value = move.gainDb
      } else {
        this.filters[i].gain.value = 0
      }
    }
    if (this.sHighpass && this.sShelf && this.sWidth) {
      const st = active ? corrections.stereo : null
      this.sHighpass.frequency.value = st?.bassMonoHz ?? 10
      this.sShelf.gain.value = st?.sHighShelfDb ?? 0
      this.sWidth.gain.value = st?.sWidthGain ?? 1
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
