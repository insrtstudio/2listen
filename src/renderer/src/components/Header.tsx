import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import Icon from './Icon'

/** Nom éditable en place : un clic ouvre la saisie (façon Apple Music). */
function EditableTitle({ title, onRename }: { title: string; onRename: (name: string) => void }): React.ReactNode {
  const [draft, setDraft] = useState<string | null>(null)
  if (draft === null) {
    return (
      <h1 className="toolbar-title edit no-drag" style={{ margin: 0 }} onClick={() => setDraft(title)} title="Cliquer pour renommer">
        {title}
      </h1>
    )
  }
  const commit = (): void => {
    if (draft.trim() && draft.trim() !== title) onRename(draft.trim())
    setDraft(null)
  }
  return (
    <input
      autoFocus
      className="toolbar-title-input no-drag"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
      onFocus={(e) => e.target.select()}
    />
  )
}

/** Recherche + ajout, pour les vues qu'elle filtre vraiment (voir App pour ⌘F). */
function LibraryTools(): React.ReactNode {
  const { search, setSearch, addFiles, addRoot } = useStore()
  const [menu, setMenu] = useState<{ right: number; top: number } | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

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

  return (
    <>
      <div className="search no-drag">
        <Icon name="search" />
        <input
          ref={inputRef}
          className="field"
          placeholder="Rechercher"
          title="⌘F"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearch('')
              inputRef.current?.blur()
            }
          }}
        />
        {search && (
          <button className="ic" title="Effacer" onClick={() => setSearch('')}>
            <Icon name="close" />
          </button>
        )}
      </div>
      <button
        className="ic no-drag"
        title="Ajouter à la bibliothèque"
        onClick={(e) => {
          e.stopPropagation()
          const r = e.currentTarget.getBoundingClientRect()
          setMenu((m) => (m ? null : { right: window.innerWidth - r.right, top: r.bottom + 6 }))
        }}
      >
        <Icon name="plus" />
      </button>
      {menu && (
        <div className="ctxmenu" style={{ right: menu.right, top: menu.top }}>
          <button className="it" onClick={() => void addFiles()}>Ajouter des morceaux…</button>
          <button className="it" onClick={() => void addRoot()}>Ajouter un dossier…</button>
        </div>
      )}
    </>
  )
}

/** Barre d'outils de la vue : le titre et les actions tiennent sur une seule ligne. */
export default function Header({
  title,
  sub,
  onBack,
  backLabel,
  onRename,
  actions,
  library
}: {
  title: string
  sub?: React.ReactNode
  onBack?: () => void
  backLabel?: string
  onRename?: (name: string) => void
  actions?: React.ReactNode
  /** Affiche la recherche et l'ajout de morceaux. */
  library?: boolean
}): React.ReactNode {
  return (
    <div className="toolbar drag">
      {onBack && (
        <button className="ic no-drag" onClick={onBack} title={backLabel} style={{ marginLeft: -4 }}>
          <Icon name="back" />
        </button>
      )}
      {onRename ? (
        <EditableTitle title={title} onRename={onRename} />
      ) : (
        <h1 className="toolbar-title" style={{ margin: 0 }}>{title}</h1>
      )}
      {sub && <span className="toolbar-sub">{sub}</span>}
      <div className="grow" />
      {actions}
      {library && <LibraryTools />}
    </div>
  )
}
