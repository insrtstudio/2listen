#!/usr/bin/env bash
# DMG stylisé 2Listen : fond de marque + icônes positionnées, .DS_Store écrit
# par le Finder lui-même (l'alias de fond généré par electron-builder est cassé
# sur les macOS récents).
# Usage : scripts/make-dmg.sh <chemin .app> <version> <sortie .dmg>
set -euo pipefail

APP="$1"
VERSION="$2"
OUT="$3"
VOL="2Listen ${VERSION}"
# fond fourni en @2x : le Finder le rend a la taille logique 660x420
BG="build/dmg-bg@2x.png"

STAGE="$(mktemp -d)/2Listen"
RW="$(mktemp -d)/rw.dmg"
trap 'hdiutil detach "/Volumes/${VOL}" >/dev/null 2>&1 || true' EXIT

mkdir -p "${STAGE}/.background"
cp -R "${APP}" "${STAGE}/"
ln -s /Applications "${STAGE}/Applications"
cp "${BG}" "${STAGE}/.background/background.png"
cp build/icon.icns "${STAGE}/.VolumeIcon.icns"

hdiutil create -quiet -format UDRW -fs HFS+ -volname "${VOL}" -srcfolder "${STAGE}" "${RW}"
hdiutil attach -quiet "${RW}" -noautoopen
# icône de volume (SetFile si dispo, sinon tant pis)
SetFile -a C "/Volumes/${VOL}" 2>/dev/null || true

# le Finder écrit un .DS_Store dont l'alias de fond est valide
osascript <<APPLESCRIPT
tell application "Finder"
  tell disk "${VOL}"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {200, 140, 860, 588}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 100
    set text size of viewOptions to 12
    set background picture of viewOptions to file ".background:background.png"
    set position of item "2Listen.app" of container window to {170, 265}
    set position of item "Applications" of container window to {490, 265}
    close
    open
    update without registering applications
    delay 2
    close
  end tell
end tell
APPLESCRIPT
sync
hdiutil detach -quiet "/Volumes/${VOL}"

rm -f "${OUT}"
hdiutil convert -quiet -format UDZO -imagekey zlib-level=9 -o "${OUT}" "${RW}"
rm -f "${RW}"
echo "✓ ${OUT}"
