/**
 * Génère build/icon.icns sans aucune dépendance : on dessine l'icône pixel par
 * pixel (carré crème, bord encre, forme d'onde orange — l'ADN 2Listen), on
 * encode le PNG à la main (zlib + CRC), puis sips/iconutil (macOS) fabriquent
 * l'iconset.
 */
import { deflateSync } from 'node:zlib'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'

const S = 1024
const px = new Uint8Array(S * S * 4) // RGBA, transparent par défaut

const CREAM = [0xec, 0xe9, 0xe2, 255]
const INK = [0x11, 0x11, 0x11, 255]
const ORANGE = [0xff, 0x4d, 0x00, 255]

const put = (x, y, c) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return
  const i = (y * S + x) * 4
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3]
}

const rect = (x0, y0, x1, y1, c) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, c)
}

// — plaque : carré aux coins arrondis (marge macOS ~10 %) —
const M = 100, R = 180, B = 34 // marge, rayon, bordure
const inside = (x, y) => {
  const x0 = M, y0 = M, x1 = S - M, y1 = S - M
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return false
  const cx = Math.max(x0 + R, Math.min(x1 - R, x + 0.5))
  const cy = Math.max(y0 + R, Math.min(y1 - R, y + 0.5))
  const dx = x + 0.5 - cx, dy = y + 0.5 - cy
  return dx * dx + dy * dy <= R * R
}
const insideInner = (x, y) => {
  const x0 = M + B, y0 = M + B, x1 = S - M - B, y1 = S - M - B
  const r = R - B
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return false
  const cx = Math.max(x0 + r, Math.min(x1 - r, x + 0.5))
  const cy = Math.max(y0 + r, Math.min(y1 - r, y + 0.5))
  const dx = x + 0.5 - cx, dy = y + 0.5 - cy
  return dx * dx + dy * dy <= r * r
}
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++)
    if (inside(x, y)) put(x, y, insideInner(x, y) ? CREAM : INK)

// — forme d'onde : barres orange symétriques, silhouette organique —
const mid = S / 2
const bars = 23, bw = 22, gap = 8
const total = bars * bw + (bars - 1) * gap
const startX = Math.round((S - total) / 2)
// hauteurs façon morceau : intro, montée, drop, outro
const hs = [0.18, 0.30, 0.24, 0.46, 0.38, 0.62, 0.52, 0.78, 0.66, 0.92, 0.84, 1.0, 0.84, 0.92, 0.66, 0.78, 0.52, 0.62, 0.38, 0.46, 0.24, 0.30, 0.18]
const maxH = 300
hs.forEach((h, i) => {
  const x0 = startX + i * (bw + gap)
  const hh = Math.round(h * maxH)
  rect(x0, Math.round(mid - hh), x0 + bw, Math.round(mid + hh), i === 11 ? INK : ORANGE)
})
// ligne médiane encre
rect(M + B + 40, mid - 4, S - M - B - 40, mid + 4, INK)

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
