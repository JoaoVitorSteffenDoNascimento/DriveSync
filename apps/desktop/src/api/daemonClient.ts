import type {
  AccountInfo,
  AppSettings,
  CreateFolderInput,
  DaemonSnapshot,
  FolderContentsResponse,
  FolderInviteInfo,
  ImportPathsResult,
  RemoteFolderItem,
  ResolvedFolderCode,
  SharePermissionInput,
  SyncFolderConfig,
} from '@drivesync/shared';
import type { DaemonConnectionInfo } from '../types/global';

export class DaemonClient {
  private baseUrl: string;
  private wsUrl: string;
  private token: string;

  constructor(conn: DaemonConnectionInfo) {
    this.baseUrl = conn.baseUrl;
    this.wsUrl = conn.wsUrl;
    this.token = conn.token;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-DriveSync-Token': this.token,
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new Error(data.error || `Erro HTTP ${res.status}`);
    }
    return data as T;
  }

  getSnapshot(): Promise<DaemonSnapshot> {
    return this.request<DaemonSnapshot>('/api/snapshot');
  }

  saveOAuthClient(clientId: string, clientSecret: string): Promise<AccountInfo> {
    return this.request<AccountInfo>('/api/auth/oauth/client', {
      method: 'POST',
      body: JSON.stringify({ clientId, clientSecret }),
    });
  }

  uploadGoogleOAuthJson(rawJson: string): Promise<AccountInfo> {
    return this.request<AccountInfo>('/api/auth/oauth/google-json', {
      method: 'POST',
      body: rawJson,
    });
  }

  startOAuth(): Promise<{ authUrl: string; redirectUri: string }> {
    return this.request<{ authUrl: string; redirectUri: string }>('/api/auth/oauth/start', {
      method: 'POST',
    });
  }

  cancelOAuth(): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>('/api/auth/oauth/cancel', {
      method: 'POST',
    });
  }

  importFromRclone(remoteName = 'gdrive'): Promise<AccountInfo> {
    return this.request<AccountInfo>('/api/auth/import-rclone', {
      method: 'POST',
      body: JSON.stringify({ remoteName }),
    });
  }

  disconnectAccount(): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>('/api/auth/disconnect', {
      method: 'POST',
    });
  }

  resolveFolderCode(codeOrLink: string): Promise<ResolvedFolderCode> {
    return this.request<ResolvedFolderCode>('/api/drive/resolve-code', {
      method: 'POST',
      body: JSON.stringify({ codeOrLink }),
    });
  }

  generateFolderInvite(folderId: string): Promise<FolderInviteInfo> {
    return this.request<FolderInviteInfo>(`/api/folders/${encodeURIComponent(folderId)}/invite`, {
      method: 'POST',
    });
  }

  shareFolder(folderId: string, input: SharePermissionInput): Promise<{ shared: boolean }> {
    return this.request<{ shared: boolean }>(`/api/folders/${encodeURIComponent(folderId)}/share`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  listFolderContents(folderId: string, subpath = ''): Promise<FolderContentsResponse> {
    const q = new URLSearchParams({ subpath });
    return this.request<FolderContentsResponse>(
      `/api/folders/${encodeURIComponent(folderId)}/files?${q.toString()}`,
    );
  }

  createSubfolder(folderId: string, subpath: string, name: string): Promise<{ created: boolean }> {
    return this.request<{ created: boolean }>(
      `/api/folders/${encodeURIComponent(folderId)}/mkdir`,
      {
        method: 'POST',
        body: JSON.stringify({ subpath, name }),
      },
    );
  }

  importLocalPaths(
    folderId: string,
    subpath: string,
    paths: string[],
  ): Promise<ImportPathsResult> {
    return this.request<ImportPathsResult>(
      `/api/folders/${encodeURIComponent(folderId)}/import-paths`,
      {
        method: 'POST',
        body: JSON.stringify({ subpath, paths }),
      },
    );
  }

  listDriveFolders(parentId = 'root', shared = false): Promise<RemoteFolderItem[]> {
    const q = new URLSearchParams({ parentId, shared: String(shared) });
    return this.request<RemoteFolderItem[]>(`/api/drive/folders?${q.toString()}`);
  }

  createDriveFolder(name: string, parentId = 'root'): Promise<RemoteFolderItem> {
    return this.request<RemoteFolderItem>('/api/drive/folders', {
      method: 'POST',
      body: JSON.stringify({ name, parentId }),
    });
  }

  createSyncFolder(input: CreateFolderInput): Promise<SyncFolderConfig> {
    return this.request<SyncFolderConfig>('/api/folders', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  updateSyncFolder(folder: SyncFolderConfig): Promise<SyncFolderConfig> {
    return this.request<SyncFolderConfig>(`/api/folders/${encodeURIComponent(folder.id)}`, {
      method: 'PUT',
      body: JSON.stringify(folder),
    });
  }

  deleteSyncFolder(folderId: string): Promise<{ deleted: boolean }> {
    return this.request<{ deleted: boolean }>(`/api/folders/${encodeURIComponent(folderId)}`, {
      method: 'DELETE',
    });
  }

  syncNow(folderId: string): Promise<{ started: boolean }> {
    return this.request<{ started: boolean }>(`/api/folders/${encodeURIComponent(folderId)}/sync`, {
      method: 'POST',
    });
  }

  resendKeptFile(folderId: string, relativePath: string): Promise<{ started: boolean }> {
    return this.request<{ started: boolean }>(`/api/folders/${encodeURIComponent(folderId)}/resend`, {
      method: 'POST',
      body: JSON.stringify({ relativePath }),
    });
  }

  updateSettings(settings: AppSettings): Promise<AppSettings> {
    return this.request<AppSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  forgetDevice(folderId: string, deviceId: string): Promise<{ deleted: boolean }> {
    return this.request<{ deleted: boolean }>(
      `/api/devices/${encodeURIComponent(folderId)}/${encodeURIComponent(deviceId)}`,
      { method: 'DELETE' },
    );
  }

  connectWebSocket(onMessage: (ev: { type: string; payload: unknown }) => void): () => void {
    let closed = false;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      if (closed) return;
      ws = new WebSocket(this.wsUrl);
      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data));
          onMessage(parsed);
        } catch {
          // ignora mensagem malformada
        }
      };
      ws.onclose = () => {
        if (!closed) {
          retryTimer = setTimeout(open, 2500);
        }
      };
    };

    open();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }
}
