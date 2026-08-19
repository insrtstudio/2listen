import { useEffect, useState, useSyncExternalStore } from 'react'
import { fmtQuality } from '@/lib/format'
import { beatDelta, deckA, deckB, getBeatLock, getCrossfade, getPhaseErrMs, onLock, setBeatLock, setCrossfade, syncBoth, type Deck } from '@/lib/decks'
import { useStore } from '@/lib/store'
import TrackPicker from './TrackPicker'
import Waveform from './Waveform'

function DeckPanel({ deck, accent }: { deck: Deck; accent: boolean }): React.ReactNode {
  const snap = useSyncExternalStore(deck.subscribe, deck.getSnapshot)
  const { tracks } = useStore()
  const t = snap.track
  const bpm = deck.effectiveBpm()
  const color = accent ? 'var(--accent)' : 'var(--ink)'

  return (
    <div style={{ flex: 1, minWidth: 0, border: 'var(--line)', display: 'flex', flexDirection: 'column' }}>
      {/* en-tête platine */}
      <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: 'var(--line)' }}>
        <div
          style={{
            width: 40,
            display: 'grid',
            placeItems: 'center',
            background: accent ? 'var(--accent)' : 'var(--ink)',
            color: accent ? '#111' : 'var(--paper)',
            font: '700 17px var(--grotesk)',
            flex: 'none'
          }}
        >
          {deck.name}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TrackPicker
            label={deck.name}
            color={accent ? 'var(--accent)' : 'var(--paper-3)'}
            trackId={t?.id ?? null}
            onPick={(id) => {
              const track = tracks.find((x) => x.id === id)
              if (track) void deck.load(track)
              else deck.eject()
            }}
            bare
          />
        </div>
      </div>

      {/* infos BPM / clé / qualité */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '8px 12px', borderBottom: 'var(--line)', flexWrap: 'wrap' }}>
        <span style={{ font: '700 26px/1 var(--grotesk)', color, minWidth: 88 }}>
          {snap.analyzing ? (
            <span className="mono" style={{ fontSize: 10, animation: 'blink 1s steps(1) infinite' }}>ANALYSE…</span>
          ) : bpm ? (
            <>
              {bpm.toFixed(1)}
              <span className="mono" style={{ fontSize: 9, marginLeft: 3, color: 'var(--ink-soft)' }}>BPM</span>
            </>
          ) : (
            '—'
          )}
        </span>
        {snap.analysis && (
          <>
            <span className="badge hot" style={{ fontSize: 11 }}>{snap.analysis.camelot}</span>
            <span className="mono" style={{ fontSize: 9, color: 'var(--ink-soft)' }}>{snap.analysis.keyName}</span>
          </>
        )}
        {t && <span className="badge" style={{ marginLeft: 'auto' }}>{fmtQuality(t)}</span>}
      </div>

      {/* waveform pilotée par la platine */}
      <div style={{ height: 92, padding: '6px 10px', borderBottom: 'var(--line)' }}>
        <Waveform track={t} source={deck} />
      </div>

      {/* transport + pitch */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', flexWrap: 'wrap' }}>
        <button
          className="tap"
          onClick={() => deck.cuePress()}
          title="À l'arrêt : pose le point de cue — en lecture : y retourne"
          style={{ width: 52, height: 40, border: '2px solid var(--ink)', font: '700 11px var(--grotesk)' }}
        >
          CUE
        </button>
        <button
          className="tap"
          onClick={() => deck.toggle()}
          style={{
            width: 64,
            height: 40,
            border: '2px solid var(--ink)',
            marginLeft: -2,
            font: '700 15px var(--grotesk)',
            background: snap.playing ? color : 'transparent',
            color: snap.playing ? (accent ? '#111' : 'var(--paper)') : 'inherit'
          }}
        >
          {snap.playing ? '❚❚' : '▶'}
        </button>
        <button
          className="mono tap"
          onClick={() => deck.setMasterTempo(!snap.masterTempo)}
          title="Master tempo : le pitch ne change plus la hauteur"
          style={{
            fontSize: 9,
            letterSpacing: '.1em',
            border: '1.5px solid currentColor',
            padding: '5px 9px',
            color: snap.masterTempo ? 'var(--accent)' : 'var(--ink-soft)'
          }}
        >
          MT
        </button>
        <div style={{ flex: 1, minWidth: 130, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ fontSize: 8, color: 'var(--ink-soft)' }}>PITCH</span>
          <input
            type="range"
            className="vol"
            style={{ flex: 1, width: 'auto' }}
            min={-8}
            max={8}
            step={0.1}
            value={(snap.rate - 1) * 100}
            onChange={(e) => deck.setRate(1 + Number(e.target.value) / 100)}
            onDoubleClick={() => deck.setRate(1)}
          />
          <span className="mono" style={{ fontSize: 10, width: 44, textAlign: 'right', color: snap.rate !== 1 ? 'var(--accent)' : 'inherit' }}>
            {snap.rate >= 1 ? '+' : ''}{((snap.rate - 1) * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* volume de la platine */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px 10px' }}>
        <span className="mono" style={{ fontSize: 8, color: 'var(--ink-soft)' }}>VOL</span>
        <input
          type="range"
          className="vol"
          style={{ flex: 1, width: 'auto' }}
          min={0}
          max={1}
          step={0.01}
          value={snap.volume}
          onChange={(e) => deck.setVolume(Number(e.target.value))}
        />
        <span className="mono" style={{ fontSize: 10, width: 34, textAlign: 'right' }}>{Math.round(snap.volume * 100)}%</span>
      </div>
    </div>
  )
}

export default function MixView(): React.ReactNode {
  const [xf, setXf] = useState(getCrossfade())
  const [lock, setLock] = useState(getBeatLock())
  const [phaseErr, setPhaseErr] = useState(0)
  useEffect(() => onLock(() => {
    setLock(getBeatLock())
    setPhaseErr(getPhaseErrMs())
  }), [])
  const snapA = useSyncExternalStore(deckA.subscribe, deckA.getSnapshot)
  const snapB = useSyncExternalStore(deckB.subscribe, deckB.getSnapshot)

  const bpmA = deckA.effectiveBpm()
  const bpmB = deckB.effectiveBpm()
  const bd = beatDelta(deckA, deckB)
  const camA = snapA.analysis?.camelot
  const camB = snapB.analysis?.camelot
  /** Compatibilité Camelot : même case, ±1 sur la roue, ou A↔B du même numéro. */
  const keyCompatible = (a: string, b: string): boolean => {
    const ma = a.match(/^(\d+)([AB])$/)
    const mb = b.match(/^(\d+)([AB])$/)
    if (!ma || !mb) return false
    const na = Number(ma[1])
    const nb = Number(mb[1])
    if (ma[2] === mb[2]) {
      const d = Math.abs(na - nb)
      return d === 0 || d === 1 || d === 11
    }
    return na === nb
  }

  return (
    <>
      <div style={{ padding: '18px 18px 14px', borderBottom: 'var(--line-thick)', flex: 'none', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className="mono" style={{ fontSize: 9, letterSpacing: '.14em', color: 'var(--accent)' }}>OUTILS — DJ</div>
          <h1 style={{ margin: '2px 0 0', font: '700 34px/1 var(--grotesk)', letterSpacing: '-0.02em' }}>
            Table de <span className="serif" style={{ fontStyle: 'italic', fontWeight: 400 }}>mix</span>
          </h1>
        </div>
        {bpmA && bpmB && bd && (
          <div className="mono" style={{ fontSize: 10, textAlign: 'right', color: 'var(--ink-soft)' }}>
            <span style={{ color: bd.delta < 0.2 ? 'var(--accent)' : 'inherit' }}>
              Δ TEMPO {bd.delta.toFixed(1)} BPM{bd.ratio !== 1 ? ` (rapport ${bd.ratio === 2 ? '2:1' : '1:2'})` : ''}
              {bd.delta < 0.2 ? ' — CALÉ ✓' : ''}
            </span>
            {camA && camB && (
              <span style={{ marginLeft: 10, color: keyCompatible(camA, camB) ? 'var(--accent)' : 'var(--ink-soft)' }}>
                {camA} × {camB} — {keyCompatible(camA, camB) ? 'CLÉS COMPATIBLES ✓' : 'clés éloignées'}
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <DeckPanel deck={deckA} accent />
          <DeckPanel deck={deckB} accent={false} />
        </div>

        {/* crossfader + beatmatch */}
        <div style={{ border: 'var(--line)', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            className="tap"
            onClick={() => syncBoth(deckA, deckB)}
            disabled={!snapA.analysis?.bpm || !snapB.analysis?.bpm}
            title="Les deux platines convergent vers un tempo commun (chaque pitch bouge deux fois moins)"
            style={{
              border: '2px solid var(--ink)',
              background: bd && bd.delta < 0.2 ? 'var(--ink)' : 'var(--accent)',
              color: bd && bd.delta < 0.2 ? 'var(--paper)' : '#111',
              font: '700 12px var(--grotesk)',
              letterSpacing: '.06em',
              padding: '9px 16px',
              flex: 'none'
            }}
          >
            SYNC ⇄
          </button>
          <button
            className="mono tap"
            onClick={() => setBeatLock(!lock)}
            disabled={!snapA.analysis?.bpm || !snapB.analysis?.bpm}
            title="Calage automatique continu : la platine secondaire reste verrouillée sur la grille de l'autre"
            style={{
              border: '2px solid var(--ink)',
              background: lock ? 'var(--accent)' : 'transparent',
              color: lock ? '#111' : 'inherit',
              font: '700 11px var(--grotesk)',
              letterSpacing: '.08em',
              padding: '10px 12px',
              flex: 'none'
            }}
          >
            LOCK {lock ? '●' : '○'}
          </button>
          {lock && (
            <span className="mono" style={{ fontSize: 9, color: Math.abs(phaseErr) < 15 ? 'var(--accent)' : 'var(--ink-soft)', flex: 'none', width: 58 }}>
              {Math.abs(phaseErr) < 15 ? 'EN GRILLE ✓' : `${phaseErr > 0 ? '+' : ''}${phaseErr} ms`}
            </span>
          )}
          <span style={{ font: '700 15px var(--grotesk)', color: 'var(--accent)' }}>A</span>
          <input
            type="range"
            className="vol xfader"
            style={{ flex: 1, width: 'auto' }}
            min={0}
            max={1}
            step={0.005}
            value={xf}
            onChange={(e) => {
              const v = Number(e.target.value)
              setXf(v)
              setCrossfade(v)
            }}
            onDoubleClick={() => {
              setXf(0.5)
              setCrossfade(0.5)
            }}
          />
          <span style={{ font: '700 15px var(--grotesk)' }}>B</span>
          <span className="mono" style={{ fontSize: 8, color: 'var(--ink-soft)', width: 120, textAlign: 'right' }}>
            CROSSFADER — double-clic : centre
          </span>
        </div>
      </div>
    </>
  )
}
