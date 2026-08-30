# 2Listen — lecteur lossless local (Electron)

Stack : electron-vite + React 18 + TypeScript strict, zéro dépendance UI. electron-builder (dmg+zip, non signé), electron-updater via GitHub Releases, versions CI `0.1.<run_number>`.

Design : ADN brutaliste 2DL — papier `#ece9e2`, encre `#111`, accent `#ff4d00`, Space Grotesk / Fragment Mono / Instrument Serif, bordures 2/4 px, thème sombre via `[data-theme="dark"]` sur `:root` (variables dans `src/renderer/src/styles.css`).

Architecture :
- `src/main/` — store JSON débattu/atomique, scan incrémental (mtime+size), protocole `tl://` (Range + liste blanche), updater, IPC.
- `src/preload/index.ts` — API `window.tl` typée (types partagés dans `src/shared/types.ts`).
- Mode streamer (`components/StreamerView.tsx`) : overlay plein écran, scène Instagram (4:5, 1:1, 9:16) rendue dans un canvas 1080 px par `lib/stage.ts` (titre, webcam, waveform via `lib/wavedraw.ts`, BPM/tonalité de `lib/analysis.ts`) ; `lib/recorder.ts` enregistre `canvas.captureStream` + prise audio sur le graphe de `lib/rta.ts` (gain 1/volume) en MP4 H.264/AAC natif (MediaRecorder, fMP4) ; les morceaux sont écrits en flux par le main (`clip:*`), puis dialogue d'export. La fenêtre est verrouillée au ratio de la scène (`win:streamer`, `setAspectRatio`).
- `src/renderer/` — `lib/player.ts` (singleton hors React, 2 `<audio>` alternés pour le gapless, position jamais dans l'état React), `lib/peaks.ts` (décodage OfflineAudioContext → worker → cache disque, 2048 buckets min/max/rms), `TrackTable` virtualisé maison.

Pièges connus :
- `window.prompt` n'existe pas dans Electron — toujours des inputs inline.
- `music-metadata` et `electron-updater` sont bundlés dans le main (exclude de `externalizeDepsPlugin`) car `node_modules` n'est pas packagé ; tsconfig.node.json a `customConditions: ["node"]` pour les types de music-metadata.
- Interfaces audio pro >32 canaux : Chromium ne peut pas ouvrir la sortie → détection de stall dans le player + bannière. `ChromeWideEchoCancellation` désactivé dans le main.
- Debug : `TL_CLIP_OUT=/x.mp4` exporte le clip streamer sans dialogue (tests e2e). `TL_SHOT=/x.png TL_SHOT_DELAY=6000 TL_AUTOPLAY=1 npx electron .` capture l'écran puis quitte (userData dev = `~/Library/Application Support/2Listen`).

Commandes : `npm run dev` / `npm run typecheck` / `npm run dist` (local) / `npm run release` (CI).
