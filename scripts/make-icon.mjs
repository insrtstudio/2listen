/**
 * Génère build/icon.icns sans aucune dépendance. L'icône suit la direction
 * artistique Insrt, celle de PiersCRM (le back office, l'app mère) : plaque
 * encre, signe chromé, un seul point sunset. Le signe de 2Listen est une onde
 * sonore. Plaque, dégradés et point reprennent les valeurs mesurées sur
 * src-tauri/icons/icon.icns du CRM. On calcule chaque pixel, sur-échantillonné
 * 4×4, on encode le PNG à la main (zlib + CRC), puis sips/iconutil (macOS)
 * fabriquent l'iconset. AppMark (Icon.tsx) en est la version petite taille.
 */
import { deflateSync } from 'node:zlib'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'

const S = 1024
const px = new Uint8Array(S * S * 4) // RGBA, transparent par défaut

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const ramp = (stops, y) => {
  if (y <= stops[0][0]) return hex(stops[0][1])
  for (let i = 1; i < stops.length; i++) {
    if (y <= stops[i][0]) {
      const k = (y - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0])
      const a = hex(stops[i - 1][1]), b = hex(stops[i][1])
      return a.map((v, c) => v + (b[c] - v) * k)
    }
  }
  return hex(stops[stops.length - 1][1])
}
const INK = [[100, '#171719'], [300, '#111112'], [500, '#0d0d0e'], [700, '#0b0b0b'], [800, '#100c0b'], [860, '#150e0b'], [924, '#1c110c']]
const CHROME = [[230, '#ffffff'], [270, '#f8fafc'], [430, '#e7ebf1'], [590, '#9aa4b0'], [710, '#e0e5eb'], [780, '#edf0f5']]
const SUNSET = hex('#ff5a1f')
const EDGE = [0x35, 0x35, 0x35]

// distance signée à un rectangle arrondi (négative dedans)
const sdRound = (x, y, x0, y0, x1, y1, r) => {
  const qx = Math.abs(x - (x0 + x1) / 2) - (x1 - x0) / 2 + r
  const qy = Math.abs(y - (y0 + y1) / 2) - (y1 - y0) / 2 + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

// — l'onde : neuf capsules chromées, silhouette de morceau —
const BAR = 40, GAP = 20, FIRST = 232, MID = 490, MAX = 530
const HEIGHTS = [0.22, 0.46, 0.34, 0.72, 1.0, 0.62, 0.84, 0.4, 0.24]
const bars = HEIGHTS.map((h, i) => {
  const x0 = FIRST + i * (BAR + GAP)
  return [x0, MID - (h * MAX) / 2, x0 + BAR, MID + (h * MAX) / 2]
})

const sample = (x, y) => {
  const d = sdRound(x, y, 100, 100, 924, 924, 186)
  if (d > 0) return null
  if (Math.hypot(x - 768, y - 724) <= 32) return SUNSET
  for (const [x0, y0, x1, y1] of bars) {
    if (x >= x0 && x <= x1 && sdRound(x, y, x0, y0, x1, y1, BAR / 2) <= 0) return ramp(CHROME, y)
  }
  return d > -3 ? EDGE : ramp(INK, y)
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let n = 0, r = 0, g = 0, b = 0
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const c = sample(x + (i + 0.5) / 4, y + (j + 0.5) / 4)
        if (c) { n++; r += c[0]; g += c[1]; b += c[2] }
      }
    }
    if (!n) continue
    const k = (y * S + x) * 4
    px[k] = Math.round(r / n); px[k + 1] = Math.round(g / n); px[k + 2] = Math.round(b / n)
    px[k + 3] = Math.round((n / 16) * 255)
  }
}

// — encodage PNG minimal —
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8; ihdr[9] = 6 // 8 bits, RGBA
const raw = Buffer.alloc(S * (S * 4 + 1))
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', png)

// — iconset → icns (nécessite macOS) —
const dir = 'build/icon.iconset'
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
for (const size of [16, 32, 64, 128, 256, 512]) {
  execSync(`sips -z ${size} ${size} build/icon.png --out ${dir}/icon_${size}x${size}.png`, { stdio: 'ignore' })
  execSync(`sips -z ${size * 2} ${size * 2} build/icon.png --out ${dir}/icon_${size}x${size}@2x.png`, { stdio: 'ignore' })
}
execSync(`iconutil -c icns ${dir} -o build/icon.icns`)
rmSync(dir, { recursive: true, force: true })
console.log('✓ build/icon.icns généré')
