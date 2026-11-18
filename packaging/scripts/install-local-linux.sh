#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

INSTALL_APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/drivesync/app"
INSTALL_BIN="$HOME/.local/bin/drivesync"
UNINSTALL_BIN="$HOME/.local/bin/drivesync-uninstall"
DESKTOP_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/applications/drivesync.desktop"
ICON_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps/drivesync.png"
XDG_DATA_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}"
XDG_CFG_ROOT="${XDG_CONFIG_HOME:-$HOME/.config}"

if ! command -v electron >/dev/null 2>&1; then
  echo "ERRO: 'electron' não encontrado no sistema. Instale com: sudo pacman -S electron" >&2
  exit 1
fi

echo "[1/4] Compilando motor drivesyncd (Linux)..."
bash "$REPO_ROOT/packaging/scripts/build-engine.sh" current

echo "[2/4] Compilando frontend e processo principal Electron..."
(
  cd "$REPO_ROOT"
  npm run build --workspace=@drivesync/shared
  npm run build --workspace=@drivesync/desktop
)

echo "[3/4] Instalando arquivos em $INSTALL_APP_DIR..."
rm -rf "$INSTALL_APP_DIR"
mkdir -p "$INSTALL_APP_DIR/bin" "$INSTALL_APP_DIR/build" "$(dirname "$INSTALL_BIN")" "$(dirname "$DESKTOP_FILE")" "$(dirname "$ICON_FILE")"

cp -r "$REPO_ROOT/apps/desktop/dist" "$INSTALL_APP_DIR/"
cp -r "$REPO_ROOT/apps/desktop/dist-electron" "$INSTALL_APP_DIR/"
cp "$REPO_ROOT/apps/desktop/package.json" "$INSTALL_APP_DIR/"
cp "$REPO_ROOT/apps/desktop/build/icon.png" "$INSTALL_APP_DIR/build/icon.png"
cp "$REPO_ROOT/apps/desktop/resources/bin/linux/drivesyncd" "$INSTALL_APP_DIR/bin/drivesyncd"
chmod +x "$INSTALL_APP_DIR/bin/drivesyncd"

cat > "$UNINSTALL_BIN" <<EOF
#!/usr/bin/env bash
set -euo pipefail
PURGE_DATA=0
for arg in "\$@"; do
  case "\$arg" in
    --purge|--purge-data) PURGE_DATA=1 ;;
  esac
done
pkill -f "/.local/share/drivesync/[b]in/drivesyncd" >/dev/null 2>&1 || true
pkill -f "/.local/share/drivesync/[a]pp" >/dev/null 2>&1 || true
rm -rf "$XDG_DATA_ROOT/drivesync"
rm -f "$INSTALL_BIN" "$UNINSTALL_BIN" "$DESKTOP_FILE" "$ICON_FILE" "$XDG_CFG_ROOT/autostart/drivesync.desktop"
if [ "\$PURGE_DATA" -eq 1 ]; then
  rm -rf "$XDG_CFG_ROOT/DriveSync"
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$XDG_DATA_ROOT/applications" >/dev/null 2>&1 || true
fi
if command -v notify-send >/dev/null 2>&1; then
  notify-send "DriveSync desinstalado" "O aplicativo foi removido. Suas pastas sincronizadas permanecem intactas." >/dev/null 2>&1 || true
fi
echo "DriveSync removido com sucesso (suas pastas sincronizadas permanecem intactas)."
EOF
chmod +x "$UNINSTALL_BIN"

cat > "$INSTALL_BIN" <<EOF
#!/usr/bin/env bash
case "\${1:-}" in
  --uninstall-cli)
    exec "$UNINSTALL_BIN"
    ;;
  --purge-cli)
    exec "$UNINSTALL_BIN" --purge
    ;;
esac
export DRIVESYNC_ENGINE_BIN="$INSTALL_APP_DIR/bin/drivesyncd"
exec electron --ozone-platform-hint=auto --class=DriveSync "$INSTALL_APP_DIR" "\$@"
EOF
chmod +x "$INSTALL_BIN"

echo "[4/4] Registrando ícone e atalho do menu ($DESKTOP_FILE)..."
cp "$REPO_ROOT/apps/desktop/build/icon.png" "$ICON_FILE"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=DriveSync
GenericName=Sincronizador Google Drive
Comment=Sincronização simples com Google Drive, modo Master e trava de 4 GB
Exec=$INSTALL_BIN %U
Icon=$ICON_FILE
Terminal=false
Categories=Network;FileTransfer;Utility;
StartupWMClass=DriveSync
StartupNotify=true
Actions=Uninstall;

[Desktop Action Uninstall]
Name=Desinstalar DriveSync
Exec=$INSTALL_BIN --uninstall
Icon=user-trash
EOF

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$(dirname "$DESKTOP_FILE")" >/dev/null 2>&1 || true
fi

echo "Instalação concluída!"
echo "  Executável:    $INSTALL_BIN"
echo "  Desinstalador: $UNINSTALL_BIN"
echo "  Atalho:        $DESKTOP_FILE"
echo "  Inicie com:    drivesync"
