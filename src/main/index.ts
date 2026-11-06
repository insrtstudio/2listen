import { BrowserWindow, app, nativeTheme, session, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { registerHandler, registerScheme } from './protocol'
import { initServer, stopServer } from './server'
import { initStores, library, settings } from './store'
import { checkNow, initUpdater } from './updater'

// Renseigné aussi dans package.json > build.publish pour electron-builder.
const REPO_URL = 'https://github.com/insrtstudio/2listen'

let mainWindow: BrowserWindow | null = null

// Les interfaces audio pro (ex. Universal Audio, 36 canaux) font échouer le
// mixer de Chromium (« invalid output parameters ») : l'audio reste muet.
// On désactive l'annulation d'écho globale (inutile pour un lecteur) qui
// impose ce mixer, et on garde un layout stéréo standard.
app.commandLine.appendSwitch('disable-features', 'ChromeWideEchoCancellation')
app.commandLine.appendSwitch('try-supported-channel-layouts')

// Tests : profil isolé pour ne jamais toucher la bibliothèque réelle.
if (process.env.TL_USERDATA) app.setPath('userData', process.env.TL_USERDATA)

// Tests : ni fenêtre visible, ni focus, ni son. On peut les lancer pendant une session de travail.
const E2E = !!process.env.TL_E2E
if (E2E && process.platform === 'darwin') app.setActivationPolicy('accessory')

registerScheme()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: '2Listen',
    // macOS Tahoe : vibrancy native derrière la page transparente (seule la barre latérale la
    // laisse voir, cf. .sidebar dans styles.css), feux tricolores dans la barre latérale.
    backgroundColor: '#00000000',
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 22, y: 22 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // L'audio ne démarre qu'après un geste utilisateur ? Non : c'est un lecteur.
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    if (E2E) {
      mainWindow?.setOpacity(0)
      mainWindow?.setIgnoreMouseEvents(true)
      mainWindow?.webContents.setAudioMuted(true)
      mainWindow?.showInactive()
    } else {
      mainWindow?.show()
    }
    // Debug : TL_E2E=/script.js exécute un scénario de test puis quitte.
    const e2e = process.env.TL_E2E
    if (e2e) {
      setTimeout(async () => {
        try {
          const { readFileSync } = await import('node:fs')
          const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
            ...args: string[]
          ) => (win: BrowserWindow, appRef: typeof app) => Promise<void>
          await new AsyncFunction('win', 'app', readFileSync(e2e, 'utf8'))(mainWindow!, app)
        } catch (err) {
          console.error('[e2e]', err)
          process.exitCode = 1
        }
        app.quit()
      }, 2500)
    }
    // Debug : TL_SHOT=/chemin.png capture la fenêtre puis quitte.
    const shot = process.env.TL_SHOT
    if (shot) {
      if (process.env.TL_AUTOPLAY) {
        setTimeout(() => {
          void mainWindow?.webContents.executeJavaScript(
            `document.querySelector('.trow')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`
          )
        }, 2500)
      }
      setTimeout(async () => {
        try {
          const probe = await mainWindow!.webContents.executeJavaScript('(window.__tl_probe||(()=>null))()')
          console.log('[probe]', JSON.stringify(probe))
          const img = await mainWindow!.webContents.capturePage()
          const { writeFileSync } = await import('node:fs')
          writeFileSync(shot, img.toPNG())
        } finally {
          app.quit()
        }
      }, Number(process.env.TL_SHOT_DELAY ?? 3000))
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Tout lien externe s'ouvre dans le navigateur, jamais dans l'app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Autorise la sélection de sortie audio (setSinkId) et les médias locaux.
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    ['media', 'speaker-selection', 'mediaKeySystem'].includes(permission)
  )
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(['media', 'speaker-selection', 'mediaKeySystem'].includes(permission))
  )
  await initStores()
  // la vibrancy et les feux suivent le thème de l'app, pas celui du système
  nativeTheme.themeSource = settings.get().theme
  registerHandler()
  registerIpc(() => mainWindow)
  await initServer()
  createWindow()
  initUpdater((state) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:state', state)
  }, REPO_URL)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // revenir sur l'app déclenche une vérification de MAJ (throttlée à 60 s)
  app.on('browser-window-focus', () => checkNow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  stopServer()
  await Promise.all([library.flush(), settings.flush()])
})
