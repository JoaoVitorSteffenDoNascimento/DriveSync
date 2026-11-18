import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Cloud,
  CloudDownload,
  FolderSync,
  Settings,
  Users,
} from 'lucide-react';
import type { AppUpdateCheckResult, DaemonSnapshot, FolderRuntimeState } from '@drivesync/shared';
import {
  APP_VERSION,
  GITHUB_RELEASES_LATEST_API,
  GITHUB_RELEASES_URL,
  formatBytes,
  parseGitHubReleaseForPlatform,
} from '@drivesync/shared';
import { DaemonClient } from './api/daemonClient';
import { ConnectFolderWizard } from './components/ConnectFolderWizard';
import { ConnectGoogleModal } from './components/ConnectGoogleModal';
import { ActivityPage } from './pages/ActivityPage';
import { DevicesAndPeoplePage } from './pages/DevicesAndPeoplePage';
import { FoldersPage } from './pages/FoldersPage';
import { SettingsPage } from './pages/SettingsPage';

type Tab = 'folders' | 'devices' | 'activity' | 'settings';

export const App: React.FC<{ overrideClient?: DaemonClient }> = ({ overrideClient }) => {
  const [client, setClient] = useState<DaemonClient | null>(overrideClient ?? null);
  const [snapshot, setSnapshot] = useState<DaemonSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('folders');
  const [activityTab, setActivityTab] = useState<'activity' | 'blocked_4gb' | 'blocked_sender'>('activity');
  const [showWizard, setShowWizard] = useState(false);
  const [showConnectGoogle, setShowConnectGoogle] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateCheckResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  const checkUpdates = useCallback(
    async (manual = false) => {
      if (!manual && overrideClient && !window.driveSyncDesktop?.checkForUpdates) {
        return;
      }
      setCheckingUpdate(true);
      if (manual) setUpdateMessage(null);
      try {
        let info: AppUpdateCheckResult;
        if (window.driveSyncDesktop?.checkForUpdates) {
          info = await window.driveSyncDesktop.checkForUpdates(false);
        } else {
          const res = await fetch(GITHUB_RELEASES_LATEST_API, {
            headers: { Accept: 'application/vnd.github+json' },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const payload = await res.json();
          const platform =
            window.driveSyncDesktop?.getPlatformInfo().platform === 'win32' ? 'windows' : 'linux';
          info = parseGitHubReleaseForPlatform(payload, APP_VERSION, platform);
        }
        setUpdateInfo(info);
        if (manual) {
          setUpdateMessage(
            info.hasUpdate
              ? `Nova versão v${info.latestVersion} disponível!`
              : `Você já está usando a versão mais recente (v${APP_VERSION}).`,
          );
        }
      } catch (err) {
        if (manual) {
          setUpdateMessage(
            err instanceof Error ? `Erro ao verificar atualizações: ${err.message}` : 'Erro ao verificar atualizações.',
          );
        }
      } finally {
        setCheckingUpdate(false);
      }
    },
    [overrideClient],
  );

  const handleInstallUpdate = useCallback(async () => {
    setInstallingUpdate(true);
    setUpdateMessage(null);
    try {
      if (window.driveSyncDesktop?.installUpdate) {
        const res = await window.driveSyncDesktop.installUpdate(updateInfo?.downloadUrl);
        setUpdateMessage(res.detail || 'Atualização iniciada.');
      } else {
        window.open(updateInfo?.downloadUrl || GITHUB_RELEASES_URL, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      setUpdateMessage(
        err instanceof Error ? `Falha ao atualizar: ${err.message}` : 'Falha ao iniciar atualização.',
      );
      setInstallingUpdate(false);
    }
  }, [updateInfo]);

  useEffect(() => {
    void checkUpdates(false);
    if (!window.driveSyncDesktop?.onUpdateAvailable) return undefined;
    return window.driveSyncDesktop.onUpdateAvailable((info) => {
      setUpdateInfo(info);
    });
  }, [checkUpdates]);

  useEffect(() => {
    if (overrideClient) {
      setClient(overrideClient);
      return;
    }
    let cancelled = false;
    async function init() {
      try {
        const conn = window.driveSyncDesktop
          ? await window.driveSyncDesktop.getDaemonConnection()
          : {
              baseUrl: 'http://127.0.0.1:47831',
              wsUrl: 'ws://127.0.0.1:47831/ws',
              token: '',
            };
        if (!cancelled) {
          setClient(new DaemonClient(conn));
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [overrideClient]);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const snap = await client.getSnapshot();
      setSnapshot(snap);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => {
    if (!client) return;
    void refresh();
    const unsub = client.connectWebSocket((ev) => {
      if (ev.type === 'folder_runtime' && ev.payload) {
        const rt = ev.payload as FolderRuntimeState;
        setSnapshot((prev) =>
          prev
            ? {
                ...prev,
                runtime: {
                  ...prev.runtime,
                  [rt.folderId]: rt,
                },
              }
            : prev,
        );
        return;
      }
      if (ev.type === 'auth_result') {
        const res = ev.payload as { ok?: boolean; error?: string };
        if (res && res.ok === false && res.error) {
          setAuthError(res.error);
        } else {
          setAuthError(null);
        }
        void refresh();
        return;
      }
      if (ev.type === 'snapshot_dirty') {
        void refresh();
      }
    });
    return unsub;
  }, [client, refresh]);

  const blocked4gbCount = useMemo(
    () => snapshot?.blockedFiles.filter((b) => b.reason === 'exceeds_4gb').length ?? 0,
    [snapshot],
  );

  if (loadError && !snapshot) {
    return (
      <div className="content" style={{ margin: '48px auto' }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Conectando ao motor do DriveSync...</h2>
          <p style={{ color: 'var(--text-muted)' }}>{loadError}</p>
          <button type="button" className="btn btn-primary" onClick={() => void refresh()}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (!client || !snapshot) {
    return (
      <div className="content" style={{ margin: '48px auto' }}>
        <div className="card">Carregando DriveSync...</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <Cloud size={19} />
          </div>
          <div>
            <div className="brand-title">DriveSync</div>
            <div className="brand-sub">Simples e seguro • v{APP_VERSION}</div>
          </div>
        </div>

        <button
          type="button"
          className={`nav-btn ${tab === 'folders' ? 'active' : ''}`}
          onClick={() => setTab('folders')}
        >
          <FolderSync size={17} /> Pastas
        </button>

        <button
          type="button"
          className={`nav-btn ${tab === 'devices' ? 'active' : ''}`}
          onClick={() => setTab('devices')}
        >
          <Users size={17} /> Dispositivos & Pessoas
        </button>

        <button
          type="button"
          className={`nav-btn ${tab === 'activity' ? 'active' : ''}`}
          onClick={() => {
            setActivityTab('activity');
            setTab('activity');
          }}
        >
          <Activity size={17} /> Atividade
          {blocked4gbCount > 0 && <span className="nav-badge">{blocked4gbCount}</span>}
        </button>

        <button
          type="button"
          className={`nav-btn ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => setTab('settings')}
        >
          <Settings size={17} /> Configurações
        </button>

        <div className="sidebar-footer">
          <div>
            <strong>Limite de upload:</strong> {formatBytes(snapshot.settings.maxUploadBytes)}
          </div>
          <div style={{ marginTop: 4 }}>
            Dispositivos ativos: {snapshot.devices.length}
          </div>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Dispositivo: <strong>{snapshot.settings.deviceName}</strong>
          </span>

          <button
            type="button"
            className="account-pill"
            onClick={() => setShowConnectGoogle(true)}
            style={{ cursor: 'pointer' }}
          >
            <span className={`dot ${snapshot.account.connected ? 'ok' : 'warn'}`} />
            <span>
              {snapshot.account.connected
                ? snapshot.account.email || 'Google Drive conectado'
                : 'Conectar Google Drive'}
            </span>
          </button>
        </header>

        <main className="content">
          {updateInfo?.hasUpdate && (
            <div className="card" style={{ borderColor: 'var(--primary)', marginBottom: 16 }}>
              <div className="row-inline" style={{ justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <strong style={{ fontSize: 14 }}>
                    Nova atualização disponível: v{updateInfo.latestVersion}
                  </strong>
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
                    Versão instalada: v{APP_VERSION}
                    {updateInfo.assetSizeBytes ? ` • ${formatBytes(updateInfo.assetSizeBytes)}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={installingUpdate}
                  onClick={() => void handleInstallUpdate()}
                >
                  <CloudDownload size={15} />
                  {installingUpdate ? 'Atualizando...' : 'Atualizar agora'}
                </button>
              </div>
            </div>
          )}

          {tab === 'folders' && (
            <FoldersPage
              client={client}
              snapshot={snapshot}
              onOpenWizard={() => setShowWizard(true)}
              onOpenConnectGoogle={() => setShowConnectGoogle(true)}
              onNavigateBlocked={() => {
                setActivityTab('blocked_4gb');
                setTab('activity');
              }}
              onRefresh={refresh}
            />
          )}

          {tab === 'devices' && (
            <DevicesAndPeoplePage client={client} snapshot={snapshot} onRefresh={refresh} />
          )}

          {tab === 'activity' && (
            <ActivityPage key={activityTab} snapshot={snapshot} initialTab={activityTab} />
          )}

          {tab === 'settings' && (
            <SettingsPage
              client={client}
              snapshot={snapshot}
              updateInfo={updateInfo}
              checkingUpdate={checkingUpdate}
              installingUpdate={installingUpdate}
              updateMessage={updateMessage}
              onCheckUpdate={() => void checkUpdates(true)}
              onInstallUpdate={() => void handleInstallUpdate()}
              onOpenConnectGoogle={() => setShowConnectGoogle(true)}
              onRefresh={refresh}
            />
          )}
        </main>
      </div>

      {showConnectGoogle && (
        <ConnectGoogleModal
          client={client}
          account={snapshot.account}
          externalError={authError}
          onClose={() => {
            setAuthError(null);
            setShowConnectGoogle(false);
          }}
          onUpdated={refresh}
        />
      )}

      {showWizard && (
        <ConnectFolderWizard
          client={client}
          defaultOnRemoteDelete={snapshot.settings.defaultOnRemoteDelete}
          onClose={() => setShowWizard(false)}
          onCreated={refresh}
        />
      )}
    </div>
  );
};
