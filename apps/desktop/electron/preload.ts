import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppUpdateCheckResult } from '@drivesync/shared';

export interface DaemonConnectionInfo {
  baseUrl: string;
  wsUrl: string;
  token: string;
}

export interface DesktopBridge {
  getDaemonConnection: () => Promise<DaemonConnectionInfo>;
  selectLocalFolder: () => Promise<string | null>;
  selectFilesToAdd: () => Promise<string[]>;
  selectFoldersToAdd: () => Promise<string[]>;
  getDroppedFilePaths: (files: FileList) => string[];
  openExternalUrl: (url: string) => Promise<void>;
  openPathInExplorer: (targetPath: string) => Promise<void>;
  setAutoStart: (enabled: boolean) => Promise<void>;
  getPlatformInfo: () => { platform: string; arch: string };
  checkForUpdates: (notifyOs?: boolean) => Promise<AppUpdateCheckResult>;
  installUpdate: (downloadUrl?: string) => Promise<{ started: boolean; mode: string; detail: string }>;
  onUpdateAvailable: (listener: (info: AppUpdateCheckResult) => void) => () => void;
}

const bridge: DesktopBridge = {
  getDaemonConnection: () => ipcRenderer.invoke('daemon:connection'),
  selectLocalFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  selectFilesToAdd: () => ipcRenderer.invoke('dialog:select-files'),
  selectFoldersToAdd: () => ipcRenderer.invoke('dialog:select-folders-to-add'),
  getDroppedFilePaths: (files: FileList) =>
    Array.from(files)
      .map((f) => webUtils.getPathForFile(f))
      .filter((p) => Boolean(p)),
  openExternalUrl: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  openPathInExplorer: (targetPath: string) => ipcRenderer.invoke('shell:open-path', targetPath),
  setAutoStart: (enabled: boolean) => ipcRenderer.invoke('app:set-autostart', enabled),
  getPlatformInfo: () => ({
    platform: process.platform,
    arch: process.arch,
  }),
  checkForUpdates: (notifyOs = false) => ipcRenderer.invoke('app:check-update', notifyOs),
  installUpdate: (downloadUrl?: string) => ipcRenderer.invoke('app:install-update', downloadUrl),
  onUpdateAvailable: (listener) => {
    const handler = (_ev: Electron.IpcRendererEvent, info: AppUpdateCheckResult) => listener(info);
    ipcRenderer.on('app:update-available', handler);
    return () => ipcRenderer.removeListener('app:update-available', handler);
  },
};

contextBridge.exposeInMainWorld('driveSyncDesktop', bridge);
