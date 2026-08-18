import { BrowserWindow, app, session, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { registerHandler, registerScheme } from './protocol'
import { initStores, library, settings } from './store'
import { initUpdater } from './updater'

// Renseigné aussi dans package.json > build.publish pour electron-builder.
const REPO_URL = 'https://github.com/thibaultpierens/2listen'

let mainWindow: BrowserWindow | null = null

// Les interfaces audio pro (ex. Universal Audio, 36 canaux) font échouer le
// mixer de Chromium (« invalid output parameters ») : l'audio reste muet.
// On désactive l'annulation d'écho globale (inutile pour un lecteur) qui
// impose ce mixer, et on garde un layout stéréo standard.
app.commandLine.appendSwitch('disable-features', 'ChromeWideEchoCancellation')
app.commandLine.appendSwitch('try-supported-channel-layouts')

registerScheme()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: '2Listen',
    backgroundColor: '#ece9e2',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 21 },
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
    mainWindow?.show()
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
  registerHandler()
  registerIpc(() => mainWindow)
  createWindow()
  initUpdater((state) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:state', state)
  }, REPO_URL)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  await Promise.all([library.flush(), settings.flush()])
})
