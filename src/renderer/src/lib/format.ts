export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

export function fmtTotal(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`
  return `${m} min`
}

export function fmtSize(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(2)} Go`
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} Mo`
  return `${Math.round(bytes / 1024)} Ko`
}

import type { Track } from '@shared/types'

/** « FLAC · 24/96 » ou « MP3 · 320 kbps » */
export function fmtQuality(t: Track): string {
  if (t.lossless) {
    const bits = t.bitsPerSample || 16
    const khz = t.sampleRate ? +(t.sampleRate / 1000).toFixed(1).replace(/\.0$/, '') : '?'
    return `${t.codec} · ${bits}/${khz}`
  }
  return t.bitrate ? `${t.codec} · ${t.bitrate} kbps` : t.codec
}
