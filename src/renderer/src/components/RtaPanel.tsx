import { useEffect, useRef, useState } from 'react'
import { getAnalyser, resumeRta, rtaSampleRate } from '@/lib/rta'

/**
 * Analyseur spectral temps réel (façon Clarity M / PAZ) :
 * courbe instantanée pleine, peak-hold qui retombe lentement,
 * axe log 20 Hz–20 kHz, crosshair de fréquence au survol.
 */
export default function RtaPanel({ onClose }: { onClose: () => void }): React.ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const hoverRef = useRef<number | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    const analyser = getAnalyser()
    if (!analyser) {
      setUnavailable(true)
      return
    }
    resumeRta()
    const bins = analyser.frequencyBinCount
    const data = new Float32Array(bins)
    const fs = rtaSampleRate()
    const binHz = fs / (bins * 2)
    const fMin = 20
    const fMax = Math.min(20000, fs / 2)
    const POINTS = 320
    const hold = new Float32Array(POINTS).fill(-120)
    let raf = 0

    const draw = (): void => {
      raf = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      const wrap = wrapRef.current
      if (!canvas || !wrap) return
      const rect = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(50, Math.floor(rect.width))
      const h = Math.max(50, Math.floor(rect.height))
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
      }
      const ctx2 = canvas.getContext('2d')
      if (!ctx2) return
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0)

      const styles = getComputedStyle(document.documentElement)
      const ink = styles.getPropertyValue('--ink').trim()
      const accent = styles.getPropertyValue('--accent').trim()
      const soft = styles.getPropertyValue('--ink-soft').trim()
      const paper = styles.getPropertyValue('--paper').trim()

      ctx2.fillStyle = paper
      ctx2.fillRect(0, 0, w, h)

      analyser.getFloatFrequencyData(data)

      const yMin = -96
      const yMax = -6
      const X = (p: number): number => 26 + (p / (POINTS - 1)) * (w - 32)
      const Y = (v: number): number => 6 + ((yMax - v) / (yMax - yMin)) * (h - 24)

      // grilles
      ctx2.font = '8px "Fragment Mono", monospace'
      ctx2.strokeStyle = soft
      ctx2.fillStyle = soft
      ctx2.globalAlpha = 0.25
      for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
        const p = (Math.log(f / fMin) / Math.log(fMax / fMin)) * (POINTS - 1)
        const x = X(p)
        ctx2.beginPath()
        ctx2.moveTo(x, 6)
        ctx2.lineTo(x, h - 18)
        ctx2.stroke()
        ctx2.globalAlpha = 0.9
        ctx2.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 2, h - 8)
        ctx2.globalAlpha = 0.25
      }
      for (let v = -12; v >= yMin; v -= 12) {
        ctx2.beginPath()
        ctx2.moveTo(26, Y(v))
        ctx2.lineTo(w - 6, Y(v))
        ctx2.stroke()
        ctx2.globalAlpha = 0.9
        ctx2.fillText(String(v), 3, Y(v) + 3)
        ctx2.globalAlpha = 0.25
      }
      ctx2.globalAlpha = 1

      // échantillonnage log + lissage court
      const cur = new Float32Array(POINTS)
      for (let p = 0; p < POINTS; p++) {
        const f = fMin * Math.pow(fMax / fMin, p / (POINTS - 1))
        const half = Math.pow(2, 1 / 24)
        const k0 = Math.max(1, Math.floor(f / half / binHz))
        const k1 = Math.min(bins - 1, Math.max(k0, Math.ceil((f * half) / binHz)))
        let m = -160
        for (let k = k0; k <= k1; k++) if (data[k] > m) m = data[k]
        cur[p] = m
        // peak hold : montée instantanée, retombée ~12 dB/s
        hold[p] = m > hold[p] ? m : hold[p] - 0.2
      }

      // remplissage de la courbe instantanée
      ctx2.beginPath()
      ctx2.moveTo(X(0), Y(yMin))
      for (let p = 0; p < POINTS; p++) ctx2.lineTo(X(p), Y(Math.max(yMin, cur[p])))
      ctx2.lineTo(X(POINTS - 1), Y(yMin))
      ctx2.closePath()
      ctx2.fillStyle = accent
      ctx2.globalAlpha = 0.24
      ctx2.fill()
      ctx2.globalAlpha = 1
      ctx2.strokeStyle = accent
      ctx2.lineWidth = 1.8
      ctx2.beginPath()
      for (let p = 0; p < POINTS; p++) {
        const x = X(p)
        const y = Y(Math.max(yMin, cur[p]))
        if (p === 0) ctx2.moveTo(x, y)
        else ctx2.lineTo(x, y)
      }
      ctx2.stroke()

      // peak hold en encre
      ctx2.strokeStyle = ink
      ctx2.lineWidth = 1
      ctx2.beginPath()
      for (let p = 0; p < POINTS; p++) {
        const x = X(p)
        const y = Y(Math.max(yMin, hold[p]))
        if (p === 0) ctx2.moveTo(x, y)
        else ctx2.lineTo(x, y)
      }
      ctx2.stroke()

      // crosshair
      const hover = hoverRef.current
      if (hover !== null) {
        const p = Math.round(hover * (POINTS - 1))
        const f = fMin * Math.pow(fMax / fMin, p / (POINTS - 1))
        const x = X(p)
        ctx2.strokeStyle = ink
        ctx2.globalAlpha = 0.8
        ctx2.beginPath()
        ctx2.moveTo(x, 6)
        ctx2.lineTo(x, h - 18)
        ctx2.stroke()
        ctx2.globalAlpha = 1
        ctx2.fillStyle = ink
        const label = `${f >= 1000 ? (f / 1000).toFixed(2) + ' kHz' : Math.round(f) + ' Hz'} · ${cur[p].toFixed(1)} dB`
        ctx2.font = '9px "Fragment Mono", monospace'
        const tw = ctx2.measureText(label).width
        const lx = Math.min(w - tw - 8, x + 6)
        ctx2.fillRect(lx - 3, 8, tw + 6, 14)
        ctx2.fillStyle = paper
        ctx2.fillText(label, lx, 18)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      className="rise"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: '100%',
        height: 280,
        background: 'var(--paper)',
        borderTop: 'var(--line-thick)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 50,
        boxShadow: '0 -8px 24px rgba(17,17,17,.12)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 14px', borderBottom: 'var(--line)' }}>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '.14em', color: 'var(--accent)' }}>
          ANALYSEUR SPECTRAL — TEMPS RÉEL
        </span>
        <span className="mono" style={{ fontSize: 8, color: 'var(--ink-soft)' }}>
          courbe : instantané &nbsp;·&nbsp; trait fin : peak hold
        </span>
        <button className="mono tap" onClick={onClose}
          style={{ fontSize: 9, letterSpacing: '.1em', border: '1.5px solid var(--ink)', padding: '3px 8px' }}>
          FERMER
        </button>
      </div>
      {unavailable ? (
        <div className="serif" style={{ flex: 1, display: 'grid', placeItems: 'center', fontStyle: 'italic', color: 'var(--ink-soft)' }}>
          Analyseur indisponible sur cette sortie audio.
        </div>
      ) : (
        <div
          ref={wrapRef}
          style={{ flex: 1, position: 'relative', overflow: 'hidden', cursor: 'crosshair' }}
          onPointerMove={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            hoverRef.current = Math.max(0, Math.min(1, (e.clientX - r.left - 26) / (r.width - 32)))
          }}
          onPointerLeave={() => {
            hoverRef.current = null
          }}
        >
          <canvas ref={canvasRef} width={0} height={0} style={{ position: 'absolute', inset: 0, display: 'block' }} />
        </div>
      )}
    </div>
  )
}
