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
  '500 24px "Space Grotesk"',
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
  /** Fond opaque de la scène (le canvas n'a pas de canal alpha). */
  bg: string
  /** Fond des cartes. */
  card: string
  /** Fond du cadre caméra vide. */
  well: string
  /** Accent lisible sur une carte (contraste du texte). */
  accentText: string
  /** Filets : contour des cartes et séparateurs. */
  edge: string
  sep: string
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
  const read = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback
  return {
    ink: read('--ink', '#1b1a18'),
    soft: read('--ink-soft', '#77726a'),
    accent: read('--accent', '#ff4d00'),
    accentText: read('--accent-2', '#d94100'),
    bg: read('--scene-bg', '#e6e3db'),
    card: read('--paper', '#f6f4ef'),
    well: read('--paper-2', '#edeae3'),
    edge: read('--glass-edge', 'rgb(27 26 24 / 11%)'),
    sep: read('--sep', 'rgb(27 26 24 / 10%)')
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
  const all = wrap(ctx, text, maxW)
  const lines = all.slice(0, maxLines)
  // le mot suivant force les points de suspension quand des lignes sont retirées
  const last = lines.length - 1
  lines[last] = ellipsize(ctx, all.length > maxLines ? `${lines[last]} ${all[maxLines]}` : lines[last], maxW)
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

// Mesures Tahoe de l'app (carte 12 px, gouttière 8 px) à l'échelle d'un clip
// regardé sur téléphone : 1080 px de large pour environ 390 pt d'écran.
const MARGIN = 36
const GUTTER = 18
const RADIUS = 34
const RADIUS_INNER = 20
const PADDING = 30

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

  /** Carte Tahoe : surface pleine et filet fin, sans ombre (coût par image à 30 i/s). */
  private card(r: Rect, c: ThemeColors): void {
    const ctx = this.ctx
    ctx.beginPath()
    ctx.roundRect(r.x, r.y, r.w, r.h, RADIUS)
    ctx.fillStyle = c.card
    ctx.fill()
    this.hairline(r, RADIUS, c)
  }

  private hairline(r: Rect, radius: number, c: ThemeColors): void {
    const ctx = this.ctx
    ctx.beginPath()
    ctx.roundRect(r.x + 0.75, r.y + 0.75, r.w - 1.5, r.h - 1.5, radius)
    ctx.strokeStyle = c.edge
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  draw(s: StageState): void {
    const ctx = this.ctx
    const { w: W, h: H } = FORMATS[this.format]
    const c = themeColors(this.canvas)
    const M = MARGIN
    const P = PADDING
    const square = this.format === 'square'
    const cardW = W - 2 * M
    const t = s.track

    if (s.peaks !== this.lastPeaks) {
      this.wave.reset()
      this.lastPeaks = s.peaks
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.fillStyle = c.bg
    ctx.fillRect(0, 0, W, H)
    ctx.textBaseline = 'alphabetic'

    // ---- carte du morceau : mise en page d'abord, sa hauteur dépend du titre --
    const coverSize = square ? 112 : 136
    const hasCover = !!s.cover
    const headY = M + P + 20
    const y0 = headY + 30
    const textX = M + P + (hasCover ? coverSize + 28 : 0)
    const textW = W - M - P - textX
    const title = t ? t.title : 'No track'
    const fit = fitTitle(ctx, title, textW, square ? 1 : 2)
    const titleTop = y0 + fit.size * 0.92
    const artistY = titleTop + (fit.lines.length - 1) * fit.size * 1.02 + fit.size * 0.3 + 40
    const contentBottom = Math.max(hasCover ? y0 + coverSize : 0, artistY + 12)
    const headCard = { x: M, y: M, w: cardW, h: contentBottom + P - M }
    this.card(headCard, c)

    ctx.font = '700 24px "Space Grotesk"'
    ctx.textAlign = 'left'
    ctx.fillStyle = c.ink
    ctx.fillText('2Listen', M + P, headY)
    const brandW = ctx.measureText('2Listen').width
    ctx.font = '500 24px "Space Grotesk"'
    ctx.fillStyle = c.soft
    ctx.fillText('Now playing', M + P + brandW + 14, headY)
    const labelW = brandW + 14 + ctx.measureText('Now playing').width

    // point orange qui bat la mesure (grille BPM de l'analyse)
    const a = s.analysis
    if (a && a.bpm > 0) {
      const period = 60 / a.bpm
      const phase = (((s.time - a.beatPhase) % period) + period) % period
      const beat = s.playing ? 1 - Math.min(1, phase / (period * 0.6)) : 0.25
      ctx.fillStyle = c.accent
      ctx.globalAlpha = 0.25 + 0.75 * beat
      ctx.beginPath()
      ctx.arc(M + P + labelW + 28, headY - 8, 10, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    ctx.font = '400 22px "Fragment Mono"'
    ctx.textAlign = 'right'
    ctx.fillStyle = c.soft
    ctx.fillText(`${fmtDuration(s.time)} / ${fmtDuration(s.duration)}`, W - M - P, headY)
    ctx.textAlign = 'left'

    if (s.cover) {
      const cover: Rect = { x: M + P, y: y0, w: coverSize, h: coverSize }
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(cover.x, cover.y, cover.w, cover.h, RADIUS_INNER)
      ctx.clip()
      try {
        ctx.drawImage(s.cover, cover.x, cover.y, cover.w, cover.h)
      } catch {
        /* image pas encore décodée */
      }
      ctx.restore()
      this.hairline(cover, RADIUS_INNER, c)
    }
    ctx.font = `700 ${fit.size}px "Space Grotesk"`
    ctx.fillStyle = t ? c.ink : c.soft
    let ty = titleTop
    for (const line of fit.lines) {
      ctx.fillText(line, textX, ty)
      ty += fit.size * 1.02
    }
    ctx.font = 'italic 400 40px "Instrument Serif"'
    ctx.fillStyle = c.soft
    const artist = t ? t.artist || t.albumArtist || '' : 'Pick a track in the bottom bar'
    ctx.fillText(ellipsize(ctx, artist, textW), textX, artistY)

    // ---- pile du bas, puis la caméra prend ce qui reste ----------------------
    const infoH = square ? 104 : 118
    const infoY = H - M - infoH
    const waveH = square ? 150 : 190
    const waveY = infoY - GUTTER - waveH
    const camY = headCard.y + headCard.h + GUTTER
    const camH = Math.max(120, waveY - GUTTER - camY)
    const waveCard = { x: M, y: waveY, w: cardW, h: waveH }
    // la zone cliquable pour la recherche est exactement celle des barres
    this.layout.wave = { x: M + 22, y: waveY + 16, w: cardW - 44, h: waveH - 32 }
    this.layout.cam = { x: M, y: camY, w: cardW, h: camH }

    this.drawCam(s, this.layout.cam, c)
    this.card(waveCard, c)
    this.drawWave(s, this.layout.wave, c)
    this.drawInfo(s, { x: M, y: infoY, w: cardW, h: infoH }, c)
  }

  private drawCam(s: StageState, r: Rect, c: ThemeColors): void {
    const ctx = this.ctx
    const v = s.video
    if (v && v.readyState >= 2 && v.videoWidth > 0) {
      // recadrage « cover » : on remplit la carte en rognant l'excédent
      const scale = Math.max(r.w / v.videoWidth, r.h / v.videoHeight)
      const sw = r.w / scale
      const sh = r.h / scale
      const sx = (v.videoWidth - sw) / 2
      const sy = (v.videoHeight - sh) / 2
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(r.x, r.y, r.w, r.h, RADIUS)
      ctx.clip()
      if (s.mirror) {
        ctx.translate(r.x + r.w, r.y)
        ctx.scale(-1, 1)
        ctx.drawImage(v, sx, sy, sw, sh, 0, 0, r.w, r.h)
      } else {
        ctx.drawImage(v, sx, sy, sw, sh, r.x, r.y, r.w, r.h)
      }
      ctx.restore()
      this.hairline(r, RADIUS, c)
    } else {
      ctx.beginPath()
      ctx.roundRect(r.x, r.y, r.w, r.h, RADIUS)
      ctx.fillStyle = c.well
      ctx.fill()
      this.hairline(r, RADIUS, c)
      ctx.font = 'italic 400 44px "Instrument Serif"'
      ctx.fillStyle = c.soft
      ctx.textAlign = 'center'
      ctx.fillText(v ? 'Camera…' : 'No camera', r.x + r.w / 2, r.y + r.h / 2 + 14)
      ctx.textAlign = 'left'
    }
  }

  /** Barres dans `inner` : la carte qui les porte est peinte par draw(). */
  private drawWave(s: StageState, inner: Rect, c: ThemeColors): void {
    const ctx = this.ctx
    const peaks = s.peaks
    if (!peaks) {
      ctx.fillStyle = c.sep
      ctx.beginPath()
      ctx.roundRect(inner.x, inner.y + inner.h / 2 - 2, inner.w, 4, 2)
      ctx.fill()
      if (s.track) {
        ctx.font = '500 22px "Space Grotesk"'
        ctx.fillStyle = c.soft
        ctx.fillText('Analyzing waveform…', inner.x, inner.y + 26)
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
      ctx.beginPath()
      ctx.roundRect(inner.x + px - 2, inner.y, 4, inner.h, 2)
      ctx.fill()
    }
  }

  private drawInfo(s: StageState, r: Rect, c: ThemeColors): void {
    const ctx = this.ctx
    const a = s.analysis
    const t = s.track
    const pending = !!t && !a
    const cells: Array<{ label: string; value: string; sub?: string; hot?: boolean }> = [
      { label: 'BPM', value: a && a.bpm > 0 ? String(Math.round(a.bpm)) : pending ? '…' : '—', hot: true },
      { label: 'Key', value: a?.camelot || (pending ? '…' : '—'), sub: a ? keyNameEn(a.keyName) : undefined },
      { label: 'Version', value: s.version || '—' },
      { label: 'Format', value: t ? fmtQuality(t) : '—' }
    ]
    this.card(r, c)
    const n = cells.length
    const cw = r.w / n
    ctx.fillStyle = c.sep
    for (let i = 1; i < n; i++) ctx.fillRect(Math.round(r.x + i * cw) - 1, r.y + 22, 1.5, r.h - 44)
    const small = r.h < 110
    for (let i = 0; i < n; i++) {
      const cell = cells[i]
      const x = r.x + i * cw + 26
      const maxW = cw - 44
      ctx.font = `500 ${small ? 19 : 21}px "Space Grotesk"`
      ctx.fillStyle = c.soft
      ctx.fillText(cell.label, x, r.y + (small ? 30 : 34))
      let size = small ? 34 : 40
      ctx.font = `700 ${size}px "Space Grotesk"`
      while (size > 20 && ctx.measureText(cell.value).width > maxW) {
        size -= 2
        ctx.font = `700 ${size}px "Space Grotesk"`
      }
      const text = ellipsize(ctx, cell.value, maxW)
      ctx.fillStyle = cell.hot && cell.value !== '—' && cell.value !== '…' ? c.accentText : c.ink
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
