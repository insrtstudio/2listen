import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import PlayerBar from './PlayerBar'
import Sidebar from './Sidebar'
import { AlbumView, AlbumsView, ArtistView, ArtistsView, PlaylistView, TracksView } from './Views'

export default function App(): React.ReactNode {
  const { view, tracks, roots } = useStore()
  const empty = roots.length === 0 && tracks.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar />
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <TopBar />
          <section className="rise" key={JSON.stringify(view)} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {empty ? (
              <EmptyState />
            ) : view.kind === 'tracks' ? (
              <TracksView />
            ) : view.kind === 'albums' ? (
              <AlbumsView />
            ) : view.kind === 'album' ? (
              <AlbumView artist={view.artist} album={view.album} />
            ) : view.kind === 'artists' ? (
              <ArtistsView />
            ) : view.kind === 'artist' ? (
              <ArtistView artist={view.artist} />
            ) : (
              <PlaylistView id={view.id} />
            )}
          </section>
        </main>
      </div>
      <PlayerBar />
    </div>
  )
}

function TopBar(): React.ReactNode {
  const { search, setSearch, addRoot, rescan, scan, settings, patchSettings, roots, removeRoot } = useStore()
  const [showRoots, setShowRoots] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const scanning = scan.phase === 'discover' || scan.phase === 'read'

  // ⌘F focalise la recherche
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div style={{ position: 'relative', flex: 'none' }}>
      <div
        className="drag"
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: 'var(--line-thick)', height: 52 }}
      >
        <div className="no-drag" style={{ flex: 1, maxWidth: 460 }}>
          <input
            ref={inputRef}
            className="field"
            placeholder="Rechercher titre, artiste, album…  (⌘F)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }} />
        <button className="blk tap no-drag" onClick={() => setShowRoots((v) => !v)}>
          Dossiers
        </button>
        <button className="blk tap no-drag" onClick={() => void rescan()} disabled={scanning}>
          {scanning ? 'Scan…' : 'Rescanner'}
        </button>
        <button
          className="blk tap no-drag"
          title="Basculer le thème"
          onClick={() => patchSettings({ theme: settings.theme === 'light' ? 'dark' : 'light' })}
        >
          {settings.theme === 'light' ? 'Nuit' : 'Jour'}
        </button>
      </div>

      {showRoots && (
        <div className="ctxmenu rise" style={{ position: 'absolute', right: 18, top: 54, minWidth: 340, zIndex: 60 }}>
          <div className="sect">Dossiers surveillés</div>
          {roots.map((r) => (
            <div key={r} style={{ display: 'flex', alignItems: 'center', borderBottom: 'var(--line)' }}>
              <span
                className="mono"
                style={{ flex: 1, fontSize: 10, padding: '8px 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl' }}
                title={r}
              >
                {r}
              </span>
              <button
                className="tap"
                style={{ padding: '8px 12px', color: 'var(--accent)', font: '700 12px var(--grotesk)' }}
                title="Retirer ce dossier"
                onClick={() => void removeRoot(r)}
              >
                ✕
              </button>
            </div>
          ))}
          {roots.length === 0 && (
            <div className="serif" style={{ fontStyle: 'italic', padding: '10px 12px', color: 'var(--ink-soft)', borderBottom: 'var(--line)' }}>
              Aucun dossier pour l'instant.
            </div>
          )}
          <button
            onClick={() => {
              void addRoot()
              setShowRoots(false)
            }}
          >
            + Ajouter un dossier…
          </button>
          <button onClick={() => setShowRoots(false)}>Fermer</button>
        </div>
      )}
    </div>
  )
}

function EmptyState(): React.ReactNode {
  const { addRoot } = useStore()
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center', maxWidth: 520, padding: 24 }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--accent)' }}>2LISTEN — LECTEUR LOSSLESS LOCAL</div>
        <h1 style={{ font: '700 64px/.95 var(--grotesk)', letterSpacing: '-0.03em', margin: '14px 0 6px' }}>
          Votre musique,
          <br />
          <span className="serif" style={{ fontStyle: 'italic', fontWeight: 400 }}>sans compromis.</span>
        </h1>
        <p style={{ color: 'var(--ink-soft)', font: '400 15px/1.6 var(--grotesk)', margin: '14px 0 26px' }}>
          FLAC, ALAC, WAV, AIFF — lus tels quels, bit par bit. Ajoutez un dossier, 2Listen indexe tout, pochettes et
          formes d'onde comprises.
        </p>
        <button className="blk acc tap" style={{ fontSize: 14, padding: '14px 26px' }} onClick={() => void addRoot()}>
          + Ajouter un dossier de musique
        </button>
      </div>
    </div>
  )
}
