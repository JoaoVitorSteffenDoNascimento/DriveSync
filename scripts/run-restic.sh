#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/_common.sh
source "$SCRIPT_DIR/_common.sh"

RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-rclone:gdrive:Backups-Restic}"
RESTIC_PASSWORD_FILE="${RESTIC_PASSWORD_FILE:-$HOME/.config/restic/password}"
RESTIC_BACKUP_PATHS="${RESTIC_BACKUP_PATHS:-$HOME/Nuvem:$HOME/Projetos:$HOME/.config}"
RESTIC_BASE_EXCLUDES="${RESTIC_BASE_EXCLUDES:-$REPO_ROOT/config/restic-excludes.txt}"
NUVEM_FILTERS_FILE="${NUVEM_FILTERS_FILE:-$REPO_ROOT/config/sync-filters.txt}"

NUVEM_STATE_DIR="${NUVEM_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}}"
NUVEM_RESTIC_LOG_FILE="${NUVEM_RESTIC_LOG_FILE:-$NUVEM_STATE_DIR/nuvem-restic.log}"
NUVEM_BACKUP_STATUS_FILE="${NUVEM_BACKUP_STATUS_FILE:-$NUVEM_STATE_DIR/nuvem-backup-status.json}"
NUVEM_RESTIC_LOCK_FILE="${NUVEM_RESTIC_LOCK_FILE:-$NUVEM_STATE_DIR/nuvem-restic.lock}"

RESTIC_KEEP_DAILY="${RESTIC_KEEP_DAILY:-14}"
RESTIC_KEEP_WEEKLY="${RESTIC_KEEP_WEEKLY:-8}"
RESTIC_KEEP_MONTHLY="${RESTIC_KEEP_MONTHLY:-12}"

mkdir -p "$NUVEM_STATE_DIR" "$(dirname "$NUVEM_RESTIC_LOG_FILE")" "$(dirname "$NUVEM_RESTIC_LOCK_FILE")"

exec 9>"$NUVEM_RESTIC_LOCK_FILE"
if ! flock -n 9; then
  log_msg "INFO" "Outro processo nuvem-restic já está em execução; ignorando." >> "$NUVEM_RESTIC_LOG_FILE"
  exit 0
fi

build_extra_json() {
  local snapshot_id="${1:-}"
  python3 - "$RESTIC_REPOSITORY" "$RESTIC_BACKUP_PATHS" "$snapshot_id" <<'PY'
import json, sys
repo, paths_raw, snap = sys.argv[1:4]
paths = [p for p in paths_raw.split(":") if p]
data = {"repository": repo, "paths": paths}
if snap:
    data["snapshot_id"] = snap
print(json.dumps(data, ensure_ascii=False))
PY
}

fail_restic() {
  local exit_code="$1"
  local message="$2"
  log_msg "ERROR" "$message" >> "$NUVEM_RESTIC_LOG_FILE"
  write_status_json "$NUVEM_BACKUP_STATUS_FILE" "error" "1" "$exit_code" "$message" "$(build_extra_json)"
  send_notification "critical" "DriveSync: falha no backup Restic" "$message"
  exit "$exit_code"
}

if ! require_commands restic python3 flock; then
  fail_restic 1 "Dependências obrigatórias ausentes (restic, python3, flock)."
fi

if [[ "$RESTIC_REPOSITORY" == rclone:* ]]; then
  if ! require_commands rclone; then
    fail_restic 1 "Comando rclone ausente para repositório '$RESTIC_REPOSITORY'."
  fi
  rclone_target="${RESTIC_REPOSITORY#rclone:}"
  if [[ "$rclone_target" == *:* ]]; then
    remote_name="${rclone_target%%:*}"
    if ! rclone listremotes 2>/dev/null | grep -Fxq "${remote_name}:"; then
      fail_restic 1 "Remote rclone '${remote_name}:' não configurado."
    fi
  fi
fi

if [[ ! -f "$RESTIC_PASSWORD_FILE" ]]; then
  fail_restic 1 "Arquivo de senha do Restic não encontrado: $RESTIC_PASSWORD_FILE (crie manualmente com chmod 600)."
fi

perm="$(stat -c '%a' "$RESTIC_PASSWORD_FILE" 2>/dev/null || echo "")"
if [[ -n "$perm" && "$perm" != "600" && "$perm" != "400" ]]; then
  log_msg "WARN" "Permissão insegura em $RESTIC_PASSWORD_FILE ($perm); recomendado chmod 600." >> "$NUVEM_RESTIC_LOG_FILE"
fi

IFS=':' read -r -a raw_paths <<< "$RESTIC_BACKUP_PATHS"
BACKUP_PATHS=()
missing_paths=()
for p in "${raw_paths[@]}"; do
  [[ -z "$p" ]] && continue
  if [[ -e "$p" ]]; then
    BACKUP_PATHS+=("$p")
  else
    missing_paths+=("$p")
  fi
done

if (( ${#missing_paths[@]} > 0 )) && [[ "${RESTIC_ALLOW_MISSING_PATHS:-0}" != "1" ]]; then
  fail_restic 1 "Caminho(s) de backup inexistente(s): ${missing_paths[*]}"
fi

if (( ${#BACKUP_PATHS[@]} == 0 )); then
  fail_restic 1 "Nenhum caminho válido configurado em RESTIC_BACKUP_PATHS."
fi

TMP_EXCLUDES="$(mktemp)"
RUN_TMP_LOG="$(mktemp)"
cleanup() {
  rm -f "$TMP_EXCLUDES" "$RUN_TMP_LOG"
}
trap cleanup EXIT

if [[ -n "${RESTIC_EXCLUDE_FILE:-}" ]]; then
  if [[ ! -f "$RESTIC_EXCLUDE_FILE" ]]; then
    fail_restic 1 "RESTIC_EXCLUDE_FILE não encontrado: $RESTIC_EXCLUDE_FILE"
  fi
  EFFECTIVE_EXCLUDES="$RESTIC_EXCLUDE_FILE"
else
  python3 - "$RESTIC_BASE_EXCLUDES" "$NUVEM_FILTERS_FILE" "$TMP_EXCLUDES" <<'PY'
import os
import sys

base_path, rclone_filters_path, out_path = sys.argv[1:4]
patterns = []
seen = set()

def add_pat(p: str) -> None:
    p = p.strip()
    if not p or p.startswith("#"):
        return
    if p not in seen:
        seen.add(p)
        patterns.append(p)

if os.path.isfile(base_path):
    with open(base_path, encoding="utf-8") as fh:
        for line in fh:
            add_pat(line)

# Converte regras "- padrão" do Rclone para sintaxe do Restic (--exclude-file)
if os.path.isfile(rclone_filters_path):
    with open(rclone_filters_path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("- "):
                pat = line[2:].strip()
                if pat.endswith("/**"):
                    pat = pat[:-3]
                if pat and "/" not in pat and not pat.startswith("*"):
                    pat = f"**/{pat}"
                elif pat and "/" in pat and not pat.startswith(("/", "**/")):
                    pat = f"**/{pat}"
                add_pat(pat)

with open(out_path, "w", encoding="utf-8") as out:
    for pat in patterns:
        out.write(pat + "\n")
PY
  EFFECTIVE_EXCLUDES="$TMP_EXCLUDES"
fi

export RESTIC_REPOSITORY
export RESTIC_PASSWORD_FILE

if ! restic cat config >/dev/null 2>&1; then
  if [[ "${RESTIC_AUTO_INIT:-0}" == "1" ]]; then
    log_msg "INFO" "Inicializando repositório Restic em $RESTIC_REPOSITORY" >> "$NUVEM_RESTIC_LOG_FILE"
    if ! restic init >> "$RUN_TMP_LOG" 2>&1; then
      cat "$RUN_TMP_LOG" >> "$NUVEM_RESTIC_LOG_FILE"
      fail_restic 1 "Falha ao inicializar repositório Restic em $RESTIC_REPOSITORY."
    fi
  else
    fail_restic 1 "Repositório Restic inacessível ou não inicializado: $RESTIC_REPOSITORY (rode 'restic init' antes)."
  fi
fi

is_dry_run=0
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" || "$arg" == "-n" ]]; then
    is_dry_run=1
    break
  fi
done

log_msg "INFO" "Iniciando backup Restic em $RESTIC_REPOSITORY para: ${BACKUP_PATHS[*]}" >> "$NUVEM_RESTIC_LOG_FILE"

restic backup \
  --verbose \
  --exclude-caches \
  --exclude-file "$EFFECTIVE_EXCLUDES" \
  "$@" \
  "${BACKUP_PATHS[@]}" >> "$RUN_TMP_LOG" 2>&1
rc_backup=$?

cat "$RUN_TMP_LOG" >> "$NUVEM_RESTIC_LOG_FILE"

if (( rc_backup != 0 )); then
  err_summary="$(grep -E 'Fatal:|error|Error' "$RUN_TMP_LOG" | tail -n 1 || true)"
  fail_restic "$rc_backup" "${err_summary:-Falha durante restic backup (código $rc_backup).}"
fi

snapshot_id="$(python3 - "$RUN_TMP_LOG" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
m = re.findall(r"snapshot\s+([0-9a-fA-F]{6,64})\s+saved", text)
print(m[-1] if m else "")
PY
)"

if (( is_dry_run == 0 )); then
  FORGET_TMP="$(mktemp)"
  restic forget \
    --prune \
    --keep-daily "$RESTIC_KEEP_DAILY" \
    --keep-weekly "$RESTIC_KEEP_WEEKLY" \
    --keep-monthly "$RESTIC_KEEP_MONTHLY" >"$FORGET_TMP" 2>&1
  rc_forget=$?
  cat "$FORGET_TMP" >> "$NUVEM_RESTIC_LOG_FILE"
  rm -f "$FORGET_TMP"

  if (( rc_forget != 0 )); then
    fail_restic "$rc_forget" "Backup criado ($snapshot_id), mas 'restic forget --prune' falhou (código $rc_forget)."
  fi
fi

ok_msg="Backup Restic concluído com sucesso"
[[ -n "$snapshot_id" ]] && ok_msg="$ok_msg (snapshot $snapshot_id)"
(( is_dry_run == 1 )) && ok_msg="$ok_msg [dry-run]"

write_status_json "$NUVEM_BACKUP_STATUS_FILE" "ok" "0" "0" "$ok_msg" "$(build_extra_json "$snapshot_id")"
log_msg "INFO" "$ok_msg" >> "$NUVEM_RESTIC_LOG_FILE"
exit 0
