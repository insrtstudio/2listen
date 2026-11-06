import { useMemo, useRef, useState } from 'react'
import type { TagEdit, Track } from '@shared/types'
import { useStore } from '@/lib/store'
import Cover from './Cover'
import Icon from './Icon'

type Field = 'title' | 'artist' | 'albumArtist' | 'album' | 'genre' | 'year' | 'cover'

/** Éditeur de métadonnées : surcouche bibliothèque, les fichiers restent intacts.
 *  Avec plusieurs pistes, seuls les champs réellement modifiés sont appliqués à toutes. */
export default function TagEditor({ tracks, onClose }: { tracks: Track[]; onClose: () => void }): React.ReactNode {
  const { applyTagEdits, applyTagEditsMany } = useStore()
  const multi = tracks.length > 1
  const t0 = tracks[0]

  // valeur commune aux pistes sélectionnées, sinon champ vide + placeholder « Plusieurs valeurs »
  const common = useMemo(() => {
    const pick = <K extends keyof Track>(k: K): { value: Track[K] | null; mixed: boolean } => {
      const v = t0[k]
      const mixed = tracks.some((t) => t[k] !== v)
      return { value: mixed ? null : v, mixed }
    }
    return {
      artist: pick('artist'), albumArtist: pick('albumArtist'), album: pick('album'),
      genre: pick('genre'), year: pick('year'), cover: pick('cover')
    }
  }, [tracks, t0])

  const [title, setTitle] = useState(t0.title)
  const [artist, setArtist] = useState((common.artist.value as string) ?? '')
  const [albumArtist, setAlbumArtist] = useState((common.albumArtist.value as string) ?? '')
  const [album, setAlbum] = useState((common.album.value as string) ?? '')
  const [genre, setGenre] = useState((common.genre.value as string) ?? '')
  const [year, setYear] = useState(common.year.value ? String(common.year.value) : '')
  const [cover, setCover] = useState<string | null>((common.cover.value as string | null) ?? null)
  const [saving, setSaving] = useState(false)
  const dirty = useRef(new Set<Field>())

  const field = (
    key: Field, label: string, value: string, set: (v: string) => void,
    opts?: { width?: string; mixed?: boolean }
  ): React.ReactNode => (
    <label style={{ display: 'block', flex: opts?.width ? undefined : 1, width: opts?.width, minWidth: 0 }}>
      <span className="label" style={{ display: 'block', marginBottom: 4 }}>{label}</span>
      <input
        className="field"
        value={value}
        placeholder={opts?.mixed ? 'Plusieurs valeurs' : undefined}
        onChange={(e) => {
          dirty.current.add(key)
          set(e.target.value)
        }}
      />
    </label>
  )

  const save = async (): Promise<void> => {
    setSaving(true)
    if (!multi) {
      await applyTagEdits(t0.id, {
        title: title.trim() || t0.title,
        artist: artist.trim() || 'Artiste inconnu',
        albumArtist: albumArtist.trim() || artist.trim() || 'Artiste inconnu',
        album: album.trim() || 'Sans album',
        genre: genre.trim(),
        year: year.trim() ? Number(year.trim()) || null : null,
        cover
      })
    } else {
      // n'appliquer que ce qui a été touché — un champ « Plusieurs valeurs » laissé vide reste intact
      const patch: TagEdit = {}
      if (dirty.current.has('artist') && artist.trim()) patch.artist = artist.trim()
      if (dirty.current.has('albumArtist') && albumArtist.trim()) patch.albumArtist = albumArtist.trim()
      if (dirty.current.has('album') && album.trim()) patch.album = album.trim()
      if (dirty.current.has('genre')) patch.genre = genre.trim()
      if (dirty.current.has('year')) patch.year = year.trim() ? Number(year.trim()) || null : null
      if (dirty.current.has('cover')) patch.cover = cover
      if (Object.keys(patch).length > 0) await applyTagEditsMany(tracks.map((t) => t.id), patch)
    }
    onClose()
  }

  return (
    <div className="veil" onClick={onClose}>
      <div className="modal glass" style={{ width: 600 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">{multi ? `Modifier ${tracks.length} morceaux` : 'Modifier les infos'}</span>
          <button className="ic" title="Fermer" onClick={onClose}><Icon name="close" /></button>
        </div>

        <div style={{ display: 'flex', gap: 16, padding: '4px 20px 12px' }}>
          <div style={{ flex: 'none', width: 120 }}>
            <Cover coverKey={cover} size={120} alt={album} />
            <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
              <button
                className="blk sm grow"
                onClick={() =>
                  void window.tl.library.pickCover().then((k) => {
                    if (!k) return
                    dirty.current.add('cover')
                    setCover(k)
                  })
                }
              >
                Choisir…
              </button>
              {cover && (
                <button
                  className="ic xs"
                  title="Retirer la pochette"
                  onClick={() => {
                    dirty.current.add('cover')
                    setCover(null)
                  }}
                >
                  <Icon name="close" />
                </button>
              )}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!multi && field('title', 'Titre', title, setTitle)}
            <div style={{ display: 'flex', gap: 10 }}>
              {field('artist', 'Artiste', artist, setArtist, { mixed: common.artist.mixed })}
              {field('albumArtist', "Artiste de l'album", albumArtist, setAlbumArtist, { mixed: common.albumArtist.mixed })}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {field('album', 'Album', album, setAlbum, { mixed: common.album.mixed })}
              {field('genre', 'Genre', genre, setGenre, { mixed: common.genre.mixed })}
              {field('year', 'Année', year, setYear, { width: '76px', mixed: common.year.mixed })}
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <span className="dim grow" style={{ fontSize: 11.5 }}>
            {multi ? 'Seuls les champs modifiés sont appliqués.' : "Le fichier audio n'est pas modifié."}
          </span>
          <button className="blk" onClick={onClose}>Annuler</button>
          <button className="blk acc" onClick={() => void save()} disabled={saving}>
            {saving ? 'Enregistrement…' : multi ? `Appliquer à ${tracks.length} morceaux` : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
