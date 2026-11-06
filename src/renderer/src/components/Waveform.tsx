import { useEffect, useRef, useState } from 'react'
import type { Peaks, Track } from '@shared/types'
import { fmtDuration } from '@/lib/format'
import { getPeaks } from '@/lib/peaks'
import { player } from '@/lib/player'
import { drawWaveBars, themeWaveColors } from '@/lib/wavedraw'


/**
 * Forme d'onde haute définition sur canvas :
 *  – silhouette min/max (un trait vertical par bucket, 2048 buckets)
 *  – cœur RMS plus dense superposé
 *  – progression orange, tête de lecture clignotante, survol = prévisualisation.
 * Redessinée uniquement quand la progression ou la taille change.
 */
export interface WaveSource {
  onTime: (cb: (t: number, d: number) => void) => () => void
  seek: (frac: number) => void
}

export default function Waveform({ track, source }: { track: Track | null; source?: WaveSource }): React.ReactNode {
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
      const peaks = await getPeaks(track.id, track.path)
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
    const src = source ?? player
    const off = src.onTime((t, d) => {
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
  }, [source])

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

    const { ink, soft, accent } = themeWaveColors()

    const peaks = peaksRef.current
    const mid = h / 2
    const progress = progressRef.current

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

    drawWaveBars(ctx, peaks, w, h, progress, { ink, soft, accent })

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
    ;(source ?? player).seek(fracFromEvent(e))
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const frac = fracFromEvent(e)
    hoverRef.current = frac
    const d = track?.duration ?? 0
    setHoverLabel({ x: frac, text: fmtDuration(frac * d) })
    if (draggingRef.current) (source ?? player).seek(frac)
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
        <span className="mono dim pulse" style={{ position: 'absolute', left: 6, top: 4, fontSize: 10 }}>
          Analyse de l'onde…
        </span>
      )}
      {hoverLabel && track && (
        <span
          className="mono"
          style={{
            position: 'absolute',
            left: `min(max(${hoverLabel.x * 100}%, 22px), calc(100% - 22px))`,
            top: 0,
            transform: 'translateX(-50%)',
            fontSize: 9.5,
            background: 'var(--ink)',
            color: 'var(--paper)',
            padding: '1px 6px',
            borderRadius: 999,
            pointerEvents: 'none'
          }}
        >
          {hoverLabel.text}
        </span>
      )}
    </div>
  )
}
