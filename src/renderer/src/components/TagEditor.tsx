import { useState } from 'react'
import type { Track } from '@shared/types'
import { useStore } from '@/lib/store'
import Cover from './Cover'

/** Éditeur de métadonnées : surcouche bibliothèque, les fichiers restent intacts. */
export default function TagEditor({ track, onClose }: { track: Track; onClose: () => void }): React.ReactNode {
  const { applyTagEdits } = useStore()
  const [title, setTitle] = useState(track.title)
  const [artist, setArtist] = useState(track.artist)
  const [albumArtist, setAlbumArtist] = useState(track.albumArtist)
  const [album, setAlbum] = useState(track.album)
  const [genre, setGenre] = useState(track.genre)
  const [year, setYear] = useState(track.year ? String(track.year) : '')
  const [cover, setCover] = useState<string | null>(track.cover)
  const [saving, setSaving] = useState(false)

  const field = (label: string, value: string, set: (v: string) => void, width?: string): React.ReactNode => (
    <label style={{ display: 'block', flex: width ? undefined : 1, width, minWidth: 0 }}>
      <span className="mono" style={{ fontSize: 8, letterSpacing: '.12em', color: 'var(--ink-soft)', display: 'block', marginBottom: 3 }}>
        {label}
      </span>
      <input className="field" value={value} onChange={(e) => set(e.target.value)} style={{ padding: '8px 10px', fontSize: 13 }} />
    </label>
  )

  const save = async (): Promise<void> => {
    setSaving(true)
    await applyTagEdits(track.id, {
      title: title.trim() || track.title,
      artist: artist.trim() || 'Artiste inconnu',
      albumArtist: albumArtist.trim() || artist.trim() || 'Artiste inconnu',
      album: album.trim() || 'Sans album',
      genre: genre.trim(),
      year: year.trim() ? Number(year.trim()) || null : null,
      cover
    })
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: 'rgba(17,17,17,.45)',
        display: 'grid',
        placeItems: 'center'
      }}
      onClick={onClose}
    >
      <div
        className="rise"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 620, maxWidth: '92vw', background: 'var(--paper)', border: 'var(--line-thick)', boxShadow: '10px 10px 0 rgba(17,17,17,.3)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: 'var(--line-thick)' }}>
          <div>
            <div className="mono" style={{ fontSize: 8, letterSpacing: '.14em', color: 'var(--accent)' }}>MÉTADONNÉES</div>
            <div style={{ font: '700 18px var(--grotesk)' }}>Modifier les infos</div>
          </div>
          <span className="mono" style={{ fontSize: 8, color: 'var(--ink-soft)', maxWidth: 240, textAlign: 'right' }}>
            le fichier audio n'est pas modifié — les corrections vivent dans la bibliothèque et survivent aux rescans
          </span>
        </div>

        <div style={{ display: 'flex', gap: 16, padding: 16 }}>
          {/* artwork */}
          <div style={{ flex: 'none' }}>
            <Cover coverKey={cover} size={132} alt={album} />
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button
                className="mono tap"
                onClick={() => void window.tl.library.pickCover().then((k) => k && setCover(k))}
                style={{ fontSize: 8, letterSpacing: '.08em', border: '1.5px solid var(--ink)', padding: '4px 7px', flex: 1 }}
              >
                CHOISIR…
              </button>
              {cover && (
                <button
                  className="mono tap"
                  onClick={() => setCover(null)}
                  title="Retirer la pochette"
                  style={{ fontSize: 8, border: '1.5px solid var(--ink)', padding: '4px 7px', color: 'var(--accent)' }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* champs */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {field('TITRE', title, setTitle)}
            <div style={{ display: 'flex', gap: 10 }}>
              {field('ARTISTE', artist, setArtist)}
              {field("ARTISTE DE L'ALBUM", albumArtist, setAlbumArtist)}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {field('ALBUM', album, setAlbum)}
              {field('GENRE', genre, setGenre)}
              {field('ANNÉE', year, setYear, '86px')}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 16px 16px' }}>
          <button className="blk tap" onClick={onClose}>Annuler</button>
          <button className="blk acc tap" onClick={() => void save()} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
