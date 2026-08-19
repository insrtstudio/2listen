import { useMemo, useState } from 'react'
import { useStore } from '@/lib/store'

/** Sélecteur de piste (recherche + liste), partagé entre Comparer et la table de mix. */
export default function TrackPicker({
  label,
  color,
  trackId,
  onPick,
  bare
}: {
  label: string
  color: string
  trackId: string | null
  onPick: (id: string | null) => void
  /** sans bordure extérieure ni pastille (déjà fournies par le parent) */
  bare?: boolean
}): React.ReactNode {
  const { tracks } = useStore()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const picked = tracks.find((t) => t.id === trackId) ?? null

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return tracks.slice(0, 8)
    return tracks
      .filter((t) => t.title.toLowerCase().includes(needle) || t.artist.toLowerCase().includes(needle))
      .slice(0, 8)
  }, [tracks, q])

  return (
    <div style={{ flex: 1, minWidth: 0, border: bare ? 'none' : 'var(--line)', position: 'relative', background: 'var(--paper)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          borderBottom: open ? 'var(--line)' : 'none'
        }}
      >
        {!bare && (
          <span
            style={{
              width: 26,
              height: 26,
              flex: 'none',
              display: 'grid',
              placeItems: 'center',
              background: color,
              color: '#111',
              font: '700 13px var(--grotesk)',
              border: '2px solid var(--ink)'
            }}
          >
            {label}
          </span>
        )}
        {picked ? (
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ font: '700 13px/1.2 var(--grotesk)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {picked.title}
            </div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--ink-soft)' }}>
              {picked.artist} · {picked.codec}
            </div>
          </div>
        ) : (
          <span className="serif" style={{ fontStyle: 'italic', color: 'var(--ink-soft)', flex: 1 }}>
            {label === 'A' ? 'Choisir votre mix…' : 'Choisir la référence…'}
          </span>
        )}
        <button className="mono tap" onClick={() => setOpen((v) => !v)}
          style={{ fontSize: 9, letterSpacing: '.1em', border: '1.5px solid var(--ink)', padding: '3px 8px', flex: 'none' }}>
          {picked ? 'CHANGER' : 'CHOISIR'}
        </button>
        {picked && (
          <button className="tap" title="Vider" onClick={() => onPick(null)}
            style={{ color: 'var(--accent)', font: '700 13px var(--grotesk)', flex: 'none' }}>
            ✕
          </button>
        )}
      </div>
      {open && (
        <div style={{ position: 'absolute', left: -2, right: -2, top: '100%', zIndex: 40, background: 'var(--paper)', border: 'var(--line-thick)', boxShadow: '6px 6px 0 rgba(17,17,17,.25)' }}>
          <input
            autoFocus
            className="field"
            placeholder="Rechercher…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ border: 'none', borderBottom: 'var(--line)' }}
          />
          {results.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                onPick(t.id)
                setOpen(false)
                setQ('')
              }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', borderBottom: 'var(--line)', font: '500 12px var(--grotesk)' }}
              className="hov"
            >
              {t.title} <span className="mono" style={{ fontSize: 9, color: 'var(--ink-soft)' }}>— {t.artist}</span>
            </button>
          ))}
          {results.length === 0 && (
            <div className="serif" style={{ fontStyle: 'italic', color: 'var(--ink-soft)', padding: '8px 12px' }}>Rien trouvé.</div>
          )}
        </div>
      )}
    </div>
  )
}
