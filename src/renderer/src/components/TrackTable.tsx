import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ColumnKey, Track } from '@shared/types'
import { fmtDuration, fmtQuality } from '@/lib/format'
import { player } from '@/lib/player'
import { useStore } from '@/lib/store'
import TagEditor from './TagEditor'

const ROW = 44

export type SortKey =
  | 'title' | 'artist' | 'albumArtist' | 'album' | 'genre' | 'year'
  | 'duration' | 'addedAt' | 'playCount' | 'lastPlayedAt' | 'rating' | 'quality' | 'manual'

interface Props {
  tracks: Track[]
  /** Ordre manuel (playlist) : active le glisser-déposer. */
  onReorder?: (from: number, to: number) => void
  onRemove?: (ids: string[]) => void
  sort: SortKey
  sortDir: 1 | -1
  onSort?: (key: SortKey) => void
}

function qualityRank(t: Track): number {
  return (t.lossless ? 1_000_000 : 0) + t.sampleRate + t.bitsPerSample * 10 + t.bitrate
}

export function sortTracks(tracks: Track[], key: SortKey, dir: 1 | -1): Track[] {
  if (key === 'manual') return tracks
  const c = new Intl.Collator('fr', { sensitivity: 'base' })
  const cmp: Record<Exclude<SortKey, 'manual'>, (a: Track, b: Track) => number> = {
    title: (a, b) => c.compare(a.title, b.title),
    artist: (a, b) => c.compare(a.artist, b.artist) || c.compare(a.album, b.album) || (a.trackNo ?? 0) - (b.trackNo ?? 0),
    albumArtist: (a, b) => c.compare(a.albumArtist, b.albumArtist) || c.compare(a.album, b.album) || (a.trackNo ?? 0) - (b.trackNo ?? 0),
    album: (a, b) => c.compare(a.album, b.album) || (a.discNo ?? 0) - (b.discNo ?? 0) || (a.trackNo ?? 0) - (b.trackNo ?? 0),
    genre: (a, b) => c.compare(a.genre, b.genre) || c.compare(a.artist, b.artist),
    year: (a, b) => (a.year ?? 0) - (b.year ?? 0),
    duration: (a, b) => a.duration - b.duration,
    addedAt: (a, b) => a.addedAt - b.addedAt,
    playCount: (a, b) => a.playCount - b.playCount,
    lastPlayedAt: (a, b) => (a.lastPlayedAt ?? 0) - (b.lastPlayedAt ?? 0),
    rating: (a, b) => a.rating - b.rating,
    quality: (a, b) => qualityRank(a) - qualityRank(b)
  }
  return [...tracks].sort((a, b) => cmp[key](a, b) * dir)
}

const ell: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const num: React.CSSProperties = { fontSize: 11, textAlign: 'right' }
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })

interface ColumnDef {
  label: string
  sort: SortKey
  width: string
  align?: 'right'
  render: (t: Track, isSel: boolean) => React.ReactNode
}

/** Registre des colonnes affichables (le titre, lui, est toujours là). */
const COLUMNS: Record<ColumnKey, ColumnDef> = {
  artist: { label: 'Artiste', sort: 'artist', width: 'minmax(120px, 1.2fr)', render: (t) => <span className="dim" style={ell}>{t.artist}</span> },
  albumArtist: { label: 'Artiste album', sort: 'albumArtist', width: 'minmax(120px, 1.2fr)', render: (t) => <span className="dim" style={ell}>{t.albumArtist}</span> },
  album: { label: 'Album', sort: 'album', width: 'minmax(120px, 1.2fr)', render: (t) => <span className="dim" style={ell}>{t.album}</span> },
  genre: { label: 'Genre', sort: 'genre', width: 'minmax(80px, .8fr)', render: (t) => <span className="dim" style={ell}>{t.genre || '—'}</span> },
  year: { label: 'Année', sort: 'year', width: '48px', align: 'right', render: (t) => <span className="mono dim" style={num}>{t.year ?? '—'}</span> },
  quality: {
    label: 'Qualité', sort: 'quality', width: '118px',
    render: (t, isSel) => <span className={`badge ${t.lossless && !isSel ? 'hot' : ''}`} style={{ justifySelf: 'start' }}>{fmtQuality(t)}</span>
  },
  duration: { label: 'Durée', sort: 'duration', width: '64px', align: 'right', render: (t) => <span className="mono dim" style={num}>{fmtDuration(t.duration)}</span> },
  addedAt: { label: 'Ajouté', sort: 'addedAt', width: '76px', align: 'right', render: (t) => <span className="mono dim" style={num}>{t.addedAt ? dateFmt.format(t.addedAt) : '—'}</span> },
  playCount: { label: 'Écoutes', sort: 'playCount', width: '58px', align: 'right', render: (t) => <span className="mono dim" style={num}>{t.playCount || '—'}</span> },
  lastPlayedAt: { label: 'Écouté le', sort: 'lastPlayedAt', width: '76px', align: 'right', render: (t) => <span className="mono dim" style={num}>{t.lastPlayedAt ? dateFmt.format(t.lastPlayedAt) : '—'}</span> },
  rating: { label: 'Note', sort: 'rating', width: '64px', render: (t) => <span className="dim" style={{ fontSize: 11, letterSpacing: 1 }}>{t.rating ? '★'.repeat(t.rating) : '—'}</span> }
}

const COLUMN_ORDER = Object.keys(COLUMNS) as ColumnKey[]

/**
 * Liste virtualisée maison : seules les lignes visibles existent dans le DOM,
 * 50 000 pistes défilent sans effort.
 */
export default function TrackTable({ tracks, onReorder, onRemove, sort, sortDir, onSort }: Props): React.ReactNode {
  const { settings, setRating, playlists, addToPlaylist, createPlaylist, removeTracks, patchSettings, setView } = useStore()
  const snap = useSyncExternalStore(player.subscribe, player.getSnapshot)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [range, setRange] = useState<[number, number]>([0, 60])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<number>(-1)
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null)
  const [colMenu, setColMenu] = useState<number | null>(null)
  const [editing, setEditing] = useState<Track[] | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dropIdx, setDropIdx] = useState<number | null>(null)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const start = Math.max(0, Math.floor(el.scrollTop / ROW) - 8)
    const end = Math.min(tracks.length, Math.ceil((el.scrollTop + el.clientHeight) / ROW) + 8)
    setRange((r) => (r[0] === start && r[1] === end ? r : [start, end]))
  }, [tracks.length])

  useEffect(() => {
    onScroll()
  }, [onScroll, tracks])

  useEffect(() => {
    setSelected(new Set())
    setAnchor(-1)
  }, [tracks])

  const play = useCallback((index: number) => void player.playQueue(tracks, index), [tracks])

  const onRowClick = (e: React.MouseEvent, index: number, id: string): void => {
    if (e.shiftKey && anchor >= 0) {
      const [a, b] = [Math.min(anchor, index), Math.max(anchor, index)]
      setSelected(new Set(tracks.slice(a, b + 1).map((t) => t.id)))
    } else if (e.metaKey || e.ctrlKey) {
      setSelected((s) => {
        const n = new Set(s)
        if (n.has(id)) n.delete(id)
        else n.add(id)
        return n
      })
      setAnchor(index)
    } else {
      setSelected(new Set([id]))
      setAnchor(index)
    }
  }

  const onContext = (e: React.MouseEvent, index: number, id: string): void => {
    e.preventDefault()
    const ids = selected.has(id) ? [...selected] : [id]
    if (!selected.has(id)) {
      setSelected(new Set([id]))
      setAnchor(index)
    }
    setMenu({ x: e.clientX, y: e.clientY, ids })
  }

  useEffect(() => {
    if (!menu && colMenu === null) return
    const close = (): void => {
      setMenu(null)
      setColMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [menu, colMenu])

  // navigation clavier : ↑/↓ sélection, Entrée lecture, Espace pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === ' ') {
        e.preventDefault()
        player.toggle()
        return
      }
      if (e.key === 'Enter' && anchor >= 0 && anchor < tracks.length) {
        play(anchor)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const next = Math.max(0, Math.min(tracks.length - 1, anchor + (e.key === 'ArrowDown' ? 1 : -1)))
        setAnchor(next)
        setSelected(new Set([tracks[next].id]))
        scrollRef.current?.scrollTo({ top: Math.max(0, next * ROW - 200) })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anchor, tracks, play])

  const head = (key: SortKey, label: string, style?: React.CSSProperties): React.ReactNode => (
    <button
      onClick={() => onSort?.(key)}
      className="mono sorth"
      title={`Trier par ${label.toLowerCase()}`}
      style={{
        fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left',
        color: sort === key ? 'var(--accent)' : 'var(--ink-soft)', ...style
      }}
    >
      {label}
      <span style={{ opacity: sort === key ? 1 : 0.45 }}>{sort === key ? (sortDir === 1 ? ' ↑' : ' ↓') : ' ⇅'}</span>
    </button>
  )

  // colonnes choisies par l'utilisateur, dans l'ordre canonique du registre
  const cols = COLUMN_ORDER.filter((k) => settings.columns.includes(k))
  const toggleColumn = (key: ColumnKey): void => {
    const has = cols.includes(key)
    patchSettings({ columns: COLUMN_ORDER.filter((k) => (k === key ? !has : cols.includes(k))) })
  }

  const grid = `34px minmax(220px, 2fr) ${cols.map((k) => COLUMNS[k].width).join(' ')} 22px`
  const [start, end] = range
  const visible = tracks.slice(start, end)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div
        style={{
          display: 'grid', gridTemplateColumns: grid, gap: 12, alignItems: 'center',
          padding: '8px 18px', borderBottom: 'var(--line-thick)', flex: 'none'
        }}
      >
        <span className="mono" style={{ fontSize: 9, color: 'var(--ink-soft)' }}>#</span>
        {head('title', 'Titre')}
        {cols.map((k) => (
          <Fragment key={k}>{head(COLUMNS[k].sort, COLUMNS[k].label, COLUMNS[k].align ? { textAlign: 'right' } : undefined)}</Fragment>
        ))}
        <button
          className="mono sorth"
          title="Choisir les colonnes…"
          onClick={(e) => {
            e.stopPropagation()
            const below = e.currentTarget.getBoundingClientRect().bottom + 6
            setColMenu((v) => (v === null ? below : null))
          }}
          style={{ fontSize: 12, color: 'var(--ink-soft)', textAlign: 'right' }}
        >
          ⊞
        </button>
      </div>

      <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ height: tracks.length * ROW, position: 'relative' }}>
          {visible.map((t, i) => {
            const index = start + i
            const isPlaying = snap.track?.id === t.id
            const isSel = selected.has(t.id)
            const draggable = true
            return (
              <div
                key={t.id}
                className={`trow ${isSel ? 'sel' : ''} ${isPlaying ? 'playing' : ''}`}
                onClick={(e) => onRowClick(e, index, t.id)}
                onDoubleClick={() => play(index)}
                onContextMenu={(e) => onContext(e, index, t.id)}
                draggable={draggable}
                onDragStart={(e) => {
                  // drag interne : l'id permet de déposer sur les zones A/B
                  e.dataTransfer.setData('application/x-2listen-track', t.id)
                  e.dataTransfer.effectAllowed = 'copyMove'
                  if (onReorder) setDragIdx(index)
                }}
                onDragOver={(e) => {
                  if (dragIdx === null) return
                  e.preventDefault()
                  setDropIdx(index)
                }}
                onDrop={() => {
                  if (dragIdx !== null && dropIdx !== null && dragIdx !== dropIdx) onReorder?.(dragIdx, dropIdx)
                  setDragIdx(null)
                  setDropIdx(null)
                }}
                onDragEnd={() => {
                  setDragIdx(null)
                  setDropIdx(null)
                }}
                style={{
                  position: 'absolute', top: index * ROW, left: 0, right: 0, height: ROW,
                  display: 'grid', gridTemplateColumns: grid, gap: 12, alignItems: 'center',
                  padding: '0 18px',
                  boxShadow: dropIdx === index && dragIdx !== null ? 'inset 0 3px 0 var(--accent)' : undefined
                }}
              >
                <span className="mono dim" style={{ fontSize: 10 }}>
                  {isPlaying ? (
                    <span style={{ color: 'var(--accent)', animation: snap.playing ? 'blink 1s steps(1) infinite' : undefined }}>▶</span>
                  ) : (
                    index + 1
                  )}
                </span>
                <span style={{ fontWeight: isPlaying ? 700 : 500, ...ell }}>
                  {t.title}
                </span>
                {cols.map((k) => (
                  <Fragment key={k}>{COLUMNS[k].render(t, isSel)}</Fragment>
                ))}
              </div>
            )
          })}
        </div>
        {tracks.length === 0 && (
          <div className="serif" style={{ fontStyle: 'italic', fontSize: 20, color: 'var(--ink-soft)', padding: 40, textAlign: 'center' }}>
            Aucune piste ici.
          </div>
        )}
      </div>

      {editing && <TagEditor tracks={editing} onClose={() => setEditing(null)} />}
      {colMenu !== null && (
        <div className="ctxmenu rise" style={{ right: 12, top: colMenu, minWidth: 190 }} onClick={(e) => e.stopPropagation()}>
          <div className="sect">Colonnes</div>
          {COLUMN_ORDER.map((k) => (
            <button key={k} onClick={() => toggleColumn(k)}>
              <span style={{ display: 'inline-block', width: 20, color: cols.includes(k) ? 'var(--accent)' : 'var(--ink-soft)' }}>
                {cols.includes(k) ? '■' : '□'}
              </span>
              {COLUMNS[k].label}
            </button>
          ))}
        </div>
      )}
      {menu && (
        <div
          className="ctxmenu rise"
          style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 320) }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const idx = tracks.findIndex((t) => t.id === menu.ids[0])
              if (idx >= 0) play(idx)
              setMenu(null)
            }}
          >
            ▶ Lire
          </button>
          <div className="sect">Ajouter à la playlist</div>
          {playlists.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                addToPlaylist(p.id, menu.ids)
                setMenu(null)
              }}
            >
              + {p.name}
            </button>
          ))}
          <button
            onClick={() => {
              // window.prompt n'existe pas dans Electron : nom par défaut, renommable ensuite.
              addToPlaylist(createPlaylist('Nouvelle playlist'), menu.ids)
              setMenu(null)
            }}
          >
            + Nouvelle playlist…
          </button>
          <button
            onClick={() => {
              const ids = new Set(menu.ids)
              const sel = tracks.filter((t) => ids.has(t.id))
              if (sel.length) setEditing(sel)
              setMenu(null)
            }}
          >
            ✎ Modifier les infos{menu.ids.length > 1 ? ` (${menu.ids.length})` : ''}…
          </button>
          <div className="sect">Outil A/B</div>
          <div style={{ display: 'flex', borderBottom: 'var(--line)' }}>
            <button
              style={{ flex: 1, borderBottom: 'none', borderRight: 'var(--line)' }}
              onClick={() => {
                patchSettings({ compareA: menu.ids[0] })
                setView({ kind: 'compare' })
                setMenu(null)
              }}
            >
              → Mix (A)
            </button>
            <button
              style={{ flex: 1, borderBottom: 'none' }}
              onClick={() => {
                patchSettings({ compareB: menu.ids[0] })
                setView({ kind: 'compare' })
                setMenu(null)
              }}
            >
              → Référence (B)
            </button>
          </div>
          <div className="sect">Note</div>
          <div style={{ display: 'flex', borderBottom: 'var(--line)' }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                style={{ flex: 1, borderBottom: 'none', textAlign: 'center', padding: '7px 0' }}
                onClick={() => {
                  for (const id of menu.ids) setRating(id, n)
                  setMenu(null)
                }}
              >
                {n <= (tracks.find((t) => t.id === menu.ids[0])?.rating ?? 0) ? '★' : '☆'}
              </button>
            ))}
          </div>
          {onRemove && (
            <button
              onClick={() => {
                onRemove(menu.ids)
                setMenu(null)
              }}
            >
              − Retirer de la playlist
            </button>
          )}
          <button
            onClick={() => {
              const t = tracks.find((x) => x.id === menu.ids[0])
              if (t) void window.tl.track.reveal(t.path)
              setMenu(null)
            }}
          >
            Afficher dans le Finder
          </button>
          <button
            onClick={() => {
              void removeTracks(menu.ids)
              setMenu(null)
            }}
            style={{ color: 'var(--accent)' }}
          >
            ✕ Retirer de la bibliothèque ({menu.ids.length})
          </button>
        </div>
      )}
    </div>
  )
}
