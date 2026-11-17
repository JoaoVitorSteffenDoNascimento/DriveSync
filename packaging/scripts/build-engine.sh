#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENGINE_DIR="$REPO_ROOT/apps/engine"
OUT_DESKTOP_BIN="$REPO_ROOT/apps/desktop/resources/bin"
OUT_ENGINE_BIN="$ENGINE_DIR/bin"

TARGET="${1:-current}"

mkdir -p "$OUT_DESKTOP_BIN" "$OUT_ENGINE_BIN"

build_target() {
  local goos="$1"
  local goarch="$2"
  local ext=""
  if [[ "$goos" == "windows" ]]; then
    ext=".exe"
  fi
  local bin_name="drivesyncd${ext}"
  local ldflags="-s -w"
  if [[ -n "${DRIVESYNC_GOOGLE_CLIENT_ID:-}" ]]; then
    ldflags="$ldflags -X 'github.com/brendha/drivesync/engine/internal/drive.BuildGoogleClientID=${DRIVESYNC_GOOGLE_CLIENT_ID}'"
  fi
  if [[ -n "${DRIVESYNC_GOOGLE_CLIENT_SECRET:-}" ]]; then
    ldflags="$ldflags -X 'github.com/brendha/drivesync/engine/internal/drive.BuildGoogleClientSecret=${DRIVESYNC_GOOGLE_CLIENT_SECRET}'"
  fi

  echo "[build-engine] Compilando $goos/$goarch -> $bin_name"
  (
    cd "$ENGINE_DIR"
    GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 \
      go build -buildvcs=false -trimpath -ldflags="$ldflags" -o "$OUT_ENGINE_BIN/${goos}-${goarch}-${bin_name}" ./cmd/drivesyncd
  )

  local os_subdir="linux"
  if [[ "$goos" == "windows" ]]; then
    os_subdir="win"
  fi
  mkdir -p "$OUT_DESKTOP_BIN/$os_subdir"

  # Copia o binário esperado para o empacotamento atual em apps/desktop/resources/bin/<os>
  cp "$OUT_ENGINE_BIN/${goos}-${goarch}-${bin_name}" "$OUT_DESKTOP_BIN/$os_subdir/$bin_name"
  cp "$OUT_ENGINE_BIN/${goos}-${goarch}-${bin_name}" "$OUT_ENGINE_BIN/$bin_name"
  if [[ "$goos" != "windows" ]]; then
    chmod +x "$OUT_DESKTOP_BIN/$os_subdir/$bin_name" "$OUT_ENGINE_BIN/$bin_name"
  fi
}

case "$TARGET" in
  current)
    HOST_OS="$(go env GOOS)"
    HOST_ARCH="$(go env GOARCH)"
    build_target "$HOST_OS" "$HOST_ARCH"
    ;;
  linux)
    build_target linux amd64
    ;;
  linux-arm64)
    build_target linux arm64
    ;;
  windows)
    build_target windows amd64
    ;;
  all)
    build_target linux amd64
    build_target windows amd64
    ;;
  *)
    echo "Uso: $0 [current|linux|linux-arm64|windows|all]" >&2
    exit 2
    ;;
esac
