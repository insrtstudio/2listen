import { player } from './player'

/**
 * Graphe audio partagé : branche les deux éléments <audio> du lecteur dans un
 * AudioContext (pass-through neutre, gain unité) et expose le nœud de mélange.
 * Créé au premier usage, conservé ensuite — la lecture continue de passer par
 * le graphe. Sert au RTA (AnalyserNode) et à l'enregistrement du mode streamer
 * (MediaStreamDestination).
 */
let ctx: AudioContext | null = null
let merge: GainNode | null = null
let analyser: AnalyserNode | null = null

export interface AudioGraph {
  ctx: AudioContext
  /** Somme des deux éléments <audio> (avant la sortie). */
  merge: GainNode
}

export function getAudioGraph(): AudioGraph | null {
  if (ctx && merge) return { ctx, merge }
  try {
    const elements = player as unknown as { a: HTMLAudioElement; b: HTMLAudioElement }
    ctx = new AudioContext()
    merge = ctx.createGain()
    for (const el of [elements.a, elements.b]) {
      const src = ctx.createMediaElementSource(el)
      src.connect(merge)
    }
    merge.connect(ctx.destination)
    return { ctx, merge }
  } catch {
    ctx = null
    merge = null
    return null
  }
}

export function getAnalyser(): AnalyserNode | null {
  if (analyser) return analyser
  const graph = getAudioGraph()
  if (!graph) return null
  analyser = graph.ctx.createAnalyser()
  // résolution maximale de l'AnalyserNode : bandes d'environ 1,5 Hz.
  // La FFT est native (Chromium), le coût reste négligeable.
  analyser.fftSize = 32768
  analyser.smoothingTimeConstant = 0.5
  analyser.minDecibels = -100
  analyser.maxDecibels = -5
  graph.merge.connect(analyser)
  return analyser
}

export function resumeRta(): void {
  void ctx?.resume().catch(() => {})
}

export function rtaSampleRate(): number {
  return ctx?.sampleRate ?? 44100
}
