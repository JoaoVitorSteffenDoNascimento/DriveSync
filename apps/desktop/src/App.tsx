import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Cloud,
  FolderSync,
  Settings,
  Users,
} from 'lucide-react';
import type { DaemonSnapshot, FolderRuntimeState } from '@drivesync/shared';
import { formatBytes } from '@drivesync/shared';
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
            <div className="brand-sub">Simples e seguro</div>
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
