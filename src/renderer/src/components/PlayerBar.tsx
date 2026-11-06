import { useEffect, useState, useSyncExternalStore } from 'react'
import { fmtDuration, fmtQuality } from '@/lib/format'
import { player } from '@/lib/player'
import { useStore } from '@/lib/store'
import Cover from './Cover'
import Icon from './Icon'
import RtaPanel from './RtaPanel'
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
  const [rta, setRta] = useState(false)

  const cycleRepeat = (): void => {
    const order: Array<'off' | 'all' | 'one'> = ['off', 'all', 'one']
    patchSettings({ repeat: order[(order.indexOf(settings.repeat) + 1) % 3] })
  }
  const repeatTitle = { off: 'Répéter : non', all: 'Répéter : tout', one: 'Répéter : ce morceau' }[settings.repeat]

  return (
    <footer className="player">
      {rta && <RtaPanel onClose={() => setRta(false)} />}
      {snap.stalled && (
        <div className="notice">
          <Icon name="warn" />
          La sortie audio ne répond pas. Vérifiez votre interface ou changez de sortie dans Réglages Système › Son.
        </div>
      )}

      <div className="card player-bar">
        <div className="player-grid">
          <Cover coverKey={t?.cover ?? null} size={60} alt={t?.album ?? ''} />

          <div className="pmeta">
            {t ? (
              <>
                <div className="t ell" title={t.title}>{t.title}</div>
                <div className="s ell" title={t.artist}>{t.artist}</div>
                <div className="q ell">{fmtQuality(t)}</div>
              </>
            ) : (
              <div className="serif dim" style={{ fontStyle: 'italic', fontSize: 16 }}>Rien en écoute</div>
            )}
          </div>

          <div className="ptransport">
            <button className="ic" title="Précédent" onClick={() => player.prev()}><Icon name="prev" /></button>
            <button
              className="ic acc"
              style={{ width: 38, height: 38 }}
              title={snap.playing ? 'Pause (espace)' : 'Lecture (espace)'}
              onClick={() => player.toggle()}
            >
              <Icon name={snap.playing ? 'pause' : 'play'} />
            </button>
            <button className="ic" title="Suivant" onClick={() => player.next()}><Icon name="next" /></button>
          </div>

          <div className="pwave">
            <span className="time"><TimeReadout side="cur" /></span>
            <div className="w"><Waveform track={t} /></div>
            <span className="time r"><TimeReadout side="total" /></span>
          </div>

          <div className="ptools">
            <button className={`ic tool-opt ${settings.shuffle ? 'on' : ''}`} title="Lecture aléatoire" onClick={() => patchSettings({ shuffle: !settings.shuffle })}>
              <Icon name="shuffle" />
            </button>
            <button className={`ic tool-opt ${settings.repeat !== 'off' ? 'on' : ''}`} title={repeatTitle} onClick={cycleRepeat} style={{ position: 'relative' }}>
              <Icon name="repeat" />
              {settings.repeat === 'one' && <span className="rep1">1</span>}
            </button>
            <button className={`ic ${rta ? 'on' : ''}`} title="Analyseur spectral temps réel" onClick={() => setRta((v) => !v)}>
              <Icon name="spectrum" />
            </button>
            <span className="ic" style={{ pointerEvents: 'none', color: 'var(--ink-soft)', background: 'none' }}><Icon name="volume" /></span>
            <input
              type="range"
              className="pvol fill"
              min={0}
              max={1}
              step={0.01}
              title={`Volume ${Math.round(settings.volume * 100)} %`}
              value={settings.volume}
              onChange={(e) => patchSettings({ volume: Number(e.target.value) })}
              style={{ '--pct': `${settings.volume * 100}%` } as React.CSSProperties}
            />
          </div>
        </div>
      </div>
    </footer>
  )
}
