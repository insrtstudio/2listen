import { useMemo, useRef, useState } from 'react'
import type { TagEdit, Track } from '@shared/types'
import { useStore } from '@/lib/store'
import Cover from './Cover'

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
      <span className="mono" style={{ fontSize: 8, letterSpacing: '.12em', color: 'var(--ink-soft)', display: 'block', marginBottom: 3 }}>
        {label}
      </span>
      <input
        className="field"
        value={value}
        placeholder={opts?.mixed ? 'Plusieurs valeurs' : undefined}
        onChange={(e) => {
          dirty.current.add(key)
          set(e.target.value)
        }}
        style={{ padding: '8px 10px', fontSize: 13 }}
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
            <div style={{ font: '700 18px var(--grotesk)' }}>
              {multi ? `Modifier ${tracks.length} pistes` : 'Modifier les infos'}
            </div>
          </div>
          <span className="mono" style={{ fontSize: 8, color: 'var(--ink-soft)', maxWidth: 240, textAlign: 'right' }}>
            {multi
              ? 'seuls les champs modifiés seront appliqués à toutes les pistes sélectionnées'
              : "le fichier audio n'est pas modifié — les corrections vivent dans la bibliothèque et survivent aux rescans"}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 16, padding: 16 }}>
          {/* artwork */}
          <div style={{ flex: 'none' }}>
            <Cover coverKey={cover} size={132} alt={album} />
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button
                className="mono tap"
                onClick={() =>
                  void window.tl.library.pickCover().then((k) => {
                    if (!k) return
                    dirty.current.add('cover')
                    setCover(k)
                  })
                }
                style={{ fontSize: 8, letterSpacing: '.08em', border: '1.5px solid var(--ink)', padding: '4px 7px', flex: 1 }}
              >
                CHOISIR…
              </button>
              {cover && (
                <button
                  className="mono tap"
                  onClick={() => {
                    dirty.current.add('cover')
                    setCover(null)
                  }}
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
            {!multi && field('title', 'TITRE', title, setTitle)}
            <div style={{ display: 'flex', gap: 10 }}>
              {field('artist', 'ARTISTE', artist, setArtist, { mixed: common.artist.mixed })}
              {field('albumArtist', "ARTISTE DE L'ALBUM", albumArtist, setAlbumArtist, { mixed: common.albumArtist.mixed })}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {field('album', 'ALBUM', album, setAlbum, { mixed: common.album.mixed })}
              {field('genre', 'GENRE', genre, setGenre, { mixed: common.genre.mixed })}
              {field('year', 'ANNÉE', year, setYear, { width: '86px', mixed: common.year.mixed })}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 16px 16px' }}>
          <button className="blk tap" onClick={onClose}>Annuler</button>
          <button className="blk acc tap" onClick={() => void save()} disabled={saving}>
            {saving ? 'Enregistrement…' : multi ? `Appliquer à ${tracks.length} pistes` : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
