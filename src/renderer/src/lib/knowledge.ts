import type { AnalysisData } from '@shared/types'
import { fmtNote, freqToNote } from './notes'

/**
 * Repères de mixage/mastering pour la musique électronique, condensés depuis
 * la presse spécialisée et la pratique des studios de mastering club
 * (Sound on Sound, iZotope/Tonal Balance, Riemann Kollektion, guides de
 * mastering techno/house) :
 *  – club master : −8 à −6 LUFS-I (peak techno −6/−7, minimal/dub −8/−10) ;
 *    au-delà de −6, la dynamique y passe ; streaming normalisé ≈ −14 →
 *    deux masters sont devenus le standard
 *  – true peak ≤ −1 dBTP pour l'encodage streaming (Amazon −2)
 *  – PLR moderne club : ~6–9 dB ; < 5 = écrasé
 *  – graves mono sous 80–120 Hz (exigence club/vinyle, pas un choix de style)
 *  – kick : fondamentale 40–60 Hz (techno/house : 40–50), accordée à la
 *    tonalité (tonique ou quinte) sinon kick et bass se battent
 *  – couper sous ~30 Hz : le rumble inaudible fait pomper le limiteur
 *  – boxiness/mud : 200–500 Hz ; dureté : 2–5 kHz ; air : > 10 kHz
 *  – pente spectrale globale légèrement descendante (~3 dB/octave, type
 *    bruit rose) = équilibre tonal attendu
 */

/** Moyenne (dB) du spectre entre f0 et f1. */
function bandAvg(a: AnalysisData, f0: number, f1: number): number {
  let sum = 0
  let cnt = 0
  a.freqs.forEach((f, i) => {
    if (f >= f0 && f < f1) {
      sum += a.spectrum[i]
      cnt++
    }
  })
  return cnt > 0 ? sum / cnt : -120
}

/** Fréquence du pic d'énergie dans la zone kick/sub (35–95 Hz). */
export function lowFundamental(a: AnalysisData): number | null {
  let best = -1
  let bestV = -120
  a.freqs.forEach((f, i) => {
    if (f >= 35 && f <= 95 && a.spectrum[i] > bestV) {
      bestV = a.spectrum[i]
      best = f
    }
  })
  if (best < 0) return null
  // le pic doit dominer son voisinage pour être une vraie fondamentale
  return bestV > bandAvg(a, 100, 200) + 3 ? best : null
}

/** Classes de hauteur (0 = Do) de la tonique et de la quinte de la tonalité détectée. */
function keyPitchClasses(keyName: string): [number, number] | null {
  const NAMES = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si']
  const root = NAMES.findIndex((n) => keyName.startsWith(n + ' ') || keyName === n)
  if (root < 0) return null
  return [root, (root + 7) % 12]
}

/**
 * Observations « club électro » absolues sur un morceau (indépendantes de la
 * référence) — chaque règle ne parle que si la mesure la déclenche.
 */
export function clubAssessment(a: AnalysisData): string[] {
  const out: string[] = []

  // — loudness —
  if (a.lufsI > -6)
    out.push(
      `${a.lufsI.toFixed(1)} LUFS : au-delà de −6, la presse mastering est unanime — la dynamique y passe pour un volume que le streaming annulera. Zone club recommandée : −8 à −6 LUFS.`
    )
  else if (a.lufsI >= -8) out.push(`${a.lufsI.toFixed(1)} LUFS : dans la zone club (−8 à −6) — calibré pour un système de club.`)
  else if (a.lufsI >= -10)
    out.push(`${a.lufsI.toFixed(1)} LUFS : zone minimal/dub (−8 à −10) — cohérent si les respirations font partie du genre.`)
  else if (a.lufsI > -16)
    out.push(
      `${a.lufsI.toFixed(1)} LUFS : sous le standard club — parfait pour le streaming normalisé (≈ −14), mais prévoyez un second master club : deux masters, c'est devenu la norme.`
    )

  if (a.truePeakDb > -0.3)
    out.push(`True peak ${a.truePeakDb.toFixed(1)} dBTP : l'encodage (streaming, MP3) va écrêter — visez ≤ −1 dBTP.`)
  if (a.plr < 5)
    out.push(`PLR ${a.plr.toFixed(1)} dB : master écrasé (repère club moderne : 6–9 dB) — essayez la compression parallèle sur le bus batterie plutôt que d'écraser le master.`)

  // — bas du spectre —
  const rumble = bandAvg(a, 20, 30)
  const subRef = bandAvg(a, 40, 80)
  if (rumble > subRef - 6)
    out.push(`Énergie notable sous 30 Hz (rumble) : inaudible en club mais fait pomper le limiteur — coupez sous ~30 Hz.`)

  const fund = lowFundamental(a)
  if (fund) {
    const note = freqToNote(fund)
    const pcs = keyPitchClasses(a.keyName)
    if (note && pcs) {
      const NAMES = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si']
      const pc = NAMES.indexOf(note.name)
      const inKey = pc === pcs[0] || pc === pcs[1]
      if (inKey) {
        out.push(`Fondamentale kick/sub ≈ ${Math.round(fund)} Hz (${fmtNote(fund)}) — accordée à la tonalité (${a.keyName}) ✓.`)
      } else {
        out.push(
          `Fondamentale kick/sub ≈ ${Math.round(fund)} Hz (${fmtNote(fund)}) alors que la tonalité détectée est ${a.keyName} : kick et bass risquent de se battre — accordez le kick sur la tonique ou la quinte.`
        )
      }
    }
    if (fund > 60)
      out.push(`Fondamentale grave à ${Math.round(fund)} Hz : haut pour du club (repère techno/house : 40–60 Hz) — le sub paraîtra léger sur un gros système.`)
  }

  if (a.widthLowDb > -15)
    out.push(`Graves larges (S/M ${a.widthLowDb.toFixed(0)} dB) : sous 80–120 Hz le mono n'est pas un choix esthétique, c'est une exigence club/vinyle.`)

  // — zones à problème (relatif au voisinage spectral) —
  const mud = bandAvg(a, 200, 500)
  const around = (bandAvg(a, 100, 200) + bandAvg(a, 500, 1000)) / 2
  if (mud > around + 3.5)
    out.push(`Bosse de ${(mud - around).toFixed(1)} dB entre 200 et 500 Hz : zone « mud/boxiness » — un cut doux de 2–3 dB y clarifie souvent tout le mix.`)

  const harsh = bandAvg(a, 2000, 5000)
  const harshRef = (bandAvg(a, 800, 2000) + bandAvg(a, 5000, 9000)) / 2
  if (harsh > harshRef + 4)
    out.push(`Zone 2–5 kHz saillante (+${(harsh - harshRef).toFixed(1)} dB vs voisinage) : dureté à l'oreille — c'est là que la fatigue d'écoute se joue.`)

  // — pente globale —
  const lowRef = bandAvg(a, 60, 250)
  const highRef = bandAvg(a, 4000, 12000)
  const slope = (lowRef - highRef) / Math.log2(8000 / 120) // dB/octave approx
  if (slope < 1)
    out.push(`Pente spectrale quasi plate (${slope.toFixed(1)} dB/oct) : plus brillant que l'équilibre type bruit rose (~3 dB/oct) attendu en électro — vérifiez la dureté des aigus.`)
  else if (slope > 5.5)
    out.push(`Pente spectrale très raide (${slope.toFixed(1)} dB/oct) : le haut du spectre manque d'air par rapport aux références du genre.`)

  return out
}

/** Ligne de sources, affichée sous les repères. */
export const KNOWLEDGE_SOURCES =
  'Repères : Sound on Sound (Mixing Bass, pink-noise reference), iZotope Tonal Balance, Riemann Kollektion & guides de mastering techno/house (LUFS club, PLR, mono < 120 Hz, kick 40–60 Hz accordé).'
