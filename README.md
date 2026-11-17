# DriveSync — Desktop Multiplataforma, Drive Master & Nuvem Pessoal

Plataforma simples de sincronização com Google Drive organizada em duas frentes compatíveis:

1. **App Desktop + Motor Cross-Platform (`apps/desktop` + `apps/engine` — Parte 1):**
   - Interface simples em **Electron + React + TypeScript** para **Windows 10/11** (`.exe` / `.msi`) e **Linux** (`.deb`, `.rpm`, `.pacman` / `PKGBUILD` Arch e `.AppImage`).
   - Motor nativo em **Go (`drivesyncd`)** com SQLite local, `fsnotify` e Google Drive API v3.
   - **Escolha de pasta** no computador ↔ pasta no Google Drive por conexão.
   - **Múltiplos dispositivos** conectados com visibilidade na aba **Dispositivos & Pessoas** (`.drivesync/devices/*.json`).
   - **Modo Drive "Master" compartilhado:** permite escolher de quem receber arquivos (ex.: aceitar de João, ignorar de Luiz) e **preserva os arquivos já baixados no PC caso sejam apagados no Drive** (opção padrão, com alternativa configurável para espelhar exclusões em Quarentena).
   - **Limitação rígida de até 4 GB (`4 GiB`) por upload** com bloqueio automático e aviso claro na interface.
2. **Base Mobile (`apps/mobile` — Parte 2):**
   - Espaço reservado e contratos compartilhados em `packages/shared` para o futuro app Android/iOS.
3. **Automação Legada Arch Linux (`scripts/` + `config/` + `systemd/`):**
   - Preservada integralmente para quem usa `rclone bisync` + `inotifywait` + `restic` + `Waybar` (`status-waybar.py`). O novo motor também atualiza `nuvem-status.json` no Linux quando a ponte Waybar está ativada.

---

## Estrutura do Monorepo

```text
DriveSync/
├── apps/
│   ├── desktop/                # App Desktop Electron + React + Vite + electron-builder
│   ├── engine/                 # Motor/Daemon Go (drivesyncd) cross-platform Win/Linux
│   └── mobile/                 # Estrutura reservada da Parte 2 (Mobile)
├── packages/
│   └── shared/                 # Tipos TS, regras de remetentes e trava de 4 GiB compartilhados
├── packaging/
│   ├── arch/                   # PKGBUILD e .desktop para Arch Linux
│   └── scripts/                # Scripts de compilação cruzada do motor Go
├── config/                     # Filtros Rclone/Restic preservados
├── scripts/                    # Scripts bash/Python originais (Arch + Waybar)
├── systemd/                    # Unidades systemd --user preservadas
└── tests/                      # Suíte validate-sync.sh preservada
```

---

## Como rodar em desenvolvimento (Desktop + Motor)

```bash
# 1. Instalar dependências JS/TS do monorepo
npm install

# 2. Compilar pacote compartilhado e motor Go
npm run build:engine
npm run build --workspace=@drivesync/shared

# 3. Rodar testes completos (Shared + Desktop + Go Engine + Legado)
npm test

# 4. Abrir interface desktop em modo dev (terminal 1: Vite, terminal 2: Electron)
npm run dev
```

### Autenticação com o Google Drive

Na interface do DriveSync:
- **Linux/Arch com `rclone` já configurado:** clique em **Conectar Google Drive → Importar conta já configurada no rclone (`gdrive:`)**.
- **Login direto pelo navegador (Windows/Linux):** informe seu OAuth Client ID (Desktop App do Google Cloud Console) ou utilize o Client ID configurado no build (`DRIVESYNC_GOOGLE_CLIENT_ID` / `DRIVESYNC_GOOGLE_CLIENT_SECRET`) e clique em **Entrar com Google pelo navegador**.

---

## Empacotamento Multiplataforma

```bash
# Compilar o motor drivesyncd para Linux e Windows (cross-compile nativo em Go)
bash packaging/scripts/build-engine.sh all

# Gerar pacotes Linux (.AppImage, .deb, .rpm, .pacman)
npm run pack:linux

# Gerar instaladores Windows 10/11 (.exe NSIS e .msi - requer ambiente Windows ou Wine/makensis)
npm run pack:win
```

Para construir pacote nativo no **Arch Linux** usando o `electron` do sistema:
```bash
cd packaging/arch && makepkg -si
```

---

## Automação Legada Arch Linux (`rclone bisync` + `restic` + Waybar)

Os scripts originais continuam funcionando sem alterações:

- **Validação sandbox offline:**
  ```bash
  ./tests/validate-sync.sh --local
  ```
- **Validação completa contra Google Drive (`~/Nuvem-Teste` ↔ `gdrive:Sync-Teste`):**
  ```bash
  ./tests/validate-sync.sh --gdrive
  ```
- **Serviços `systemd --user`:**
  ```bash
  mkdir -p ~/.config/systemd/user ~/.local/state
  cp systemd/* ~/.config/systemd/user/
  systemctl --user daemon-reload
  systemctl --user enable --now nuvem-bisync.timer nuvem-watcher.service nuvem-restic.timer
  ```
- **Waybar (`~/.config/waybar/config.jsonc`):**
  ```jsonc
  "custom/drivesync": {
      "format": "{}",
      "return-type": "json",
      "exec": "python3 /home/brendha/Projetos/DriveSync/scripts/status-waybar.py",
      "interval": 15,
      "on-click": "systemctl --user start nuvem-bisync.service",
      "tooltip": true
  }
  ```
