import { player } from './player'

/**
 * Analyseur spectral temps réel : branche les deux éléments <audio> du lecteur
 * dans un AudioContext (pass-through neutre) et expose un AnalyserNode.
 * Créé au premier usage, conservé ensuite — la lecture continue de passer
 * par le graphe (gain unité, aucun traitement).
 */
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null

export function getAnalyser(): AnalyserNode | null {
  if (analyser) return analyser
  try {
    const elements = (player as unknown as { a: HTMLAudioElement; b: HTMLAudioElement })
    ctx = new AudioContext()
    analyser = ctx.createAnalyser()
    // résolution maximale de l'AnalyserNode : bandes d'environ 1,5 Hz.
    // La FFT est native (Chromium), le coût reste négligeable.
    analyser.fftSize = 32768
    analyser.smoothingTimeConstant = 0.5
    analyser.minDecibels = -100
    analyser.maxDecibels = -5
    const merge = ctx.createGain()
    for (const el of [elements.a, elements.b]) {
      const src = ctx.createMediaElementSource(el)
      src.connect(merge)
    }
    merge.connect(analyser)
    merge.connect(ctx.destination)
    return analyser
  } catch {
    ctx = null
    analyser = null
    return null
  }
}

export function resumeRta(): void {
  void ctx?.resume().catch(() => {})
}

export function rtaSampleRate(): number {
  return ctx?.sampleRate ?? 44100
}
