/* Scénario e2e piloté depuis le main (TL_E2E). `win` et `app` sont fournis.
   Chaque étape : action DOM dans le renderer + capture d'écran. */
const { writeFileSync } = await import('node:fs')
const { join } = await import('node:path')

const outDir = process.env.TL_E2E_OUT || '.'
const wc = win.webContents
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (code) => wc.executeJavaScript(`(async () => { ${code} })()`, true)
const shot = async (name) => {
  const img = await wc.capturePage()
  writeFileSync(join(outDir, `${name}.png`), img.toPNG())
  console.log('[e2e] shot', name)
}
const click = (selector) => js(`
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})][0]
  if (!el) throw new Error('introuvable: ' + ${JSON.stringify(selector)})
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
`)
const clickText = (selector, text) => js(`
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.includes(${JSON.stringify(text)}))
  if (!el) throw new Error('introuvable: ' + ${JSON.stringify(text)})
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
`)
const assert = async (code, label) => {
  const ok = await js(`return (${code})`)
  console.log(ok ? `[e2e] OK  ${label}` : `[e2e] FAIL ${label}`)
  if (!ok) process.exitCode = 1
}

// — 1. vue Pistes chargée —
await sleep(1500)
await assert(`document.querySelectorAll('.trow').length >= 3`, 'pistes listées')
await shot('01-pistes')

// — 2. lecture au double-clic + waveform —
await js(`document.querySelector('.trow').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
await sleep(2500)
await assert(`window.__tl_probe().playing === true`, 'lecture démarrée')
await assert(`window.__tl_probe().ready === 4`, 'audio décodé (readyState 4)')
await shot('02-lecture')

// — 3. tri par colonne —
await clickText('button', 'Titre')
await sleep(300)
await shot('03-tri-titre')

// — 4. recherche —
await js(`
  const inp = document.querySelector('input.field')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, 'basalte')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
`)
await sleep(400)
await assert(`document.querySelectorAll('.trow').length === 1`, 'recherche filtre à 1 piste')
await shot('04-recherche')
await js(`
  const inp = document.querySelector('input.field')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, '')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
`)

// — 5. menu contextuel + création de playlist —
await sleep(300)
await js(`document.querySelector('.trow').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 300 }))`)
await sleep(300)
await shot('05-menu-contextuel')
await clickText('.ctxmenu button', 'Nouvelle playlist')
await sleep(400)
await assert(`[...document.querySelectorAll('.navitem')].some((e) => e.textContent.includes('Nouvelle playlist'))`, 'playlist créée dans la sidebar')

// — 6. ajout d'une 2e piste puis vue playlist —
await js(`document.querySelectorAll('.trow')[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 330 }))`)
await sleep(250)
await clickText('.ctxmenu button', 'Nouvelle playlist')
await sleep(250)
await clickText('.navitem', 'Nouvelle playlist')
await sleep(400)
await assert(`document.querySelectorAll('.trow').length === 2`, 'playlist contient 2 pistes')
await shot('06-playlist')

// — 7. albums / artistes —
await clickText('.navitem', 'Albums')
await sleep(400)
await assert(`document.querySelectorAll('.albcard').length >= 1`, 'grille d’albums')
await shot('07-albums')
await click('.albcard')
await sleep(400)
await shot('08-album-detail')
await clickText('.navitem', 'Artistes')
await sleep(400)
await shot('09-artistes')

// — 8. clavier : flèche + espace (pause) —
await clickText('.navitem', 'Pistes')
await sleep(400)
await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))`)
await sleep(300)
await assert(`window.__tl_probe().playing === false`, 'espace met en pause')

// — 9. état persisté : la playlist doit être dans library.json —
console.log('[e2e] terminé')
