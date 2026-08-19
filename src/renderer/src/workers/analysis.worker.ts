/**
 * Analyse audio complète pour l'outil A/B :
 *  – LUFS intégrée (ITU-R BS.1770-4 : pondération K + gating absolu/relatif)
 *  – LUFS court terme max et LRA (EBU R128)
 *  – crête échantillon, crête inter-échantillons (Catmull-Rom 4x), RMS,
 *    facteur de crête, PLR
 *  – spectre moyen de Welch (FFT 8192, Hann) sur points log-espacés 20 Hz–20 kHz
 */
export interface AnalysisJob {
  id: string
  sampleRate: number
  channels: Float32Array[]
}

export interface AnalysisResultMsg {
  id: string
  result: {
    version: number
    lufsI: number
    lufsSMax: number
    lra: number
    peakDb: number
    truePeakDb: number
    rmsDb: number
    crestDb: number
    plr: number
    spectrum: number[]
    freqs: number[]
    bpm: number
    keyName: string
    camelot: string
    beatPhase: number
  }
}

const db = (v: number): number => (v > 0 ? 20 * Math.log10(v) : -120)
const round1 = (v: number): number => Math.round(v * 10) / 10

/* — biquad (formules RBJ) — */
interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

function highShelf(fs: number, f0: number, gainDb: number, q: number): Biquad {
  const A = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * f0) / fs
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const b0 = A * (A + 1 + (A - 1) * cos + 2 * Math.sqrt(A) * alpha)
  const b1 = -2 * A * (A - 1 + (A + 1) * cos)
  const b2 = A * (A + 1 + (A - 1) * cos - 2 * Math.sqrt(A) * alpha)
  const a0 = A + 1 - (A - 1) * cos + 2 * Math.sqrt(A) * alpha
  const a1 = 2 * (A - 1 - (A + 1) * cos)
  const a2 = A + 1 - (A - 1) * cos - 2 * Math.sqrt(A) * alpha
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

function highPass(fs: number, f0: number, q: number): Biquad {
  const w0 = (2 * Math.PI * f0) / fs
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const b0 = (1 + cos) / 2
  const b1 = -(1 + cos)
  const b2 = (1 + cos) / 2
  const a0 = 1 + alpha
  const a1 = -2 * cos
  const a2 = 1 - alpha
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

/* — FFT radix-2 itérative (réel : im initialisé à 0) — */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k]
        const uIm = im[i + k]
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe
        re[i + k] = uRe + vRe
        im[i + k] = uIm + vIm
        re[i + k + len / 2] = uRe - vRe
        im[i + k + len / 2] = uIm - vIm
        const nRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nRe
      }
    }
  }
}

self.onmessage = (e: MessageEvent<AnalysisJob>) => {
  const { id, sampleRate: fs, channels } = e.data
  const n = channels[0]?.length ?? 0
  const nCh = channels.length
  if (n === 0 || nCh === 0) return

  /* ————— pondération K + énergies par tranche de 100 ms ————— */
  const shelf = highShelf(fs, 1681.97, 3.99976, 0.7071752)
  const hp = highPass(fs, 38.135, 0.5003271)
  const hop = Math.max(1, Math.round(fs / 10)) // 100 ms
  const nHops = Math.ceil(n / hop)
  const hopEnergy = new Float64Array(nHops) // somme des carrés pondérés K (tous canaux)
  const HOP_B = 512 // ≈11,6 ms : résolution du détecteur de tempo
  const beatEnergy = new Float64Array(Math.ceil(n / HOP_B) + 1)

  let peak = 0
  let truePeak = 0
  let totalEnergy = 0

  for (let c = 0; c < nCh; c++) {
    const x = channels[c]
    let s1 = 0, s2 = 0, h1 = 0, h2 = 0 // états biquads (forme directe II transposée)
    let p0 = 0, p1 = 0, p2 = 0 // fenêtre pour l'interpolation Catmull-Rom
    for (let i = 0; i < n; i++) {
      const v = x[i]
      const av = Math.abs(v)
      if (av > peak) peak = av
      totalEnergy += v * v
      beatEnergy[(i / HOP_B) | 0] += v * v

      // crête inter-échantillons : Catmull-Rom sur (p2,p1,p0,v) à t=0.25/0.5/0.75
      if (i >= 3) {
        for (let t = 0.25; t < 1; t += 0.25) {
          const t2 = t * t
          const t3 = t2 * t
          const y =
            0.5 *
            (2 * p1 +
              (-p2 + p0) * t +
              (2 * p2 - 5 * p1 + 4 * p0 - v) * t2 +
              (-p2 + 3 * p1 - 3 * p0 + v) * t3)
          const ay = Math.abs(y)
          if (ay > truePeak) truePeak = ay
        }
      }
      p2 = p1
      p1 = p0
      p0 = v

      // pondération K : shelf puis high-pass
      let y = shelf.b0 * v + s1
      s1 = shelf.b1 * v - shelf.a1 * y + s2
      s2 = shelf.b2 * v - shelf.a2 * y
      const k = hp.b0 * y + h1
      h1 = hp.b1 * y - hp.a1 * k + h2
      h2 = hp.b2 * y - hp.a2 * k

      hopEnergy[Math.floor(i / hop)] += k * k
    }
  }
  if (truePeak < peak) truePeak = peak

  /* ————— loudness par blocs (BS.1770 : 400 ms, recouvrement 75 %) ————— */
  const blockLoudness: number[] = []
  for (let j = 0; j + 4 <= nHops; j++) {
    let sum = 0
    for (let k = 0; k < 4; k++) sum += hopEnergy[j + k]
    const mean = sum / (4 * hop)
    blockLoudness.push(-0.691 + 10 * Math.log10(mean + 1e-12))
  }
  // gating absolu (−70) puis relatif (−10)
  const abs = blockLoudness.filter((l) => l > -70)
  const meanE = (ls: number[]): number =>
    ls.reduce((s, l) => s + Math.pow(10, (l + 0.691) / 10), 0) / (ls.length || 1)
  let lufsI = -70
  if (abs.length > 0) {
    const relThreshold = -0.691 + 10 * Math.log10(meanE(abs)) - 10
    const gated = abs.filter((l) => l > relThreshold)
    lufsI = gated.length > 0 ? -0.691 + 10 * Math.log10(meanE(gated)) : -70
  }

  /* ————— court terme 3 s (pas de 100 ms) : max + LRA ————— */
  const stWindow = 30 // 30 hops de 100 ms
  const shortTerm: number[] = []
  let acc = 0
  for (let j = 0; j < nHops; j++) {
    acc += hopEnergy[j]
    if (j >= stWindow) acc -= hopEnergy[j - stWindow]
    if (j >= stWindow - 1) {
      const mean = acc / (stWindow * hop)
      shortTerm.push(-0.691 + 10 * Math.log10(mean + 1e-12))
    }
  }
  const stAbs = shortTerm.filter((l) => l > -70)
  let lufsSMax = -70
  let lra = 0
  if (stAbs.length > 0) {
    lufsSMax = Math.max(...stAbs)
    const relT = -0.691 + 10 * Math.log10(meanE(stAbs)) - 20
    const gated = stAbs.filter((l) => l > relT).sort((a, b) => a - b)
    if (gated.length >= 2) {
      const p = (q: number): number => gated[Math.min(gated.length - 1, Math.floor(q * gated.length))]
      lra = p(0.95) - p(0.1)
    }
  }

  /* ————— spectre de Welch sur le mix mono ————— */
  const FFT_N = 8192
  const POINTS = 240
  const spectrumAcc = new Float64Array(FFT_N / 2)
  const hann = new Float64Array(FFT_N)
  for (let i = 0; i < FFT_N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_N)
  const maxWindows = 160
  const available = Math.max(1, Math.floor((n - FFT_N) / (FFT_N / 2)) + 1)
  const useWindows = Math.min(maxWindows, available)
  const strideWin = available > 1 ? Math.floor((n - FFT_N) / Math.max(1, useWindows - 1)) : 0
  const re = new Float64Array(FFT_N)
  const im = new Float64Array(FFT_N)
  let windowsDone = 0
  for (let wIdx = 0; wIdx < useWindows; wIdx++) {
    const start = Math.min(Math.max(0, n - FFT_N), wIdx * strideWin)
    for (let i = 0; i < FFT_N; i++) {
      let v = 0
      for (let c = 0; c < nCh; c++) v += channels[c][start + i]
      re[i] = (v / nCh) * hann[i]
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k < FFT_N / 2; k++) spectrumAcc[k] += re[k] * re[k] + im[k] * im[k]
    windowsDone++
  }
  // points log-espacés 20 Hz → 20 kHz, lissés ~1/6 d'octave
  const fMin = 20
  const fMax = Math.min(20000, fs / 2 - 100)
  const freqs: number[] = []
  const spectrum: number[] = []
  const binHz = fs / FFT_N
  // normalisation : fenêtre Hann (somme des gains) + nombre de fenêtres
  const norm = windowsDone * Math.pow(FFT_N / 2, 2)
  for (let p = 0; p < POINTS; p++) {
    const f = fMin * Math.pow(fMax / fMin, p / (POINTS - 1))
    const half = Math.pow(2, 1 / 12) // ± demi-ton ≈ lissage 1/6 octave
    const k0 = Math.max(1, Math.floor(f / half / binHz))
    const k1 = Math.min(FFT_N / 2 - 1, Math.ceil((f * half) / binHz))
    let sum = 0
    let cnt = 0
    for (let k = k0; k <= k1; k++) {
      sum += spectrumAcc[k]
      cnt++
    }
    freqs.push(Math.round(f))
    spectrum.push(round1(10 * Math.log10(sum / (cnt || 1) / norm + 1e-20)))
  }

  /* ————— tempo : autocorrélation du flux d'énergie ————— */
  const hopSec = HOP_B / fs
  const nb = beatEnergy.length
  const flux = new Float64Array(nb)
  for (let i = 1; i < nb; i++) flux[i] = Math.max(0, beatEnergy[i] - beatEnergy[i - 1])
  let fluxMean = 0
  for (let i = 0; i < nb; i++) fluxMean += flux[i]
  fluxMean /= nb || 1
  for (let i = 0; i < nb; i++) flux[i] = Math.max(0, flux[i] - fluxMean)
  const minLag = Math.max(2, Math.floor(60 / (200 * hopSec))) // 200 BPM
  const maxLag = Math.min(nb >> 1, Math.ceil(60 / (60 * hopSec))) // 60 BPM
  let bpm = 0
  if (maxLag > minLag + 4) {
    const ac = new Float64Array(maxLag + 1)
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0
      for (let i = 0; i + lag < nb; i++) sum += flux[i] * flux[i + lag]
      ac[lag] = sum / (nb - lag)
    }
    let best = minLag
    let bestScore = -1
    for (let lag = minLag; lag <= maxLag; lag++) {
      const cand = 60 / (lag * hopSec)
      // renforce les harmoniques du tempo, pénalise les extrêmes
      let score = ac[lag]
      if (lag * 2 <= maxLag) score += 0.5 * ac[lag * 2]
      score *= 1 - 0.4 * Math.abs(Math.log2(cand / 120))
      if (score > bestScore) {
        bestScore = score
        best = lag
      }
    }
    bpm = 60 / (best * hopSec)
    if (bpm < 75) bpm *= 2
    if (bpm > 190) bpm /= 2
    bpm = Math.round(bpm * 10) / 10
  }

  /* ————— phase de la grille : peigne au pas du battement ————— */
  let beatPhase = 0
  if (bpm > 0) {
    const period = 60 / bpm / hopSec // battement en hops (fractionnaire)
    const span = Math.min(nb, Math.floor(90 / hopSec)) // 90 premières secondes
    let bestO = 0
    let bestS = -1
    const steps = Math.max(8, Math.round(period))
    for (let s2 = 0; s2 < steps; s2++) {
      const o = (s2 / steps) * period
      let sum = 0
      for (let t = o; t < span; t += period) sum += flux[Math.round(t)] ?? 0
      if (sum > bestS) {
        bestS = sum
        bestO = o
      }
    }
    beatPhase = Math.round(bestO * hopSec * 1000) / 1000
  }

  /* ————— tonalité : chroma depuis le spectre moyen + profils de Krumhansl ————— */
  const chroma = new Float64Array(12)
  for (let k = 1; k < FFT_N / 2; k++) {
    const f = k * binHz
    if (f < 55 || f > 5000) continue
    const pc = ((Math.round(12 * Math.log2(f / 261.6256)) % 12) + 120) % 12
    chroma[pc] += spectrumAcc[k] / (1 + f / 2000) // dé-emphase des aigus
  }
  const NOTES = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si']
  const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
  const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
  const CAM_MAJ = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B']
  const CAM_MIN = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A']
  const corr = (profile: number[], root: number): number => {
    let s = 0
    for (let i = 0; i < 12; i++) s += profile[(i - root + 12) % 12] * chroma[i]
    return s
  }
  let keyName = '—'
  let camelot = '—'
  let bestK = -1
  for (let r = 0; r < 12; r++) {
    const cM = corr(MAJ, r)
    const cm = corr(MIN, r)
    if (cM > bestK) {
      bestK = cM
      keyName = `${NOTES[r]} majeur`
      camelot = CAM_MAJ[r]
    }
    if (cm > bestK) {
      bestK = cm
      keyName = `${NOTES[r]} mineur`
      camelot = CAM_MIN[r]
    }
  }

  const rms = Math.sqrt(totalEnergy / (n * nCh))
  const peakDb = round1(db(peak))
  const truePeakDb = round1(db(truePeak))
  const rmsDb = round1(db(rms))

  const result: AnalysisResultMsg['result'] = {
    version: 3,
    lufsI: round1(lufsI),
    lufsSMax: round1(lufsSMax),
    lra: round1(lra),
    peakDb,
    truePeakDb,
    rmsDb,
    crestDb: round1(peakDb - rmsDb),
    plr: round1(truePeakDb - lufsI),
    spectrum,
    freqs,
    bpm,
    keyName,
    camelot,
    beatPhase
  }
  ;(self as unknown as Worker).postMessage({ id, result } satisfies AnalysisResultMsg)
}
