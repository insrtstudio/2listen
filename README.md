# 2Listen

Lecteur de musique **locale** et **lossless** pour macOS — brutaliste, rapide, hors ligne.

![2Listen](build/icon.png)

## Fonctionnalités

- **Lossless d'abord** : FLAC, ALAC, WAV, AIFF lus tels quels (badge qualité `FLAC · 24/96`), plus MP3/AAC/OGG/Opus.
- **Bibliothèque** : ajoutez des dossiers, scan incrémental (les fichiers inchangés ne sont jamais relus), pochettes extraites et mises en cache, vues Pistes / Albums / Artistes, recherche instantanée (⌘F), tri par colonne.
- **Playlists** : création, renommage, réordonnancement par glisser-déposer, ajout via clic droit multi-sélection (⇧ / ⌘).
- **Waveform haute définition** : 2048 buckets min/max + RMS calculés dans un Web Worker, cache disque, seek au clic/glisser, prévisualisation du temps au survol.
- **Lecture** : gapless (piste suivante préchargée), aléatoire, répétition, notes ★, compteur d'écoutes, raccourcis (Espace, Entrée, ↑/↓), touches média macOS.
- **Deux thèmes** : Jour (papier crème) / Nuit — même ADN brutaliste que 2DL.
- **Mise à jour automatique** : chaque push sur `main` publie une release GitHub que l'app détecte toute seule.
- **Performances** : liste virtualisée (50 000 pistes fluides), position de lecture hors React, écritures disque débattues.

## Développement

```bash
npm install
npm run dev        # electron-vite HMR
npm run typecheck
npm run dist       # build + .zip (dist/)
npm run dmg        # .dmg stylisé (fond de marque, glisser vers Applications)
```

### Tests e2e

Le harnais `TL_E2E` pilote l'app réelle (DOM + captures d'écran) :

```bash
npm run build
TL_E2E="$PWD/scripts/e2e.js" TL_E2E_OUT=/tmp npx electron .
```

Scénario couvert : bibliothèque, lecture, tri, recherche, menu contextuel,
création de playlist, albums/artistes, raccourcis clavier, seek waveform,
scan incrémental.

## Release automatique

Le workflow `.github/workflows/release.yml` se déclenche à chaque push sur `main` :

1. version auto-incrémentée `0.1.<numéro de run>` (strictement croissante) ;
2. build `.zip` (arm64 + x64) pour l'auto-update, publiés par electron-builder ;
3. build des `.dmg` stylisés (`scripts/make-dmg.sh` : fond de marque rendu par
   Electron, `.DS_Store` écrit par le Finder) attachés à la même release ;
4. `electron-updater` détecte la release au prochain lancement (vérification toutes les 30 min).

Prérequis : créer le dépôt GitHub et faire correspondre `publish.owner/repo`
dans `electron-builder.yml` **et** `REPO_URL` dans `src/main/index.ts`.

### Signature (optionnel mais recommandé)

Sans certificat *Developer ID*, macOS affiche l'avertissement Gatekeeper au premier
lancement (clic droit → Ouvrir) et l'installation silencieuse des mises à jour est
impossible : l'app bascule alors sur un badge « MAJ dispo — télécharger » qui ouvre
la page de release. Avec un certificat, ajoutez les secrets `CSC_LINK` /
`CSC_KEY_PASSWORD` au dépôt et retirez `identity: null` + `CSC_IDENTITY_AUTO_DISCOVERY`.

## Notes techniques

- Les fichiers audio sont servis au renderer par un protocole custom `tl://` avec
  support des requêtes `Range` (seek instantané) et liste blanche des dossiers de
  la bibliothèque.
- La bibliothèque est un JSON en mémoire écrit de façon atomique et débattue
  (`~/Library/Application Support/2Listen/`).
- Si l'interface audio par défaut du système ne répond pas (certaines interfaces
  pro >32 canaux, périphérique éteint), l'app l'affiche clairement au lieu de
  rester muette.
