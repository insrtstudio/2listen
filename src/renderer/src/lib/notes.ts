/** Conversion fréquence → note (notation française), façon EQ Eight. */
const NAMES = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si']

export interface NoteInfo {
  name: string
  octave: number
  /** écart en cents à la note juste (−50…+50) */
  cents: number
}

export function freqToNote(f: number): NoteInfo | null {
  if (!Number.isFinite(f) || f < 16 || f > 22000) return null
  const midi = Math.round(69 + 12 * Math.log2(f / 440))
  const exact = 440 * Math.pow(2, (midi - 69) / 12)
  return {
    name: NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    cents: Math.round(1200 * Math.log2(f / exact))
  }
}

/** « Sol#4 +12 ¢ » (cents omis sous ±5). */
export function fmtNote(f: number): string {
  const n = freqToNote(f)
  if (!n) return ''
  const cents = Math.abs(n.cents) >= 5 ? ` ${n.cents > 0 ? '+' : ''}${n.cents}¢` : ''
  return `${n.name}${n.octave}${cents}`
}
