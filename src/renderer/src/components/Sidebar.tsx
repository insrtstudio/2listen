import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '@/lib/store'
import Icon, { AppMark } from './Icon'
import SettingsSheet from './SettingsSheet'
import { TRACKS_DRAG } from './TrackTable'

export default function Sidebar(): React.ReactNode {
  const { view, setView, playlists, scan, createPlaylist, addToPlaylist, update, setStreamer, settings, patchSettings } = useStore()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const scanning = scan.phase === 'discover' || scan.phase === 'read'

  // ⌘, : réglages, comme toute app macOS
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey && e.key === ',') {
        e.preventDefault()
        setShowSettings(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const item = (label: string, icon: string, on: boolean, onClick: () => void, title?: string): React.ReactNode => (
    <button className={`navitem ${on ? 'on' : ''}`} onClick={onClick} title={title}>
      <Icon name={icon} />
      <span className="ell">{label}</span>
    </button>
  )

  return (
    <aside className="sidebar">
      <div className="sidebar-titlebar drag">
        <span className="brand"><AppMark />2Listen</span>
      </div>

      <nav>
        <div className="navlabel label" style={{ marginTop: 4 }}>Bibliothèque</div>
        {item('Morceaux', 'note', view.kind === 'tracks', () => setView({ kind: 'tracks' }))}
        {item('Albums', 'album', view.kind === 'albums' || view.kind === 'album', () => setView({ kind: 'albums' }))}
        {item('Artistes', 'artist', view.kind === 'artists' || view.kind === 'artist', () => setView({ kind: 'artists' }))}

        <div className="navlabel label">Outils</div>
        {item('Comparer A/B', 'compare', view.kind === 'compare', () => setView({ kind: 'compare' }), 'Votre mix face à une référence')}
        {item('Table de mix', 'mix', view.kind === 'mix', () => setView({ kind: 'mix' }), 'Deux platines, sync et crossfader')}
        {item('Mode streamer', 'camera', false, () => setStreamer(true), 'Scène Instagram, webcam et clip MP4')}

        <div className="navlabel label">
          Playlists
          <button className="ic xs" title="Nouvelle playlist" onClick={() => setCreating(true)}>
            <Icon name="plus" />
          </button>
        </div>
        {creating && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) {
                const id = createPlaylist(name)
                setView({ kind: 'playlist', id })
              }
              setName('')
              setCreating(false)
            }}
            style={{ padding: '2px 8px 4px' }}
          >
            <input
              autoFocus
              className="field"
              placeholder="Nom de la playlist"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
              }}
              onBlur={() => {
                setCreating(false)
                setName('')
              }}
            />
          </form>
        )}
        {playlists.map((p) => (
          <div
            key={p.id}
            className={dropTarget === p.id ? 'drop-hot' : undefined}
            data-playlist-drop={p.id}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(TRACKS_DRAG)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              setDropTarget(p.id)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              setDropTarget(null)
              const ids: unknown = JSON.parse(e.dataTransfer.getData(TRACKS_DRAG) || '[]')
              if (Array.isArray(ids)) addToPlaylist(p.id, ids as string[])
            }}
          >
            {item(p.name, 'list', view.kind === 'playlist' && view.id === p.id, () => setView({ kind: 'playlist', id: p.id }))}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        {scanning && (
          <div className="status">
            <div className="dim pulse" style={{ marginBottom: 5 }}>
              {scan.phase === 'discover' ? `Exploration… ${scan.found}` : `Lecture ${scan.done} / ${scan.total}`}
            </div>
            {scan.phase === 'read' && scan.total > 0 && (
              <div className="progress"><div style={{ width: `${(scan.done / scan.total) * 100}%` }} /></div>
            )}
          </div>
        )}
        {update.status === 'downloading' && (
          <div className="status">
            <div className="dim" style={{ marginBottom: 5 }}>Mise à jour {update.percent ?? 0} %</div>
            <div className="progress"><div style={{ width: `${update.percent ?? 0}%` }} /></div>
          </div>
        )}
        {update.status === 'ready' && (
          <button className="blk acc" style={{ width: '100%' }} onClick={() => void window.tl.update.install()} title="Redémarre l'app en quelques secondes">
            Installer la v{update.version}
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button className="navitem" style={{ flex: 1, margin: 0, width: 'auto' }} onClick={() => setShowSettings(true)} title="⌘,">
            <Icon name="gear" />
            Réglages
            {update.status === 'error' && <span className="dim" style={{ marginLeft: 'auto', color: 'var(--accent-2)' }}>●</span>}
          </button>
          <button
            className="ic"
            title={settings.theme === 'light' ? 'Thème sombre' : 'Thème clair'}
            onClick={() => patchSettings({ theme: settings.theme === 'light' ? 'dark' : 'light' })}
          >
            <Icon name={settings.theme === 'light' ? 'moon' : 'sun'} />
          </button>
        </div>
      </div>
      {/* portail : la colonne principale passe au-dessus de la barre latérale */}
      {showSettings && createPortal(<SettingsSheet onClose={() => setShowSettings(false)} />, document.body)}
    </aside>
  )
}
