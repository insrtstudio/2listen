import type { Peaks } from '@shared/types'
import type { PeaksResult } from '../workers/peaks.worker'
import PeaksWorker from '../workers/peaks.worker?worker'

/** 2048 buckets ≈ un pic par pixel sur un écran large — waveform très détaillée. */
export const BUCKETS = 2048

const memory = new Map<string, Peaks>()
const pending = new Map<string, Promise<Peaks | null>>()

function unpack(buckets: number, buf: ArrayBuffer): Peaks {
  const u8 = new Uint8Array(buf)
  return {
    buckets,
    min: u8.slice(0, buckets),
    max: u8.slice(buckets, buckets * 2),
    rms: u8.slice(buckets * 2, buckets * 3)
  }
}

async function compute(id: string, audioUrl: string): Promise<Peaks | null> {
  let decoded: AudioBuffer
  try {
    const res = await fetch(audioUrl)
    const raw = await res.arrayBuffer()
    // Contexte jetable : uniquement pour décoder, jamais pour jouer.
    const ctx = new OfflineAudioContext(1, 1, 44100)
    decoded = await ctx.decodeAudioData(raw)
  } catch {
    return null
  }

  const channels: Float32Array[] = []
  for (let c = 0; c < Math.min(2, decoded.numberOfChannels); c++) {
    channels.push(decoded.getChannelData(c))
  }

  return new Promise((resolvePeaks) => {
    const worker = new PeaksWorker()
    worker.onmessage = (e: MessageEvent<PeaksResult>) => {
      worker.terminate()
      const peaks = unpack(e.data.buckets, e.data.data)
      void window.tl.peaks.write(id, e.data.data)
      resolvePeaks(peaks)
    }
    worker.onerror = () => {
      worker.terminate()
      resolvePeaks(null)
    }
    worker.postMessage(
      { id, buckets: BUCKETS, channels },
      channels.map((c) => c.buffer)
    )
  })
}

/** Mémoire → disque → calcul. Une seule promesse en vol par piste. */
export function getPeaks(id: string, audioUrl: string): Promise<Peaks | null> {
  const cached = memory.get(id)
  if (cached) return Promise.resolve(cached)
  const inflight = pending.get(id)
  if (inflight) return inflight

  const job = (async () => {
    const disk = await window.tl.peaks.read(id)
    if (disk && disk.byteLength === BUCKETS * 3) {
      const peaks = unpack(BUCKETS, disk)
      memory.set(id, peaks)
      return peaks
    }
    const peaks = await compute(id, audioUrl)
    if (peaks) {
      memory.set(id, peaks)
      if (memory.size > 40) {
        const first = memory.keys().next().value
        if (first && first !== id) memory.delete(first)
      }
    }
    return peaks
  })().finally(() => pending.delete(id))

  pending.set(id, job)
  return job
}
