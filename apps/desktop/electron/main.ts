import {
  app,
  BrowserWindow,
  Menu,
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

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let daemonProc: ChildProcess | null = null;
let daemonPort = 0;
let isQuitting = false;
let minimizeToTrayPref = true;

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
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
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
