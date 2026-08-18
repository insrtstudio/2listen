import { useState } from 'react'
import { useStore } from '@/lib/store'

export default function Sidebar(): React.ReactNode {
  const store = useStore()
  const { view, setView, playlists, tracks, scan, createPlaylist, update, version } = store
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const scanning = scan.phase === 'discover' || scan.phase === 'read'

  return (
    <aside
      style={{
        width: 248, flex: 'none', borderRight: 'var(--line-thick)',
        display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--paper)'
      }}
    >
      {/* zone de drag sous les feux macOS */}
      <div className="drag" style={{ height: 52, borderBottom: 'var(--line-thick)', display: 'flex', alignItems: 'flex-end', padding: '0 16px 6px' }}>
        <span style={{ font: '700 20px var(--grotesk)', letterSpacing: '-0.02em' }}>
          2<span style={{ color: 'var(--accent)' }}>Listen</span>
        </span>
        <span className="mono" style={{ fontSize: 8, color: 'var(--ink-soft)', marginLeft: 8, marginBottom: 3 }}>
          v{version || '0.0.0'}
        </span>
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div className="mono" style={{ fontSize: 9, letterSpacing: '.12em', color: 'var(--ink-soft)', padding: '14px 14px 6px' }}>
          BIBLIOTHÈQUE
        </div>
        <button className={`navitem ${view.kind === 'tracks' ? 'on' : ''}`} onClick={() => setView({ kind: 'tracks' })}>
          Pistes <span className="cnt">{tracks.length}</span>
        </button>
        <button className={`navitem ${view.kind === 'albums' || view.kind === 'album' ? 'on' : ''}`} onClick={() => setView({ kind: 'albums' })}>
          Albums
        </button>
        <button className={`navitem ${view.kind === 'artists' || view.kind === 'artist' ? 'on' : ''}`} onClick={() => setView({ kind: 'artists' })}>
          Artistes
        </button>

        <div className="mono" style={{ fontSize: 9, letterSpacing: '.12em', color: 'var(--ink-soft)', padding: '18px 14px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          PLAYLISTS
          <button
            className="tap"
            title="Nouvelle playlist"
            onClick={() => setCreating(true)}
            style={{ font: '700 13px var(--grotesk)', color: 'var(--accent)' }}
          >
            +
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
            style={{ padding: '4px 10px 8px' }}
          >
            <input
              autoFocus
              className="field"
              placeholder="Nom de la playlist…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                setCreating(false)
                setName('')
              }}
              style={{ padding: '6px 9px', fontSize: 12 }}
            />
          </form>
        )}
        {playlists.map((p) => (
          <button
            key={p.id}
            className={`navitem ${view.kind === 'playlist' && view.id === p.id ? 'on' : ''}`}
            onClick={() => setView({ kind: 'playlist', id: p.id })}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            <span className="cnt">{p.trackIds.length}</span>
          </button>
        ))}
        {playlists.length === 0 && !creating && (
          <div className="serif" style={{ fontStyle: 'italic', fontSize: 13, color: 'var(--ink-soft)', padding: '4px 14px 10px' }}>
            Aucune playlist.
          </div>
        )}
      </nav>

      {/* état du scan + mise à jour */}
      <div style={{ borderTop: 'var(--line)', flex: 'none' }}>
        {scanning && (
          <div style={{ padding: '10px 14px', borderBottom: 'var(--line)' }}>
            <div className="mono" style={{ fontSize: 9, color: 'var(--accent)', animation: 'blink 1s steps(1) infinite' }}>
              {scan.phase === 'discover' ? `EXPLORATION… ${scan.found}` : `LECTURE ${scan.done}/${scan.total}`}
            </div>
            {scan.phase === 'read' && scan.total > 0 && (
              <div style={{ height: 6, border: '1.5px solid var(--ink)', marginTop: 6 }}>
                <div style={{ height: '100%', width: `${(scan.done / scan.total) * 100}%`, background: 'var(--accent)' }} />
              </div>
            )}
          </div>
        )}
        <UpdateBadge status={update} />
      </div>
    </aside>
  )
}

function UpdateBadge({ status }: { status: ReturnType<typeof useStore>['update'] }): React.ReactNode {
  if (status.status === 'ready') {
    return (
      <button
        className="tap"
        onClick={() => void window.tl.update.install()}
        style={{ width: '100%', padding: '10px 14px', background: 'var(--accent)', color: '#111', font: '700 11px var(--grotesk)', letterSpacing: '.06em', textAlign: 'left' }}
      >
        ↻ INSTALLER v{status.version}
      </button>
    )
  }
  if (status.status === 'downloading') {
    return (
      <div className="mono" style={{ padding: '10px 14px', fontSize: 9, color: 'var(--ink-soft)' }}>
        MAJ v{status.version} — {status.percent ?? 0}%
      </div>
    )
  }
  if (status.status === 'error' && status.manual && status.url && status.version) {
    return (
      <button
        className="tap"
        onClick={() => void window.tl.update.openUrl(status.url!)}
        style={{ width: '100%', padding: '10px 14px', font: '500 10px var(--mono)', color: 'var(--accent)', textAlign: 'left' }}
      >
        ↗ MAJ dispo — télécharger
      </button>
    )
  }
  return null
}
