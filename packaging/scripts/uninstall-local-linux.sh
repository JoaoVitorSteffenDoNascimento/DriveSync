#!/usr/bin/env bash
set -euo pipefail

rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/drivesync"
rm -f "$HOME/.local/bin/drivesync"
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/applications/drivesync.desktop"
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps/drivesync.png"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${XDG_DATA_HOME:-$HOME/.local/share}/applications" >/dev/null 2>&1 || true
fi

echo "DriveSync removido da instalação local do usuário (suas pastas sincronizadas e configurações não foram apagadas)."
