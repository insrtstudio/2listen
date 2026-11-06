import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import CompareView from './CompareView'
import MixView from './MixView'
import PlayerBar from './PlayerBar'
import Sidebar from './Sidebar'
import StreamerView from './StreamerView'
import { AlbumView, AlbumsView, ArtistView, ArtistsView, PlaylistView, TracksView } from './Views'

export default function App(): React.ReactNode {
  const { view, setView, tracks, roots, addPaths, streamer } = useStore()
  const empty = roots.length === 0 && tracks.length === 0
  const [dropping, setDropping] = useState(false)

  // dépôt de fichiers audio n'importe où : ajout à la bibliothèque.
  // La bannière vit tant que des dragover arrivent et s'éteint 150 ms après
  // le dernier — dragenter/dragleave sont trop peu fiables (sortie de
  // fenêtre, Échap, drop hors app) et laissaient la bannière coincée.
  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | null = null
    const hasFiles = (e: DragEvent): boolean => [...(e.dataTransfer?.types ?? [])].includes('Files')
    const hide = (): void => {
      if (hideTimer) clearTimeout(hideTimer)
      hideTimer = null
      setDropping(false)
    }
    const onOver = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setDropping(true)
      if (hideTimer) clearTimeout(hideTimer)
      hideTimer = setTimeout(() => setDropping(false), 150)
    }
    const onDrop = (e: DragEvent): void => {
      hide()
      if (!hasFiles(e)) return
      e.preventDefault()
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => window.tl.dnd.path(f)).filter(Boolean)
      void addPaths(paths)
    }
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', hide)
    window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', hide)
      window.removeEventListener('blur', hide)
      if (hideTimer) clearTimeout(hideTimer)
    }
  }, [addPaths])

  // ⌘F : la recherche vit sur les vues qu'elle filtre, on y revient au besoin
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'f') return
      e.preventDefault()
      const focus = (): void => document.querySelector<HTMLInputElement>('.search input')?.focus()
      if (document.querySelector('.search input')) focus()
      else {
        setView({ kind: 'tracks' })
        setTimeout(focus, 30)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView])

  return (
    <div className="shell">
      {dropping && <div className="drop-banner">Déposez vos morceaux pour les ajouter à la bibliothèque</div>}
      <Sidebar />
      <main className="maincol">
        <section className="view rise" key={JSON.stringify(view)}>
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
          ) : view.kind === 'compare' ? (
            <CompareView />
          ) : view.kind === 'mix' ? (
            <MixView />
          ) : (
            <PlaylistView id={view.id} />
          )}
        </section>
        <PlayerBar />
      </main>
      {streamer && <StreamerView />}
    </div>
  )
}

function EmptyState(): React.ReactNode {
  const { addRoot, addFiles } = useStore()
  return (
    <>
      <div className="toolbar drag" />
      <div className="card page" style={{ display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 480, padding: 24 }}>
          <h1 style={{ font: '700 44px/1 var(--grotesk)', letterSpacing: '-0.03em', margin: '0 0 12px' }}>
            Votre musique,
            <br />
            <span className="serif" style={{ fontStyle: 'italic', fontWeight: 400 }}>sans compromis.</span>
          </h1>
          <p className="dim" style={{ font: '400 14px/1.55 var(--grotesk)', margin: '0 0 22px' }}>
            FLAC, ALAC, WAV, AIFF, lus tels quels. Ajoutez un dossier, 2Listen indexe tout.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="blk acc lg" onClick={() => void addRoot()}>Ajouter un dossier</button>
            <button className="blk lg" onClick={() => void addFiles()}>Ajouter des morceaux</button>
          </div>
        </div>
      </div>
    </>
  )
}
