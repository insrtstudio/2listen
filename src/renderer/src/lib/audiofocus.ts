/**
 * Arbitre audio : une seule « scène » sonore à la fois (lecteur principal,
 * platines de mix, prévisualisation corrigée). Quand une scène démarre,
 * les autres se mettent en pause.
 */
type Pause = () => void

const registry = new Map<string, Pause>()

export function registerScene(name: string, pause: Pause): void {
  registry.set(name, pause)
}

export function claimScene(name: string): void {
  for (const [key, pause] of registry) {
    if (key !== name) pause()
  }
}
