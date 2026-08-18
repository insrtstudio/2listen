import { useEffect, useState, useSyncExternalStore } from 'react'
import { fmtDuration, fmtQuality } from '@/lib/format'
import { player } from '@/lib/player'
import { useStore } from '@/lib/store'
import Cover from './Cover'
import Waveform from './Waveform'

const BAR = 124 // hauteur intérieure de la barre de lecture

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

/** Bouton de transport carré, bordures fusionnées avec son voisin de gauche. */
function TBtn({
  label,
  title,
  onClick,
  size,
  active,
  accent,
  first
}: {
  label: string
  title: string
  onClick: () => void
  size: number
  active?: boolean
  accent?: boolean
  first?: boolean
}): React.ReactNode {
  return (
    <button
      className="tap"
      onClick={onClick}
      title={title}
      style={{
        width: size,
        height: size,
        border: '2px solid var(--ink)',
        marginLeft: first ? 0 : -2,
        display: 'grid',
        placeItems: 'center',
        font: `700 ${accent ? 17 : 13}px var(--grotesk)`,
        background: accent ? 'var(--accent)' : active ? 'var(--ink)' : 'transparent',
        color: accent ? '#111' : active ? 'var(--paper)' : 'inherit',
        position: accent ? 'relative' : undefined,
        zIndex: accent ? 1 : undefined
      }}
    >
      {label}
    </button>
  )
}

export default function PlayerBar(): React.ReactNode {
  const snap = useSyncExternalStore(player.subscribe, player.getSnapshot)
  const { settings, patchSettings } = useStore()
  const t = snap.track

  const cycleRepeat = (): void => {
    const order: Array<'off' | 'all' | 'one'> = ['off', 'all', 'one']
    patchSettings({ repeat: order[(order.indexOf(settings.repeat) + 1) % 3] })
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
          gridTemplateColumns: `${BAR}px minmax(170px, 250px) max-content 1fr 150px`,
          alignItems: 'stretch',
          height: BAR,
          background: 'var(--paper)'
        }}
      >
        {/* — pochette pleine cellule — */}
        <div style={{ borderRight: 'var(--line)' }}>
          <Cover coverKey={t?.cover ?? null} size={BAR} alt={t?.album ?? ''} flush />
        </div>

        {/* — titre / artiste / qualité — */}
        <div
          style={{
            borderRight: 'var(--line)',
            padding: '0 16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 5,
            minWidth: 0
          }}
        >
          {t ? (
            <>
              <div
                style={{
                  font: '700 15px/1.2 var(--grotesk)',
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical'
                }}
              >
                {t.title}
              </div>
              <div
                style={{
                  font: '400 12px/1.3 var(--grotesk)',
                  color: 'var(--ink-soft)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {t.artist}
              </div>
              <span className={`badge ${t.lossless ? 'hot' : ''}`} style={{ alignSelf: 'flex-start' }}>
                {fmtQuality(t)}
              </span>
            </>
          ) : (
            <div className="serif" style={{ fontStyle: 'italic', fontSize: 17, color: 'var(--ink-soft)' }}>
              Rien en écoute
            </div>
          )}
        </div>

        {/* — transport : trois carrés fusionnés + bascules dessous — */}
        <div
          style={{
            borderRight: 'var(--line)',
            padding: '0 18px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8
          }}
        >
          <div style={{ display: 'flex' }}>
            <TBtn first size={46} label="⏮" title="Précédent" onClick={() => player.prev()} />
            <TBtn size={46} accent label={snap.playing ? '❚❚' : '▶'} title={snap.playing ? 'Pause' : 'Lecture'} onClick={() => player.toggle()} />
            <TBtn size={46} label="⏭" title="Suivant" onClick={() => player.next()} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="mono tap"
              onClick={() => patchSettings({ shuffle: !settings.shuffle })}
              title="Lecture aléatoire"
              style={{
                font: '400 9px var(--mono)',
                letterSpacing: '.1em',
                padding: '3px 8px',
                border: '1.5px solid currentColor',
                color: settings.shuffle ? 'var(--accent)' : 'var(--ink-soft)'
              }}
            >
              ALÉA
            </button>
            <button
              className="mono tap"
              onClick={cycleRepeat}
              title="Répétition"
              style={{
                font: '400 9px var(--mono)',
                letterSpacing: '.1em',
                padding: '3px 8px',
                border: '1.5px solid currentColor',
                color: settings.repeat !== 'off' ? 'var(--accent)' : 'var(--ink-soft)'
              }}
            >
              {settings.repeat === 'one' ? 'REP·1' : 'REP'}
            </button>
          </div>
        </div>

        {/* — waveform héros, pleine hauteur, temps incrustés — */}
        <div style={{ position: 'relative', minWidth: 0, padding: '10px 14px 22px' }}>
          <Waveform track={t} />
          {t && (
            <span
              className="mono"
              style={{
                position: 'absolute',
                right: 14,
                top: 3,
                fontSize: 8,
                letterSpacing: '.08em',
                color: 'var(--ink-soft)',
                display: 'flex',
                gap: 8,
                pointerEvents: 'none'
              }}
            >
              <span><i style={{ display: 'inline-block', width: 7, height: 7, background: 'var(--ink)', marginRight: 3 }} />GRAVES</span>
              <span><i style={{ display: 'inline-block', width: 7, height: 7, background: 'var(--ink-soft)', marginRight: 3 }} />MÉDIUMS</span>
              <span><i style={{ display: 'inline-block', width: 7, height: 7, background: 'var(--accent)', marginRight: 3 }} />AIGUS</span>
              <span><i style={{ display: 'inline-block', width: 2, height: 8, background: 'var(--accent)', marginRight: 3 }} />TRANSIT.</span>
            </span>
          )}
          <span
            className="mono"
            style={{ position: 'absolute', left: 14, bottom: 5, fontSize: 10, color: 'var(--ink)' }}
          >
            <TimeReadout side="cur" />
          </span>
          <span
            className="mono"
            style={{ position: 'absolute', right: 14, bottom: 5, fontSize: 10, color: 'var(--ink-soft)' }}
          >
            <TimeReadout side="total" />
          </span>
        </div>

        {/* — volume compact — */}
        <div
          style={{
            borderLeft: 'var(--line)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            justifyContent: 'center',
            gap: 6,
            padding: '0 16px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="mono" style={{ fontSize: 9, letterSpacing: '.12em', color: 'var(--ink-soft)' }}>VOL</span>
            <span className="mono" style={{ fontSize: 10 }}>{Math.round(settings.volume * 100)}%</span>
          </div>
          <input
            type="range"
            className="vol"
            min={0}
            max={1}
            step={0.01}
            value={settings.volume}
            onChange={(e) => patchSettings({ volume: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </footer>
  )
}
