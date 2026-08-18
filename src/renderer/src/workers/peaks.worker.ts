/**
 * Analyse spectrale de forme d'onde en une passe, sans FFT :
 * deux filtres one-pole découpent chaque canal en trois bandes
 * (graves < 180 Hz, médiums, aigus > 3,5 kHz). Par bucket :
 * silhouette min/max, RMS par bande, et score de transitoire
 * (facteur de crête × flux d'énergie montant).
 */
export interface PeaksJob {
  id: string
  buckets: number
  sampleRate: number
  channels: Float32Array[]
}

export interface PeaksResult {
  id: string
  buckets: number
  /** [min, max, low, mid, high, trans] — 6 × buckets octets */
  data: ArrayBuffer
}

const PLANES = 6

self.onmessage = (e: MessageEvent<PeaksJob>) => {
  const { id, buckets, sampleRate, channels } = e.data
  const length = channels[0]?.length ?? 0
  const out = new Uint8Array(buckets * PLANES)
  if (length === 0 || channels.length === 0) {
    out.fill(128, 0, buckets * 2)
    ;(self as unknown as Worker).postMessage({ id, buckets, data: out.buffer } satisfies PeaksResult, [out.buffer])
    return
  }

  const aLow = 1 - Math.exp((-2 * Math.PI * 180) / sampleRate)
  const aHigh = 1 - Math.exp((-2 * Math.PI * 3500) / sampleRate)
  const step = length / buckets
  // gain de quantification : un RMS de bande dépasse rarement ~0.35
  const GAIN = 3

  const lp180 = new Float64Array(channels.length)
  const lp3500 = new Float64Array(channels.length)
  let prevRms = 0

  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * step)
    const end = Math.min(length, Math.max(start + 1, Math.floor((b + 1) * step)))
    let min = 1
    let max = -1
    let peak = 0
    let sumL = 0
    let sumM = 0
    let sumH = 0
    let n = 0
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c]
      let l1 = lp180[c]
      let l2 = lp3500[c]
      for (let i = start; i < end; i++) {
        const x = ch[i]
        if (x < min) min = x
        if (x > max) max = x
        const ax = Math.abs(x)
        if (ax > peak) peak = ax
        l1 += aLow * (x - l1)
        l2 += aHigh * (x - l2)
        const low = l1
        const mid = l2 - l1
        const high = x - l2
        sumL += low * low
        sumM += mid * mid
        sumH += high * high
        n++
      }
      lp180[c] = l1
      lp3500[c] = l2
    }
    const rmsL = Math.sqrt(sumL / (n || 1))
    const rmsM = Math.sqrt(sumM / (n || 1))
    const rmsH = Math.sqrt(sumH / (n || 1))
    const rmsTotal = Math.sqrt((sumL + sumM + sumH) / (n || 1))

    // transitoire : pic net au-dessus du RMS + montée d'énergie vs bucket précédent
    const crest = rmsTotal > 0.004 ? peak / rmsTotal : 0
    const flux = prevRms > 0 ? rmsTotal / prevRms : rmsTotal > 0.02 ? 2 : 0
    const transient = crest > 2.2 && flux > 1.35 && rmsTotal > 0.02
      ? Math.min(1, ((crest - 2.2) / 3) * ((flux - 1) / 1.5) * (rmsTotal * 6))
      : 0
    prevRms = rmsTotal

    out[b] = Math.round((Math.max(-1, min) + 1) * 127.5)
    out[buckets + b] = Math.round((Math.min(1, max) + 1) * 127.5)
    out[buckets * 2 + b] = Math.round(Math.min(1, rmsL * GAIN) * 255)
    out[buckets * 3 + b] = Math.round(Math.min(1, rmsM * GAIN) * 255)
    out[buckets * 4 + b] = Math.round(Math.min(1, rmsH * GAIN) * 255)
    out[buckets * 5 + b] = Math.round(Math.min(1, transient) * 255)
  }

  ;(self as unknown as Worker).postMessage({ id, buckets, data: out.buffer } satisfies PeaksResult, [out.buffer])
}
