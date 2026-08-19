import type { AnalysisData } from '@shared/types'
import type { AnalysisResultMsg } from '../workers/analysis.worker'
import AnalysisWorker from '../workers/analysis.worker?worker'

const ANALYSIS_VERSION = 1

const memory = new Map<string, AnalysisData>()
const pending = new Map<string, Promise<AnalysisData | null>>()

async function compute(id: string, audioUrl: string): Promise<AnalysisData | null> {
  let decoded: AudioBuffer
  try {
    const res = await fetch(audioUrl)
    const raw = await res.arrayBuffer()
    const ctx = new OfflineAudioContext(1, 1, 44100)
    decoded = await ctx.decodeAudioData(raw)
  } catch {
    return null
  }
  const channels: Float32Array[] = []
  for (let c = 0; c < Math.min(2, decoded.numberOfChannels); c++) channels.push(decoded.getChannelData(c))

  return new Promise((resolveAnalysis) => {
    const worker = new AnalysisWorker()
    worker.onmessage = (e: MessageEvent<AnalysisResultMsg>) => {
      worker.terminate()
      const data: AnalysisData = e.data.result
      void window.tl.analysis.write(id, JSON.stringify(data))
      resolveAnalysis(data)
    }
    worker.onerror = () => {
      worker.terminate()
      resolveAnalysis(null)
    }
    worker.postMessage(
      { id, sampleRate: decoded.sampleRate, channels },
      channels.map((c) => c.buffer)
    )
  })
}

/** Mémoire → cache disque → calcul complet (une promesse en vol par piste). */
export function getAnalysis(id: string, audioUrl: string): Promise<AnalysisData | null> {
  const cached = memory.get(id)
  if (cached) return Promise.resolve(cached)
  const inflight = pending.get(id)
  if (inflight) return inflight

  const job = (async () => {
    const disk = await window.tl.analysis.read(id)
    if (disk) {
      try {
        const parsed = JSON.parse(disk) as AnalysisData
        if (parsed.version === ANALYSIS_VERSION && Array.isArray(parsed.spectrum)) {
          memory.set(id, parsed)
          return parsed
        }
      } catch {
        /* cache illisible : recalcul */
      }
    }
    const data = await compute(id, audioUrl)
    if (data) {
      memory.set(id, data)
      if (memory.size > 24) {
        const first = memory.keys().next().value
        if (first && first !== id) memory.delete(first)
      }
    }
    return data
  })().finally(() => pending.delete(id))

  pending.set(id, job)
  return job
}
