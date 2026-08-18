import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Track } from '@shared/types'
import { fmtDuration, fmtQuality } from '@/lib/format'
import { player } from '@/lib/player'
import { useStore } from '@/lib/store'

const ROW = 44

export type SortKey = 'title' | 'artist' | 'album' | 'duration' | 'addedAt' | 'playCount' | 'quality' | 'manual'

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
    album: (a, b) => c.compare(a.album, b.album) || (a.discNo ?? 0) - (b.discNo ?? 0) || (a.trackNo ?? 0) - (b.trackNo ?? 0),
    duration: (a, b) => a.duration - b.duration,
    addedAt: (a, b) => a.addedAt - b.addedAt,
    playCount: (a, b) => a.playCount - b.playCount,
    quality: (a, b) => qualityRank(a) - qualityRank(b)
  }
  return [...tracks].sort((a, b) => cmp[key](a, b) * dir)
}

/**
 * Liste virtualisée maison : seules les lignes visibles existent dans le DOM,
 * 50 000 pistes défilent sans effort.
 */
export default function TrackTable({ tracks, onReorder, onRemove, sort, sortDir, onSort }: Props): React.ReactNode {
  const { setRating, playlists, addToPlaylist, createPlaylist } = useStore()
  const snap = useSyncExternalStore(player.subscribe, player.getSnapshot)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [range, setRange] = useState<[number, number]>([0, 60])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<number>(-1)
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null)
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
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

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
      className="mono"
      style={{
        fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'left',
        color: sort === key ? 'var(--accent)' : 'var(--ink-soft)', ...style
      }}
    >
      {label}
      {sort === key ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
    </button>
  )

  const grid = '34px minmax(220px, 2fr) minmax(140px, 1.2fr) minmax(140px, 1.2fr) 118px 64px 58px'
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
        {head('artist', 'Artiste')}
        {head('album', 'Album')}
        {head('quality', 'Qualité')}
        {head('duration', 'Durée', { textAlign: 'right' })}
        {head('playCount', 'Écoutes', { textAlign: 'right' })}
      </div>

      <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ height: tracks.length * ROW, position: 'relative' }}>
          {visible.map((t, i) => {
            const index = start + i
            const isPlaying = snap.track?.id === t.id
            const isSel = selected.has(t.id)
            const draggable = Boolean(onReorder)
            return (
              <div
                key={t.id}
                className={`trow ${isSel ? 'sel' : ''} ${isPlaying ? 'playing' : ''}`}
                onClick={(e) => onRowClick(e, index, t.id)}
                onDoubleClick={() => play(index)}
                onContextMenu={(e) => onContext(e, index, t.id)}
                draggable={draggable}
                onDragStart={(e) => {
                  setDragIdx(index)
                  e.dataTransfer.effectAllowed = 'move'
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
                <span style={{ fontWeight: isPlaying ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.title}
                </span>
                <span className="dim" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.artist}</span>
                <span className="dim" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.album}</span>
                <span className={`badge ${t.lossless && !isSel ? 'hot' : ''}`} style={{ justifySelf: 'start' }}>
                  {fmtQuality(t)}
                </span>
                <span className="mono dim" style={{ fontSize: 11, textAlign: 'right' }}>{fmtDuration(t.duration)}</span>
                <span className="mono dim" style={{ fontSize: 11, textAlign: 'right' }}>{t.playCount || '—'}</span>
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
        </div>
      )}
    </div>
  )
}
