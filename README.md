# DriveSync — Desktop Multiplataforma, Drive Master & Nuvem Pessoal

Plataforma simples de sincronização com Google Drive organizada em duas frentes compatíveis:

1. **App Desktop + Motor Cross-Platform (`apps/desktop` + `apps/engine` — Parte 1):**
   - Interface simples em **Electron + React + TypeScript** para **Windows 10/11** (`.exe` / `.msi`) e **Linux** (`.deb`, `.rpm`, `.pacman` / `PKGBUILD` Arch e `.AppImage`).
   - Motor nativo em **Go (`drivesyncd`)** com SQLite local, `fsnotify` e Google Drive API v3.
   - **Escolha de pasta** no computador ↔ pasta no Google Drive por conexão.
   - **Múltiplos dispositivos** conectados com visibilidade na aba **Dispositivos & Pessoas** (`.drivesync/devices/*.json`).
   - **Modo Drive "Master" compartilhado:** permite escolher de quem receber arquivos (ex.: aceitar de João, ignorar de Luiz) e **preserva os arquivos já baixados no PC caso sejam apagados no Drive** (opção padrão, com alternativa configurável para espelhar exclusões em Quarentena).
   - **Limitação rígida de até 4 GB (`4 GiB`) por upload** com bloqueio automático e aviso claro na interface.
2. **App Mobile Android (`apps/mobile` — Parte 2):**
   - Aplicativo em **Capacitor 8 + React + TypeScript + Kotlin nativo** usando **somente Google Drive API v3** (`HttpURLConnection`, OAuth Chrome Custom Tabs loopback, Android SAF `ACTION_OPEN_DOCUMENT_TREE` e `WorkManager`).
   - Suporta escolha de pasta local do celular, entrada rápida em pastas compartilhadas por código (`DS1...` / `DS-XXXX-XXXX`) ou link do Drive, filtro de remetentes no modo Master, proteção contra exclusões no Drive (`keep_local` por padrão), trava rígida de **4 GB (`4 GiB`)** e visibilidade multi-dispositivo (`.drivesync/devices/*.json`).
   - Botão direto em **Configurações → Compartilhar o DriveSync** no Desktop e no Mobile para copiar o link da página de downloads.
3. **Automação Legada Arch Linux (`scripts/` + `config/` + `systemd/`):**
   - Preservada integralmente para quem usa `rclone bisync` + `inotifywait` + `restic` + `Waybar` (`status-waybar.py`). O novo motor também atualiza `nuvem-status.json` no Linux quando a ponte Waybar está ativada.

---

## Estrutura do Monorepo

```text
DriveSync/
├── apps/
│   ├── desktop/                # App Desktop Electron + React + Vite + electron-builder
│   ├── engine/                 # Motor/Daemon Go (drivesyncd) cross-platform Win/Linux
│   └── mobile/                 # App Mobile (Capacitor + React + Motor nativo Kotlin/Android)
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

## Compartilhar e Instalar (Windows, Linux e Android)

Os instaladores prontos ficam centralizados na página de **Releases do GitHub** (gerada automaticamente pelo workflow `.github/workflows/release.yml`):

- **Site oficial de downloads (GitHub Pages):** <https://joaovitorsteffendonascimento.github.io/DriveSync/>
- **Releases diretas no GitHub:** <https://github.com/JoaoVitorSteffenDoNascimento/DriveSync/releases>
  - **Windows 10/11:** `.exe` (NSIS) ou `.msi`
  - **Linux:** `.AppImage`, `.deb`, `.rpm` ou `.pacman`
  - **Android:** `DriveSync-Android.apk`

> **Dica para login com 1 clique nos builds compartilhados:** configure no repositório GitHub (*Settings → Secrets and variables → Actions*) os segredos `DRIVESYNC_GOOGLE_CLIENT_ID` e `DRIVESYNC_GOOGLE_CLIENT_SECRET` antes de disparar o workflow de Release. Assim quem receber o instalador ou APK não precisará enviar `credentials.json` manualmente.

## Empacotamento Local

```bash
# Compilar o motor drivesyncd para Linux e Windows (cross-compile nativo em Go)
bash packaging/scripts/build-engine.sh all

# Gerar pacotes Linux (.AppImage, .deb, .rpm, .pacman)
npm run pack:linux

# Gerar instaladores Windows 10/11 (.exe NSIS e .msi - requer ambiente Windows ou Wine/makensis)
npm run pack:win

# Sincronizar bundle web Mobile com projeto Android e gerar APK (requer Android SDK + JDK 21)
npm run build --workspace=@drivesync/shared
npm run build --workspace=@drivesync/mobile
cd apps/mobile && npx cap sync android && cd android && ./gradlew assembleDebug
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
