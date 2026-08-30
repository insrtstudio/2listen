import { player } from './player'
import { getAudioGraph } from './rta'

/**
 * Enregistrement du clip streamer : vidéo = captureStream du canvas de la
 * scène, audio = prise sur le graphe du lecteur (compensée du volume, pour un
 * clip au niveau du fichier quel que soit le curseur) + micro optionnel.
 * MediaRecorder encode ; les morceaux partent au main au fil de l'eau.
 */
const MIMES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1,opus',
  'video/mp4',
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm'
]

export function pickClipMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  return MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
}

export const clipExt = (mime: string): string => (mime.startsWith('video/mp4') ? 'mp4' : 'webm')

export class ClipRecorder {
  readonly mime = pickClipMime()
  startedAt = 0
  private rec: MediaRecorder | null = null
  private id: string | null = null
  private chain: Promise<void> = Promise.resolve()
  private cleanup: Array<() => void> = []
  private stopped: Promise<void> | null = null

  get active(): boolean {
    return !!this.rec && this.rec.state !== 'inactive'
  }

  async start(canvas: HTMLCanvasElement, mic: MediaStream | null, fps = 30): Promise<void> {
    if (!this.mime) throw new Error('MediaRecorder indisponible')
    const graph = getAudioGraph()
    if (!graph) throw new Error('Graphe audio indisponible')
    await graph.ctx.resume().catch(() => {})

    // prise audio : lecteur (× 1/volume) + micro éventuel → destination flux
    const dest = graph.ctx.createMediaStreamDestination()
    const comp = graph.ctx.createGain()
    const setComp = (): void => {
      comp.gain.value = player.volume > 0.001 ? 1 / player.volume : 1
    }
    setComp()
    const unsub = player.subscribe(setComp)
    graph.merge.connect(comp)
    comp.connect(dest)
    let micSrc: MediaStreamAudioSourceNode | null = null
    if (mic && mic.getAudioTracks().length > 0) {
      micSrc = graph.ctx.createMediaStreamSource(mic)
      micSrc.connect(dest)
    }
    this.cleanup.push(() => {
      unsub()
      try {
        graph.merge.disconnect(comp)
      } catch {
        /* déjà déconnecté */
      }
      comp.disconnect()
      micSrc?.disconnect()
    })

    const video = canvas.captureStream(fps)
    const stream = new MediaStream([...video.getVideoTracks(), ...dest.stream.getAudioTracks()])
    this.cleanup.push(() => {
      for (const tr of video.getTracks()) tr.stop()
    })

    this.id = await window.tl.clip.start(clipExt(this.mime))
    const id = this.id
    const rec = new MediaRecorder(stream, {
      mimeType: this.mime,
      videoBitsPerSecond: 12_000_000,
      audioBitsPerSecond: 256_000
    })
    this.rec = rec
    this.stopped = new Promise<void>((resolve) => {
      rec.addEventListener('stop', () => resolve(), { once: true })
      rec.addEventListener('error', () => resolve(), { once: true })
    })
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data.size === 0) return
      const blob = e.data
      this.chain = this.chain.then(async () => {
        const buf = await blob.arrayBuffer()
        await window.tl.clip.chunk(id, buf)
      })
    }
    rec.start(1000)
    this.startedAt = performance.now()
  }

  /** Arrête l'encodage, propose l'enregistrement ; chemin final ou null. */
  async stop(suggestedName: string): Promise<string | null> {
    const id = this.id
    if (!this.rec || !id) return null
    if (this.rec.state !== 'inactive') this.rec.stop()
    await this.stopped
    await this.chain
    this.release()
    return window.tl.clip.finish(id, suggestedName)
  }

  async cancel(): Promise<void> {
    const id = this.id
    if (this.rec && this.rec.state !== 'inactive') {
      this.rec.ondataavailable = null
      this.rec.stop()
      await this.stopped
    }
    this.release()
    if (id) await window.tl.clip.cancel(id)
  }

  private release(): void {
    for (const fn of this.cleanup.splice(0)) fn()
    this.rec = null
    this.id = null
  }
}
