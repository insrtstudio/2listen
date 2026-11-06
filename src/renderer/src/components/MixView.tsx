import { useEffect, useState, useSyncExternalStore } from 'react'
import { fmtQuality } from '@/lib/format'
import { beatDelta, deckA, deckB, getBeatLock, getCrossfade, getPhaseErrMs, onLock, setBeatLock, setCrossfade, syncBoth, type Deck } from '@/lib/decks'
import { useStore } from '@/lib/store'
import Header from './Header'
import Icon from './Icon'
import TrackPicker from './TrackPicker'
import Waveform from './Waveform'

function DeckPanel({ deck, accent }: { deck: Deck; accent: boolean }): React.ReactNode {
  const snap = useSyncExternalStore(deck.subscribe, deck.getSnapshot)
  const { tracks } = useStore()
  const t = snap.track
  const bpm = deck.effectiveBpm()

  return (
    <div className="card" style={{ flex: 1, minWidth: 300, display: 'flex', flexDirection: 'column' }}>
      <div style={{ borderBottom: 'var(--line)', position: 'relative', zIndex: 2 }}>
        <TrackPicker
          label={deck.name}
          accent={accent}
          placeholder="Charger un morceau…"
          trackId={t?.id ?? null}
          onPick={(id) => {
            const track = tracks.find((x) => x.id === id)
            if (track) void deck.load(track)
            else deck.eject()
          }}
          bare
        />
      </div>

      <div style={{ height: 180, padding: '8px 12px', borderBottom: 'var(--line)' }}>
        <Waveform track={t} source={deck} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
        <button className="blk" onClick={() => deck.cuePress()} title="À l'arrêt : pose le point de cue. En lecture : y retourne.">
          Cue
        </button>
        <button className="ic acc" style={{ width: 36, height: 36 }} title={snap.playing ? 'Pause' : 'Lecture'} onClick={() => deck.toggle()}>
          <Icon name={snap.playing ? 'pause' : 'play'} />
        </button>
        <div className="grow" />
        {snap.loading ? (
          <span className="dim pulse">Chargement…</span>
        ) : (
          <>
            {snap.analysis && <span className="badge hot" title={snap.analysis.keyName}>{snap.analysis.camelot}</span>}
            <span title={t ? fmtQuality(t) : undefined} style={{ font: '700 22px/1 var(--grotesk)', letterSpacing: '-0.02em' }}>
              {bpm ? bpm.toFixed(1) : '—'}
            </span>
            <span className="label">BPM</span>
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 12px 10px' }}>
        <div className="prow" title="Double-clic : remet à zéro">
          <span>Pitch</span>
          <input
            type="range"
            min={-8}
            max={8}
            step={0.1}
            value={(snap.rate - 1) * 100}
            onChange={(e) => deck.setRate(1 + Number(e.target.value) / 100)}
            onDoubleClick={() => deck.setRate(1)}
          />
          <span style={{ color: snap.rate !== 1 ? 'var(--accent-2)' : undefined }}>
            {snap.rate >= 1 ? '+' : ''}{((snap.rate - 1) * 100).toFixed(1)} %
          </span>
        </div>
        <div className="prow">
          <span>Volume</span>
          <input
            type="range"
            className="fill"
            min={0}
            max={1}
            step={0.01}
            value={snap.volume}
            onChange={(e) => deck.setVolume(Number(e.target.value))}
            style={{ '--pct': `${snap.volume * 100}%` } as React.CSSProperties}
          />
          <span>{Math.round(snap.volume * 100)} %</span>
        </div>
      </div>
    </div>
  )
}

/** Compatibilité Camelot : même case, ±1 sur la roue, ou A↔B du même numéro. */
function keyCompatible(a: string, b: string): boolean {
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
  const synced = !!bd && bd.delta < 0.2
  const canSync = !!snapA.analysis?.bpm && !!snapB.analysis?.bpm

  const status = bpmA && bpmB && bd ? (
    <>
      <span style={{ color: synced ? 'var(--accent-2)' : undefined }}>
        {synced ? 'Tempos calés' : `Écart ${bd.delta.toFixed(1)} BPM`}
        {bd.ratio !== 1 ? ` (${bd.ratio === 2 ? '2:1' : '1:2'})` : ''}
      </span>
      {camA && camB && (
        <span style={{ color: keyCompatible(camA, camB) ? 'var(--accent-2)' : undefined }}>
          {' · '}{camA} × {camB} {keyCompatible(camA, camB) ? 'compatibles' : 'éloignées'}
        </span>
      )}
    </>
  ) : undefined

  return (
    <>
      <Header title="Table de mix" sub={status} />
      <div className="pane-scroll">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 'none' }}>
          <DeckPanel deck={deckA} accent />
          <DeckPanel deck={deckB} accent={false} />
        </div>

        <div className="card" style={{ flex: 'none', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className={`blk ${canSync && !synced ? 'acc' : ''}`}
            onClick={() => syncBoth(deckA, deckB)}
            disabled={!canSync}
            title="Les deux platines convergent vers un tempo commun (chaque pitch bouge deux fois moins)"
          >
            Sync
          </button>
          <button
            className={`blk ${lock ? 'on' : ''}`}
            onClick={() => setBeatLock(!lock)}
            disabled={!canSync}
            title="Un morceau lancé pendant que l'autre joue part déjà calé, puis reste verrouillé sur la grille"
          >
            Lock
          </button>
          {lock && (
            <span className="mono dim" style={{ fontSize: 10.5, width: 60, flex: 'none', color: Math.abs(phaseErr) < 15 ? 'var(--accent-2)' : undefined }}>
              {Math.abs(phaseErr) < 15 ? 'En grille' : `${phaseErr > 0 ? '+' : ''}${phaseErr} ms`}
            </span>
          )}
          <div style={{ width: 8 }} />
          <span className="dot a">A</span>
          <input
            type="range"
            className="xfader"
            style={{ flex: 1 }}
            title="Crossfader. Double-clic : centre"
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
          <span className="dot">B</span>
        </div>
      </div>
    </>
  )
}
