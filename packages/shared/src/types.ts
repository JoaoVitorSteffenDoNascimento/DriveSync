export type FolderKind = 'personal' | 'master';

export type SyncDirection = 'bidirectional' | 'receive_only';

export type RemoteDeletePolicy = 'keep_local' | 'mirror_trash';

export type LocalDeletePolicy = 'ignore' | 'trash_remote';

export type SenderPolicyMode = 'all' | 'blocklist' | 'allowlist';

export type UnknownSenderAction = 'allow' | 'block';

export interface SenderRule {
  email: string;
  displayName?: string;
  allowed: boolean;
}

export interface SenderPolicy {
  mode: SenderPolicyMode;
  unknownSenderAction: UnknownSenderAction;
  rules: SenderRule[];
}

export interface KnownSender {
  folderId: string;
  email: string;
  displayName: string;
  lastSeenAt: string;
}

export interface SyncFolderConfig {
  id: string;
  name: string;
  localPath: string;
  remoteFolderId: string;
  remoteFolderName: string;
  kind: FolderKind;
  direction: SyncDirection;
  onRemoteDelete: RemoteDeletePolicy;
  onLocalDelete: LocalDeletePolicy;
  senderPolicy: SenderPolicy;
  paused: boolean;
  shareCode?: string;
  createdAt: string;
}

export interface FolderInviteInfo {
  folderId: string;
  folderName: string;
  shortCode: string;
  fullCode: string;
  driveUrl: string;
  kind: FolderKind;
}

export interface ResolvedFolderCode {
  remoteFolderId: string;
  remoteFolderName: string;
  shortCode?: string;
  kind: FolderKind;
  ownerEmail?: string;
  ownerName?: string;
  canWrite: boolean;
  matchedBy: 'full_code' | 'drive_link' | 'short_code';
}

export interface SharePermissionInput {
  accessType: 'user' | 'anyone';
  role: 'reader' | 'writer';
  email?: string;
}

export interface FolderContentItem {
  name: string;
  relativePath: string;
  isDir: boolean;
  sizeBytes: number;
  modifiedAt: string;
  exceeds4gb: boolean;
  syncStatus?: 'synced' | 'sending' | 'pending' | 'blocked_4gb' | 'local_only';
  senderName?: string;
  senderEmail?: string;
}

export interface FolderContentsResponse {
  folderId: string;
  folderName: string;
  localPath: string;
  subpath: string;
  items: FolderContentItem[];
}

export interface ImportPathsResult {
  addedCount: number;
  skippedOver4GB: string[];
  errors: string[];
}

export type FolderSyncStatus = 'idle' | 'syncing' | 'ok' | 'warning' | 'error' | 'paused';

export interface FolderRuntimeState {
  folderId: string;
  status: FolderSyncStatus;
  message: string;
  lastSyncAt?: string;
  currentFile?: string;
  currentAction?: 'upload' | 'download';
  currentAuthor?: string;
  progressPercent?: number;
  bytesTransferred?: number;
  bytesTotal?: number;
  blocked4gbCount: number;
  ignoredSenderCount: number;
  keptLocalCount: number;
  syncedFilesCount: number;
}

export interface DeviceRegistration {
  deviceId: string;
  deviceName: string;
  platform: 'linux' | 'windows' | 'android' | 'ios' | 'macos' | string;
  arch: string;
  appVersion: string;
  accountEmail: string;
  syncMode: SyncDirection;
  folderId: string;
  status: 'online' | 'syncing' | 'paused' | 'readonly';
  lastSeenAt: string;
  isCurrentDevice?: boolean;
}

export interface AccountInfo {
  connected: boolean;
  email: string;
  displayName: string;
  authSource: 'oauth_pkce' | 'rclone_import' | 'none';
  hasCustomOAuthClient: boolean;
}

export interface AppSettings {
  deviceId: string;
  deviceName: string;
  maxUploadBytes: number;
  pollIntervalSeconds: number;
  startOnBoot: boolean;
  minimizeToTray: boolean;
  enableWaybarBridge: boolean;
  defaultOnRemoteDelete: RemoteDeletePolicy;
  syncRootPath?: string;
  autoSyncAccountFolders?: boolean;
}

export type BlockReason = 'exceeds_4gb' | 'sender_blocked' | 'ignore_pattern';

export interface BlockedFileEntry {
  id: number;
  folderId: string;
  folderName: string;
  relativePath: string;
  localPath?: string;
  fileSizeBytes: number;
  authorEmail?: string;
  authorName?: string;
  reason: BlockReason;
  detail: string;
  detectedAt: string;
}

export type ActivityLevel = 'info' | 'success' | 'warning' | 'error';

export interface ActivityEvent {
  id: number;
  folderId: string;
  folderName: string;
  kind:
    | 'upload'
    | 'download'
    | 'kept_local'
    | 'trashed_local'
    | 'blocked_4gb'
    | 'blocked_sender'
    | 'conflict'
    | 'sync_error'
    | 'system';
  level: ActivityLevel;
  message: string;
  relativePath?: string;
  authorEmail?: string;
  fileSizeBytes?: number;
  createdAt: string;
}

export interface RemoteFolderItem {
  id: string;
  name: string;
  shared: boolean;
  ownerEmail?: string;
  ownerName?: string;
  canWrite: boolean;
}

export interface DiscoveredRemoteFolder {
  remoteFolderId: string;
  remoteFolderName: string;
  kind: FolderKind;
  shortCode?: string;
  ownerEmail?: string;
  ownerName?: string;
  canWrite: boolean;
  deviceNames: string[];
  devices?: DeviceRegistration[];
  onRemoteDelete: RemoteDeletePolicy;
  onLocalDelete: LocalDeletePolicy;
  direction: SyncDirection;
  senderPolicy?: SenderPolicy;
}

export interface DaemonSnapshot {
  account: AccountInfo;
  settings: AppSettings;
  folders: SyncFolderConfig[];
  runtime: Record<string, FolderRuntimeState>;
  devices: DeviceRegistration[];
  knownSenders: KnownSender[];
  blockedFiles: BlockedFileEntry[];
  recentActivity: ActivityEvent[];
  discoveredFolders?: DiscoveredRemoteFolder[];
}

export interface CreateFolderInput {
  name: string;
  localPath: string;
  remoteFolderId: string;
  remoteFolderName: string;
  kind: FolderKind;
  direction: SyncDirection;
  onRemoteDelete: RemoteDeletePolicy;
  onLocalDelete: LocalDeletePolicy;
  senderPolicy: SenderPolicy;
}

export type AppUpdatePlatform = 'windows' | 'linux' | 'android';

export interface AppUpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
  downloadUrl: string;
  assetName: string;
  assetSizeBytes?: number;
  releaseNotes?: string;
  publishedAt?: string;
  checkedAt: string;
}
