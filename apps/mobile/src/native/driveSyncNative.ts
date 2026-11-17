import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  MAX_UPLOAD_BYTES,
  type AccountInfo,
  type AppSettings,
  type CreateFolderInput,
  type DaemonSnapshot,
  type FolderContentsResponse,
  type FolderInviteInfo,
  type ImportPathsResult,
  type RemoteFolderItem,
  type ResolvedFolderCode,
  type SharePermissionInput,
  type SyncFolderConfig,
} from '@drivesync/shared';

export interface MobileSettings extends AppSettings {
  wifiOnly: boolean;
  backgroundSyncEnabled: boolean;
}

export interface MobileSnapshot extends Omit<DaemonSnapshot, 'settings'> {
  settings: MobileSettings;
}

export interface PickedMobileFolder {
  uri: string;
  displayName: string;
}

export interface DriveSyncNativePlugin {
  getSnapshot(): Promise<MobileSnapshot>;
  saveOAuthClient(options: { clientId: string; clientSecret: string }): Promise<AccountInfo>;
  uploadGoogleOAuthJson(options: { rawJson: string }): Promise<AccountInfo>;
  pickAndLoadOAuthJson(): Promise<AccountInfo>;
  startGoogleOAuth(): Promise<AccountInfo>;
  cancelGoogleOAuth(): Promise<{ ok: boolean }>;
  disconnectAccount(): Promise<{ ok: boolean }>;
  pickLocalFolder(): Promise<PickedMobileFolder>;
  pickAndImportFiles(options: { folderId: string; subpath?: string }): Promise<ImportPathsResult>;
  listFolderContents(options: { folderId: string; subpath: string }): Promise<FolderContentsResponse>;
  createSubfolder(options: { folderId: string; subpath: string; name: string }): Promise<{ ok: boolean }>;
  listDriveFolders(options: { parentId: string; shared: boolean }): Promise<{ items: RemoteFolderItem[] }>;
  createDriveFolder(options: { name: string; parentId: string }): Promise<RemoteFolderItem>;
  resolveFolderCode(options: { codeOrLink: string }): Promise<ResolvedFolderCode>;
  generateFolderInvite(options: { folderId: string }): Promise<FolderInviteInfo>;
  shareFolder(options: { folderId: string; input: SharePermissionInput }): Promise<{ shared: boolean }>;
  createSyncFolder(options: { input: CreateFolderInput }): Promise<SyncFolderConfig>;
  updateSyncFolder(options: { folder: SyncFolderConfig }): Promise<SyncFolderConfig>;
  deleteSyncFolder(options: { folderId: string }): Promise<{ deleted: boolean }>;
  forgetDevice(options: { folderId: string; deviceId: string }): Promise<{ ok: boolean }>;
  syncNow(options: { folderId: string }): Promise<{ started: boolean }>;
  updateSettings(options: { settings: MobileSettings }): Promise<MobileSettings>;
  addListener?: (
    eventName: 'authUrlReady',
    listenerFunc: (data: { authUrl: string }) => void,
  ) => Promise<PluginListenerHandle>;
}

const NativePlugin = registerPlugin<DriveSyncNativePlugin>('DriveSyncNative');

const defaultPreviewSnapshot: MobileSnapshot = {
  account: {
    connected: false,
    email: '',
    displayName: '',
    authSource: 'none',
    hasCustomOAuthClient: false,
  },
  settings: {
    deviceId: 'android-preview',
    deviceName: 'Meu Celular (Preview Web)',
    maxUploadBytes: MAX_UPLOAD_BYTES,
    pollIntervalSeconds: 900,
    startOnBoot: true,
    minimizeToTray: false,
    enableWaybarBridge: false,
    defaultOnRemoteDelete: 'keep_local',
    wifiOnly: true,
    backgroundSyncEnabled: true,
  },
  folders: [],
  runtime: {},
  devices: [],
  knownSenders: [],
  blockedFiles: [],
  recentActivity: [],
};

let previewState: MobileSnapshot = structuredClone(defaultPreviewSnapshot);

export const mobileBridge: DriveSyncNativePlugin = Capacitor.isNativePlatform()
  ? NativePlugin
  : {
      async getSnapshot() {
        return structuredClone(previewState);
      },
      async saveOAuthClient({ clientId }) {
        previewState.account.hasCustomOAuthClient = Boolean(clientId.trim());
        return previewState.account;
      },
      async uploadGoogleOAuthJson() {
        previewState.account.hasCustomOAuthClient = true;
        return previewState.account;
      },
      async pickAndLoadOAuthJson() {
        previewState.account.hasCustomOAuthClient = true;
        return previewState.account;
      },
      async startGoogleOAuth() {
        previewState.account = {
          connected: true,
          email: 'preview@gmail.com',
          displayName: 'Preview Mobile',
          authSource: 'oauth_pkce',
          hasCustomOAuthClient: true,
        };
        return previewState.account;
      },
      async cancelGoogleOAuth() {
        return { ok: true };
      },
      async disconnectAccount() {
        previewState.account = {
          connected: false,
          email: '',
          displayName: '',
          authSource: 'none',
          hasCustomOAuthClient: previewState.account.hasCustomOAuthClient,
        };
        return { ok: true };
      },
      async pickLocalFolder() {
        return { uri: 'content://com.android.externalstorage.documents/tree/primary%3ADriveSync', displayName: 'Armazenamento/DriveSync' };
      },
      async pickAndImportFiles() {
        return { addedCount: 0, skippedOver4GB: [], errors: [] };
      },
      async listFolderContents({ folderId, subpath }) {
        return {
          folderId,
          folderName: 'Drive Master',
          localPath: 'content://mock/DriveSync',
          subpath,
          items: [],
        };
      },
      async createSubfolder() {
        return { ok: true };
      },
      async listDriveFolders() {
        return { items: [] };
      },
      async createDriveFolder({ name }) {
        return { id: `dir-${Date.now()}`, name, shared: false, canWrite: true };
      },
      async resolveFolderCode({ codeOrLink }) {
        return {
          remoteFolderId: 'mock-id',
          remoteFolderName: codeOrLink,
          kind: 'master',
          canWrite: true,
          matchedBy: 'full_code',
        };
      },
      async generateFolderInvite({ folderId }) {
        return {
          folderId,
          folderName: 'Pasta',
          shortCode: 'DS-DEMO-2026',
          fullCode: `DS1.${folderId}.DS-DEMO-2026`,
          driveUrl: `https://drive.google.com/drive/folders/${folderId}`,
          kind: 'master',
        };
      },
      async shareFolder() {
        return { shared: true };
      },
      async createSyncFolder({ input }) {
        const cfg: SyncFolderConfig = {
          ...input,
          id: `mob-${Date.now()}`,
          paused: false,
          createdAt: new Date().toISOString(),
        };
        previewState.folders.push(cfg);
        return cfg;
      },
      async updateSyncFolder({ folder }) {
        previewState.folders = previewState.folders.map((f) => (f.id === folder.id ? folder : f));
        return folder;
      },
      async deleteSyncFolder({ folderId }) {
        previewState.folders = previewState.folders.filter((f) => f.id !== folderId);
        return { deleted: true };
      },
      async forgetDevice({ folderId, deviceId }) {
        previewState.devices = previewState.devices.filter(
          (d) => !(d.folderId === folderId && d.deviceId === deviceId),
        );
        return { ok: true };
      },
      async syncNow() {
        return { started: true };
      },
      async updateSettings({ settings }) {
        previewState.settings = settings;
        return settings;
      },
    };
