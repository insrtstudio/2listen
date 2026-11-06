import { useEffect, useState, useSyncExternalStore } from 'react'
import type { RemoteState } from '@shared/types'
import { useStore } from '@/lib/store'
import { peaksBatch } from '@/lib/peaks'
import Icon from './Icon'

/** Tout ce qui ne sert pas à écouter, sur une seule page. */
export default function SettingsSheet({ onClose }: { onClose: () => void }): React.ReactNode {
  const { settings, patchSettings, roots, removeRoot, addRoot, addFiles, rescan, scan, excludedCount, restoreExcluded, update, version } = useStore()
  const scanning = scan.phase === 'discover' || scan.phase === 'read'

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const updateLine = (): { text: string; action?: { label: string; run: () => void } } => {
    const check = { label: 'Rechercher', run: () => void window.tl.update.check() }
    switch (update.status) {
      case 'checking': return { text: 'Recherche en cours…' }
      case 'available': return { text: `Version ${update.version} trouvée…` }
      case 'downloading': return { text: `Téléchargement de la v${update.version} : ${update.percent ?? 0} %` }
      case 'ready': return { text: `Version ${update.version} prête`, action: { label: 'Installer', run: () => void window.tl.update.install() } }
      case 'error':
        return {
          text: 'La recherche a échoué',
          action: update.url
            ? { label: 'Ouvrir la page', run: () => void window.tl.update.openUrl(update.url!) }
            : { label: 'Réessayer', run: check.run }
        }
      case 'none': return { text: 'À jour', action: check }
      default: return { text: 'Pas encore vérifié', action: check }
    }
  }
  const up = updateLine()

  return (
    <div className="veil" onClick={onClose}>
      <div className="modal glass" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Réglages</span>
          <button className="ic" title="Fermer" onClick={onClose}><Icon name="close" /></button>
        </div>

        <div className="group">
          <span className="label">Apparence</span>
          <div className="group-box">
            <div className="grow-row">
              <span className="grow">Thème</span>
              <div className="seg">
                <button className={settings.theme === 'light' ? 'on' : ''} onClick={() => patchSettings({ theme: 'light' })}>Clair</button>
                <button className={settings.theme === 'dark' ? 'on' : ''} onClick={() => patchSettings({ theme: 'dark' })}>Sombre</button>
              </div>
            </div>
          </div>
        </div>

        <div className="group">
          <span className="label">Dossiers surveillés</span>
          <div className="group-box">
            {roots.map((r) => (
              <div className="grow-row" key={r}>
                <span className="mono ell grow" style={{ fontSize: 11, direction: 'rtl', textAlign: 'left' }} title={r}>{r}</span>
                <button className="ic xs" title="Retirer ce dossier" onClick={() => void removeRoot(r)}><Icon name="close" /></button>
              </div>
            ))}
            {roots.length === 0 && <div className="grow-row dim">Aucun dossier pour l'instant.</div>}
            <div className="grow-row" style={{ gap: 6 }}>
              <button className="blk sm" onClick={() => void addRoot()}>Ajouter un dossier…</button>
              <button className="blk sm" onClick={() => void addFiles()}>Ajouter des morceaux…</button>
              <div className="grow" />
              <button className="blk sm" onClick={() => void rescan()} disabled={scanning}>{scanning ? 'Scan…' : 'Rescanner'}</button>
            </div>
            {excludedCount > 0 && (
              <div className="grow-row">
                <span className="grow">{excludedCount} morceau{excludedCount > 1 ? 'x' : ''} retiré{excludedCount > 1 ? 's' : ''}</span>
                <button className="blk sm" onClick={() => void restoreExcluded()}>Restaurer</button>
              </div>
            )}
          </div>
        </div>

        <RemoteGroup />

        <div className="group">
          <span className="label">Couleurs de la forme d'onde</span>
          <div className="group-box">
            <div className="grow-row" style={{ gap: 16 }}>
              <Legend color="var(--ink)" label="Graves" />
              <Legend color="var(--ink-soft)" label="Médiums" />
              <Legend color="var(--accent)" label="Aigus" />
              <Legend color="var(--accent)" label="Transitoires" thin />
            </div>
          </div>
        </div>

        <div className="group" style={{ marginBottom: 18 }}>
          <span className="label">Application</span>
          <div className="group-box">
            <div className="grow-row">
              <span className="grow">2Listen {version || '0.0.0'}</span>
              <span className="dim" title={update.status === 'error' ? update.message : undefined}>{up.text}</span>
              {up.action && <button className="blk sm" onClick={up.action.run}>{up.action.label}</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Écouter depuis l'iPhone : le Mac sert la bibliothèque tant que l'app est ouverte. */
function RemoteGroup(): React.ReactNode {
  const [remote, setRemote] = useState<RemoteState | null>(null)
  useEffect(() => {
    const refresh = (): void => void window.tl.remote.state().then(setRemote)
    refresh()
    // le code expire ou se consomme à l'appairage : on suit tant que Réglages est ouvert
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
  }, [])
  if (!remote) return null
  return (
    <div className="group">
      <span className="label">iPhone</span>
      <div className="group-box">
        <label className="grow-row switch" style={{ justifyContent: 'space-between' }}>
          Écouter depuis l'iPhone
          <input
            type="checkbox"
            data-remote-switch
            checked={remote.enabled}
            onChange={(e) => void window.tl.remote.setEnabled(e.target.checked).then(setRemote)}
          />
        </label>
        {remote.running && (
          <>
            <div className="grow-row">
              <span className="grow">Code d'appairage</span>
              <span className="mono" data-remote-code style={{ fontSize: 15, letterSpacing: '0.12em' }}>{remote.code}</span>
            </div>
            <div className="grow-row">
              <span className="grow">Adresse</span>
              <span className="mono dim ell" style={{ fontSize: 11 }}>{remote.addresses.map((a) => `${a}:${remote.port}`).join(', ') || 'Pas de réseau'}</span>
            </div>
            <WaveformsRow />
            {remote.paired && (
              <div className="grow-row">
                <span className="grow">Appareils connectés</span>
                <button className="blk sm" onClick={() => void window.tl.remote.revoke().then(setRemote)}>Tout déconnecter</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** Analyse d'avance les morceaux jamais lus sur le Mac : l'iPhone n'a pas de quoi le faire lui-même. */
function WaveformsRow(): React.ReactNode {
  const batch = useSyncExternalStore(peaksBatch.subscribe, peaksBatch.get)
  useEffect(() => void peaksBatch.count(), [])
  const plural = (n: number): string => `${n} morceau${n > 1 ? 'x' : ''}`
  const status = batch.running
    ? `Analyse : ${batch.done} / ${batch.total}`
    : batch.pending === null
      ? ''
      : batch.pending === 0
        ? 'Toutes prêtes'
        : `${plural(batch.pending)} à analyser`
  return (
    <div className="grow-row" data-peaks-row>
      <span className="grow">Formes d'onde</span>
      <span className="dim" data-peaks-status style={{ fontSize: 12, marginRight: 8 }}>{status}</span>
      {batch.running ? (
        <button className="blk sm" onClick={() => peaksBatch.stop()}>Arrêter</button>
      ) : (
        !!batch.pending && <button className="blk sm" data-peaks-start onClick={() => void peaksBatch.start()}>Analyser</button>
      )}
    </div>
  )
}

function Legend({ color, label, thin }: { color: string; label: string; thin?: boolean }): React.ReactNode {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      <i style={{ width: thin ? 2 : 9, height: thin ? 12 : 9, borderRadius: thin ? 1 : 3, background: color }} />
      {label}
    </span>
  )
}
