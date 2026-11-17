#!/usr/bin/env bash
# Utilitários compartilhados pelos scripts do DriveSync.

log_msg() {
  local level="$1"
  shift
  printf '%s [%s] %s\n' "$(date -Iseconds)" "$level" "$*"
}

send_notification() {
  local urgency="${1:-normal}"
  local title="${2:-DriveSync}"
  local body="${3:-}"

  if [[ "${NUVEM_NOTIFY:-1}" != "1" ]]; then
    return 0
  fi

  if command -v notify-send >/dev/null 2>&1; then
    notify-send -u "$urgency" -a "DriveSync" "$title" "$body" >/dev/null 2>&1 || true
  fi
}

require_commands() {
  local missing=()
  local cmd
  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      missing+=("$cmd")
    fi
  done
  if (( ${#missing[@]} > 0 )); then
    log_msg "ERROR" "Dependências ausentes no PATH: ${missing[*]}"
    return 1
  fi
}

write_status_json() {
  local status_file="$1"
  local status="$2"
  local errors="$3"
  local exit_code="$4"
  local message="$5"
  local extra_json="${6:-}"
  if [[ -z "$extra_json" ]]; then
    extra_json="{}"
  fi

  mkdir -p "$(dirname "$status_file")"
  python3 - "$status_file" "$status" "$errors" "$exit_code" "$message" "$extra_json" <<'PY'
import datetime
import json
import os
import sys
import tempfile

status_file, status, errors_raw, exit_raw, message, extra_raw = sys.argv[1:7]

try:
    extra = json.loads(extra_raw)
    if not isinstance(extra, dict):
        extra = {}
except Exception:
    extra = {}

payload = {
    "timestamp": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
    "status": status,
    "errors": int(errors_raw),
    "exit_code": int(exit_raw),
    "message": message,
}
payload.update(extra)

target_dir = os.path.dirname(os.path.abspath(status_file))
fd, tmp_path = tempfile.mkstemp(prefix=".status-", suffix=".tmp", dir=target_dir)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    os.replace(tmp_path, status_file)
finally:
    if os.path.exists(tmp_path):
        os.unlink(tmp_path)
PY
}
