import { useEffect, useRef, useState } from 'react'
import type { AnalysisData } from '@shared/types'
import { getAnalysis } from '@/lib/analysis'
import { computeCorrections, preview } from '@/lib/preview'
import { player } from '@/lib/player'
import { useStore } from '@/lib/store'
import Header from './Header'
import TrackPicker from './TrackPicker'
import { fmtNote } from '@/lib/notes'
import { clubAssessment, KNOWLEDGE_SOURCES, proTricks } from '@/lib/knowledge'

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
      ctx.font = '9px "Fragment Mono", monospace'
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
  // stéréo
  if (a.corr < 0.2)
    out.push(`Corrélation L/R faible (${a.corr.toFixed(2)}) : des éléments hors phase disparaîtront en mono — vérifiez les traitements d'élargissement.`)
  if (a.widthLowDb > -20 && a.widthLowDb > b.widthLowDb + 3)
    out.push(`Graves plus larges que la référence (${a.widthLowDb.toFixed(0)} dB S/M vs ${b.widthLowDb.toFixed(0)}) : monoïsez sous 100–150 Hz.`)
  const dW = b.widthHighDb - a.widthHighDb
  if (dW >= 3) out.push(`Image plus étroite que la référence dans les aigus (${dW.toFixed(1)} dB d'écart de largeur S/M).`)
  else if (dW <= -3) out.push(`Image plus large que la référence dans les aigus — attention à la tenue en mono.`)
  if (Math.abs(a.balanceDb) >= 1) out.push(`Balance décentrée de ${Math.abs(a.balanceDb).toFixed(1)} dB vers la ${a.balanceDb > 0 ? 'gauche' : 'droite'}.`)

  if (out.length === 0) out.push('Mix très proche de la référence sur tous les indicateurs — beau travail.')
  return out
}

/** Conseils stéréo ciblés — principes des classiques du mixage/mastering
 *  (Bob Katz, Mike Senior), reformulés et déclenchés par les mesures. */
function stereoTips(a: AnalysisData, b: AnalysisData): string[] {
  const tips: string[] = []
  if (a.widthLowDb > -20 && a.widthLowDb > b.widthLowDb + 3)
    tips.push('Basses en mono sous ~120 Hz (EQ M/S ou utilitaire) : translation club et petits systèmes, punch centré — pratique standard du mastering (Katz).')
  if (b.widthHighDb - a.widthHighDb >= 3) {
    tips.push('Pour élargir sans casser le mono : doublez la partie et pan gauche/droite dur avec une prise différente, ou désaccordez ±8 ¢ — plus stable qu\'un « stereo widener ».')
    tips.push('Effet Haas : copie retardée de 10–25 ms pannée à l\'opposé — large immédiatement, mais contrôlez la somme mono (risque de filtrage en peigne).')
    tips.push('Réservez la largeur aux éléments d\'ambiance (pads, reverbs, delays ping-pong) ; lead, basse et kick restent au centre — panning LCR (Senior).')
  }
  if (a.corr < 0.3)
    tips.push('Corrélation basse : réduisez les élargisseurs par déphasage, préférez des sources réellement différentes à gauche et à droite, et contrôlez toujours au corrélomètre en somme mono.')
  if (Math.abs(a.balanceDb) >= 1)
    tips.push('Rééquilibrez au bus master (balance) puis vérifiez : une balance qui penche vient souvent d\'un seul élément pané trop fort, pas du mix entier.')
  if (tips.length === 0 && b.widthMidDb - a.widthMidDb >= 2)
    tips.push('Largeur d\'ensemble : élargissez les médiums avec des doublages pannés plutôt qu\'un traitement global — la profondeur vient du contraste étroit/large entre éléments.')
  return tips
}

/* ————— vue principale ————— */
export default function CompareView(): React.ReactNode {
  const { tracks, settings, patchSettings } = useStore()
  const [dataA, setDataA] = useState<AnalysisData | null>(null)
  const [dataB, setDataB] = useState<AnalysisData | null>(null)
  const [busy, setBusy] = useState<'A' | 'B' | null>(null)
  const [aligned, setAligned] = useState(true)
  const [side, setSide] = useState<'A' | 'B' | 'AC'>('A')
  const [allMetrics, setAllMetrics] = useState(false)
  const [showFixes, setShowFixes] = useState(false)
  const [tab, setTab] = useState('analysis')

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
      <div key={label} className="metric">
        <span className="n ell">{label}</span>
        <span className="v a">{va !== undefined ? va.toFixed(1) : '—'}</span>
        <span className="v">{vb !== undefined ? vb.toFixed(1) : '—'}</span>
        <span className={`d ${hot && goodWhenClose ? 'hot' : ''}`}>{d !== undefined ? `${d > 0 ? '+' : ''}${d.toFixed(1)} ${unit}` : ''}</span>
      </div>
    )
  }

  const ready = dataA && dataB
  const fixCount = corrections
    ? corrections.eq.length + (corrections.rumbleHpHz ? 1 : 0) + (corrections.stereo?.labels.length ?? 0) + (corrections.comp ? 1 : 0)
    : 0

  // les conseils : un onglet par famille, seules celles qui ont quelque chose à dire
  const tabs = ready
    ? [
        { key: 'analysis', label: 'Analyse', items: verdicts(dataA, dataB) },
        { key: 'club', label: 'Repères club', items: clubAssessment(dataA), note: KNOWLEDGE_SOURCES },
        { key: 'tricks', label: 'Tricks des masters', items: proTricks(dataA, dataB) },
        { key: 'stereo', label: 'Stéréo', items: stereoTips(dataA, dataB) }
      ].filter((x) => x.items.length > 0)
    : []
  const current = tabs.find((x) => x.key === tab) ?? tabs[0]

  return (
    <>
      <Header
        title="Comparer A/B"
        sub={busy ? <span className="pulse">Analyse de {busy}…</span> : undefined}
      />

      <div className="pane-scroll">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 'none', position: 'relative', zIndex: 3 }}>
          <TrackPicker label="A" accent placeholder="Votre mix…" trackId={settings.compareA} onPick={(id) => patchSettings({ compareA: id })} />
          <TrackPicker label="B" placeholder="Le morceau de référence…" trackId={settings.compareB} onPick={(id) => patchSettings({ compareB: id })} />
        </div>

        {!trackA || !trackB ? (
          <div className="card page" style={{ display: 'grid', placeItems: 'center' }}>
            <div className="empty">
              Choisissez votre mix et un morceau de référence,<br />ou glissez-les depuis la liste.
            </div>
          </div>
        ) : ready ? (
          <>
            <div className="card" style={{ flex: 'none', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div className="seg acc">
                <button className={side === 'A' ? 'on' : ''} onClick={() => listen('A')}>A</button>
                <button
                  className={side === 'AC' ? 'on' : ''}
                  onClick={() => listen('AC')}
                  title="A avec les corrections appliquées (EQ + compression)"
                  disabled={!corrections || (corrections.eq.length === 0 && !corrections.comp)}
                >
                  A corrigé
                </button>
                <button className={side === 'B' ? 'on' : ''} onClick={() => listen('B')}>B</button>
              </div>
              <label className="switch" title="La bascule garde la position. Écoute au même niveau, pour comparer sans le biais du « plus fort = mieux ».">
                <input type="checkbox" checked={aligned} onChange={(e) => setAligned(e.target.checked)} />
                Loudness alignée
              </label>
              <div className="grow" />
              {fixCount > 0 ? (
                <button className={`blk sm ${showFixes ? 'on' : ''}`} onClick={() => setShowFixes((v) => !v)}>
                  {fixCount} correction{fixCount > 1 ? 's' : ''} proposée{fixCount > 1 ? 's' : ''}
                </button>
              ) : (
                <span className="dim" style={{ fontSize: 12 }}>Aucune correction nécessaire</span>
              )}
              {showFixes && corrections && fixCount > 0 && (
                <div className="chips" style={{ flexBasis: '100%' }}>
                  {corrections.eq.map((m, i) => (
                    <span key={`${m.freq}-${i}`} className={`badge ${side === 'AC' ? 'hot' : ''}`}>
                      {m.type === 'lowshelf' ? 'Shelf bas' : m.type === 'highshelf' ? 'Shelf haut' : 'EQ'} {m.gainDb > 0 ? '+' : ''}
                      {m.gainDb} dB à {m.freq >= 1000 ? `${(m.freq / 1000).toFixed(m.freq < 10000 ? 2 : 1)}k` : m.freq} Hz
                      {fmtNote(m.freq) ? ` (${fmtNote(m.freq)})` : ''}
                      {m.type === 'peaking' ? ` · Q ${m.q}` : ''}
                    </span>
                  ))}
                  {corrections.rumbleHpHz && <span className={`badge ${side === 'AC' ? 'hot' : ''}`}>Coupe-bas {corrections.rumbleHpHz} Hz</span>}
                  {corrections.stereo?.labels.map((l) => <span key={l} className={`badge ${side === 'AC' ? 'hot' : ''}`}>Stéréo {l}</span>)}
                  {corrections.comp && (
                    <span className={`badge ${side === 'AC' ? 'hot' : ''}`}>
                      Comp {corrections.comp.ratio}:1 à {corrections.comp.thresholdDb} dB · gain {corrections.comp.makeupDb > 0 ? '+' : ''}{corrections.comp.makeupDb} dB
                    </span>
                  )}
                </div>
              )}
            </div>

            <div style={{ flex: 'none', display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) 330px', gap: 8, alignItems: 'stretch' }}>
              <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 300, overflow: 'hidden' }}>
                <div className="phead">
                  <span className="label grow">Spectre moyen</span>
                  <span className="mono" style={{ fontSize: 10, display: 'flex', gap: 10 }}>
                    <span style={{ color: 'var(--accent-2)' }}>— A</span>
                    <span>— B</span>
                  </span>
                </div>
                <div style={{ flex: 1, padding: 6, display: 'flex', minHeight: 0 }}>
                  <SpectrumChart a={dataA} b={dataB} aligned={aligned} />
                </div>
              </div>

              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="phead" style={{ display: 'grid', gridTemplateColumns: '1fr 58px 58px 62px' }}>
                  <span className="label">Mesures</span>
                  <span className="label" style={{ textAlign: 'right', color: 'var(--accent-2)' }}>A</span>
                  <span className="label" style={{ textAlign: 'right' }}>B</span>
                  <span className="label" style={{ textAlign: 'right' }}>Écart</span>
                </div>
                {metric('LUFS intégré', 'LU', dataA.lufsI, dataB.lufsI)}
                {metric('True peak', 'dB', dataA.truePeakDb, dataB.truePeakDb)}
                {metric('Plage (LRA)', 'LU', dataA.lra, dataB.lra)}
                {metric('Facteur de crête', 'dB', dataA.crestDb, dataB.crestDb)}
                {metric('Corrélation L/R', '', dataA.corr, dataB.corr, false)}
                {metric('BPM', 'BPM', dataA.bpm || undefined, dataB.bpm || undefined, false)}
                <div className="metric">
                  <span className="n">Tonalité</span>
                  <span className="v a" title={dataA.keyName}>{dataA.camelot}</span>
                  <span className="v" title={dataB.keyName}>{dataB.camelot}</span>
                  <span />
                </div>
                {allMetrics && (
                  <>
                    {metric('LUFS court terme max', 'LU', dataA.lufsSMax, dataB.lufsSMax)}
                    {metric('Peak échantillon', 'dB', dataA.peakDb, dataB.peakDb)}
                    {metric('RMS', 'dB', dataA.rmsDb, dataB.rmsDb)}
                    {metric('PLR', 'dB', dataA.plr, dataB.plr)}
                    {metric('Largeur graves (S/M)', 'dB', dataA.widthLowDb, dataB.widthLowDb)}
                    {metric('Largeur médiums', 'dB', dataA.widthMidDb, dataB.widthMidDb)}
                    {metric('Largeur aigus', 'dB', dataA.widthHighDb, dataB.widthHighDb)}
                    {metric('Balance L/R', 'dB', dataA.balanceDb, dataB.balanceDb)}
                  </>
                )}
                <div style={{ padding: '8px 14px', borderTop: 'var(--line)' }}>
                  <button className="blk sm" onClick={() => setAllMetrics((v) => !v)}>
                    {allMetrics ? 'Moins de mesures' : 'Toutes les mesures'}
                  </button>
                </div>
              </div>
            </div>

            {current && (
              <div className="card" style={{ flex: 'none' }}>
                <div className="phead" style={{ minHeight: 42 }}>
                  <div className="seg">
                    {tabs.map((x) => (
                      <button key={x.key} className={current.key === x.key ? 'on' : ''} onClick={() => setTab(x.key)}>
                        {x.label} <span className="n">{x.items.length}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <ul className="advice">
                  {current.items.map((v, i) => <li key={i}>{v}</li>)}
                </ul>
                {current.note && <div className="dim" style={{ fontSize: 11, padding: '0 14px 12px' }}>{current.note}</div>}
              </div>
            )}
          </>
        ) : null}
      </div>
    </>
  )
}
