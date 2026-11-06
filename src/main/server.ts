import { BrowserWindow, app, ipcMain, powerSaveBlocker } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { hostname, networkInterfaces } from 'node:os'
import { basename, extname, join } from 'node:path'
import type { Playlist, RemoteState, Track } from '../shared/types'
import { mimeFor } from './protocol'
import { library, paths } from './store'

/**
 * Serveur de l'app iPhone : le Mac sert sa bibliothèque sur le réseau local (et
 * sur Tailscale, qui se présente comme une interface de plus). Désactivé par
 * défaut. Un appareil obtient le jeton avec le code à 6 chiffres affiché dans
 * Réglages ; seuls les morceaux de la bibliothèque sont accessibles, par
 * identifiant, et les chemins du disque ne sortent jamais.
 */
const DEFAULT_PORT = 47810
const CODE_TTL = 10 * 60_000
const MAX_ATTEMPTS = 5
const AWAKE_AFTER_STREAM = 60_000
const MAX_BODY = 1 << 20

interface RemoteFile {
  enabled: boolean
  token: string | null
}

const remoteFile = (): string => join(paths.userData(), 'remote.json')
let config: RemoteFile = { enabled: false, token: null }
let server: Server | null = null
let port = 0
let bonjour: ChildProcess | null = null
let code: { value: string; expires: number; attempts: number } | null = null
let blocker: number | null = null
let blockerTimer: NodeJS.Timeout | null = null

/** Corps JSON d'une écriture, ou null s'il est trop gros ou illisible. */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) return null
    chunks.push(chunk as Buffer)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * POST /api/playlists { name, trackIds? }, puis POST ou DELETE
 * /api/playlists/<id>/tracks { trackIds } pour ajouter ou retirer des morceaux.
 */
async function handlePlaylists(req: IncomingMessage, res: ServerResponse, route: string): Promise<void> {
  const target = route.match(/^\/api\/playlists\/([^/]+)\/tracks$/)?.[1]
  const creating = route === '/api/playlists' && req.method === 'POST'
  const editing = !!target && (req.method === 'POST' || req.method === 'DELETE')
  if (!creating && !editing) {
    send(res, route === '/api/playlists' || target ? 405 : 404, { error: 'not allowed' })
    return
  }
  const body = await readJson(req)
  if (!body) {
    send(res, 400, { error: 'bad request' })
    return
  }
  const data = library.get()
  const known = new Set(data.tracks.map((t) => t.id))
  const given = Array.isArray(body.trackIds) ? body.trackIds : []
  const ids = [...new Set(given.filter((id): id is string => typeof id === 'string' && known.has(id)))]
  const now = Date.now()
  let playlists: Playlist[]
  if (creating) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : ''
    if (!name) {
      send(res, 400, { error: 'name required' })
      return
    }
    playlists = [...data.playlists, { id: randomBytes(8).toString('hex'), name, trackIds: ids, createdAt: now, updatedAt: now }]
  } else {
    if (!data.playlists.some((p) => p.id === target)) {
      send(res, 404, { error: 'not found' })
      return
    }
    playlists = data.playlists.map((p) => {
      if (p.id !== target) return p
      const trackIds = req.method === 'POST'
        ? [...p.trackIds, ...ids.filter((id) => !p.trackIds.includes(id))]
        : p.trackIds.filter((id) => !ids.includes(id))
      return { ...p, trackIds, updatedAt: now }
    })
  }
  library.set({ ...data, playlists })
  // sinon le prochain enregistrement côté Mac écraserait cette modification
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('pl:changed', playlists)
  send(res, 200, { ok: true })
}

async function saveConfig(): Promise<void> {
  // le jeton donne accès à la musique : lisible par l'utilisateur seul
  await fs.writeFile(remoteFile(), JSON.stringify(config), { encoding: 'utf8', mode: 0o600 })
}

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function currentCode(): string {
  if (!code || code.expires < Date.now()) {
    code = { value: String(randomInt(0, 1_000_000)).padStart(6, '0'), expires: Date.now() + CODE_TTL, attempts: 0 }
  }
  return code.value
}

function serverName(): string {
  return hostname().split('.')[0]
}

export function remoteState(): RemoteState {
  const addresses: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address)
    }
  }
  const running = !!server
  return {
    enabled: config.enabled,
    running,
    port,
    addresses,
    name: serverName(),
    code: running ? currentCode() : null,
    paired: !!config.token
  }
}

/** Garde le Mac éveillé pendant une écoute, et une minute après. */
function keepAwake(): void {
  if (blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension')
  if (blockerTimer) clearTimeout(blockerTimer)
  blockerTimer = setTimeout(() => {
    if (blocker !== null) powerSaveBlocker.stop(blocker)
    blocker = null
  }, AWAKE_AFTER_STREAM)
}

/** La vue iPhone d'un morceau : tout sauf où il se trouve sur le disque. */
function publicTrack(t: Track): Omit<Track, 'path' | 'root'> & { ext: string } {
  const { path, root: _root, ...rest } = t
  return { ...rest, ext: extname(path).slice(1).toLowerCase() }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
      if (body.length > 1024) {
        reject(new Error('too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

async function serveFile(req: IncomingMessage, res: ServerResponse, path: string, type: string): Promise<void> {
  let size: number
  try {
    const st = await fs.stat(path)
    if (!st.isFile()) throw new Error('not a file')
    size = st.size
  } catch {
    send(res, 404, { error: 'not found' })
    return
  }
  const headers: Record<string, string | number> = { 'Content-Type': type, 'Accept-Ranges': 'bytes' }
  let start = 0
  let end = size - 1
  let status = 200
  const match = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/)
  if (match && (match[1] || match[2])) {
    if (match[1]) {
      start = Number(match[1])
      if (match[2]) end = Math.min(Number(match[2]), size - 1)
    } else {
      // « bytes=-N » : les N derniers octets
      start = Math.max(0, size - Number(match[2]))
    }
    if (start >= size || end < start) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` })
      res.end()
      return
    }
    status = 206
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  }
  headers['Content-Length'] = size === 0 ? 0 : end - start + 1
  res.writeHead(status, headers)
  if (req.method === 'HEAD' || size === 0) {
    res.end()
    return
  }
  const stream = createReadStream(path, { start, end })
  stream.on('error', () => res.destroy())
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const route = url.pathname

  if (route === '/api/info' && req.method === 'GET') {
    send(res, 200, { app: '2Listen', version: app.getVersion(), name: serverName() })
    return
  }

  if (route === '/api/pair' && req.method === 'POST') {
    let submitted = ''
    try {
      submitted = String((JSON.parse(await readBody(req)) as { code?: unknown }).code ?? '')
    } catch {
      send(res, 400, { error: 'bad request' })
      return
    }
    if (!code || code.expires < Date.now()) {
      send(res, 403, { error: 'code expired' })
      return
    }
    if (!same(submitted, code.value)) {
      // trop d'essais : le code brûle, Réglages en affichera un autre
      if (++code.attempts >= MAX_ATTEMPTS) code = null
      send(res, 403, { error: 'wrong code' })
      return
    }
    code = null
    if (!config.token) {
      config.token = randomBytes(32).toString('hex')
      await saveConfig()
    }
    send(res, 200, { token: config.token, name: serverName() })
    return
  }

  // Tout le reste exige le jeton. AVPlayer ne pose pas d'en-tête fiable sur ses
  // requêtes de lecture, d'où l'alternative en paramètre.
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
  const given = bearer ?? url.searchParams.get('t') ?? ''
  if (!config.token || !same(given, config.token)) {
    send(res, 401, { error: 'unauthorized' })
    return
  }
  // l'iPhone vérifie ici qu'il parle bien à son Mac avant d'adopter une nouvelle adresse
  if (route === '/api/info/auth') {
    send(res, 200, { ok: true })
    return
  }
  if (route.startsWith('/api/playlists')) {
    // pas de jeton dans l'adresse pour écrire : il finirait dans les journaux
    if (!bearer) {
      send(res, 401, { error: 'unauthorized' })
      return
    }
    await handlePlaylists(req, res, route)
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, { error: 'method not allowed' })
    return
  }

  if (route === '/api/library') {
    const data = library.get()
    // les adresses permettent à l'iPhone de retrouver le Mac hors du réseau local (Tailscale)
    send(res, 200, { tracks: data.tracks.map(publicTrack), playlists: data.playlists, addresses: remoteState().addresses, port })
    return
  }

  const trackOf = (prefix: string): Track | undefined => {
    const id = basename(route.slice(prefix.length), extname(route))
    return library.get().tracks.find((t) => t.id === id)
  }

  if (route.startsWith('/api/stream/')) {
    const track = trackOf('/api/stream/')
    if (!track) {
      send(res, 404, { error: 'not found' })
      return
    }
    keepAwake()
    await serveFile(req, res, track.path, mimeFor(track.path))
    return
  }

  if (route.startsWith('/api/cover/')) {
    const key = route.slice('/api/cover/'.length)
    // seules les pochettes référencées par la bibliothèque sont servies
    if (!library.get().tracks.some((t) => t.cover === key)) {
      send(res, 404, { error: 'not found' })
      return
    }
    await serveFile(req, res, join(paths.covers(), key), mimeFor(key))
    return
  }

  if (route.startsWith('/api/peaks/')) {
    const track = trackOf('/api/peaks/')
    if (!track) {
      send(res, 404, { error: 'not found' })
      return
    }
    await serveFile(req, res, join(paths.peaks(), `${track.id}.peaks`), 'application/octet-stream')
    return
  }

  send(res, 404, { error: 'not found' })
}

function advertise(): void {
  if (process.platform !== 'darwin') return
  bonjour = spawn('/usr/bin/dns-sd', ['-R', `2Listen sur ${serverName()}`, '_2listen._tcp', 'local', String(port)], { stdio: 'ignore' })
  bonjour.on('error', () => {
    bonjour = null
  })
}

function listen(onPort: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const s = createServer((req, res) => {
      handle(req, res).catch((err) => {
        console.error('[server]', err)
        if (!res.headersSent) send(res, 500, { error: 'internal' })
        else res.destroy()
      })
    })
    s.once('error', reject)
    s.listen(onPort, '0.0.0.0', () => {
      s.off('error', reject)
      resolve(s)
    })
  })
}

async function start(): Promise<void> {
  if (server) return
  const wanted = Number(process.env.TL_SERVER_PORT) || DEFAULT_PORT
  // port occupé : on en prend un autre, Bonjour le communique à l'iPhone
  server = await listen(wanted).catch(() => listen(0))
  const address = server.address()
  port = typeof address === 'object' && address ? address.port : wanted
  advertise()
}

export function stopServer(): void {
  bonjour?.kill()
  bonjour = null
  server?.close()
  server?.closeAllConnections()
  server = null
  port = 0
  code = null
}

export async function initServer(): Promise<void> {
  try {
    config = { ...config, ...(JSON.parse(await fs.readFile(remoteFile(), 'utf8')) as Partial<RemoteFile>) }
  } catch {
    /* premier lancement */
  }
  if (config.enabled) await start().catch((err) => console.error('[server] démarrage impossible', err))

  ipcMain.handle('remote:state', (): RemoteState => remoteState())
  ipcMain.handle('remote:setEnabled', async (_e, enabled: boolean): Promise<RemoteState> => {
    config.enabled = !!enabled
    await saveConfig()
    if (config.enabled) await start()
    else stopServer()
    return remoteState()
  })
  // change le jeton : tous les appareils devront être appairés à nouveau
  ipcMain.handle('remote:revoke', async (): Promise<RemoteState> => {
    config.token = null
    code = null
    await saveConfig()
    return remoteState()
  })
}
