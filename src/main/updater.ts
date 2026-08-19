import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { UpdateState } from '../shared/types'

const { autoUpdater } = electronUpdater

type Listener = (state: UpdateState) => void

let state: UpdateState = { status: 'idle' }
let listener: Listener = () => {}
let downloadUrl = 'https://github.com'
/** Zip téléchargé par electron-updater (événement update-downloaded). */
let downloadedFile: string | null = null
let lastCheck = 0

const log = (msg: string): void => {
  const line = `${new Date().toISOString()} ${msg}\n`
  try {
    appendFileSync(join(app.getPath('userData'), 'updater.log'), line)
  } catch {
    /* le log ne doit jamais faire échouer l'updater */
  }
}

const emit = (next: UpdateState): void => {
  state = next
  log(`state=${next.status}${next.version ? ` v${next.version}` : ''}${next.message ? ` (${next.message})` : ''}`)
  listener(state)
}

export const getUpdateState = (): UpdateState => state

/**
 * Détection + téléchargement : electron-updater (flux GitHub Releases,
 * blockmaps, choix d'architecture). Installation : script shell maison —
 * `quitAndInstall` passe par Squirrel.Mac qui exige une app signée et échoue
 * en silence sur un build non signé.
 */
export function initUpdater(onState: Listener, repoUrl: string): void {
  listener = onState
  downloadUrl = `${repoUrl}/releases/latest`

  if (!app.isPackaged) {
    emit({ status: 'none', message: 'dev' })
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false // notre installeur s'en charge
  autoUpdater.logger = {
    info: (m: unknown) => log(`[eu] ${String(m)}`),
    warn: (m: unknown) => log(`[eu][warn] ${String(m)}`),
    error: (m: unknown) => log(`[eu][error] ${String(m)}`),
    debug: (m: unknown) => log(`[eu][debug] ${String(m)}`)
  }

  autoUpdater.on('checking-for-update', () => emit({ status: 'checking' }))
  autoUpdater.on('update-available', (info) => emit({ status: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => emit({ status: 'none' }))
  autoUpdater.on('download-progress', (p) =>
    emit({ status: 'downloading', percent: Math.round(p.percent), version: state.version })
  )
  autoUpdater.on('update-downloaded', (info) => {
    downloadedFile = info.downloadedFile ?? null
    emit({ status: 'ready', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    emit({
      status: 'error',
      message: String(err?.message ?? err).split('\n')[0].slice(0, 140),
      manual: true,
      url: downloadUrl,
      version: state.version
    })
  })

  checkNow()
  setInterval(checkNow, 15 * 60_000)
}

/** Vérification (throttle 60 s pour les déclencheurs type focus fenêtre). */
export function checkNow(force = false): void {
  if (!app.isPackaged) return
  const now = Date.now()
  if (!force && now - lastCheck < 60_000) return
  lastCheck = now
  void autoUpdater.checkForUpdates().catch((err) => log(`check failed: ${String(err)}`))
}

/**
 * Installation maison : attend la fin du process, extrait le zip téléchargé,
 * remplace le bundle .app en place, retire la quarantaine et relance.
 * Aucune exigence de signature.
 */
export function installNow(): void {
  if (state.status !== 'ready' || !downloadedFile) {
    log(`installNow refusé : status=${state.status} file=${downloadedFile ?? 'null'}`)
    return
  }
  // …/2Listen.app/Contents/MacOS/2Listen → …/2Listen.app
  const bundle = resolve(process.execPath, '..', '..', '..')
  if (!bundle.endsWith('.app')) {
    log(`installNow : bundle inattendu ${bundle}`)
    return
  }
  const script = [
    'set -e',
    `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
    'TMP=$(mktemp -d)',
    `ditto -x -k "${downloadedFile}" "$TMP"`,
    'NEW=$(find "$TMP" -maxdepth 1 -name "*.app" -print -quit)',
    '[ -n "$NEW" ]',
    `rm -rf "${bundle}"`,
    `mv "$NEW" "${bundle}"`,
    `xattr -dr com.apple.quarantine "${bundle}" 2>/dev/null || true`,
    'sleep 0.5',
    `open -n "${bundle}"`
  ].join('\n')
  log(`installNow : remplacement de ${bundle} par ${downloadedFile}`)
  spawn('/bin/bash', ['-c', script], { detached: true, stdio: 'ignore' }).unref()
  app.quit()
}
