import { useEffect, useState, useSyncExternalStore } from 'react'
import { fmtDuration, fmtQuality } from '@/lib/format'
import { player } from '@/lib/player'
import { useStore } from '@/lib/store'
import Cover from './Cover'
import Waveform from './Waveform'

/** Affichage du temps piloté par les événements audio, hors re-render global. */
function TimeReadout({ side }: { side: 'cur' | 'total' }): React.ReactNode {
  const [text, setText] = useState('0:00')
  useEffect(
    () =>
      player.onTime((t, d) => {
        setText(fmtDuration(side === 'cur' ? t : d))
      }),
    [side]
  )
  return <span>{text}</span>
}

export default function PlayerBar(): React.ReactNode {
  const snap = useSyncExternalStore(player.subscribe, player.getSnapshot)
  const { settings, patchSettings } = useStore()
  const t = snap.track

  const cycleRepeat = (): void => {
    const order: Array<'off' | 'all' | 'one'> = ['off', 'all', 'one']
    const next = order[(order.indexOf(settings.repeat) + 1) % 3]
    patchSettings({ repeat: next })
  }

  return (
    <footer style={{ flex: 'none' }}>
      {snap.stalled && (
        <div
          className="mono"
          style={{
            background: 'var(--accent)',
            color: '#111',
            fontSize: 10,
            letterSpacing: '.06em',
            padding: '6px 18px',
            borderTop: 'var(--line-thick)'
          }}
        >
          ⚠ LA SORTIE AUDIO SYSTÈME NE RÉPOND PAS — vérifiez votre interface audio ou changez de sortie dans Réglages
          Système → Son.
        </div>
      )}
      <div
      style={{
        borderTop: 'var(--line-thick)',
        display: 'grid',
        gridTemplateColumns: '340px 1fr 300px',
        alignItems: 'stretch',
        height: 108,
        background: 'var(--paper)'
      }}
    >
      {/* — piste en cours — */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', borderRight: 'var(--line)', minWidth: 0 }}>
        <Cover coverKey={t?.cover ?? null} size={76} alt={t?.album ?? ''} />
        <div style={{ minWidth: 0 }}>
          {t ? (
            <>
              <div style={{ font: '700 15px/1.25 var(--grotesk)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {t.title}
              </div>
              <div style={{ font: '400 12px/1.4 var(--grotesk)', color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {t.artist}
              </div>
              <div style={{ marginTop: 4 }}>
                <span className={`badge ${t.lossless ? 'hot' : ''}`}>{fmtQuality(t)}</span>
              </div>
            </>
          ) : (
            <div className="serif" style={{ fontStyle: 'italic', fontSize: 17, color: 'var(--ink-soft)' }}>
              Rien en écoute
            </div>
          )}
        </div>
      </div>

      {/* — transport + waveform — */}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ flex: 1, minHeight: 0, padding: '10px 18px 2px' }}>
          <Waveform track={t} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 18px 8px' }}>
          <span className="mono" style={{ fontSize: 10, width: 52 }}>
            <TimeReadout side="cur" />
          </span>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 4 }}>
            <button
              className="tap"
              onClick={() => patchSettings({ shuffle: !settings.shuffle })}
              title="Lecture aléatoire"
              style={{
                font: '700 11px var(--grotesk)', padding: '3px 10px',
                border: '2px solid var(--ink)',
                background: settings.shuffle ? 'var(--accent)' : 'transparent',
                color: settings.shuffle ? '#111' : 'inherit'
              }}
            >
              ALÉA
            </button>
            <button className="tap" onClick={() => player.prev()} title="Précédent"
              style={{ font: '700 15px var(--grotesk)', padding: '2px 12px', border: '2px solid var(--ink)' }}>
              ⏮
            </button>
            <button
              className="tap"
              onClick={() => player.toggle()}
              title={snap.playing ? 'Pause' : 'Lecture'}
              style={{
                font: '700 15px var(--grotesk)', padding: '2px 22px',
                border: '2px solid var(--ink)', background: 'var(--accent)', color: '#111'
              }}
            >
              {snap.playing ? '❚❚' : '▶'}
            </button>
            <button className="tap" onClick={() => player.next()} title="Suivant"
              style={{ font: '700 15px var(--grotesk)', padding: '2px 12px', border: '2px solid var(--ink)' }}>
              ⏭
            </button>
            <button
              className="tap"
              onClick={cycleRepeat}
              title="Répétition"
              style={{
                font: '700 11px var(--grotesk)', padding: '3px 10px',
                border: '2px solid var(--ink)',
                background: settings.repeat !== 'off' ? 'var(--accent)' : 'transparent',
                color: settings.repeat !== 'off' ? '#111' : 'inherit'
              }}
            >
              {settings.repeat === 'one' ? 'REP·1' : 'REP'}
            </button>
          </div>
          <span className="mono" style={{ fontSize: 10, width: 52, textAlign: 'right', color: 'var(--ink-soft)' }}>
            <TimeReadout side="total" />
          </span>
        </div>
      </div>

      {/* — volume — */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, padding: '0 20px', borderLeft: 'var(--line)' }}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-soft)' }}>VOL</span>
        <input
          type="range"
          className="vol"
          min={0}
          max={1}
          step={0.01}
          value={settings.volume}
          onChange={(e) => patchSettings({ volume: Number(e.target.value) })}
        />
        <span className="mono" style={{ fontSize: 10, width: 30 }}>{Math.round(settings.volume * 100)}%</span>
      </div>
      </div>
    </footer>
  )
}
