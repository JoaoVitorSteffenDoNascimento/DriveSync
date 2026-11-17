#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/_common.sh
source "$SCRIPT_DIR/_common.sh"

NUVEM_LOCAL_DIR="${NUVEM_LOCAL_DIR:-$HOME/Nuvem}"
NUVEM_REMOTE="${NUVEM_REMOTE:-gdrive:Sync}"
NUVEM_FILTERS_FILE="${NUVEM_FILTERS_FILE:-$REPO_ROOT/config/sync-filters.txt}"
NUVEM_STATE_DIR="${NUVEM_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}}"
NUVEM_LOG_FILE="${NUVEM_LOG_FILE:-$NUVEM_STATE_DIR/nuvem-sync.log}"
NUVEM_STATUS_FILE="${NUVEM_STATUS_FILE:-$NUVEM_STATE_DIR/nuvem-status.json}"
NUVEM_LOCK_FILE="${NUVEM_LOCK_FILE:-$NUVEM_STATE_DIR/nuvem-bisync.lock}"
NUVEM_QUARENTENA_LOCAL="${NUVEM_QUARENTENA_LOCAL:-$NUVEM_STATE_DIR/nuvem-quarentena}"
NUVEM_QUARENTENA_REMOTE="${NUVEM_QUARENTENA_REMOTE:-gdrive:Quarentena}"
NUVEM_MAX_DELETE="${NUVEM_MAX_DELETE:-15}"
NUVEM_MAX_LOCK="${NUVEM_MAX_LOCK:-2m}"

RUN_DATE="$(date +%F)"
BACKUP_DIR1="${NUVEM_BACKUP_DIR1:-${NUVEM_QUARENTENA_LOCAL%/}/$RUN_DATE}"
BACKUP_DIR2="${NUVEM_BACKUP_DIR2:-${NUVEM_QUARENTENA_REMOTE%/}/$RUN_DATE}"

mkdir -p "$NUVEM_STATE_DIR" "$(dirname "$NUVEM_LOG_FILE")" "$(dirname "$NUVEM_LOCK_FILE")"

exec 9>"$NUVEM_LOCK_FILE"
if ! flock -n 9; then
  log_msg "INFO" "Outro processo nuvem-bisync já está em execução; ignorando disparo concorrente." >> "$NUVEM_LOG_FILE"
  exit 0
fi

is_dry_run="false"
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" || "$arg" == "-n" ]]; then
    is_dry_run="true"
    break
  fi
done
if [[ "${NUVEM_DRY_RUN:-0}" == "1" ]]; then
  is_dry_run="true"
fi

build_extra_json() {
  python3 - "$NUVEM_LOCAL_DIR" "$NUVEM_REMOTE" "$is_dry_run" <<'PY'
import json, sys
local_dir, remote, dry_run = sys.argv[1:4]
print(json.dumps({
    "local_dir": local_dir,
    "remote": remote,
    "dry_run": dry_run == "true",
}, ensure_ascii=False))
PY
}

fail_early() {
  local exit_code="$1"
  local message="$2"
  log_msg "ERROR" "$message" >> "$NUVEM_LOG_FILE"
  write_status_json "$NUVEM_STATUS_FILE" "error" "1" "$exit_code" "$message" "$(build_extra_json)"
  send_notification "critical" "DriveSync: falha na sincronização" "$message"
  exit "$exit_code"
}

if ! require_commands rclone python3 flock; then
  fail_early 1 "Comandos obrigatórios não encontrados (rclone, python3, flock)."
fi

if [[ ! -d "$NUVEM_LOCAL_DIR" ]]; then
  fail_early 1 "Diretório local não encontrado: $NUVEM_LOCAL_DIR"
fi

if [[ ! -f "$NUVEM_FILTERS_FILE" ]]; then
  fail_early 1 "Arquivo de filtros não encontrado: $NUVEM_FILTERS_FILE"
fi

if [[ "$NUVEM_REMOTE" == *:* ]]; then
  remote_name="${NUVEM_REMOTE%%:*}"
  if ! rclone listremotes 2>/dev/null | grep -Fxq "${remote_name}:"; then
    fail_early 1 "Remote rclone '${remote_name}:' não configurado. Execute 'rclone config' primeiro."
  fi
fi

mkdir -p "$NUVEM_QUARENTENA_LOCAL"

RUN_TMP_LOG="$(mktemp)"
cleanup() {
  rm -f "$RUN_TMP_LOG"
}
trap cleanup EXIT

cmd=(
  rclone bisync
  "$NUVEM_LOCAL_DIR"
  "$NUVEM_REMOTE"
  --filters-file "$NUVEM_FILTERS_FILE"
  --resilient
  --recover
  --max-lock "$NUVEM_MAX_LOCK"
  --conflict-resolve newer
  --conflict-loser num
  --max-delete "$NUVEM_MAX_DELETE"
  --drive-skip-gdocs
  --backup-dir1 "$BACKUP_DIR1"
  --backup-dir2 "$BACKUP_DIR2"
  -v
)

if [[ -n "${NUVEM_WORKDIR:-}" ]]; then
  mkdir -p "$NUVEM_WORKDIR"
  cmd+=(--workdir "$NUVEM_WORKDIR")
fi

if [[ "${NUVEM_DRY_RUN:-0}" == "1" ]]; then
  has_dry_flag=0
  for arg in "$@"; do
    if [[ "$arg" == "--dry-run" || "$arg" == "-n" ]]; then
      has_dry_flag=1
      break
    fi
  done
  if (( has_dry_flag == 0 )); then
    cmd+=(--dry-run)
  fi
fi

if (( $# > 0 )); then
  cmd+=("$@")
fi

{
  log_msg "INFO" "Iniciando bisync: $NUVEM_LOCAL_DIR <-> $NUVEM_REMOTE (dry_run=$is_dry_run)"
} >> "$NUVEM_LOG_FILE"

"${cmd[@]}" >"$RUN_TMP_LOG" 2>&1
rc=$?

cat "$RUN_TMP_LOG" >> "$NUVEM_LOG_FILE"

parsed="$(python3 - "$RUN_TMP_LOG" "$rc" <<'PY'
import json
import re
import sys

log_path, rc_str = sys.argv[1:3]
rc = int(rc_str)
text = open(log_path, encoding="utf-8", errors="replace").read()

error_count = 0
m = re.findall(r"Errors:\s+(\d+)", text)
if m:
    error_count = int(m[-1])
elif rc != 0:
    error_count = max(1, len(re.findall(r"\bERROR\s*:", text)))

aborted_markers = (
    "Safety abort:",
    "too many deletes",
    "Bisync aborted",
    "all files were changed",
    "Failed to bisync: too many deletes",
)

if rc == 0:
    status = "ok"
    message = "Sincronização concluída sem erros."
elif any(marker in text for marker in aborted_markers):
    status = "aborted"
    error_count = max(1, error_count)
    if "too many deletes" in text:
        message = "Sincronização abortada pela trava de segurança --max-delete."
    elif "all files were changed" in text:
        message = "Sincronização abortada: alteração em 100% dos arquivos."
    else:
        message = "Sincronização abortada por trava de segurança do rclone bisync."
else:
    status = "error"
    error_count = max(1, error_count)
    err_lines = [line.strip() for line in text.splitlines() if "ERROR" in line or "Failed to bisync" in line]
    message = err_lines[-1][:240] if err_lines else f"Falha no rclone bisync (código {rc})."

print(json.dumps({"status": status, "errors": error_count, "message": message}, ensure_ascii=False))
PY
)"

status="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["status"])' "$parsed")"
errors="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["errors"])' "$parsed")"
message="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["message"])' "$parsed")"

write_status_json "$NUVEM_STATUS_FILE" "$status" "$errors" "$rc" "$message" "$(build_extra_json)"
log_msg "INFO" "Finalizado bisync: status=$status errors=$errors rc=$rc" >> "$NUVEM_LOG_FILE"

if [[ "$status" == "aborted" ]]; then
  send_notification "critical" "DriveSync: sincronização abortada" "$message"
elif [[ "$status" == "error" ]]; then
  send_notification "critical" "DriveSync: erro na sincronização" "$message"
fi

exit "$rc"
