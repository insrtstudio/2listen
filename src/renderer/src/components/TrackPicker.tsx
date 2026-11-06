import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import Icon from './Icon'

const INTERNAL = 'application/x-2listen-track'

/** Sélecteur de morceau (recherche, liste, dépôt), partagé entre Comparer et la table de mix. */
export default function TrackPicker({
  label,
  accent,
  placeholder,
  trackId,
  onPick,
  bare
}: {
  label: string
  accent?: boolean
  placeholder: string
  trackId: string | null
  onPick: (id: string | null) => void
  /** sans carte : le parent la fournit déjà */
  bare?: boolean
}): React.ReactNode {
  const { tracks, addPaths } = useStore()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hot, setHot] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const picked = tracks.find((t) => t.id === trackId) ?? null

  // un clic ailleurs referme la liste
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  const acceptsDrag = (e: React.DragEvent): boolean =>
    e.dataTransfer.types.includes(INTERNAL) || e.dataTransfer.types.includes('Files')

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setHot(false)
    const internal = e.dataTransfer.getData(INTERNAL)
    if (internal) {
      onPick(internal)
      return
    }
    const paths = [...e.dataTransfer.files].map((f) => window.tl.dnd.path(f)).filter(Boolean)
    if (paths.length === 0) return
    await addPaths(paths)
    onPick(await window.tl.dnd.idForPath(paths[0]))
  }

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return tracks.slice(0, 8)
    return tracks
      .filter((t) => t.title.toLowerCase().includes(needle) || t.artist.toLowerCase().includes(needle))
      .slice(0, 8)
  }, [tracks, q])

  return (
    <div
      ref={rootRef}
      data-dropzone={label}
      className={`card picker ${bare ? 'bare' : ''} ${hot ? 'hot' : ''}`}
      onDragOver={(e) => {
        if (!acceptsDrag(e)) return
        e.preventDefault()
        e.stopPropagation()
        setHot(true)
      }}
      onDragLeave={() => setHot(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <div className="picker-row">
        <span className={`dot ${accent ? 'a' : ''}`}>{label}</span>
        {picked ? (
          <div className="grow">
            <div className="t ell" title={picked.title}>{picked.title}</div>
            <div className="s ell">{picked.artist} · {picked.codec}</div>
          </div>
        ) : (
          <span className="dim grow ell">{placeholder}</span>
        )}
        <button className="blk sm" onClick={() => setOpen((v) => !v)}>{picked ? 'Changer' : 'Choisir'}</button>
        {picked && (
          <button className="ic xs" title="Vider" onClick={() => onPick(null)}><Icon name="close" /></button>
        )}
      </div>
      {open && (
        <div className="dropdown">
          <input
            autoFocus
            className="field"
            placeholder="Rechercher"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
            }}
          />
          <div className="list">
            {results.map((t) => (
              <button
                key={t.id}
                className={`opt ${t.id === trackId ? 'cur' : ''}`}
                onClick={() => {
                  onPick(t.id)
                  setOpen(false)
                  setQ('')
                }}
              >
                <span className="ell">{t.title}</span>
                <span className="dim ell" style={{ flex: 'none', maxWidth: '45%', fontSize: 11 }}>{t.artist}</span>
              </button>
            ))}
            {results.length === 0 && <div className="dim" style={{ padding: '6px 9px' }}>Rien trouvé.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
