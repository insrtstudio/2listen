/**
 * Calcul des pics de forme d'onde à partir des canaux PCM décodés.
 * Trois séries par bucket : min, max (silhouette précise) et RMS (densité
 * d'énergie), quantifiées en Uint8 autour de 128.
 */
export interface PeaksJob {
  id: string
  buckets: number
  channels: Float32Array[]
}

export interface PeaksResult {
  id: string
  buckets: number
  data: ArrayBuffer // [min…, max…, rms…] — 3 × buckets octets
}

self.onmessage = (e: MessageEvent<PeaksJob>) => {
  const { id, buckets, channels } = e.data
  const length = channels[0]?.length ?? 0
  const out = new Uint8Array(buckets * 3)
  if (length === 0 || channels.length === 0) {
    out.fill(128, 0, buckets * 2)
    ;(self as unknown as Worker).postMessage({ id, buckets, data: out.buffer } satisfies PeaksResult, [out.buffer])
    return
  }

  const step = length / buckets
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * step)
    const end = Math.min(length, Math.max(start + 1, Math.floor((b + 1) * step)))
    let min = 1
    let max = -1
    let sum = 0
    let n = 0
    for (const ch of channels) {
      for (let i = start; i < end; i++) {
        const v = ch[i]
        if (v < min) min = v
        if (v > max) max = v
        sum += v * v
        n++
      }
    }
    const rms = Math.sqrt(sum / (n || 1))
    out[b] = Math.round((Math.max(-1, min) + 1) * 127.5)
    out[buckets + b] = Math.round((Math.min(1, max) + 1) * 127.5)
    out[buckets * 2 + b] = Math.round(Math.min(1, rms) * 255)
  }

  ;(self as unknown as Worker).postMessage({ id, buckets, data: out.buffer } satisfies PeaksResult, [out.buffer])
}
