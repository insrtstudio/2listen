import type { Peaks } from '@shared/types'

const rgbCache = new Map<string, [number, number, number]>()
export function hexToRgb(hex: string): [number, number, number] {
  const cached = rgbCache.get(hex)
  if (cached) return cached
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const v: [number, number, number] = [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0
  ]
  rgbCache.set(hex, v)
  return v
}

export interface WaveColors {
  ink: string
  soft: string
  accent: string
}

/** Couleurs de la waveform lues sur le thème courant. */
export function themeWaveColors(): WaveColors {
  const styles = getComputedStyle(document.documentElement)
  return {
    ink: styles.getPropertyValue('--ink').trim() || '#111',
    accent: styles.getPropertyValue('--accent').trim() || '#ff4d00',
    soft: styles.getPropertyValue('--ink-soft').trim() || '#77726a'
  }
}

/**
 * Dessine les barres spectrales d'une forme d'onde dans le rectangle (0,0,w,h)
 * du contexte courant (translater avant l'appel pour décaler) :
 *  – silhouette min/max (texture), cœur RMS (masse colorée), ticks de transitoires
 *  – palette : graves = encre, médiums = gris chaud, aigus = orange
 *  – partie lue en pleine opacité, tête de lecture orange.
 * Partagé entre la barre de lecture et la scène du mode streamer.
 */
export function drawWaveBars(
  ctx: CanvasRenderingContext2D,
  peaks: Peaks,
  w: number,
  h: number,
  progress: number,
  colors: WaveColors,
  opts: { playhead?: number } = {}
): void {
  const { ink, soft, accent } = colors
  const cLow = hexToRgb(ink)
  const cMid = hexToRgb(soft)
  const cHigh = hexToRgb(accent)
  const mid = h / 2
  const playedX = progress * w

  const { buckets, min, max, low, mid: bandMid, high, trans } = peaks
  const step = w / buckets
  const stride = Math.max(1, Math.floor(buckets / w))
  for (let b = 0; b < buckets; b += stride) {
    const x = b * step
    let lo = 255
    let hi = 0
    let eL = 0
    let eM = 0
    let eH = 0
    let eT = 0
    for (let k = b; k < Math.min(buckets, b + stride); k++) {
      if (min[k] < lo) lo = min[k]
      if (max[k] > hi) hi = max[k]
      if (low[k] > eL) eL = low[k]
      if (bandMid[k] > eM) eM = bandMid[k]
      if (high[k] > eH) eH = high[k]
      if (trans[k] > eT) eT = trans[k]
    }
    // les aigus portent moins d'énergie : on les surpondère pour la couleur
    const wL = eL
    const wM = eM * 1.4
    const wH = eH * 2.2
    const sum = wL + wM + wH || 1
    const r = Math.round((cLow[0] * wL + cMid[0] * wM + cHigh[0] * wH) / sum)
    const g = Math.round((cLow[1] * wL + cMid[1] * wM + cHigh[1] * wH) / sum)
    const bl = Math.round((cLow[2] * wL + cMid[2] * wM + cHigh[2] * wH) / sum)
    const color = `rgb(${r},${g},${bl})`

    const played = x <= playedX
    const bw = Math.max(1, step * stride - 0.4)
    const yTop = mid - ((hi - 128) / 128) * (mid - 2)
    const yBot = mid - ((lo - 128) / 128) * (mid - 2)

    // tick de transitoire pleine hauteur, sous la barre
    if (eT > 110) {
      ctx.fillStyle = played ? accent : ink
      ctx.globalAlpha = played ? 0.85 : 0.3
      ctx.fillRect(x + bw / 2 - 0.75, 1, 1.5, h - 2)
    }

    // silhouette min/max (texture) puis cœur RMS total (masse colorée)
    ctx.fillStyle = color
    ctx.globalAlpha = played ? 0.4 : 0.2
    ctx.fillRect(x, yTop, bw, Math.max(1, yBot - yTop))
    const energy = Math.min(255, Math.sqrt(eL * eL + eM * eM + eH * eH))
    const rh = (energy / 255) * (h - 4)
    ctx.globalAlpha = played ? 1 : 0.5
    ctx.fillRect(x, mid - rh / 2, bw, Math.max(1, rh))
  }
  ctx.globalAlpha = 1

  // tête de lecture
  const ph = opts.playhead ?? 2
  if (progress > 0) {
    ctx.fillStyle = accent
    ctx.fillRect(playedX - ph / 2, 0, ph, h)
  }
}
