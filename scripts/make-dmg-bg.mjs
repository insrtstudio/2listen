/** Capture build/dmg-bg.html en PNG 1x + 2x, puis TIFF multi-résolution. */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import electron from 'electron'
const { app, BrowserWindow } = electron

const W = 660, H = 420

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W, height: H, show: true, frame: false,
    webPreferences: { backgroundThrottling: false }
  })
  await win.loadFile(resolve(process.cwd(), 'build/dmg-bg.html'))
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)', true)
  await new Promise((r) => setTimeout(r, 500))
  writeFileSync('build/dmg-bg.png', (await win.webContents.capturePage()).toPNG())
  console.log('step:1x')

  win.setSize(W * 2, H * 2)
  win.webContents.setZoomFactor(2)
  await new Promise((r) => setTimeout(r, 800))
  writeFileSync('build/dmg-bg@2x.png', (await win.webContents.capturePage()).toPNG())
  console.log('step:2x')
  win.destroy()

  execSync('tiffutil -cathidpicheck build/dmg-bg.png build/dmg-bg@2x.png -out build/dmg-background.tiff')
  console.log('OK build/dmg-background.tiff')
  app.quit()
})
setTimeout(() => { console.error('timeout'); process.exit(1) }, 30000)
