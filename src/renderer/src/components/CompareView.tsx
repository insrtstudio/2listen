import { useEffect, useRef, useState } from 'react'
import type { AnalysisData } from '@shared/types'
import { getAnalysis } from '@/lib/analysis'
import { computeCorrections, preview } from '@/lib/preview'
import { player } from '@/lib/player'
import { useStore } from '@/lib/store'
import TrackPicker from './TrackPicker'
import { fmtNote } from '@/lib/notes'

/* ————— spectre superposé + bande de delta ————— */
function SpectrumChart({ a, b, aligned }: { a: AnalysisData; b: AnalysisData; aligned: boolean }): React.ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const hoverRef = useRef<number | null>(null)
  const redrawRef = useRef<() => void>(() => {})

  useEffect(() => {
    const draw = (): void => {
      const canvas = canvasRef.current
      const wrap = wrapRef.current
      if (!canvas || !wrap) return
      const rect = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(50, Math.floor(rect.width))
      const h = Math.max(50, Math.floor(rect.height))
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const styles = getComputedStyle(document.documentElement)
      const ink = styles.getPropertyValue('--ink').trim()
      const accent = styles.getPropertyValue('--accent').trim()
      const soft = styles.getPropertyValue('--ink-soft').trim()

      const deltaH = 46 // bande Δ en bas
      const chartH = h - deltaH - 16
      const padL = 30

      // alignement : on retire l'écart de loudness pour comparer la FORME
      const offset = aligned ? a.lufsI - b.lufsI : 0
      const sa = a.spectrum.map((v) => v - offset)
      const sb = b.spectrum
      const all = [...sa, ...sb]
      const yMax = Math.min(0, Math.max(...all) + 4)
      const yMin = Math.max(-100, Math.min(...all) - 2, yMax - 60)
      const X = (i: number): number => padL + (i / (sa.length - 1)) * (w - padL - 4)
      const Y = (v: number): number => 8 + ((yMax - v) / (yMax - yMin)) * (chartH - 8)

      // grilles de fréquences
      ctx.font = '8px "Fragment Mono", monospace'
      ctx.fillStyle = soft
      ctx.strokeStyle = soft
      ctx.globalAlpha = 0.3
      const marks = [50, 100, 200, 500, 1000, 2000, 5000, 10000]
      for (const f of marks) {
        const i = a.freqs.findIndex((fr) => fr >= f)
        if (i < 0) continue
        const x = X(i)
        ctx.beginPath()
        ctx.moveTo(x, 8)
        ctx.lineTo(x, chartH + deltaH + 8)
        ctx.stroke()
      }
      // grille dB
      for (let v = Math.ceil(yMin / 12) * 12; v <= yMax; v += 12) {
        ctx.beginPath()
        ctx.moveTo(padL, Y(v))
        ctx.lineTo(w - 4, Y(v))
        ctx.stroke()
        ctx.globalAlpha = 0.9
        ctx.fillText(`${v}`, 2, Y(v) + 3)
        ctx.globalAlpha = 0.3
      }
      ctx.globalAlpha = 1

      const curve = (vals: number[], color: string, width: number): void => {
        ctx.strokeStyle = color
        ctx.lineWidth = width
        ctx.beginPath()
        vals.forEach((v, i) => {
          const x = X(i)
          const y = Y(v)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
      }
      // B (référence) : encre — A (mix) : orange
      curve(sb, ink, 1.5)
      curve(sa, accent, 2)

      // bande Δ = A − B
      const zeroY = chartH + 16 + deltaH / 2
      ctx.strokeStyle = soft
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.moveTo(padL, zeroY)
      ctx.lineTo(w - 4, zeroY)
      ctx.stroke()
      ctx.globalAlpha = 1
      const dScale = (deltaH / 2 - 3) / 12 // ±12 dB pleine échelle
      for (let i = 0; i < sa.length; i++) {
        const d = Math.max(-12, Math.min(12, sa[i] - sb[i]))
        const x = X(i)
        const barH = Math.abs(d) * dScale
        ctx.fillStyle = Math.abs(d) > 2.5 ? accent : ink
        ctx.globalAlpha = Math.abs(d) > 2.5 ? 0.95 : 0.3
        if (d >= 0) ctx.fillRect(x, zeroY - barH, Math.max(1, (w - padL) / sa.length), barH)
        else ctx.fillRect(x, zeroY, Math.max(1, (w - padL) / sa.length), barH)
      }
      ctx.globalAlpha = 1
      ctx.fillStyle = soft
      ctx.fillText('Δ A−B (±12 dB)', padL + 4, chartH + 24)
      // libellés de fréquence par-dessus tout
      for (const f of marks) {
        const i = a.freqs.findIndex((fr) => fr >= f)
        if (i < 0) continue
        ctx.fillStyle = ink
        ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), X(i) + 2, chartH + deltaH + 14)
      }

      // crosshair : fréquence · note (façon EQ Eight) · A / B / Δ
      const hover = hoverRef.current
      if (hover !== null) {
        const i = Math.max(0, Math.min(sa.length - 1, Math.round(hover * (sa.length - 1))))
        const f = a.freqs[i]
        const x = X(i)
        ctx.strokeStyle = ink
        ctx.globalAlpha = 0.85
        ctx.beginPath()
        ctx.moveTo(x, 8)
        ctx.lineTo(x, chartH + deltaH + 8)
        ctx.stroke()
        ctx.globalAlpha = 1
        const note = fmtNote(f)
        const label = `${f >= 1000 ? (f / 1000).toFixed(2) + ' kHz' : Math.round(f) + ' Hz'}${note ? ` · ${note}` : ''}  A ${sa[i].toFixed(1)}  B ${sb[i].toFixed(1)}  Δ ${(sa[i] - sb[i]) >= 0 ? '+' : ''}${(sa[i] - sb[i]).toFixed(1)} dB`
        ctx.font = '9px "Fragment Mono", monospace'
        const tw = ctx.measureText(label).width
        const lx = Math.min(w - tw - 8, Math.max(padL, x + 6))
        ctx.fillStyle = ink
        ctx.fillRect(lx - 3, 10, tw + 6, 14)
        ctx.fillStyle = styles.getPropertyValue('--paper').trim()
        ctx.fillText(label, lx, 20)
      }
    }
    redrawRef.current = draw
    draw()
    const ro = new ResizeObserver(draw)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [a, b, aligned])

  return (
    <div
      ref={wrapRef}
      style={{ flex: 1, minHeight: 220, position: 'relative', overflow: 'hidden', cursor: 'crosshair' }}
      onPointerMove={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        hoverRef.current = Math.max(0, Math.min(1, (e.clientX - r.left - 30) / (r.width - 34)))
        redrawRef.current()
      }}
      onPointerLeave={() => {
        hoverRef.current = null
        redrawRef.current()
      }}
    >
      <canvas ref={canvasRef} width={0} height={0} style={{ position: 'absolute', inset: 0, display: 'block' }} />
    </div>
  )
}

/* ————— verdicts automatiques ————— */
function verdicts(a: AnalysisData, b: AnalysisData): string[] {
  const out: string[] = []
  const lufsDiff = a.lufsI - b.lufsI
  if (Math.abs(lufsDiff) >= 0.5)
    out.push(`Votre mix est ${Math.abs(lufsDiff).toFixed(1)} LU ${lufsDiff > 0 ? 'plus fort' : 'moins fort'} que la référence (écoute alignée pour comparer sans biais).`)
  const crestDiff = a.crestDb - b.crestDb
  if (crestDiff <= -2)
    out.push(`Mix plus compressé : facteur de crête ${a.crestDb.toFixed(1)} dB contre ${b.crestDb.toFixed(1)} dB — attention à l'écrasement des transitoires.`)
  else if (crestDiff >= 2)
    out.push(`Mix plus dynamique que la référence (crête ${a.crestDb.toFixed(1)} dB vs ${b.crestDb.toFixed(1)} dB) — marge pour densifier au master si voulu.`)
  const lraDiff = a.lra - b.lra
  if (Math.abs(lraDiff) >= 2)
    out.push(`Plage de loudness ${lraDiff > 0 ? 'plus large' : 'plus étroite'} (LRA ${a.lra.toFixed(1)} LU vs ${b.lra.toFixed(1)} LU).`)
  if (a.truePeakDb > -1 && a.truePeakDb > b.truePeakDb)
    out.push(`Crête inter-échantillons à ${a.truePeakDb.toFixed(1)} dBTP : risque de clipping à l'encodage — visez ≤ −1 dBTP.`)

  // bandes spectrales (alignées en loudness)
  const offset = a.lufsI - b.lufsI
  const bands: Array<[string, number, number]> = [
    ['graves (<120 Hz)', 20, 120],
    ['bas-médiums (120–500 Hz)', 120, 500],
    ['médiums (500 Hz–2 kHz)', 500, 2000],
    ['hauts-médiums (2–6 kHz)', 2000, 6000],
    ['aigus (>6 kHz)', 6000, 20000]
  ]
  for (const [name, f0, f1] of bands) {
    let sum = 0
    let cnt = 0
    a.freqs.forEach((f, i) => {
      if (f >= f0 && f < f1) {
        sum += a.spectrum[i] - offset - b.spectrum[i]
        cnt++
      }
    })
    const d = sum / (cnt || 1)
    if (Math.abs(d) >= 2.5)
      out.push(`${d > 0 ? '+' : ''}${d.toFixed(1)} dB de ${name} par rapport à la référence.`)
  }
  if (out.length === 0) out.push('Mix très proche de la référence sur tous les indicateurs — beau travail.')
  return out
}

/* ————— vue principale ————— */
export default function CompareView(): React.ReactNode {
  const { tracks, settings, patchSettings } = useStore()
  const [dataA, setDataA] = useState<AnalysisData | null>(null)
  const [dataB, setDataB] = useState<AnalysisData | null>(null)
  const [busy, setBusy] = useState<'A' | 'B' | null>(null)
  const [aligned, setAligned] = useState(true)
  const [side, setSide] = useState<'A' | 'B' | 'AC'>('A')

  const trackA = tracks.find((t) => t.id === settings.compareA) ?? null
  const trackB = tracks.find((t) => t.id === settings.compareB) ?? null

  useEffect(() => {
    let alive = true
    setDataA(null)
    if (!trackA) return
    setBusy('A')
    void (async () => {
      const d = await getAnalysis(trackA.id, trackA.path)
      if (alive) {
        setDataA(d)
        setBusy((v) => (v === 'A' ? null : v))
      }
    })()
    return () => {
      alive = false
    }
  }, [trackA?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true
    setDataB(null)
    if (!trackB) return
    setBusy('B')
    void (async () => {
      const d = await getAnalysis(trackB.id, trackB.path)
      if (alive) {
        setDataB(d)
        setBusy((v) => (v === 'B' ? null : v))
      }
    })()
    return () => {
      alive = false
    }
  }, [trackB?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const corrections = dataA && dataB ? computeCorrections(dataA, dataB) : null

  /** Position courante quel que soit le moteur (lecteur ou prévisualisation). */
  const currentFraction = (): number => {
    if (side === 'AC') return preview.fraction()
    return player.track ? player.fraction() : 0
  }

  /** Bascule A / A corrigé / B : même position, loudness alignée sur le moins fort. */
  const listen = (which: 'A' | 'B' | 'AC'): void => {
    const frac = currentFraction()
    if (which === 'AC') {
      if (!trackA || !corrections) return
      setSide('AC')
      void preview.play(trackA, frac, corrections, true)
      return
    }
    const track = which === 'A' ? trackA : trackB
    if (!track) return
    setSide(which)
    let gainDb = 0
    if (aligned && dataA && dataB) {
      const target = Math.min(dataA.lufsI, dataB.lufsI)
      gainDb = target - (which === 'A' ? dataA.lufsI : dataB.lufsI) // ≤ 0
    }
    void player.playSolo(track, frac, gainDb)
  }

  const metric = (
    label: string,
    unit: string,
    va: number | undefined,
    vb: number | undefined,
    goodWhenClose = true
  ): React.ReactNode => {
    const d = va !== undefined && vb !== undefined ? va - vb : undefined
    const hot = d !== undefined && Math.abs(d) >= (unit === 'LU' || unit === 'dB' ? 2 : 1)
    return (
      <div key={label} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 8, padding: '7px 12px', borderBottom: 'var(--line)', alignItems: 'baseline' }}>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '.08em', color: 'var(--ink-soft)' }}>{label}</span>
        <span style={{ font: '700 14px var(--grotesk)', color: 'var(--accent)' }}>{va !== undefined ? va.toFixed(1) : '—'}</span>
        <span style={{ font: '700 14px var(--grotesk)' }}>{vb !== undefined ? vb.toFixed(1) : '—'}</span>
        <span className="mono" style={{ fontSize: 11, color: hot && goodWhenClose ? 'var(--accent)' : 'var(--ink-soft)' }}>
          {d !== undefined ? `${d > 0 ? '+' : ''}${d.toFixed(1)} ${unit}` : ''}
        </span>
      </div>
    )
  }

  const ready = dataA && dataB

  return (
    <>
      <div style={{ padding: '18px 18px 14px', borderBottom: 'var(--line-thick)', flex: 'none' }}>
        <div className="mono" style={{ fontSize: 9, letterSpacing: '.14em', color: 'var(--accent)' }}>OUTILS — MIX & MASTER</div>
        <h1 style={{ margin: '2px 0 0', font: '700 34px/1 var(--grotesk)', letterSpacing: '-0.02em' }}>
          Comparer <span className="serif" style={{ fontStyle: 'italic', fontWeight: 400 }}>A/B</span>
        </h1>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* sélection */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <TrackPicker label="A" color="var(--accent)" trackId={settings.compareA} onPick={(id) => patchSettings({ compareA: id })} />
          <TrackPicker label="B" color="var(--paper-3, #dbd7cc)" trackId={settings.compareB} onPick={(id) => patchSettings({ compareB: id })} />
        </div>

        {busy && (
          <div className="mono" style={{ fontSize: 10, color: 'var(--accent)', animation: 'blink 1s steps(1) infinite' }}>
            ANALYSE {busy} EN COURS — LUFS, SPECTRE, DYNAMIQUE…
          </div>
        )}

        {!trackA || !trackB ? (
          <div className="serif" style={{ fontStyle: 'italic', fontSize: 19, color: 'var(--ink-soft)', textAlign: 'center', padding: '40px 0' }}>
            Choisissez votre mix (A) et un morceau de référence (B) —<br />
            clic droit sur une piste → « A/B » pour aller plus vite.
          </div>
        ) : ready ? (
          <>
            {/* écoute A/B */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 9, letterSpacing: '.1em', color: 'var(--ink-soft)' }}>ÉCOUTE</span>
              <div style={{ display: 'flex' }}>
                <button
                  className="tap"
                  onClick={() => listen('A')}
                  style={{
                    width: 56, height: 36, border: '2px solid var(--ink)', font: '700 15px var(--grotesk)',
                    background: side === 'A' ? 'var(--accent)' : 'transparent', color: side === 'A' ? '#111' : 'inherit'
                  }}
                >
                  A
                </button>
                <button
                  className="tap"
                  onClick={() => listen('AC')}
                  title="A avec les corrections appliquées (EQ + compression)"
                  disabled={!corrections || (corrections.eq.length === 0 && !corrections.comp)}
                  style={{
                    width: 92, height: 36, border: '2px solid var(--ink)', marginLeft: -2, font: '700 12px var(--grotesk)',
                    background: side === 'AC' ? 'var(--accent)' : 'transparent', color: side === 'AC' ? '#111' : 'inherit'
                  }}
                >
                  A corrigé ✦
                </button>
                <button
                  className="tap"
                  onClick={() => listen('B')}
                  style={{
                    width: 56, height: 36, border: '2px solid var(--ink)', marginLeft: -2, font: '700 15px var(--grotesk)',
                    background: side === 'B' ? 'var(--ink)' : 'transparent', color: side === 'B' ? 'var(--paper)' : 'inherit'
                  }}
                >
                  B
                </button>
              </div>
              <label className="mono tap" style={{ fontSize: 9, letterSpacing: '.08em', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: aligned ? 'var(--accent)' : 'var(--ink-soft)' }}>
                <input type="checkbox" checked={aligned} onChange={(e) => setAligned(e.target.checked)} style={{ accentColor: '#ff4d00' }} />
                LOUDNESS ALIGNÉE
              </label>
              <span className="mono" style={{ fontSize: 9, color: 'var(--ink-soft)' }}>
                la bascule garde la position — comparez sans le biais du « plus fort = mieux »
              </span>
            </div>

            {corrections && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="mono" style={{ fontSize: 8, letterSpacing: '.12em', color: 'var(--ink-soft)' }}>
                  CORRECTIONS « A CORRIGÉ ✦ » :
                </span>
                {corrections.eq.map((m, i) => (
                  <span key={`${m.freq}-${i}`} className="badge" style={{ color: side === 'AC' ? 'var(--accent)' : undefined }}>
                    {m.type === 'lowshelf' ? 'SHELF↓' : m.type === 'highshelf' ? 'SHELF↑' : 'EQ'} {m.gainDb > 0 ? '+' : ''}
                    {m.gainDb} dB @ {m.freq >= 1000 ? `${(m.freq / 1000).toFixed(m.freq < 10000 ? 2 : 1)}k` : m.freq} Hz
                    {fmtNote(m.freq) ? ` (${fmtNote(m.freq)})` : ''}
                    {m.type === 'peaking' ? ` · Q ${m.q}` : ''}
                  </span>
                ))}
                {corrections.comp && (
                  <span className="badge" style={{ color: side === 'AC' ? 'var(--accent)' : undefined }}>
                    COMP {corrections.comp.ratio}:1 @ {corrections.comp.thresholdDb} dB · make-up {corrections.comp.makeupDb > 0 ? '+' : ''}{corrections.comp.makeupDb} dB
                  </span>
                )}
                {corrections.eq.length === 0 && !corrections.comp && (
                  <span className="mono" style={{ fontSize: 9, color: 'var(--ink-soft)' }}>aucune correction nécessaire — le mix colle déjà à la référence</span>
                )}
              </div>
            )}

            {/* spectre + métriques */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 1.5fr) minmax(280px, 1fr)', gap: 14, alignItems: 'stretch' }}>
              <div style={{ border: 'var(--line)', display: 'flex', flexDirection: 'column', minHeight: 300 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: 'var(--line)' }}>
                  <span className="mono" style={{ fontSize: 9, letterSpacing: '.1em', color: 'var(--ink-soft)' }}>SPECTRE MOYEN (dB / Hz)</span>
                  <span className="mono" style={{ fontSize: 9, display: 'flex', gap: 10 }}>
                    <span style={{ color: 'var(--accent)' }}>— A (mix)</span>
                    <span>— B (réf)</span>
                  </span>
                </div>
                <div style={{ flex: 1, padding: 6 }}>
                  <SpectrumChart a={dataA} b={dataB} aligned={aligned} />
                </div>
              </div>

              <div style={{ border: 'var(--line)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 8, padding: '8px 12px', borderBottom: 'var(--line-thick)' }}>
                  <span className="mono" style={{ fontSize: 9, letterSpacing: '.1em', color: 'var(--ink-soft)' }}>MÉTRIQUE</span>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--accent)' }}>A</span>
                  <span className="mono" style={{ fontSize: 9 }}>B</span>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--ink-soft)' }}>Δ</span>
                </div>
                {metric('LUFS INTÉGRÉ', 'LU', dataA.lufsI, dataB.lufsI)}
                {metric('LUFS COURT TERME MAX', 'LU', dataA.lufsSMax, dataB.lufsSMax)}
                {metric('LRA (PLAGE)', 'LU', dataA.lra, dataB.lra)}
                {metric('PEAK ÉCHANTILLON', 'dB', dataA.peakDb, dataB.peakDb)}
                {metric('TRUE PEAK ≈', 'dB', dataA.truePeakDb, dataB.truePeakDb)}
                {metric('RMS', 'dB', dataA.rmsDb, dataB.rmsDb)}
                {metric('FACTEUR DE CRÊTE', 'dB', dataA.crestDb, dataB.crestDb)}
                {metric('PLR', 'dB', dataA.plr, dataB.plr)}
                {metric('BPM', 'BPM', dataA.bpm || undefined, dataB.bpm || undefined, false)}
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 8, padding: '7px 12px', alignItems: 'baseline' }}>
                  <span className="mono" style={{ fontSize: 9, letterSpacing: '.08em', color: 'var(--ink-soft)' }}>TONALITÉ</span>
                  <span style={{ font: '700 13px var(--grotesk)', color: 'var(--accent)' }} title={dataA.keyName}>{dataA.camelot}</span>
                  <span style={{ font: '700 13px var(--grotesk)' }} title={dataB.keyName}>{dataB.camelot}</span>
                  <span />
                </div>
              </div>
            </div>

            {/* verdicts */}
            <div style={{ border: 'var(--line)', background: 'var(--paper-2)' }}>
              <div className="mono" style={{ fontSize: 9, letterSpacing: '.1em', color: 'var(--accent)', padding: '8px 12px 2px' }}>
                LECTURE DE L'ANALYSE
              </div>
              <ul style={{ margin: 0, padding: '6px 12px 10px 28px' }}>
                {verdicts(dataA, dataB).map((v, i) => (
                  <li key={i} style={{ font: '500 13px/1.7 var(--grotesk)' }}>{v}</li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
