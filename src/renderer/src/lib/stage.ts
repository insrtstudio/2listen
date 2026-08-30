import type { AnalysisData, Peaks, Track } from '@shared/types'
import { fmtDuration, fmtQuality } from './format'
import { drawWaveBars, type WaveColors } from './wavedraw'

/**
 * Scène du mode streamer : une publication Instagram rendue sur un canvas
 * 1080 px de large (4:5, 1:1 ou 9:16). Le même canvas sert à l'aperçu et à
 * l'enregistrement (captureStream) — ce qu'on voit est ce qu'on exporte.
 */
export type StageFormat = 'post' | 'square' | 'story'

export const FORMATS: Record<StageFormat, { w: number; h: number; label: string; name: string }> = {
  post: { w: 1080, h: 1350, label: '4:5', name: 'Post' },
  square: { w: 1080, h: 1080, label: '1:1', name: 'Square' },
  story: { w: 1080, h: 1920, label: '9:16', name: 'Story / Reel' }
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface StageState {
  track: Track | null
  peaks: Peaks | null
  analysis: AnalysisData | null
  cover: HTMLImageElement | null
  /** Flux webcam (élément vidéo en lecture) ou null. */
  video: HTMLVideoElement | null
  mirror: boolean
  version: string
  time: number
  duration: number
  playing: boolean
}

export interface StageLayout {
  wave: Rect
  cam: Rect
}

/** Version dérivée du titre : « (Club Mix) », « [v3] », « … - Radio Edit », « v2 ». */
export function parseVersion(title: string): string {
  const paren = title.match(/[([]([^)\]]{1,40})[)\]]\s*$/)
  if (paren) return paren[1].trim()
  const dash = title.match(/\s[-–—]\s([^-–—]{1,40})$/)
  if (dash) return dash[1].trim()
  const v = title.match(/\b(v(?:ersion)?\s?\d+[a-z]?)\b/i)
  if (v) return v[1].trim()
  return ''
}

/** Nom de fichier proposé pour l'export. */
export function clipName(track: Track | null, version: string, ext: string): string {
  const base = track ? `${track.artist ? track.artist + ' - ' : ''}${track.title}` : 'clip'
  const v = version ? ` (${version})` : ''
  return `${base}${v} — 2Listen.${ext}`.replace(/[/\\:*?"<>|]+/g, '-')
}

const TEXT_FONTS = [
  '700 72px "Space Grotesk"',
  '500 20px "Space Grotesk"',
  'italic 400 40px "Instrument Serif"',
  '400 20px "Fragment Mono"'
]

export async function loadStageFonts(): Promise<void> {
  try {
    await Promise.all(TEXT_FONTS.map((f) => document.fonts.load(f)))
  } catch {
    /* polices système en secours */
  }
}

interface ThemeColors extends WaveColors {
  paper: string
  paper3: string
}

/** Tonalité en anglais pour la scène (l'analyse nomme les notes en français). */
const NOTE_EN: Record<string, string> = {
  Do: 'C', 'Do#': 'C#', 'Ré': 'D', 'Ré#': 'D#', Mi: 'E', Fa: 'F', 'Fa#': 'F#',
  Sol: 'G', 'Sol#': 'G#', La: 'A', 'La#': 'A#', Si: 'B'
}
export function keyNameEn(keyName: string): string {
  const m = keyName.match(/^(\S+)\s+(mineur|majeur)$/)
  if (!m) return keyName
  const note = NOTE_EN[m[1]] ?? m[1]
  return `${note} ${m[2] === 'mineur' ? 'minor' : 'major'}`
}

function themeColors(el: Element): ThemeColors {
  // tout est lu sur le canvas : l'overlay streamer porte son propre
  // [data-theme], indépendant du thème de l'app
  const styles = getComputedStyle(el)
  return {
    ink: styles.getPropertyValue('--ink').trim() || '#111',
    soft: styles.getPropertyValue('--ink-soft').trim() || '#77726a',
    accent: styles.getPropertyValue('--accent').trim() || '#ff4d00',
    paper: styles.getPropertyValue('--paper').trim() || '#ece9e2',
    paper3: styles.getPropertyValue('--paper-3').trim() || '#dbd7cc'
  }
}

/** Découpe `text` en lignes tenant dans `maxW` à la police courante. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w
    if (ctx.measureText(test).width <= maxW || !cur) cur = test
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t.trimEnd() + '…'
}

/**
 * Titre auto-ajusté : réduit la taille de 72 à 40 px jusqu'à tenir sur
 * `maxLines` lignes ; au-delà, la dernière ligne est tronquée.
 */
function fitTitle(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): { size: number; lines: string[] } {
  for (let size = 72; size >= 40; size -= 4) {
    ctx.font = `700 ${size}px "Space Grotesk"`
    const lines = wrap(ctx, text, maxW)
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) return { size, lines }
  }
  ctx.font = '700 40px "Space Grotesk"'
  const lines = wrap(ctx, text, maxW).slice(0, maxLines)
  lines[lines.length - 1] = ellipsize(ctx, lines[lines.length - 1], maxW)
  return { size: 40, lines }
}

/**
 * Cache de la forme d'onde : deux calques (non lu / lu) rendus une fois par
 * (pics, taille, couleurs) ; chaque image ne coûte ensuite que deux drawImage.
 */
class WaveCache {
  private key = ''
  private idle: HTMLCanvasElement | null = null
  private played: HTMLCanvasElement | null = null

  get(peaks: Peaks, w: number, h: number, colors: WaveColors): { idle: HTMLCanvasElement; played: HTMLCanvasElement } {
    const key = `${peaks.buckets}:${peaks.min.byteLength}:${w}x${h}:${colors.ink}${colors.soft}${colors.accent}`
    if (key !== this.key || !this.idle || !this.played) {
      this.key = key
      this.idle = document.createElement('canvas')
      this.played = document.createElement('canvas')
      for (const [c, progress] of [
        [this.idle, 0],
        [this.played, 1]
      ] as const) {
        c.width = w
        c.height = h
        const cx = c.getContext('2d')!
        drawWaveBars(cx, peaks, w, h, progress, colors, { playhead: 0 })
      }
    }
    return { idle: this.idle, played: this.played }
  }

  /** Les pics ont changé d'objet : invalide (le byteLength seul ne suffit pas). */
  reset(): void {
    this.key = ''
  }
}

export class Stage {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private wave = new WaveCache()
  private lastPeaks: Peaks | null = null
  layout: StageLayout = { wave: { x: 0, y: 0, w: 0, h: 0 }, cam: { x: 0, y: 0, w: 0, h: 0 } }
  format: StageFormat = 'post'

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: false })!
    this.setFormat('post')
  }

  setFormat(f: StageFormat): void {
    this.format = f
    const { w, h } = FORMATS[f]
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
  }

  draw(s: StageState): void {
    const ctx = this.ctx
    const { w: W, h: H } = FORMATS[this.format]
    const c = themeColors(this.canvas)
    const M = 64
    const t = s.track

    if (s.peaks !== this.lastPeaks) {
      this.wave.reset()
      this.lastPeaks = s.peaks
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.fillStyle = c.paper
    ctx.fillRect(0, 0, W, H)
    ctx.textBaseline = 'alphabetic'

    // ---- en-tête : marque, pulsation au tempo, temps ------------------------
    ctx.font = '400 22px "Fragment Mono"'
    ctx.textAlign = 'left'
    ctx.fillStyle = c.ink
    ctx.fillText('2LISTEN', M, M + 18)
    const brandW = ctx.measureText('2LISTEN').width
    ctx.fillStyle = c.soft
    ctx.fillText('— NOW PLAYING', M + brandW + 14, M + 18)
    const labelW = brandW + 14 + ctx.measureText('— NOW PLAYING').width

    // carré orange qui bat la mesure (grille BPM de l'analyse)
    const a = s.analysis
    if (a && a.bpm > 0) {
      const period = 60 / a.bpm
      const phase = (((s.time - a.beatPhase) % period) + period) % period
      const beat = s.playing ? 1 - Math.min(1, phase / (period * 0.6)) : 0.25
      ctx.fillStyle = c.accent
      ctx.globalAlpha = 0.25 + 0.75 * beat
      ctx.fillRect(M + labelW + 22, M, 20, 20)
      ctx.globalAlpha = 1
    }

    ctx.textAlign = 'right'
    ctx.fillStyle = c.ink
    ctx.fillText(`${fmtDuration(s.time)} / ${fmtDuration(s.duration)}`, W - M, M + 18)
    ctx.textAlign = 'left'

    // ---- titre / artiste (+ pochette) ---------------------------------------
    const y0 = M + 60
    const coverSize = this.format === 'square' ? 112 : 136
    let textX = M
    if (s.cover) {
      ctx.fillStyle = c.ink
      ctx.fillRect(M, y0, coverSize, coverSize)
      try {
        ctx.drawImage(s.cover, M + 3, y0 + 3, coverSize - 6, coverSize - 6)
      } catch {
        /* image pas encore décodée */
      }
      textX = M + coverSize + 28
    }
    const textW = W - M - textX
    const maxLines = this.format === 'square' ? 1 : 2
    const title = t ? t.title : 'No track'
    const fit = fitTitle(ctx, title, textW, maxLines)
    ctx.font = `700 ${fit.size}px "Space Grotesk"`
    ctx.fillStyle = t ? c.ink : c.soft
    let ty = y0 + fit.size * 0.92
    for (const line of fit.lines) {
      ctx.fillText(line, textX, ty)
      ty += fit.size * 1.02
    }
    ctx.font = 'italic 400 40px "Instrument Serif"'
    ctx.fillStyle = c.soft
    const artist = t ? t.artist || t.albumArtist || '' : 'Pick a track in the bottom bar'
    ctx.fillText(ellipsize(ctx, artist, textW), textX, ty + 14)
    const titleBottom = Math.max(y0 + coverSize, ty + 26)

    // ---- rangée d'infos (bas) ----------------------------------------------
    const infoH = this.format === 'square' ? 104 : 118
    const infoY = H - M - infoH
    // ---- forme d'onde ------------------------------------------------------
    const waveH = this.format === 'square' ? 130 : 170
    const waveY = infoY - 28 - waveH
    this.layout.wave = { x: M, y: waveY, w: W - 2 * M, h: waveH }
    // ---- caméra ------------------------------------------------------------
    const camY = titleBottom + 28
    const camH = Math.max(120, waveY - 28 - camY)
    this.layout.cam = { x: M, y: camY, w: W - 2 * M, h: camH }

    this.drawCam(s, this.layout.cam, c)
    this.drawWave(s, this.layout.wave, c)
    this.drawInfo(s, { x: M, y: infoY, w: W - 2 * M, h: infoH }, c)
  }

  private drawCam(s: StageState, r: Rect, c: ThemeColors): void {
    const ctx = this.ctx
    ctx.fillStyle = c.ink
    ctx.fillRect(r.x, r.y, r.w, r.h)
    const inner = { x: r.x + 4, y: r.y + 4, w: r.w - 8, h: r.h - 8 }
    const v = s.video
    if (v && v.readyState >= 2 && v.videoWidth > 0) {
      // recadrage « cover » : on remplit le cadre en rognant l'excédent
      const scale = Math.max(inner.w / v.videoWidth, inner.h / v.videoHeight)
      const sw = inner.w / scale
      const sh = inner.h / scale
      const sx = (v.videoWidth - sw) / 2
      const sy = (v.videoHeight - sh) / 2
      ctx.save()
      ctx.beginPath()
      ctx.rect(inner.x, inner.y, inner.w, inner.h)
      ctx.clip()
      if (s.mirror) {
        ctx.translate(inner.x + inner.w, inner.y)
        ctx.scale(-1, 1)
        ctx.drawImage(v, sx, sy, sw, sh, 0, 0, inner.w, inner.h)
      } else {
        ctx.drawImage(v, sx, sy, sw, sh, inner.x, inner.y, inner.w, inner.h)
      }
      ctx.restore()
    } else {
      ctx.fillStyle = c.paper3
      ctx.fillRect(inner.x, inner.y, inner.w, inner.h)
      ctx.font = 'italic 400 44px "Instrument Serif"'
      ctx.fillStyle = c.soft
      ctx.textAlign = 'center'
      ctx.fillText(v ? 'Camera…' : 'No camera', inner.x + inner.w / 2, inner.y + inner.h / 2 + 14)
      ctx.textAlign = 'left'
    }
  }

  private drawWave(s: StageState, r: Rect, c: ThemeColors): void {
    const ctx = this.ctx
    ctx.fillStyle = c.ink
    ctx.fillRect(r.x, r.y, r.w, r.h)
    const inner = { x: r.x + 2, y: r.y + 2, w: r.w - 4, h: r.h - 4 }
    ctx.fillStyle = c.paper
    ctx.fillRect(inner.x, inner.y, inner.w, inner.h)
    const peaks = s.peaks
    if (!peaks) {
      ctx.strokeStyle = c.soft
      ctx.setLineDash([3, 6])
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(inner.x + 12, inner.y + inner.h / 2)
      ctx.lineTo(inner.x + inner.w - 12, inner.y + inner.h / 2)
      ctx.stroke()
      ctx.setLineDash([])
      if (s.track) {
        ctx.font = '400 18px "Fragment Mono"'
        ctx.fillStyle = c.soft
        ctx.fillText('ANALYZING WAVEFORM…', inner.x + 16, inner.y + 30)
      }
      return
    }
    const progress = s.duration > 0 ? Math.max(0, Math.min(1, s.time / s.duration)) : 0
    const layers = this.wave.get(peaks, inner.w, inner.h, c)
    ctx.drawImage(layers.idle, inner.x, inner.y)
    const px = Math.round(progress * inner.w)
    if (px > 0) {
      ctx.drawImage(layers.played, 0, 0, px, inner.h, inner.x, inner.y, px, inner.h)
      ctx.fillStyle = c.accent
      ctx.fillRect(inner.x + px - 2, inner.y, 4, inner.h)
    }
  }

  private drawInfo(s: StageState, r: Rect, c: ThemeColors): void {
    const ctx = this.ctx
    const a = s.analysis
    const t = s.track
    const pending = !!t && !a
    const cells: Array<{ label: string; value: string; sub?: string; hot?: boolean }> = [
      { label: 'BPM', value: a && a.bpm > 0 ? String(Math.round(a.bpm)) : pending ? '…' : '—', hot: true },
      { label: 'KEY', value: a?.camelot || (pending ? '…' : '—'), sub: a ? keyNameEn(a.keyName) : undefined },
      { label: 'VERSION', value: s.version || '—' },
      { label: 'FORMAT', value: t ? fmtQuality(t) : '—' }
    ]
    // cadre + séparateurs
    ctx.fillStyle = c.ink
    ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.fillStyle = c.paper
    ctx.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4)
    const n = cells.length
    const cw = r.w / n
    for (let i = 1; i < n; i++) {
      ctx.fillStyle = c.ink
      ctx.fillRect(Math.round(r.x + i * cw) - 1, r.y, 2, r.h)
    }
    const small = r.h < 110
    for (let i = 0; i < n; i++) {
      const cell = cells[i]
      const x = r.x + i * cw + 18
      const maxW = cw - 36
      ctx.font = `400 ${small ? 15 : 17}px "Fragment Mono"`
      ctx.fillStyle = c.soft
      ctx.fillText(cell.label, x, r.y + (small ? 30 : 34))
      let size = small ? 34 : 40
      ctx.font = `700 ${size}px "Space Grotesk"`
      while (size > 20 && ctx.measureText(cell.value).width > maxW) {
        size -= 2
        ctx.font = `700 ${size}px "Space Grotesk"`
      }
      const text = ellipsize(ctx, cell.value, maxW)
      ctx.fillStyle = cell.hot && cell.value !== '—' && cell.value !== '…' ? c.accent : c.ink
      const baseline = r.y + r.h - (small ? 22 : 26)
      ctx.fillText(text, x, baseline)
      if (cell.sub) {
        const vw = ctx.measureText(text).width
        ctx.font = '400 15px "Fragment Mono"'
        ctx.fillStyle = c.soft
        const sub = ellipsize(ctx, cell.sub, Math.max(0, maxW - vw - 12))
        if (sub && !sub.startsWith('…')) ctx.fillText(sub, x + vw + 12, baseline)
      }
    }
  }
}
