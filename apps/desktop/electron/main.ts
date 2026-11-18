import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  shell,
} from 'electron';
import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppUpdateCheckResult } from '@drivesync/shared';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let daemonProc: ChildProcess | null = null;
let daemonPort = 0;
let isQuitting = false;
let minimizeToTrayPref = true;
let lastNotifiedVersion = '';

const RELEASE_API_URL =
  'https://api.github.com/repos/JoaoVitorSteffenDoNascimento/DriveSync/releases/latest';
const RELEASES_PAGE_URL =
  'https://github.com/JoaoVitorSteffenDoNascimento/DriveSync/releases/latest';

function normalizeSemVer(raw: string): string {
  const cleaned = String(raw || '').trim().replace(/^[vV]/, '');
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(cleaned);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : '';
}

function semVerCode(raw: string): number {
  const norm = normalizeSemVer(raw);
  if (!norm) return 0;
  const [maj, min, pat] = norm.split('.').map(Number);
  return maj * 10000 + min * 100 + pat;
}

async function checkDesktopUpdate(notifyOs = true): Promise<AppUpdateCheckResult> {
  const currentVersion = normalizeSemVer(app.getVersion()) || app.getVersion();
  const res = await fetch(RELEASE_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `DriveSync-Desktop/${currentVersion}`,
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub Releases retornou HTTP ${res.status}`);
  }
  const payload = (await res.json()) as {
    tag_name?: string;
    html_url?: string;
    body?: string;
    published_at?: string;
    assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>;
  };

  const latestVersion = normalizeSemVer(payload.tag_name ?? '') || currentVersion;
  const hasUpdate = semVerCode(latestVersion) > semVerCode(currentVersion);
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const wantExt = process.platform === 'win32' ? /\.exe$/i : /\.AppImage$/i;
  const fallbackName =
    process.platform === 'win32' ? 'DriveSync-Setup-Windows-x64.exe' : 'DriveSync-Linux-x64.AppImage';
  const matched = assets.find((a) => typeof a.name === 'string' && wantExt.test(a.name));
  const assetName = matched?.name || fallbackName;
  const downloadUrl =
    matched?.browser_download_url ||
    `https://github.com/JoaoVitorSteffenDoNascimento/DriveSync/releases/latest/download/${assetName}`;

  const result: AppUpdateCheckResult = {
    currentVersion,
    latestVersion,
    hasUpdate,
    releaseUrl: payload.html_url || RELEASES_PAGE_URL,
    downloadUrl,
    assetName,
    assetSizeBytes: matched?.size,
    releaseNotes: payload.body,
    publishedAt: payload.published_at,
    checkedAt: new Date().toISOString(),
  };

  if (hasUpdate) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:update-available', result);
    }
    if (notifyOs && lastNotifiedVersion !== latestVersion && Notification.isSupported()) {
      lastNotifiedVersion = latestVersion;
      const n = new Notification({
        title: `DriveSync v${latestVersion} disponível`,
        body: 'Clique para abrir o DriveSync e atualizar com 1 clique.',
      });
      n.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (!mainWindow.isVisible()) mainWindow.show();
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      });
      n.show();
    }
  }

  return result;
}

async function downloadBinaryToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, {
    headers: { 'User-Agent': `DriveSync-Desktop/${app.getVersion()}` },
  });
  if (!res.ok) {
    throw new Error(`Falha no download da atualização (HTTP ${res.status}).`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.tmp`;
  fs.writeFileSync(tmpPath, buf);
  fs.renameSync(tmpPath, destPath);
}

function findLocalRepoForUpdate(): string | null {
  const candidates = [process.cwd(), path.join(os.homedir(), 'Projetos', 'DriveSync')];
  for (const dir of candidates) {
    if (
      fs.existsSync(path.join(dir, '.git')) &&
      fs.existsSync(path.join(dir, 'packaging', 'scripts', 'install-local-linux.sh'))
    ) {
      return dir;
    }
  }
  return null;
}

async function installDesktopUpdate(rawDownloadUrl?: string): Promise<{
  started: boolean;
  mode: string;
  detail: string;
}> {
  const fallbackUrl =
    process.platform === 'win32'
      ? 'https://github.com/JoaoVitorSteffenDoNascimento/DriveSync/releases/latest/download/DriveSync-Setup-Windows-x64.exe'
      : 'https://github.com/JoaoVitorSteffenDoNascimento/DriveSync/releases/latest/download/DriveSync-Linux-x64.AppImage';
  const targetUrl =
    rawDownloadUrl && rawDownloadUrl.startsWith('https://') ? rawDownloadUrl : fallbackUrl;

  if (process.platform === 'win32') {
    const installerPath = path.join(os.tmpdir(), 'DriveSync-Setup-Update.exe');
    await downloadBinaryToFile(targetUrl, installerPath);
    const child = spawn(installerPath, [], { detached: true, stdio: 'ignore' });
    child.unref();
    isQuitting = true;
    setTimeout(() => app.quit(), 400);
    return {
      started: true,
      mode: 'windows_installer',
      detail: 'Instalador baixado e iniciado em segundo plano.',
    };
  }

  if (process.platform === 'linux') {
    const runningAppImage = process.env.APPIMAGE;
    if (runningAppImage) {
      await downloadBinaryToFile(targetUrl, runningAppImage);
      fs.chmodSync(runningAppImage, 0o755);
      app.relaunch({ execPath: runningAppImage });
      isQuitting = true;
      setTimeout(() => app.quit(), 350);
      return {
        started: true,
        mode: 'appimage_relaunch',
        detail: 'Nova versão do AppImage baixada; reiniciando aplicativo.',
      };
    }

    const localRepo = findLocalRepoForUpdate();
    if (!app.isPackaged && localRepo) {
      const localBin = path.join(os.homedir(), '.local', 'bin', 'drivesync');
      const updaterScript = [
        'sleep 1',
        `git -C ${JSON.stringify(localRepo)} pull --ff-only`,
        `bash ${JSON.stringify(path.join(localRepo, 'packaging', 'scripts', 'install-local-linux.sh'))}`,
        `setsid -f ${JSON.stringify(localBin)} </dev/null >/dev/null 2>&1`,
      ].join(' && ');
      const child = spawn('bash', ['-lc', updaterScript], { detached: true, stdio: 'ignore' });
      child.unref();
      isQuitting = true;
      setTimeout(() => app.quit(), 350);
      return {
        started: true,
        mode: 'linux_local_rebuild',
        detail: 'Atualizando instalação local e reiniciando o DriveSync...',
      };
    }

    const appImageDest = path.join(os.homedir(), '.local', 'share', 'drivesync', 'DriveSync.AppImage');
    await downloadBinaryToFile(targetUrl, appImageDest);
    fs.chmodSync(appImageDest, 0o755);
    const child = spawn(appImageDest, [], { detached: true, stdio: 'ignore' });
    child.unref();
    isQuitting = true;
    setTimeout(() => app.quit(), 400);
    return {
      started: true,
      mode: 'linux_appimage',
      detail: 'Nova versão baixada e iniciada.',
    };
  }

  await shell.openExternal(RELEASES_PAGE_URL);
  return { started: true, mode: 'browser_download', detail: 'Página de download aberta no navegador.' };
}

function buildLinuxSystemUninstallCmd(): string {
  const pkgInstalled =
    fs.existsSync('/opt/DriveSync') || fs.existsSync('/usr/lib/drivesync') || fs.existsSync('/usr/bin/drivesync');
  if (!pkgInstalled) return '';

  const candidates: Array<{ bin: string; cmd: string }> = [
    {
      bin: 'pacman',
      cmd: 'if pacman -Qi drivesync >/dev/null 2>&1; then pacman -Rns --noconfirm drivesync; elif pacman -Qi drivesync-desktop >/dev/null 2>&1; then pacman -Rns --noconfirm drivesync-desktop; fi',
    },
    { bin: 'apt-get', cmd: 'apt-get remove -y drivesync || true' },
    { bin: 'dnf', cmd: 'dnf remove -y drivesync || true' },
    { bin: 'rpm', cmd: 'rpm -e drivesync || true' },
  ];

  for (const item of candidates) {
    try {
      const resolved = execFileSync('which', [item.bin], { encoding: 'utf8' }).trim();
      if (resolved) return item.cmd;
    } catch {
      // tenta o próximo gerenciador
    }
  }
  return '';
}

async function performDesktopUninstall(purgeData = false): Promise<{ started: boolean; detail: string }> {
  stopDaemon();
  applyAutoStart(false);

  if (process.platform === 'linux') {
    const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    const cfgHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    const pathsToRemove = [
      path.join(dataHome, 'drivesync'),
      path.join(os.homedir(), '.local', 'bin', 'drivesync'),
      path.join(os.homedir(), '.local', 'bin', 'drivesync-uninstall'),
      path.join(dataHome, 'applications', 'drivesync.desktop'),
      path.join(dataHome, 'icons', 'hicolor', '512x512', 'apps', 'drivesync.png'),
      path.join(cfgHome, 'autostart', 'drivesync.desktop'),
    ];
    if (process.env.APPIMAGE) {
      pathsToRemove.push(process.env.APPIMAGE);
    }
    if (purgeData) {
      pathsToRemove.push(path.join(cfgHome, 'DriveSync'));
    }

    const sysCmd = buildLinuxSystemUninstallCmd();
    const lines = [
      'sleep 0.6',
      'for target in "$@"; do rm -rf "$target"; done',
      `update-desktop-database ${JSON.stringify(path.join(dataHome, 'applications'))} >/dev/null 2>&1 || true`,
    ];
    if (sysCmd) {
      lines.push(
        `if command -v pkexec >/dev/null 2>&1; then pkexec sh -c ${JSON.stringify(sysCmd)} || true; fi`,
      );
    }
    lines.push(
      'if command -v notify-send >/dev/null 2>&1; then notify-send "DriveSync desinstalado" "O aplicativo foi removido. Suas pastas sincronizadas permanecem intactas." >/dev/null 2>&1 || true; fi',
    );

    const child = spawn('bash', ['-c', lines.join('; '), '--', ...pathsToRemove], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    isQuitting = true;
    setTimeout(() => app.quit(), 250);
    return {
      started: true,
      detail: 'Desinstalação iniciada no Linux. Suas pastas sincronizadas permanecem intactas.',
    };
  }

  if (process.platform === 'win32') {
    const execDir = path.dirname(process.execPath);
    const uninstaller = [
      path.join(execDir, 'Uninstall DriveSync.exe'),
      path.join(execDir, '..', 'Uninstall DriveSync.exe'),
    ].find((candidate) => fs.existsSync(candidate));

    if (purgeData) {
      try {
        fs.rmSync(app.getPath('userData'), { recursive: true, force: true });
      } catch {
        // ignora erro se em uso antes de sair
      }
    }

    if (uninstaller) {
      const child = spawn(uninstaller, [], { detached: true, stdio: 'ignore' });
      child.unref();
    } else {
      await shell.openExternal('ms-settings:appsfeatures');
    }
    isQuitting = true;
    setTimeout(() => app.quit(), 300);
    return {
      started: true,
      detail: 'Desinstalador do Windows iniciado.',
    };
  }

  return { started: false, detail: 'Desinstalação direta não suportada neste sistema.' };
}

function handleInteractiveUninstallDialog(): boolean {
  const options: Electron.MessageBoxSyncOptions = {
    type: 'warning',
    title: 'Desinstalar DriveSync',
    message: 'Deseja desinstalar o DriveSync deste computador?',
    detail:
      'Suas pastas sincronizadas no computador e no Google Drive continuarão intactas.',
    buttons: [
      'Cancelar',
      'Desinstalar (manter configurações)',
      'Desinstalar e apagar dados do app',
    ],
    defaultId: 0,
    cancelId: 0,
  };
  const choice = mainWindow
    ? dialog.showMessageBoxSync(mainWindow, options)
    : dialog.showMessageBoxSync(options);
  if (choice === 1 || choice === 2) {
    void performDesktopUninstall(choice === 2);
    return true;
  }
  return false;
}

const sessionToken = crypto.randomBytes(24).toString('hex');

const TRAY_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="16" fill="#2563EB"/>
  <path d="M21 42h23a9 9 0 0 0 1.4-17.9A13 13 0 0 0 20.3 21.5 10 10 0 0 0 21 42Z" fill="#FFFFFF"/>
  <path d="M27 31l5-5 5 5M32 26v11" stroke="#2563EB" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>
`;

function createTrayIcon() {
  const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(TRAY_ICON_SVG).toString('base64');
  return nativeImage.createFromDataURL(dataUrl).resize({ width: 20, height: 20 });
}

function resolveEngineLaunch(): { command: string; args: string[]; cwd?: string } {
  const binName = process.platform === 'win32' ? 'drivesyncd.exe' : 'drivesyncd';
  const commonArgs = ['--port', '0', '--token', sessionToken];

  if (process.env.DRIVESYNC_ENGINE_BIN && fs.existsSync(process.env.DRIVESYNC_ENGINE_BIN)) {
    return { command: process.env.DRIVESYNC_ENGINE_BIN, args: commonArgs };
  }

  if (app.isPackaged) {
    const packagedBin = path.join(process.resourcesPath, 'bin', binName);
    return { command: packagedBin, args: commonArgs };
  }

  const localBundledBin = path.resolve(__dirname, '..', 'bin', binName);
  if (fs.existsSync(localBundledBin)) {
    return { command: localBundledBin, args: commonArgs };
  }

  const devBin = path.resolve(__dirname, '..', '..', 'engine', 'bin', binName);
  if (fs.existsSync(devBin)) {
    return { command: devBin, args: commonArgs };
  }

  const engineDir = path.resolve(__dirname, '..', '..', 'engine');
  return {
    command: 'go',
    args: ['run', '-buildvcs=false', './cmd/drivesyncd', ...commonArgs],
    cwd: engineDir,
  };
}

function startDaemon(): Promise<number> {
  return new Promise((resolve, reject) => {
    const launch = resolveEngineLaunch();
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    daemonProc = child;

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Tempo limite ao iniciar o motor drivesyncd.'));
      }
    }, 20000);

    let buffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const match = /^DRIVESYNCD_READY\s+port=(\d+)/.exec(line.trim());
        if (match && !settled) {
          settled = true;
          clearTimeout(timeout);
          daemonPort = Number(match[1]);
          resolve(daemonPort);
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) {
        console.error('[drivesyncd]', text);
      }
    });

    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Motor drivesyncd encerrou prematuramente (código ${code}).`));
      }
      daemonProc = null;
    });
  });
}

function stopDaemon() {
  if (daemonProc && !daemonProc.killed) {
    daemonProc.kill('SIGTERM');
    daemonProc = null;
  }
}

async function triggerSyncAllFromTray() {
  if (!daemonPort) return;
  try {
    const res = await fetch(`http://127.0.0.1:${daemonPort}/api/folders`, {
      headers: { 'X-DriveSync-Token': sessionToken },
    });
    if (!res.ok) return;
    const folders = (await res.json()) as Array<{ id: string }>;
    await Promise.all(
      folders.map((f) =>
        fetch(`http://127.0.0.1:${daemonPort}/api/folders/${encodeURIComponent(f.id)}/sync`, {
          method: 'POST',
          headers: { 'X-DriveSync-Token': sessionToken },
        }),
      ),
    );
  } catch {
    // Silencioso no tray
  }
}

function setupTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip('DriveSync — Sincronização ativa');
  const menu = Menu.buildFromTemplate([
    {
      label: 'Abrir DriveSync',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Sincronizar Pastas Agora',
      click: () => {
        void triggerSyncAllFromTray();
      },
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  const iconCandidate = path.resolve(__dirname, '..', 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1020,
    height: 700,
    minWidth: 820,
    minHeight: 580,
    title: 'DriveSync',
    icon: fs.existsSync(iconCandidate) ? iconCandidate : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.resolve(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting && minimizeToTrayPref) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function applyAutoStart(enabled: boolean) {
  if (process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return;
  }
  if (process.platform === 'linux') {
    const autostartDir = path.join(os.homedir(), '.config', 'autostart');
    const desktopFile = path.join(autostartDir, 'drivesync.desktop');
    if (!enabled) {
      if (fs.existsSync(desktopFile)) {
        fs.unlinkSync(desktopFile);
      }
      return;
    }
    fs.mkdirSync(autostartDir, { recursive: true });
    const localLauncher = path.join(os.homedir(), '.local', 'bin', 'drivesync');
    const systemLauncher = '/usr/bin/drivesync';
    let execCmd = `"${process.execPath}"`;
    if (!app.isPackaged) {
      if (fs.existsSync(localLauncher)) {
        execCmd = `"${localLauncher}"`;
      } else if (fs.existsSync(systemLauncher)) {
        execCmd = `"${systemLauncher}"`;
      } else {
        execCmd = `"${process.execPath}" "${app.getAppPath()}"`;
      }
    }
    const content = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=DriveSync',
      'Comment=Sincronização simples com Google Drive',
      `Exec=${execCmd}`,
      'Icon=drivesync',
      'Terminal=false',
      'X-GNOME-Autostart-enabled=true',
      '',
    ].join('\n');
    fs.writeFileSync(desktopFile, content, 'utf8');
  }
}

function tryOpenLinuxGuiFileManager(dirPath: string): boolean {
  let defaultHandler = '';
  try {
    defaultHandler = execFileSync('xdg-mime', ['query', 'default', 'inode/directory'], {
      encoding: 'utf8',
    })
      .trim()
      .toLowerCase();
  } catch {
    defaultHandler = '';
  }

  const terminalHandlers = ['kitty', 'alacritty', 'foot', 'wezterm', 'konsole', 'gnome-terminal', 'xterm'];
  const pointsToTerminal =
    !defaultHandler || terminalHandlers.some((term) => defaultHandler.includes(term));

  if (!pointsToTerminal) {
    return false;
  }

  const guiManagers = ['dolphin', 'thunar', 'nautilus', 'nemo', 'pcmanfm', 'pcmanfm-qt', 'caja'];
  for (const fm of guiManagers) {
    try {
      const resolved = execFileSync('which', [fm], { encoding: 'utf8' }).trim();
      if (resolved) {
        const child = spawn(resolved, [dirPath], { detached: true, stdio: 'ignore' });
        child.unref();
        return true;
      }
    } catch {
      // tenta o próximo gerenciador gráfico
    }
  }
  return false;
}

function registerIPC() {
  ipcMain.handle('daemon:connection', () => ({
    baseUrl: `http://127.0.0.1:${daemonPort}`,
    wsUrl: `ws://127.0.0.1:${daemonPort}/ws?token=${encodeURIComponent(sessionToken)}`,
    token: sessionToken,
  }));

  ipcMain.handle('dialog:select-folder', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Escolher pasta no computador',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:select-files', async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Escolher arquivos para adicionar na pasta',
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  ipcMain.handle('dialog:select-folders-to-add', async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Escolher pastas para adicionar',
      properties: ['openDirectory', 'multiSelections'],
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  ipcMain.handle('shell:open-external', async (_ev, rawUrl: string) => {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Protocolo de URL não permitido');
    }
    await shell.openExternal(parsed.toString());
  });

  ipcMain.handle('shell:open-path', async (_ev, targetPath: string) => {
    if (!targetPath) return;
    const isFile = fs.existsSync(targetPath) && fs.statSync(targetPath).isFile();
    if (process.platform === 'linux') {
      const dirToOpen = isFile ? path.dirname(targetPath) : targetPath;
      if (tryOpenLinuxGuiFileManager(dirToOpen)) {
        return;
      }
    }
    if (isFile) {
      shell.showItemInFolder(targetPath);
      return;
    }
    await shell.openPath(targetPath);
  });

  ipcMain.handle('app:set-autostart', (_ev, enabled: boolean) => {
    applyAutoStart(Boolean(enabled));
  });

  ipcMain.handle('app:check-update', (_ev, notifyOs?: boolean) =>
    checkDesktopUpdate(notifyOs !== false),
  );

  ipcMain.handle('app:install-update', (_ev, downloadUrl?: string) =>
    installDesktopUpdate(downloadUrl),
  );

  ipcMain.handle('app:uninstall', (_ev, options?: { purgeData?: boolean }) =>
    performDesktopUninstall(Boolean(options?.purgeData)),
  );
}

app.setName('DriveSync');

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(sig, () => {
    isQuitting = true;
    app.quit();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_ev, commandLine) => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    if (commandLine.includes('--uninstall') || commandLine.includes('uninstall')) {
      handleInteractiveUninstallDialog();
    }
  });

  app.whenReady().then(async () => {
    if (process.argv.includes('--uninstall') || process.argv.includes('uninstall')) {
      const started = handleInteractiveUninstallDialog();
      if (!started) {
        isQuitting = true;
        app.quit();
      }
      return;
    }
    registerIPC();
    try {
      await startDaemon();
      // Sincroniza preferência de tray com o daemon
      try {
        const res = await fetch(`http://127.0.0.1:${daemonPort}/api/settings`, {
          headers: { 'X-DriveSync-Token': sessionToken },
        });
        if (res.ok) {
          const st = (await res.json()) as { minimizeToTray?: boolean };
          if (typeof st.minimizeToTray === 'boolean') {
            minimizeToTrayPref = st.minimizeToTray;
          }
        }
      } catch {
        // mantém padrão true
      }
      setupTray();
      createWindow();
      setTimeout(() => {
        void checkDesktopUpdate(true).catch(() => {});
      }, 5000);
      setInterval(() => {
        void checkDesktopUpdate(true).catch(() => {});
      }, 30 * 60 * 1000);
    } catch (err) {
      dialog.showErrorBox(
        'Erro ao iniciar o DriveSync',
        err instanceof Error ? err.message : String(err),
      );
      app.quit();
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
    stopDaemon();
  });

  app.on('window-all-closed', () => {
    if (!minimizeToTrayPref) {
      isQuitting = true;
      app.quit();
    }
  });
}
