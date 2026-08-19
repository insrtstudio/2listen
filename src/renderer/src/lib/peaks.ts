import type { Peaks } from '@shared/types'
import { decodeTrack } from './decode'
import type { PeaksResult } from '../workers/peaks.worker'
import PeaksWorker from '../workers/peaks.worker?worker'

/** 2048 buckets ≈ un pic par pixel sur un écran large — waveform très détaillée. */
export const BUCKETS = 2048

const memory = new Map<string, Peaks>()
const pending = new Map<string, Promise<Peaks | null>>()

/** 6 plans : min, max, low, mid, high, trans. */
export const PLANES = 6

function unpack(buckets: number, buf: ArrayBuffer): Peaks {
  const u8 = new Uint8Array(buf)
  const plane = (i: number): Uint8Array => u8.slice(buckets * i, buckets * (i + 1))
  return {
    buckets,
    min: plane(0),
    max: plane(1),
    low: plane(2),
    mid: plane(3),
    high: plane(4),
    trans: plane(5)
  }
}

async function compute(id: string, path: string): Promise<Peaks | null> {
  const decoded = await decodeTrack(path)
  if (!decoded) return null

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
      { id, buckets: BUCKETS, sampleRate: decoded.sampleRate, channels },
      channels.map((c) => c.buffer)
    )
  })
}

/** Mémoire → disque → calcul. Une seule promesse en vol par piste. */
export function getPeaks(id: string, path: string): Promise<Peaks | null> {
  const cached = memory.get(id)
  if (cached) return Promise.resolve(cached)
  const inflight = pending.get(id)
  if (inflight) return inflight

  const job = (async () => {
    const disk = await window.tl.peaks.read(id)
    // l'ancien cache 3 plans (v1) a une taille différente : il est recalculé
    if (disk && disk.byteLength === BUCKETS * PLANES) {
      const peaks = unpack(BUCKETS, disk)
      memory.set(id, peaks)
      return peaks
    }
    const peaks = await compute(id, path)
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
