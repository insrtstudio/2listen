import { useEffect, useRef, useState } from 'react'
import type { Peaks, Track } from '@shared/types'
import { fmtDuration } from '@/lib/format'
import { getPeaks } from '@/lib/peaks'

const rgbCache = new Map<string, [number, number, number]>()
function hexToRgb(hex: string): [number, number, number] {
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
import { player } from '@/lib/player'

/**
 * Forme d'onde haute définition sur canvas :
 *  – silhouette min/max (un trait vertical par bucket, 2048 buckets)
 *  – cœur RMS plus dense superposé
 *  – progression orange, tête de lecture clignotante, survol = prévisualisation.
 * Redessinée uniquement quand la progression ou la taille change.
 */
export default function Waveform({ track }: { track: Track | null }): React.ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const peaksRef = useRef<Peaks | null>(null)
  const progressRef = useRef(0)
  const hoverRef = useRef<number | null>(null)
  const [hoverLabel, setHoverLabel] = useState<{ x: number; text: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const draggingRef = useRef(false)

  // charge les pics à chaque changement de piste
  useEffect(() => {
    let alive = true
    peaksRef.current = null
    progressRef.current = 0
    draw()
    if (!track) return
    setLoading(true)
    void (async () => {
      const url = await window.tl.url.audio(track.path)
      const peaks = await getPeaks(track.id, url)
      if (!alive) return
      peaksRef.current = peaks
      setLoading(false)
      draw()
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id])

  // suit la position de lecture sans passer par l'état React
  useEffect(() => {
    let raf = 0
    const off = player.onTime((t, d) => {
      const p = d > 0 ? t / d : 0
      if (Math.abs(p - progressRef.current) < 0.0004) return
      progressRef.current = p
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(draw)
    })
    return () => {
      off()
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // redessine au redimensionnement
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function draw(): void {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const rect = wrap.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.floor(rect.width))
    const h = Math.max(1, Math.floor(rect.height))
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const styles = getComputedStyle(document.documentElement)
    const ink = styles.getPropertyValue('--ink').trim() || '#111'
    const accent = styles.getPropertyValue('--accent').trim() || '#ff4d00'
    const soft = styles.getPropertyValue('--ink-soft').trim() || '#77726a'

    const peaks = peaksRef.current
    const mid = h / 2
    const progress = progressRef.current
    const playedX = progress * w

    if (!peaks) {
      // ligne d'attente : un trait fin en pointillé
      ctx.strokeStyle = soft
      ctx.setLineDash([2, 4])
      ctx.beginPath()
      ctx.moveTo(0, mid)
      ctx.lineTo(w, mid)
      ctx.stroke()
      ctx.setLineDash([])
      return
    }

    // palette spectrale : graves = encre, médiums = gris chaud, aigus = orange.
    // La couleur de chaque barre est le mélange pondéré par l'énergie des bandes.
    const cLow = hexToRgb(ink)
    const cMid = hexToRgb(soft)
    const cHigh = hexToRgb(accent)

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
    if (progress > 0) {
      ctx.fillStyle = accent
      ctx.fillRect(playedX - 1, 0, 2, h)
    }

    // survol
    const hover = hoverRef.current
    if (hover !== null) {
      ctx.fillStyle = ink
      ctx.globalAlpha = 0.9
      ctx.fillRect(hover * w - 0.5, 0, 1, h)
      ctx.globalAlpha = 1
    }
  }

  const fracFromEvent = (e: React.PointerEvent): number => {
    const rect = wrapRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (!track) return
    draggingRef.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    player.seek(fracFromEvent(e))
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const frac = fracFromEvent(e)
    hoverRef.current = frac
    const d = track?.duration ?? 0
    setHoverLabel({ x: frac, text: fmtDuration(frac * d) })
    if (draggingRef.current) player.seek(frac)
    draw()
  }
  const onPointerUp = (): void => {
    draggingRef.current = false
  }
  const onPointerLeave = (): void => {
    hoverRef.current = null
    setHoverLabel(null)
    draggingRef.current = false
    draw()
  }

  return (
    <div
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      style={{ position: 'relative', height: '100%', overflow: 'hidden', cursor: track ? 'crosshair' : 'default', touchAction: 'none' }}
    >
      {/* en absolu : la taille par défaut d'un canvas (300×150) ne doit jamais
          gonfler la hauteur de la barre de lecture */}
      <canvas ref={canvasRef} width={0} height={0} style={{ position: 'absolute', inset: 0, display: 'block' }} />
      {loading && track && (
        <span
          className="mono"
          style={{
            position: 'absolute', left: 10, top: 6, fontSize: 9, color: 'var(--ink-soft)',
            animation: 'blink 1s steps(1) infinite'
          }}
        >
          ANALYSE DE L'ONDE…
        </span>
      )}
      {hoverLabel && track && (
        <span
          className="mono"
          style={{
            position: 'absolute',
            left: `min(max(${hoverLabel.x * 100}%, 24px), calc(100% - 30px))`,
            top: -2,
            transform: 'translateX(-50%)',
            fontSize: 9,
            background: 'var(--ink)',
            color: 'var(--paper)',
            padding: '1px 5px',
            pointerEvents: 'none'
          }}
        >
          {hoverLabel.text}
        </span>
      )}
    </div>
  )
}
