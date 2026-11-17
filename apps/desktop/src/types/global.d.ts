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
}

declare global {
  interface Window {
    driveSyncDesktop?: DesktopBridge;
  }
}
