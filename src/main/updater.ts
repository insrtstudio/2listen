import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '../shared/types'

const { autoUpdater } = electronUpdater

type Listener = (state: UpdateState) => void

let state: UpdateState = { status: 'idle' }
let listener: Listener = () => {}
let downloadUrl = 'https://github.com'

const emit = (next: UpdateState): void => {
  state = next
  listener(state)
}

export const getUpdateState = (): UpdateState => state

/**
 * Mise à jour automatique via les releases GitHub (électron-updater lit le
 * champ `publish` du package à la construction). Sur macOS, l'installation
 * silencieuse exige une app signée : si la vérification de signature échoue,
 * on bascule proprement en mode « télécharger manuellement ».
 */
export function initUpdater(onState: Listener, repoUrl: string): void {
  listener = onState
  downloadUrl = `${repoUrl}/releases/latest`

  if (!app.isPackaged) {
    emit({ status: 'none', message: 'dev' })
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => emit({ status: 'checking' }))
  autoUpdater.on('update-available', (info) => emit({ status: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => emit({ status: 'none' }))
  autoUpdater.on('download-progress', (p) =>
    emit({ status: 'downloading', percent: Math.round(p.percent), version: state.version })
  )
  autoUpdater.on('update-downloaded', (info) => emit({ status: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => {
    const message = String(err?.message ?? err)
    const signature = /code signature|not signed|Could not get code signature/i.test(message)
    emit({
      status: 'error',
      message: signature ? 'App non signée : mise à jour manuelle' : message,
      manual: true,
      url: downloadUrl,
      version: state.version
    })
  })

  void autoUpdater.checkForUpdates().catch(() => {})
  // Re-vérifie toutes les 30 minutes tant que l'app tourne.
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), 30 * 60_000)
}

export function installNow(): void {
  if (state.status === 'ready') autoUpdater.quitAndInstall()
}

export function checkNow(): void {
  if (app.isPackaged) void autoUpdater.checkForUpdates().catch(() => {})
}
