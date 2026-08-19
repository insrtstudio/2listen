import { protocol } from 'electron'
import { createReadStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { extname, join, resolve, sep } from 'node:path'
import { library, paths } from './store'

export const SCHEME = 'tl'

/** À déclarer avant `app.whenReady()`. */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
    }
  ])
}

const MIME: Record<string, string> = {
  flac: 'audio/flac',
  wav: 'audio/wav',
  wave: 'audio/wav',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  aifc: 'audio/aiff',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  alac: 'audio/mp4',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png'
}

const mimeFor = (path: string): string => MIME[extname(path).slice(1).toLowerCase()] ?? 'application/octet-stream'

/** Un fichier n'est servi que s'il vit sous une racine, est un morceau ajouté
 *  individuellement, ou appartient à nos caches. */
function isAllowed(target: string): boolean {
  const data = library.get()
  const abs = resolve(target)
  if (data.files.some((f) => resolve(f) === abs)) return true
  const allowed = [...data.roots, paths.covers(), paths.peaks(), paths.decodeTmp()]
  return allowed.some((root) => {
    const r = resolve(root)
    return abs === r || abs.startsWith(r.endsWith(sep) ? r : r + sep)
  })
}

async function serveFile(path: string, rangeHeader: string | null): Promise<Response> {
  let stat
  try {
    stat = await fs.stat(path)
  } catch {
    return new Response('Not found', { status: 404 })
  }
  const size = stat.size
  const type = mimeFor(path)
  const base = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache'
  }

  const match = rangeHeader?.match(/bytes=(\d*)-(\d*)/)
  if (match) {
    // Le seek audio de Chromium repose entièrement sur des requêtes partielles.
    const start = match[1] ? Number(match[1]) : 0
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
    if (Number.isNaN(start) || start >= size || end < start) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
    return new Response(stream, {
      status: 206,
      headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
    })
  }

  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream
  return new Response(stream, { status: 200, headers: { ...base, 'Content-Length': String(size) } })
}

export function registerHandler(): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    const range = request.headers.get('Range')

    if (url.hostname === 'audio') {
      const path = url.searchParams.get('p')
      if (!path || !isAllowed(path)) return new Response('Forbidden', { status: 403 })
      return serveFile(path, range)
    }
    if (url.hostname === 'cover') {
      const key = url.searchParams.get('k')
      if (!key || /[/\\]|\.\./.test(key)) return new Response('Forbidden', { status: 403 })
      return serveFile(join(paths.covers(), key), null)
    }
    return new Response('Not found', { status: 404 })
  })
}

export const audioUrl = (path: string): string => `${SCHEME}://audio/?p=${encodeURIComponent(path)}`
export const coverUrl = (key: string): string => `${SCHEME}://cover/?k=${encodeURIComponent(key)}`
