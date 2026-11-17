#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/_common.sh
source "$SCRIPT_DIR/_common.sh"

NUVEM_LOCAL_DIR="${NUVEM_LOCAL_DIR:-$HOME/Nuvem}"
NUVEM_DEBOUNCE_SEC="${NUVEM_DEBOUNCE_SEC:-5}"
NUVEM_WATCH_EVENTS="${NUVEM_WATCH_EVENTS:-close_write,moved_to,moved_from,delete}"
NUVEM_WATCH_EXCLUDE="${NUVEM_WATCH_EXCLUDE:-(/\.git/|/node_modules/|/\.venv/|/venv/|/__pycache__/|/dist/|/build/|/target/|/\.next/|/\.Trash-[0-9]+/|/Cache/|/Code Cache/|/GPUCache/|\.tmp$|\.swp$|\.swo$|~$|\.part$|\.crdownload$|/\.DS_Store$|/Thumbs\.db$)}"
NUVEM_SYNC_SERVICE="${NUVEM_SYNC_SERVICE:-nuvem-bisync.service}"
NUVEM_STATE_DIR="${NUVEM_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}}"
NUVEM_WATCH_LOG_FILE="${NUVEM_WATCH_LOG_FILE:-$NUVEM_STATE_DIR/nuvem-watcher.log}"

mkdir -p "$NUVEM_STATE_DIR" "$(dirname "$NUVEM_WATCH_LOG_FILE")"

if ! require_commands inotifywait; then
  log_msg "ERROR" "Pacote inotify-tools não encontrado (instale com: sudo pacman -S inotify-tools)." | tee -a "$NUVEM_WATCH_LOG_FILE" >&2
  exit 1
fi

if [[ ! -d "$NUVEM_LOCAL_DIR" ]]; then
  log_msg "ERROR" "Diretório monitorado não existe: $NUVEM_LOCAL_DIR" | tee -a "$NUVEM_WATCH_LOG_FILE" >&2
  exit 1
fi

trigger_sync() {
  if [[ -n "${NUVEM_TRIGGER_CMD:-}" ]]; then
    log_msg "INFO" "Disparando comando customizado: $NUVEM_TRIGGER_CMD" >> "$NUVEM_WATCH_LOG_FILE"
    bash -c "$NUVEM_TRIGGER_CMD" >> "$NUVEM_WATCH_LOG_FILE" 2>&1 || \
      log_msg "WARN" "Comando de sync retornou erro." >> "$NUVEM_WATCH_LOG_FILE"
    return 0
  fi

  log_msg "INFO" "Alteração detectada; acionando $NUVEM_SYNC_SERVICE" >> "$NUVEM_WATCH_LOG_FILE"
  if ! systemctl --user start "$NUVEM_SYNC_SERVICE" >> "$NUVEM_WATCH_LOG_FILE" 2>&1; then
    log_msg "WARN" "Falha ao acionar $NUVEM_SYNC_SERVICE via systemctl --user." >> "$NUVEM_WATCH_LOG_FILE"
  fi
}

log_msg "INFO" "Monitorando '$NUVEM_LOCAL_DIR' (eventos=$NUVEM_WATCH_EVENTS, debounce=${NUVEM_DEBOUNCE_SEC}s)" >> "$NUVEM_WATCH_LOG_FILE"

exec 3< <(inotifywait -m -r -q -e "$NUVEM_WATCH_EVENTS" --exclude "$NUVEM_WATCH_EXCLUDE" --format '%w%f' "$NUVEM_LOCAL_DIR")
INOTIFY_PID=$!

cleanup() {
  exec 3<&- || true
  if kill -0 "$INOTIFY_PID" >/dev/null 2>&1; then
    kill "$INOTIFY_PID" >/dev/null 2>&1 || true
    wait "$INOTIFY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

while IFS= read -r changed_path <&3; do
  log_msg "DEBUG" "Evento inicial em: $changed_path" >> "$NUVEM_WATCH_LOG_FILE"
  # Trailing-edge debounce: aguarda janela silenciosa antes de sincronizar
  while IFS= read -r -t "$NUVEM_DEBOUNCE_SEC" _queued <&3; do
    :
  done
  trigger_sync
done

wait "$INOTIFY_PID" 2>/dev/null
rc=$?
if (( rc != 0 )); then
  log_msg "ERROR" "inotifywait encerrou inesperadamente (código $rc)." | tee -a "$NUVEM_WATCH_LOG_FILE" >&2
fi
exit "$rc"
