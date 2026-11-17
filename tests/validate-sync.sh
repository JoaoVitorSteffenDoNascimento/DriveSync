#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

MODE="auto"
while (( $# > 0 )); do
  case "$1" in
    --local) MODE="local" ;;
    --gdrive) MODE="gdrive" ;;
    --auto) MODE="auto" ;;
    -h|--help)
      cat <<'EOF'
Uso: tests/validate-sync.sh [--auto|--local|--gdrive]

Modos:
  --auto    Usa --gdrive se o remote 'gdrive:' e 'restic' estiverem prontos; caso contrário usa --local.
  --local   Executa os testes não-destrutivos em sandbox local (/tmp), sem precisar do Google Drive.
  --gdrive  Executa a checklist completa (Testes 1-6) usando ~/Nuvem-Teste e gdrive:Sync-Teste.
EOF
      exit 0
      ;;
    *)
      echo "Opção inválida: $1" >&2
      exit 2
      ;;
  esac
  shift
done

has_gdrive=0
if command -v rclone >/dev/null 2>&1 && rclone listremotes 2>/dev/null | grep -Fxq "gdrive:"; then
  has_gdrive=1
fi
has_restic=0
if command -v restic >/dev/null 2>&1; then
  has_restic=1
fi

if [[ "$MODE" == "auto" ]]; then
  if (( has_gdrive == 1 && has_restic == 1 )); then
    MODE="gdrive"
  else
    MODE="local"
  fi
fi

if [[ "$MODE" == "gdrive" ]]; then
  if (( has_gdrive == 0 )); then
    echo "ERRO: remote 'gdrive:' não configurado no rclone. Rode 'rclone config' ou use --local." >&2
    exit 1
  fi
  if (( has_restic == 0 )); then
    echo "ERRO: 'restic' não está instalado. Instale com 'sudo pacman -S restic' ou use --local." >&2
    exit 1
  fi
fi

SANDBOX_DIR="$(mktemp -d /tmp/drivesync-validate-XXXXXX)"
cleanup() {
  rm -rf "$SANDBOX_DIR"
}
trap cleanup EXIT

STATE_DIR="$SANDBOX_DIR/state"
WORKDIR="$SANDBOX_DIR/workdir"
FILTERS_COPY="$SANDBOX_DIR/sync-filters.txt"
NOTIFY_LOG="$SANDBOX_DIR/notify.log"
SHIM_BIN="$SANDBOX_DIR/bin"
mkdir -p "$STATE_DIR" "$WORKDIR" "$SHIM_BIN"
cp "$REPO_ROOT/config/sync-filters.txt" "$FILTERS_COPY"

# Intercepta notify-send nos testes para validar disparo sem poluir a área de trabalho
cat > "$SHIM_BIN/notify-send" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$NOTIFY_LOG"
EOF
chmod +x "$SHIM_BIN/notify-send"
export PATH="$SHIM_BIN:$PATH"

if [[ "$MODE" == "gdrive" ]]; then
  TEST_LOCAL="${NUVEM_TEST_LOCAL:-$HOME/Nuvem-Teste}"
  TEST_REMOTE="${NUVEM_TEST_REMOTE:-gdrive:Sync-Teste}"
  TEST_QUARENTENA_REMOTE="${NUVEM_TEST_QUARENTENA_REMOTE:-gdrive:Quarentena-Teste}"
  TEST_RESTIC_REPO="${NUVEM_TEST_RESTIC_REPO:-rclone:gdrive:Backups-Restic-Teste}"
  if [[ "$TEST_LOCAL" == "$HOME/Nuvem" || "$TEST_REMOTE" == "gdrive:Sync" ]]; then
    echo "ERRO DE SEGURANÇA: nunca aponte testes para ~/Nuvem ou gdrive:Sync." >&2
    exit 1
  fi
  mkdir -p "$TEST_LOCAL"
  # Limpa apenas pastas de teste dedicadas
  find "$TEST_LOCAL" -mindepth 1 -delete
  rclone purge "$TEST_REMOTE" >/dev/null 2>&1 || true
  rclone mkdir "$TEST_REMOTE"
  rclone mkdir "$TEST_QUARENTENA_REMOTE"
else
  TEST_LOCAL="$SANDBOX_DIR/Nuvem-Teste"
  TEST_REMOTE="$SANDBOX_DIR/remote/Sync-Teste"
  TEST_QUARENTENA_REMOTE="$SANDBOX_DIR/remote/Quarentena-Teste"
  TEST_RESTIC_REPO="$SANDBOX_DIR/remote/Backups-Restic-Teste"
  mkdir -p "$TEST_LOCAL" "$TEST_REMOTE" "$TEST_QUARENTENA_REMOTE"
fi

export NUVEM_LOCAL_DIR="$TEST_LOCAL"
export NUVEM_REMOTE="$TEST_REMOTE"
export NUVEM_FILTERS_FILE="$FILTERS_COPY"
export NUVEM_STATE_DIR="$STATE_DIR"
export NUVEM_LOG_FILE="$STATE_DIR/nuvem-sync.log"
export NUVEM_STATUS_FILE="$STATE_DIR/nuvem-status.json"
export NUVEM_BACKUP_STATUS_FILE="$STATE_DIR/nuvem-backup-status.json"
export NUVEM_LOCK_FILE="$STATE_DIR/nuvem-bisync.lock"
export NUVEM_QUARENTENA_LOCAL="$STATE_DIR/quarentena-local"
export NUVEM_QUARENTENA_REMOTE="$TEST_QUARENTENA_REMOTE"
export NUVEM_WORKDIR="$WORKDIR"
export NUVEM_NOTIFY=1

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf '[PASS] %s\n' "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf '[FAIL] %s\n' "$1" >&2
}

skip() {
  SKIP_COUNT=$((SKIP_COUNT + 1))
  printf '[SKIP] %s\n' "$1"
}

write_remote_file() {
  local rel="$1"
  local content="$2"
  if [[ "$TEST_REMOTE" == *:* ]]; then
    printf '%s' "$content" | rclone rcat "$TEST_REMOTE/$rel"
    # Aguarda consistência eventual da API de listagem do Google Drive
    local attempt=0
    while (( attempt < 5 )); do
      if remote_exists "$rel"; then
        break
      fi
      sleep 1
      attempt=$((attempt + 1))
    done
    sleep 2
  else
    mkdir -p "$(dirname "$TEST_REMOTE/$rel")"
    printf '%s' "$content" > "$TEST_REMOTE/$rel"
  fi
}

remote_exists() {
  local rel="$1"
  if [[ "$TEST_REMOTE" == *:* ]]; then
    rclone lsf "$TEST_REMOTE" --recursive --files-only 2>/dev/null | grep -Fxq "$rel"
  else
    [[ -f "$TEST_REMOTE/$rel" ]]
  fi
}

read_remote_file() {
  local rel="$1"
  if [[ "$TEST_REMOTE" == *:* ]]; then
    rclone cat "$TEST_REMOTE/$rel"
  else
    cat "$TEST_REMOTE/$rel"
  fi
}

json_field() {
  local file="$1"
  local field="$2"
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$file" "$field"
}

echo "============================================================"
echo " DriveSync - Suíte de Validação Não-Destrutiva (modo: $MODE)"
echo " Local:  $TEST_LOCAL"
echo " Remote: $TEST_REMOTE"
echo "============================================================"

# Teste 0: Validação estática de scripts e JSON
if bash -n "$REPO_ROOT"/scripts/*.sh "$REPO_ROOT"/tests/*.sh && \
   python3 -m py_compile "$REPO_ROOT/scripts/status-waybar.py"; then
  pass "Teste 0: sintaxe bash e Python válida"
else
  fail "Teste 0: erro de sintaxe nos scripts"
fi

# Teste 1: --resync --dry-run (filtros + nada tocado)
mkdir -p "$TEST_LOCAL/node_modules/pkg" "$TEST_LOCAL/.git"
printf 'conteudo\n' > "$TEST_LOCAL/doc1.txt"
printf 'module.exports={}\n' > "$TEST_LOCAL/node_modules/pkg/index.js"
printf 'ref: refs/heads/main\n' > "$TEST_LOCAL/.git/HEAD"
printf 'fake-iso\n' > "$TEST_LOCAL/distro.iso"

if "$REPO_ROOT/scripts/run-bisync.sh" --resync --dry-run && \
   ! remote_exists "doc1.txt" && \
   ! remote_exists "node_modules/pkg/index.js" && \
   ! remote_exists ".git/HEAD" && \
   ! remote_exists "distro.iso" && \
   grep -q "doc1.txt: Skipped copy" "$NUVEM_LOG_FILE" && \
   ! grep -q "node_modules" "$NUVEM_LOG_FILE" && \
   ! grep -q "\.git" "$NUVEM_LOG_FILE" && \
   ! grep -q "distro.iso" "$NUVEM_LOG_FILE" && \
   [[ "$(json_field "$NUVEM_STATUS_FILE" dry_run)" == "True" ]]; then
  pass "Teste 1: --resync --dry-run respeitou filtros e não transferiu arquivos reais"
else
  fail "Teste 1: falha na verificação de --resync --dry-run"
fi

# Teste 2: Inicialização real na pasta de teste com 3 arquivos + pastas ignoradas
rm -f "$TEST_LOCAL/doc1.txt" "$TEST_LOCAL/distro.iso"
printf 'um\n' > "$TEST_LOCAL/arq1.txt"
printf 'dois\n' > "$TEST_LOCAL/arq2.txt"
printf 'tres\n' > "$TEST_LOCAL/arq3.txt"

if "$REPO_ROOT/scripts/run-bisync.sh" --resync && \
   remote_exists "arq1.txt" && remote_exists "arq2.txt" && remote_exists "arq3.txt" && \
   ! remote_exists "node_modules/pkg/index.js" && ! remote_exists ".git/HEAD" && \
   [[ "$(json_field "$NUVEM_STATUS_FILE" status)" == "ok" ]]; then
  pass "Teste 2: inicialização real (--resync) enviou 3 arquivos e ignorou node_modules/.git"
else
  fail "Teste 2: falha na inicialização real"
fi

# Teste 3: Espelhamento bidirecional + Waybar JSON
printf 'subida\n' > "$TEST_LOCAL/subida.txt"
write_remote_file "descida.txt" $'descida\n'

set +e
"$REPO_ROOT/scripts/run-bisync.sh"
rc_t3=$?
set -e

if (( rc_t3 != 0 )); then
  fail "Teste 3: run-bisync.sh retornou código $rc_t3 (log: $(tail -n 5 "$NUVEM_LOG_FILE" | tr '\n' ' '))"
elif ! remote_exists "subida.txt"; then
  fail "Teste 3: subida.txt não apareceu em $TEST_REMOTE"
elif [[ ! -f "$TEST_LOCAL/descida.txt" ]]; then
  fail "Teste 3: descida.txt não foi baixado para $TEST_LOCAL"
elif [[ "$(cat "$TEST_LOCAL/descida.txt")" != "descida" ]]; then
  fail "Teste 3: conteúdo inesperado em descida.txt"
else
  waybar_json="$("$REPO_ROOT/scripts/status-waybar.py")"
  if python3 -c 'import json,sys; d=json.loads(sys.argv[1]); assert d["class"]=="ok" and "text" in d and "tooltip" in d' "$waybar_json"; then
    pass "Teste 3: espelhamento bidirecional e status-waybar.py validados"
  else
    fail "Teste 3: JSON inválido no status-waybar.py: $waybar_json"
  fi
fi

# Teste 4: Trava --max-delete 15
for i in 4 5 6 7 8 9 10; do
  printf 'extra %s\n' "$i" > "$TEST_LOCAL/arq${i}.txt"
done
"$REPO_ROOT/scripts/run-bisync.sh" >/dev/null 2>&1 || true

rm -f "$TEST_LOCAL/arq1.txt" "$TEST_LOCAL/arq2.txt" "$TEST_LOCAL/arq3.txt"
: > "$NOTIFY_LOG"

set +e
"$REPO_ROOT/scripts/run-bisync.sh"
rc_delete=$?
set -e

if (( rc_delete != 0 )) && \
   [[ "$(json_field "$NUVEM_STATUS_FILE" status)" == "aborted" ]] && \
   remote_exists "arq1.txt" && remote_exists "arq2.txt" && remote_exists "arq3.txt" && \
   grep -qi "abortada" "$NOTIFY_LOG"; then
  pass "Teste 4: trava --max-delete 15 abortou exclusão em massa, preservou remoto e disparou notify-send"
else
  fail "Teste 4: trava --max-delete 15 não se comportou como esperado (rc=$rc_delete)"
fi

# Reequilibra estado antes do Teste 5
printf 'um\n' > "$TEST_LOCAL/arq1.txt"
printf 'dois\n' > "$TEST_LOCAL/arq2.txt"
printf 'tres\n' > "$TEST_LOCAL/arq3.txt"
printf 'base\n' > "$TEST_LOCAL/conflito.txt"
"$REPO_ROOT/scripts/run-bisync.sh" --resync >/dev/null

# Teste 5: Resolução de conflito (--conflict-resolve newer --conflict-loser num)
sleep 1.2
printf 'versao-local-antiga\n' > "$TEST_LOCAL/conflito.txt"
sleep 1.5
write_remote_file "conflito.txt" $'versao-remota-nova\n'

if "$REPO_ROOT/scripts/run-bisync.sh" && \
   [[ "$(cat "$TEST_LOCAL/conflito.txt")" == "versao-remota-nova" ]] && \
   [[ "$(read_remote_file "conflito.txt")" == "versao-remota-nova" ]] && \
   compgen -G "$TEST_LOCAL/conflito.txt.conflict*" >/dev/null; then
  pass "Teste 5: conflito resolvido pela versão mais recente com preservação do perdedor (.conflictN)"
else
  fail "Teste 5: falha na resolução de conflito"
fi

# Teste 6: Restic (backup criptografado, exclusões e restauração)
if (( has_restic == 1 )); then
  RESTIC_PASS="$SANDBOX_DIR/restic-pass"
  printf 'senha-teste-segura-123\n' > "$RESTIC_PASS"
  chmod 600 "$RESTIC_PASS"

  RESTIC_SRC="$SANDBOX_DIR/restic-src"
  RESTORE_DIR="$SANDBOX_DIR/restic-restore"
  mkdir -p "$RESTIC_SRC/node_modules/x" "$RESTORE_DIR"
  printf 'segredo importante\n' > "$RESTIC_SRC/importante.txt"
  printf 'lixo\n' > "$RESTIC_SRC/node_modules/x/pkg.js"

  if [[ "$MODE" == "gdrive" ]]; then
    rclone purge gdrive:Backups-Restic-Teste >/dev/null 2>&1 || true
  fi

  if RESTIC_REPOSITORY="$TEST_RESTIC_REPO" \
     RESTIC_PASSWORD_FILE="$RESTIC_PASS" \
     RESTIC_BACKUP_PATHS="$RESTIC_SRC" \
     RESTIC_AUTO_INIT=1 \
     "$REPO_ROOT/scripts/run-restic.sh" && \
     [[ "$(json_field "$NUVEM_BACKUP_STATUS_FILE" status)" == "ok" ]] && \
     ! RESTIC_REPOSITORY="$TEST_RESTIC_REPO" RESTIC_PASSWORD_FILE="$RESTIC_PASS" restic ls latest | grep -q "node_modules" && \
     rm -f "$RESTIC_SRC/importante.txt" && \
     RESTIC_REPOSITORY="$TEST_RESTIC_REPO" RESTIC_PASSWORD_FILE="$RESTIC_PASS" \
       restic restore latest --include "$RESTIC_SRC/importante.txt" --target "$RESTORE_DIR" >/dev/null && \
     [[ "$(cat "$RESTORE_DIR/$RESTIC_SRC/importante.txt")" == "segredo importante" ]]; then
    pass "Teste 6: backup Restic criptografado, exclusões e restore validados"
  else
    fail "Teste 6: falha no fluxo Restic"
  fi
else
  skip "Teste 6: binário 'restic' não instalado (instale com: sudo pacman -S restic)"
fi

echo "============================================================"
printf 'Resultado: %d PASS | %d FAIL | %d SKIP\n' "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT"
echo "============================================================"

if (( FAIL_COUNT > 0 )); then
  exit 1
fi

if [[ "$MODE" == "gdrive" ]]; then
  find "$TEST_LOCAL" -mindepth 1 -delete
  rclone purge "$TEST_REMOTE" >/dev/null 2>&1 || true
  rclone purge "$TEST_QUARENTENA_REMOTE" >/dev/null 2>&1 || true
  rclone purge gdrive:Backups-Restic-Teste >/dev/null 2>&1 || true
fi
exit 0
