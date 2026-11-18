#!/usr/bin/env bash
set -euo pipefail

PURGE_DATA=0
for arg in "$@"; do
  case "$arg" in
    --purge|--purge-data)
      PURGE_DATA=1
      ;;
  esac
done

pkill -f "/home/brendha/.local/share/drivesync/[b]in/drivesyncd" >/dev/null 2>&1 || true
pkill -f "/.local/share/drivesync/[a]pp" >/dev/null 2>&1 || true

rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/drivesync"
rm -f "$HOME/.local/bin/drivesync"
rm -f "$HOME/.local/bin/drivesync-uninstall"
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/applications/drivesync.desktop"
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps/drivesync.png"
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/drivesync.desktop"

if [ "$PURGE_DATA" -eq 1 ]; then
  rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/DriveSync"
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${XDG_DATA_HOME:-$HOME/.local/share}/applications" >/dev/null 2>&1 || true
fi

if command -v notify-send >/dev/null 2>&1; then
  notify-send "DriveSync desinstalado" "O aplicativo foi removido. Suas pastas sincronizadas permanecem intactas." >/dev/null 2>&1 || true
fi

if [ "$PURGE_DATA" -eq 1 ]; then
  echo "DriveSync e configurações locais do usuário removidos (suas pastas de arquivos sincronizados não foram apagadas)."
else
  echo "DriveSync removido da instalação local do usuário (suas pastas sincronizadas e configurações não foram apagadas)."
fi
