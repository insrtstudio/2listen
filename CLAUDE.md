# 2Listen — lecteur lossless local (Electron)

Stack : electron-vite + React 18 + TypeScript strict, zéro dépendance UI. electron-builder (dmg+zip, non signé), electron-updater via GitHub Releases, versions CI `0.1.<run_number>`.

Design : shell macOS 26 « Tahoe » (Liquid Glass) sur l'identité 2DL, mêmes jetons que 2Edit et PiersCRM — accent `#ff4d00`, Space Grotesk / Fragment Mono / Instrument Serif (`@fontsource`, aucun réseau), thème via `data-theme` (`:root`, ou l'overlay streamer qui a le sien) et `nativeTheme.themeSource` pour que vibrancy et feux suivent. Fenêtre `vibrancy: 'sidebar'` + fond transparent, feux à x22 y22 ; `.sidebar` est la seule zone qui laisse voir la vibrancy, son ombre étalée peint `--window-bg` partout ailleurs (d'où `.maincol` en z-index 1, et les modales de la barre latérale en portail). Cartes 12 px (`.card`), gouttières 8 px, capsules (`.blk`), segmentés (`.seg`), interrupteurs (`.switch`), groupes façon Réglages Système (`.group`), verre CSS sur menus/modales (`.ctxmenu`, `.glass`), jamais au-dessus d'un canvas animé. Couleurs en hexa obligatoires (`lib/wavedraw.ts` les décompose). L'orange signale ce qui est actif, pas la décoration. La scène streamer (canvas exporté en clip) suit les mêmes jetons, en cartes mises à l'échelle 1080 px ; seul son fond est à part (`--scene-bg`, opaque car le canvas n'a pas d'alpha). Vues : le titre et les actions vivent dans la barre d'outils (`Header.tsx`) ; la recherche n'apparaît que là où elle filtre ; tout ce qui ne sert pas à écouter est dans Réglages (`SettingsSheet.tsx`, ⌘,).

Architecture :
- `src/main/` — store JSON débattu/atomique, scan incrémental (mtime+size), protocole `tl://` (Range + liste blanche), updater, IPC.
- `src/preload/index.ts` — API `window.tl` typée (types partagés dans `src/shared/types.ts`).
- Mode streamer (`components/StreamerView.tsx`) : overlay plein écran, scène Instagram (4:5, 1:1, 9:16) rendue dans un canvas 1080 px par `lib/stage.ts` (titre, webcam, waveform via `lib/wavedraw.ts`, BPM/tonalité de `lib/analysis.ts`) ; `lib/recorder.ts` enregistre `canvas.captureStream` + prise audio sur le graphe de `lib/rta.ts` (gain 1/volume) en MP4 H.264/AAC natif (MediaRecorder, fMP4) ; les morceaux sont écrits en flux par le main (`clip:*`), puis dialogue d'export. La fenêtre est verrouillée au ratio de la scène (`win:streamer`, `setAspectRatio`).
- `src/renderer/` — `lib/player.ts` (singleton hors React, 2 `<audio>` alternés pour le gapless, position jamais dans l'état React), `lib/peaks.ts` (décodage OfflineAudioContext → worker → cache disque, 2048 buckets min/max/rms), `TrackTable` virtualisé maison.

Pièges connus :
- `window.prompt` n'existe pas dans Electron — toujours des inputs inline.
- `music-metadata` et `electron-updater` sont bundlés dans le main (exclude de `externalizeDepsPlugin`) car `node_modules` n'est pas packagé ; tsconfig.node.json a `customConditions: ["node"]` pour les types de music-metadata.
- Interfaces audio pro >32 canaux : Chromium ne peut pas ouvrir la sortie → détection de stall dans le player + bannière. `ChromeWideEchoCancellation` désactivé dans le main.
- `TL_E2E` lance l'app invisible, sans focus ni son (`scripts/e2e.js` passe même pendant une session de travail) ; capturer avec `webContents.capturePage`, jamais `screencapture` (il prend ce qui est devant à l'écran). La vibrancy n'apparaît pas dans ces captures.
- Debug : `TL_CLIP_OUT=/x.mp4` exporte le clip streamer sans dialogue (tests e2e). `TL_SHOT=/x.png TL_SHOT_DELAY=6000 TL_AUTOPLAY=1 npx electron .` capture l'écran puis quitte (userData dev = `~/Library/Application Support/2Listen`).

Commandes : `npm run dev` / `npm run typecheck` / `npm run dist` (local) / `npm run release` (CI).
