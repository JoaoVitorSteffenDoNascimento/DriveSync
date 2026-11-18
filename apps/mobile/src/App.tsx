import React, { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  CloudDownload,
  Copy,
  Crown,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  FolderSync,
  Laptop,
  Lock,
  LogOut,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Share2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import {
  APP_VERSION,
  formatBytes,
  formatStoragePath,
  normalizeEmail,
  type DiscoveredRemoteFolder,
  type FolderRuntimeState,
  type RemoteDeletePolicy,
  type SenderPolicyMode,
  type SyncFolderConfig,
} from '@drivesync/shared';
import {
  mobileBridge,
  type DriveSyncNativePlugin,
  type MobileSettings,
  type MobileSnapshot,
} from './native/driveSyncNative';
import { MobileAuthSheet } from './components/MobileAuthSheet';
import { MobileConnectSheet } from './components/MobileConnectSheet';
import { MobileFolderBrowserSheet } from './components/MobileFolderBrowserSheet';
import { MobileFolderSettingsSheet } from './components/MobileFolderSettingsSheet';
import { MobileShareSheet } from './components/MobileShareSheet';

type Tab = 'folders' | 'people' | 'activity' | 'settings';
type ActivitySubTab = 'recent' | 'blocked_4gb' | 'blocked_sender';

const DOWNLOAD_SITE_URL = 'https://joaovitorsteffendonascimento.github.io/DriveSync/';
const RELEASES_URL = 'https://github.com/JoaoVitorSteffenDoNascimento/DriveSync/releases/latest';

function renderStatusBadge(paused: boolean, rt?: FolderRuntimeState) {
  if (paused) {
    return <span className="badge badge-warning">Pausado</span>;
  }
  switch (rt?.status) {
    case 'ok':
      return <span className="badge badge-ok">Sincronizado</span>;
    case 'syncing':
      return <span className="badge">Sincronizando</span>;
    case 'warning':
      return <span className="badge badge-warning">Atenção</span>;
    case 'error':
      return <span className="badge badge-error">Erro</span>;
    case 'paused':
      return <span className="badge badge-warning">Pausado</span>;
    default:
      return <span className="badge">Aguardando</span>;
  }
}

function describeSenderPolicy(folder: SyncFolderConfig): string {
  const { mode, rules } = folder.senderPolicy;
  if (mode === 'all') return 'Recebendo de todos';
  if (mode === 'allowlist') {
    return `Somente pessoas aprovadas (${rules.filter((r) => r.allowed).length})`;
  }
  const blockedCount = rules.filter((r) => !r.allowed).length;
  return blockedCount > 0 ? `Todos, exceto ${blockedCount} bloqueado(s)` : 'Recebendo de todos';
}

const DriveSyncLogoMark: React.FC = () => (
  <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true" style={{ flexShrink: 0 }}>
    <rect width="64" height="64" rx="14" fill="#2563EB" />
    <path
      d="M19 43h26a9.5 9.5 0 0 0 1.5-18.9A13.5 13.5 0 0 0 20.5 21 10.5 10.5 0 0 0 19 43Z"
      fill="#FFFFFF"
    />
    <path
      d="M26 32l6-6 6 6M32 26v12"
      stroke="#2563EB"
      strokeWidth="3.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);

export const MobileApp: React.FC<{ bridge?: DriveSyncNativePlugin }> = ({
  bridge = mobileBridge,
}) => {
  const [snap, setSnap] = useState<MobileSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>('folders');
  const [activitySubTab, setActivitySubTab] = useState<ActivitySubTab>('recent');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [shareFolder, setShareFolder] = useState<SyncFolderConfig | null>(null);
  const [browserFolder, setBrowserFolder] = useState<SyncFolderConfig | null>(null);
  const [settingsFolder, setSettingsFolder] = useState<SyncFolderConfig | null>(null);
  const [loadingDiscovered, setLoadingDiscovered] = useState(false);
  const [syncingDiscovered, setSyncingDiscovered] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await bridge.getSnapshot();
      setSnap(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [bridge]);

  const handleDiscoverFromCloud = useCallback(async () => {
    setLoadingDiscovered(true);
    try {
      await bridge.discoverAccountFolders();
      await refresh();
    } catch {
      // ignora silenciosamente se offline
    } finally {
      setLoadingDiscovered(false);
    }
  }, [bridge, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (snap?.account.connected) {
      void handleDiscoverFromCloud();
    }
  }, [snap?.account.connected, handleDiscoverFromCloud]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refresh]);

  const hasActiveSync = Boolean(
    snap && Object.values(snap.runtime).some((rt) => rt.status === 'syncing'),
  );

  useEffect(() => {
    if (!hasActiveSync) return;
    const timer = setInterval(() => {
      void refresh();
    }, 2500);
    return () => clearInterval(timer);
  }, [hasActiveSync, refresh]);

  const pollIntervalSec = snap?.settings.pollIntervalSeconds ?? 900;
  const canForegroundPoll = Boolean(
    Capacitor.isNativePlatform() &&
      snap?.account.connected &&
      snap.folders.some((f) => !f.paused) &&
      !hasActiveSync,
  );

  useEffect(() => {
    if (!canForegroundPoll) return;
    const ms = Math.max(15, pollIntervalSec) * 1000;
    const timer = setInterval(() => {
      void bridge
        .syncNow({ folderId: '' })
        .then(() => refresh())
        .catch(() => {});
    }, ms);
    return () => clearInterval(timer);
  }, [bridge, canForegroundPoll, pollIntervalSec, refresh]);

  if (!snap) {
    return (
      <div className="mobile-content" style={{ paddingTop: 48 }}>
        <div className="card">Carregando DriveSync Mobile...</div>
      </div>
    );
  }

  const blocked4gb = snap.blockedFiles.filter((b) => b.reason === 'exceeds_4gb');
  const discovered = snap.discoveredFolders ?? [];

  const handleSyncAll = async () => {
    setError(null);
    await handleDiscoverFromCloud();
    const activeFolders = snap.folders.filter((f) => !f.paused);
    for (const f of activeFolders) {
      await bridge.syncNow({ folderId: f.id }).catch(() => {});
    }
    setNotice('Lista de pastas e sincronização atualizadas.');
    await refresh();
  };

  const handleConnectAllDiscovered = async (forcePickRoot: boolean) => {
    if (discovered.length === 0) return;
    setSyncingDiscovered(true);
    setError(null);
    try {
      if (forcePickRoot || !snap.settings.syncRootUri) {
        const picked = await bridge.pickSyncRootFolder({ autoConnectDiscovered: true });
        setNotice(
          `${picked.connectedCount ?? discovered.length} pasta(s) salva(s) em "${picked.displayName}" e sincronizando!`,
        );
      } else {
        const res = await bridge.syncDiscoveredFolders({
          baseUri: snap.settings.syncRootUri,
          createSubfolders: true,
          folders: discovered,
        });
        setNotice(
          `${res.folders.length} pasta(s) sincronizando em "${snap.settings.syncRootLabel || 'pasta base'}"!`,
        );
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncingDiscovered(false);
    }
  };

  const handleConnectSingleDiscovered = async (item: DiscoveredRemoteFolder) => {
    setSyncingDiscovered(true);
    setError(null);
    try {
      const picked = await bridge.pickLocalFolder();
      await bridge.syncDiscoveredFolders({
        baseUri: picked.uri,
        createSubfolders: false,
        folders: [item],
      });
      setNotice(`Pasta "${item.remoteFolderName}" conectada em "${picked.displayName}"!`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncingDiscovered(false);
    }
  };

  return (
    <div className="mobile-shell">
      <header className="mobile-header">
        <div className="row-gap" style={{ minWidth: 0 }}>
          <DriveSyncLogoMark />
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 16 }}>DriveSync</strong>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {snap.settings.deviceName} • v{APP_VERSION} • {formatBytes(snap.settings.maxUploadBytes)}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="account-pill"
          onClick={() => setShowAuthModal(true)}
        >
          <span className={`dot ${snap.account.connected ? 'ok' : 'warn'}`} />
          <span>{snap.account.connected ? snap.account.email || 'Conectado' : 'Conectar Drive'}</span>
        </button>
      </header>

      <main className="mobile-content">
        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-info">{notice}</div>}

        {tab === 'folders' && (
          <div>
            <div className="section-header">
              <div>
                <h1 style={{ margin: 0, fontSize: 19 }}>Suas Pastas Conectadas</h1>
                <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
                  Espelhe pastas do celular com seu Google Drive ou um Drive Master.
                </p>
              </div>
              <div className="header-toolbar">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => (snap.account.connected ? setShowWizard(true) : setShowAuthModal(true))}
                >
                  <Plus size={15} /> Conectar Pasta
                </button>
                {snap.account.connected && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={loadingDiscovered}
                    onClick={() => void handleSyncAll()}
                  >
                    <RefreshCw size={14} /> {loadingDiscovered ? 'Atualizando...' : 'Atualizar'}
                  </button>
                )}
              </div>
            </div>

            {!snap.account.connected && (
              <div className="card" style={{ textAlign: 'center', padding: 24 }}>
                <strong style={{ display: 'block', fontSize: 16, marginBottom: 8 }}>
                  Passo 1: Conecte sua conta Google Drive
                </strong>
                <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>
                  Para escolher uma pasta do celular e sincronizar com o Drive Pessoal ou Drive Master, conecte sua conta Google primeiro.
                </p>
                <button type="button" className="btn btn-primary" onClick={() => setShowAuthModal(true)}>
                  Conectar Google Drive
                </button>
              </div>
            )}

            {blocked4gb.length > 0 && (
              <div className="alert row-between">
                <span className="row-gap" style={{ flex: 1 }}>
                  <AlertTriangle size={16} />
                  <span>
                    <strong>{blocked4gb.length}</strong> arquivo(s) bloqueado(s) por passarem de{' '}
                    <strong>4 GB</strong> (ex.: {blocked4gb[0].relativePath} —{' '}
                    {formatBytes(blocked4gb[0].fileSizeBytes)}).
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setActivitySubTab('blocked_4gb');
                    setTab('activity');
                  }}
                >
                  Ver detalhes
                </button>
              </div>
            )}

            {snap.account.connected && discovered.length > 0 && (
              <div className="card" style={{ borderColor: 'var(--primary)' }}>
                <div className="row-between" style={{ marginBottom: 8 }}>
                  <div>
                    <div className="row-gap">
                      <CloudDownload size={17} color="var(--primary)" />
                      <strong>Pastas encontradas na sua conta Google ({discovered.length})</strong>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                      Escolha onde armazenar no celular para espelhar com seu PC e outros dispositivos.
                    </div>
                  </div>
                </div>

                <div className="row-gap" style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={syncingDiscovered}
                    onClick={() => void handleConnectAllDiscovered(false)}
                  >
                    <FolderOpen size={14} />{' '}
                    {snap.settings.syncRootUri
                      ? `Sincronizar todas em "${snap.settings.syncRootLabel || 'Pasta base'}"`
                      : 'Escolher onde salvar e conectar todas'}
                  </button>
                  {snap.settings.syncRootUri && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={syncingDiscovered}
                      onClick={() => void handleConnectAllDiscovered(true)}
                    >
                      Alterar pasta base
                    </button>
                  )}
                </div>

                {discovered.map((d) => (
                  <div key={d.remoteFolderId} className="list-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row-gap">
                        <strong>{d.remoteFolderName}</strong>
                        <span className="badge">{d.kind === 'master' ? 'Drive Master' : 'Pessoal'}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        {d.deviceNames.length > 0
                          ? `Conectada em: ${d.deviceNames.join(', ')}`
                          : d.ownerEmail
                            ? `Dono: ${d.ownerEmail}`
                            : 'Disponível na conta Google'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={syncingDiscovered}
                      onClick={() => void handleConnectSingleDiscovered(d)}
                    >
                      <FolderOpen size={14} /> Escolher onde salvar
                    </button>
                  </div>
                ))}
              </div>
            )}

            {snap.account.connected && snap.folders.length === 0 && (
              <div className="card" style={{ textAlign: 'center', padding: 24 }}>
                <strong style={{ display: 'block', fontSize: 16, marginBottom: 8 }}>
                  Nenhuma pasta conectada ainda
                </strong>
                <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>
                  Toque em <strong>+ Conectar Pasta</strong> para escolher uma pasta do celular ou entrar pelo código de um Drive Master.
                </p>
                <button type="button" className="btn btn-primary" onClick={() => setShowWizard(true)}>
                  <Plus size={15} /> Conectar primeira pasta
                </button>
              </div>
            )}

            {snap.folders.map((f) => {
              const rt = snap.runtime[f.id];
              const pct = Math.max(0, Math.min(100, rt?.progressPercent ?? 0));
              return (
                <div key={f.id} className="card">
                  <div className="row-between" style={{ marginBottom: 8 }}>
                    <div className="row-gap">
                      {f.kind === 'master' ? (
                        <Crown size={17} color="var(--primary)" />
                      ) : (
                        <Lock size={17} color="var(--primary)" />
                      )}
                      <strong>{f.name}</strong>
                      <span className="badge">
                        {f.kind === 'master' ? 'Drive Master' : 'Pessoal'}
                      </span>
                    </div>
                    {renderStatusBadge(f.paused, rt)}
                  </div>

                  <div className="folder-path-pill">
                    <span><strong>Celular:</strong> {formatStoragePath(f.localPath)}</span>
                    <span style={{ color: 'var(--text-muted)' }}>↔</span>
                    <span><strong>Drive:</strong> {f.remoteFolderName}</span>
                  </div>
                  <div className="folder-summary-line">
                    <span>{f.direction === 'receive_only' ? 'Somente receber' : 'Enviar e receber'}</span>
                    <span>•</span>
                    <span>{f.onRemoteDelete === 'keep_local' ? 'Mantém no celular' : 'Quarentena local'}</span>
                    {f.kind === 'master' ? (
                      <>
                        <span>•</span>
                        <span>{describeSenderPolicy(f)}</span>
                      </>
                    ) : null}
                    {rt?.syncedFilesCount ? (
                      <>
                        <span>•</span>
                        <span>{rt.syncedFilesCount} arquivo(s)</span>
                      </>
                    ) : null}
                    {rt?.message ? (
                      <>
                        <span>•</span>
                        <span>{rt.message}</span>
                      </>
                    ) : null}
                  </div>

                  {rt?.status === 'syncing' && (
                    <div style={{ marginBottom: 10 }}>
                      <div className="row-between" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '68%' }}>
                          {rt.currentFile
                            ? `${rt.currentAction === 'download' ? 'Baixando: ' : 'Enviando: '}${rt.currentFile}`
                            : 'Processando arquivos...'}
                        </span>
                        <span>
                          {rt.bytesTotal
                            ? `${formatBytes(rt.bytesTransferred ?? 0)} / ${formatBytes(rt.bytesTotal)}`
                            : `${pct}%`}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, marginBottom: 4 }}>
                        Enviado por: {rt.currentAuthor || snap.account.displayName || snap.account.email || 'Você'}
                      </div>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${Math.max(8, pct)}%` }} />
                      </div>
                    </div>
                  )}

                  <div className="folder-actions-grid">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={async () => {
                        setError(null);
                        try {
                          const res = await bridge.pickAndImportFiles({ folderId: f.id });
                          if (res.skippedOver4GB.length > 0) {
                            setError(`Bloqueado (> 4 GB): ${res.skippedOver4GB.join(', ')}`);
                          } else if (res.addedCount > 0) {
                            setNotice(`${res.addedCount} arquivo(s) adicionado(s) em "${f.name}".`);
                          }
                          await refresh();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      <FilePlus2 size={14} /> Adicionar arquivos
                    </button>

                    <button type="button" className="btn btn-sm" onClick={() => setBrowserFolder(f)}>
                      <FolderOpen size={14} /> Abrir pasta
                    </button>

                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={f.paused}
                      onClick={async () => {
                        setError(null);
                        try {
                          await bridge.syncNow({ folderId: f.id });
                          await refresh();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      <RefreshCw size={14} /> Sincronizar
                    </button>

                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        setError(null);
                        try {
                          await bridge.updateSyncFolder({ folder: { ...f, paused: !f.paused } });
                          await refresh();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      {f.paused ? <Play size={14} /> : <Pause size={14} />}
                      {f.paused ? 'Retomar' : 'Pausar'}
                    </button>

                    <button type="button" className="btn btn-sm" onClick={() => setShareFolder(f)}>
                      <Share2 size={14} /> Convidar
                    </button>

                    <button type="button" className="btn btn-sm" onClick={() => setSettingsFolder(f)}>
                      <SlidersHorizontal size={14} /> Opções
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'people' && (
          <MobilePeopleTab
            bridge={bridge}
            snap={snap}
            onRefresh={refresh}
            onError={setError}
            onNotice={setNotice}
          />
        )}

        {tab === 'activity' && (
          <MobileActivityTab
            bridge={bridge}
            snap={snap}
            subTab={activitySubTab}
            onSubTabChange={setActivitySubTab}
            onError={setError}
          />
        )}

        {tab === 'settings' && (
          <MobileSettingsTab
            bridge={bridge}
            snap={snap}
            onOpenAuth={() => setShowAuthModal(true)}
            onRefresh={refresh}
            onNotice={setNotice}
            onError={setError}
          />
        )}
      </main>

      <nav className="bottom-nav">
        <button
          type="button"
          className={`bottom-tab ${tab === 'folders' ? 'active' : ''}`}
          onClick={() => setTab('folders')}
        >
          <FolderSync size={18} />
          <span>Pastas</span>
        </button>
        <button
          type="button"
          className={`bottom-tab ${tab === 'people' ? 'active' : ''}`}
          onClick={() => setTab('people')}
        >
          <Users size={18} />
          <span>Dispositivos</span>
        </button>
        <button
          type="button"
          className={`bottom-tab ${tab === 'activity' ? 'active' : ''}`}
          onClick={() => setTab('activity')}
        >
          <Activity size={18} />
          <span>Atividade</span>
          {blocked4gb.length > 0 && <span className="nav-badge">{blocked4gb.length}</span>}
        </button>
        <button
          type="button"
          className={`bottom-tab ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => setTab('settings')}
        >
          <Settings size={18} />
          <span>Configurações</span>
        </button>
      </nav>

      {showAuthModal && (
        <MobileAuthSheet
          bridge={bridge}
          hasClient={snap.account.hasCustomOAuthClient}
          onClose={() => setShowAuthModal(false)}
          onUpdated={refresh}
        />
      )}

      {showWizard && (
        <MobileConnectSheet
          bridge={bridge}
          defaultOnRemoteDelete={snap.settings.defaultOnRemoteDelete}
          onClose={() => setShowWizard(false)}
          onCreated={refresh}
        />
      )}

      {shareFolder && (
        <MobileShareSheet
          bridge={bridge}
          folder={shareFolder}
          onClose={() => setShareFolder(null)}
        />
      )}

      {browserFolder && (
        <MobileFolderBrowserSheet
          bridge={bridge}
          folder={browserFolder}
          onClose={() => setBrowserFolder(null)}
          onRefresh={refresh}
        />
      )}

      {settingsFolder && (
        <MobileFolderSettingsSheet
          bridge={bridge}
          folder={settingsFolder}
          onClose={() => setSettingsFolder(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
};

const MobilePeopleTab: React.FC<{
  bridge: DriveSyncNativePlugin;
  snap: MobileSnapshot;
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}> = ({ bridge, snap, onRefresh, onError, onNotice }) => {
  const masterFolders = snap.folders.filter((f) => f.kind === 'master');
  const [selectedFolderId, setSelectedFolderId] = useState(
    masterFolders[0]?.id ?? snap.folders[0]?.id ?? '',
  );
  const [newEmail, setNewEmail] = useState('');
  const [newAllowed, setNewAllowed] = useState<'allow' | 'block'>('allow');
  const folder = snap.folders.find((f) => f.id === selectedFolderId) ?? masterFolders[0] ?? snap.folders[0];

  const senders = snap.knownSenders.filter((s) => !folder || s.folderId === folder.id);
  const rulesMap = new Map<string, { email: string; displayName: string; allowed: boolean }>();
  for (const s of senders) {
    const e = normalizeEmail(s.email);
    rulesMap.set(e, {
      email: e,
      displayName: s.displayName,
      allowed: folder?.senderPolicy.mode !== 'allowlist',
    });
  }
  for (const r of folder?.senderPolicy.rules ?? []) {
    const e = normalizeEmail(r.email);
    rulesMap.set(e, {
      email: e,
      displayName: r.displayName || rulesMap.get(e)?.displayName || '',
      allowed: r.allowed,
    });
  }

  const updatePolicyMode = async (mode: SenderPolicyMode) => {
    if (!folder) return;
    onError(null);
    try {
      await bridge.updateSyncFolder({
        folder: {
          ...folder,
          senderPolicy: {
            ...folder.senderPolicy,
            mode,
            unknownSenderAction: mode === 'allowlist' ? 'block' : 'allow',
          },
        },
      });
      await onRefresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleSender = async (email: string, allowed: boolean) => {
    if (!folder) return;
    onError(null);
    try {
      const norm = normalizeEmail(email);
      const known = senders.find((s) => normalizeEmail(s.email) === norm);
      const nextRules = [
        ...folder.senderPolicy.rules.filter((r) => normalizeEmail(r.email) !== norm),
        { email: norm, displayName: known?.displayName, allowed },
      ];
      await bridge.updateSyncFolder({
        folder: {
          ...folder,
          senderPolicy: {
            ...folder.senderPolicy,
            mode: folder.senderPolicy.mode === 'all' ? 'blocklist' : folder.senderPolicy.mode,
            rules: nextRules,
          },
        },
      });
      await onRefresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <h1 style={{ margin: '0 0 4px', fontSize: 19 }}>Dispositivos & Pessoas</h1>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-muted)' }}>
        Veja todos os PCs e celulares conectados e escolha de quem este celular recebe no Drive Master.
      </p>

      <div className="card">
        <strong style={{ display: 'block', marginBottom: 8 }}>
          Dispositivos Conectados ({snap.devices.length})
        </strong>
        {snap.devices.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>
            Conecte uma pasta para registrar este celular e descobrir outros dispositivos conectados.
          </p>
        ) : (
          snap.devices.map((d) => {
            const folderName = snap.folders.find((f) => f.id === d.folderId)?.name ?? d.folderId;
            return (
              <div key={`${d.folderId}-${d.deviceId}`} className="list-row">
                <div className="row-gap" style={{ flex: 1, minWidth: 0 }}>
                  {d.platform === 'android' || d.platform === 'ios' ? (
                    <Smartphone size={17} />
                  ) : (
                    <Laptop size={17} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div className="row-gap">
                      <strong>{d.deviceName}</strong>
                      {d.isCurrentDevice && <span className="badge badge-ok">Este dispositivo</span>}
                      <span className="badge">{d.platform}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Pasta: {folderName} • Conta: {d.accountEmail || '—'} • Modo:{' '}
                      {d.syncMode === 'receive_only' ? 'Somente recebe' : 'Envia e recebe'}
                    </div>
                  </div>
                </div>
                <div className="row-gap">
                  <span className="badge">{d.status}</span>
                  {!d.isCurrentDevice && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      title="Remover da lista"
                      onClick={async () => {
                        onError(null);
                        try {
                          await bridge.forgetDevice({ folderId: d.folderId, deviceId: d.deviceId });
                          await onRefresh();
                        } catch (e) {
                          onError(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      <Trash2 size={14} /> Remover
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {folder && (
        <div className="card">
          <div className="row-between" style={{ marginBottom: 6 }}>
            <strong>De quem receber arquivos (Drive Master)</strong>
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                onError(null);
                await bridge.syncNow({ folderId: folder.id });
                onNotice('Reaplicando filtros de remetentes...');
                await onRefresh();
              }}
            >
              <RefreshCw size={14} /> Reaplicar filtros agora
            </button>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--text-muted)' }}>
            Exemplo: bloqueie &ldquo;luiz@...&rdquo; para não baixar arquivos dele e mantenha &ldquo;joao@...&rdquo; permitido.
          </p>

          {snap.folders.length > 1 && (
            <div className="form-group">
              <label className="form-label">Pasta selecionada</label>
              <select
                className="select"
                value={folder.id}
                onChange={(e) => setSelectedFolderId(e.target.value)}
              >
                {snap.folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.kind === 'master' ? 'Master' : 'Pessoal'})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Regra geral para esta pasta</label>
            <select
              className="select"
              value={folder.senderPolicy.mode}
              onChange={(e) => void updatePolicyMode(e.target.value as SenderPolicyMode)}
            >
              <option value="blocklist">Receber de todos, exceto quem eu bloquear</option>
              <option value="allowlist">Receber somente de pessoas aprovadas abaixo</option>
              <option value="all">Receber de qualquer pessoa (sem filtro)</option>
            </select>
          </div>

          <form
            className="row-gap"
            style={{ marginBottom: 10 }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newEmail.trim()) return;
              await toggleSender(newEmail, newAllowed === 'allow');
              setNewEmail('');
            }}
          >
            <input
              className="input"
              style={{ flex: 1, minWidth: 180 }}
              type="email"
              placeholder="Adicionar e-mail manualmente (ex.: joao@gmail.com)"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <select
              className="select"
              style={{ width: 155 }}
              value={newAllowed}
              onChange={(e) => setNewAllowed(e.target.value as 'allow' | 'block')}
            >
              <option value="allow">Receber dele(a)</option>
              <option value="block">Não receber</option>
            </select>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!newEmail.trim()}>
              Adicionar
            </button>
          </form>

          {rulesMap.size === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
              Nenhuma pessoa detectada ainda nesta pasta. Assim que alguém jogar um arquivo no Drive Master, ela aparecerá aqui automaticamente.
            </p>
          ) : (
            Array.from(rulesMap.values()).map((p) => (
              <div key={p.email} className="list-row">
                <div>
                  <strong>{p.displayName || p.email}</strong>
                  {p.displayName && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.email}</div>
                  )}
                </div>
                <button
                  type="button"
                  className={`toggle-pill ${p.allowed ? 'allowed' : 'blocked'}`}
                  onClick={() => void toggleSender(p.email, !p.allowed)}
                >
                  {p.allowed ? (
                    <>
                      <UserCheck size={14} /> Recebendo arquivos
                    </>
                  ) : (
                    <>
                      <UserX size={14} /> Não receber (bloqueado)
                    </>
                  )}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const MobileActivityTab: React.FC<{
  bridge: DriveSyncNativePlugin;
  snap: MobileSnapshot;
  subTab: ActivitySubTab;
  onSubTabChange: (next: ActivitySubTab) => void;
  onError: (msg: string | null) => void;
}> = ({ bridge, snap, subTab, onSubTabChange, onError }) => {
  const blocked4gb = snap.blockedFiles.filter((b) => b.reason === 'exceeds_4gb');
  const blockedSenders = snap.blockedFiles.filter((b) => b.reason === 'sender_blocked');

  return (
    <div>
      <h1 style={{ margin: '0 0 4px', fontSize: 19 }}>Atividade & Bloqueios</h1>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-muted)' }}>
        Histórico simples de transferências, arquivos mantidos no celular e bloqueios acima de 4 GB.
      </p>

      <div className="row-gap" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={`btn btn-sm ${subTab === 'recent' ? 'btn-primary' : ''}`}
          onClick={() => onSubTabChange('recent')}
        >
          Atividade recente ({snap.recentActivity.length})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${subTab === 'blocked_4gb' ? 'btn-primary' : ''}`}
          onClick={() => onSubTabChange('blocked_4gb')}
        >
          <ShieldAlert size={14} /> Acima de 4 GB ({blocked4gb.length})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${subTab === 'blocked_sender' ? 'btn-primary' : ''}`}
          onClick={() => onSubTabChange('blocked_sender')}
        >
          <UserX size={14} /> Ignorados por remetente ({blockedSenders.length})
        </button>
      </div>

      {subTab === 'recent' && (
        <div className="card">
          {snap.recentActivity.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Nenhuma movimentação registrada ainda.</p>
          ) : (
            snap.recentActivity.map((ev) => (
              <div key={ev.id} className="list-row">
                <div>
                  <strong style={{ fontSize: 13 }}>{ev.message}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Pasta: {ev.folderName}
                    {ev.fileSizeBytes ? ` • ${formatBytes(ev.fileSizeBytes)}` : ''}
                    {ev.authorEmail ? ` • Enviado por: ${ev.authorEmail}` : ''}
                  </div>
                </div>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {new Date(ev.createdAt).toLocaleString('pt-BR')}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {subTab === 'blocked_4gb' && (
        <div className="card">
          {blocked4gb.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>
              Nenhum arquivo bloqueado por ultrapassar 4 GB.
            </p>
          ) : (
            blocked4gb.map((b) => (
              <div key={b.id} className="list-row">
                <div>
                  <strong style={{ fontSize: 13 }}>{b.relativePath}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Pasta: {b.folderName} • Tamanho: <strong>{formatBytes(b.fileSizeBytes)}</strong> • {b.detail}
                  </div>
                </div>
                {b.localPath && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      void bridge
                        .openLocalItem({ uri: b.localPath })
                        .catch((e) => onError(e instanceof Error ? e.message : String(e)))
                    }
                  >
                    <FolderOpen size={14} /> Mostrar arquivo
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {subTab === 'blocked_sender' && (
        <div className="card">
          {blockedSenders.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>
              Nenhum arquivo ignorado por filtro de remetente.
            </p>
          ) : (
            blockedSenders.map((b) => (
              <div key={b.id} className="list-row">
                <div>
                  <strong style={{ fontSize: 13 }}>{b.relativePath}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Pasta: {b.folderName} • Enviado por:{' '}
                    <strong>{b.authorName || b.authorEmail || 'Desconhecido'}</strong> •{' '}
                    {formatBytes(b.fileSizeBytes)}
                  </div>
                </div>
                <span className="badge">Não baixado</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const MobileSettingsTab: React.FC<{
  bridge: DriveSyncNativePlugin;
  snap: MobileSnapshot;
  onOpenAuth: () => void;
  onRefresh: () => Promise<void>;
  onNotice: (msg: string | null) => void;
  onError: (msg: string | null) => void;
}> = ({ bridge, snap, onOpenAuth, onRefresh, onNotice, onError }) => {
  const [form, setForm] = useState<MobileSettings>(snap.settings);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [copiedAppLink, setCopiedAppLink] = useState(false);

  useEffect(() => {
    setForm(snap.settings);
  }, [snap.settings]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    onError(null);
    try {
      await bridge.updateSettings({
        settings: {
          ...form,
          pollIntervalSeconds: Math.min(3600, Math.max(15, Number(form.pollIntervalSeconds) || 900)),
        },
      });
      await onRefresh();
      setSavedNotice(true);
      onNotice('Configurações salvas.');
    } catch (ex) {
      onError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h1 style={{ margin: '0 0 4px', fontSize: 19 }}>Configurações</h1>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-muted)' }}>
        Preferências do celular, conta Google Drive e regras padrão de segurança.
      </p>

      <div className="card">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>Conta Google Drive</strong>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
              {snap.account.connected
                ? `Conectado como ${snap.account.displayName || snap.account.email} (${snap.account.email})`
                : 'Nenhuma conta conectada ainda.'}
            </div>
          </div>

          <div className="row-gap">
            <button type="button" className="btn btn-sm" onClick={onOpenAuth}>
              {snap.account.connected ? 'Trocar conta' : 'Conectar Google Drive'}
            </button>
            {snap.account.connected && (
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={async () => {
                  await bridge.disconnectAccount();
                  await onRefresh();
                }}
              >
                <LogOut size={14} /> Desconectar
              </button>
            )}
          </div>
        </div>
      </div>

      <form className="card" onSubmit={save}>
        <div className="form-group">
          <label className="form-label">Nome deste celular (visível na aba Dispositivos)</label>
          <input
            className="input"
            value={form.deviceName}
            onChange={(e) => setForm({ ...form, deviceName: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label className="form-label">
            Pasta base onde novas pastas sincronizadas da sua conta serão salvas no celular
          </label>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
            {form.syncRootLabel || (form.syncRootUri ? formatStoragePath(form.syncRootUri) : 'Nenhuma pasta base selecionada ainda')}
          </div>
          <div className="row-gap" style={{ marginTop: 4 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                try {
                  const picked = await bridge.pickSyncRootFolder({ autoConnectDiscovered: false });
                  setForm((prev) => ({
                    ...prev,
                    syncRootUri: picked.uri,
                    syncRootLabel: picked.displayName,
                  }));
                  await onRefresh();
                } catch {
                  // cancelado
                }
              }}
            >
              <FolderOpen size={14} /> Escolher onde salvar arquivos
            </button>
          </div>
        </div>

        <div className="form-group">
          <label className="row-gap">
            <input
              type="checkbox"
              checked={form.autoSyncAccountFolders ?? true}
              onChange={(e) => setForm({ ...form, autoSyncAccountFolders: e.target.checked })}
            />
            <span>Conectar automaticamente novas pastas da mesma conta Google nessa pasta base</span>
          </label>
        </div>

        <div className="form-group">
          <label className="form-label">
            Comportamento padrão quando um arquivo já baixado for apagado no Drive
          </label>
          <select
            className="select"
            value={form.defaultOnRemoteDelete}
            onChange={(e) => setForm({ ...form, defaultOnRemoteDelete: e.target.value as RemoteDeletePolicy })}
          >
            <option value="keep_local">
              Não apagar do celular — manter já baixados (apaga somente no Drive)
            </option>
            <option value="mirror_trash">Apagar do celular também (mover para Quarentena local)</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">
            Intervalo de checagem de novidades no Drive (segundos)
          </label>
          <input
            type="number"
            min={15}
            max={3600}
            className="input"
            value={form.pollIntervalSeconds}
            onChange={(e) =>
              setForm({
                ...form,
                pollIntervalSeconds: Math.min(3600, Math.max(15, Number(e.target.value) || 45)),
              })
            }
          />
          <div className="row-gap" style={{ marginTop: 4 }}>
            {[
              { label: '15s', val: 15 },
              { label: '45s', val: 45 },
              { label: '15 min', val: 900 },
              { label: '30 min', val: 1800 },
              { label: '60 min', val: 3600 },
            ].map((preset) => (
              <button
                key={preset.val}
                type="button"
                className={`btn btn-sm ${form.pollIntervalSeconds === preset.val ? 'btn-primary' : ''}`}
                onClick={() => setForm({ ...form, pollIntervalSeconds: preset.val })}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Com o app aberto, checa neste intervalo em segundos. Em segundo plano fechado, o Android agenda a partir de 15 min para economizar bateria.
          </div>
        </div>

        <div className="form-group">
          <label className="row-gap">
            <input
              type="checkbox"
              checked={form.startOnBoot}
              onChange={(e) => setForm({ ...form, startOnBoot: e.target.checked })}
            />
            <span>Iniciar DriveSync automaticamente ao ligar o celular</span>
          </label>
        </div>

        <div className="form-group">
          <label className="row-gap">
            <input
              type="checkbox"
              checked={form.backgroundSyncEnabled}
              onChange={(e) => setForm({ ...form, backgroundSyncEnabled: e.target.checked })}
            />
            <span>Sincronizar automaticamente em segundo plano</span>
          </label>
        </div>

        <div className="form-group">
          <label className="row-gap">
            <input
              type="checkbox"
              checked={form.wifiOnly}
              onChange={(e) => setForm({ ...form, wifiOnly: e.target.checked })}
            />
            <span>Sincronizar em segundo plano apenas no Wi-Fi</span>
          </label>
        </div>

        <div className="card" style={{ background: 'var(--surface-muted)', boxShadow: 'none' }}>
          <div className="row-gap">
            <ShieldCheck size={18} color="var(--primary)" />
            <div style={{ flex: 1 }}>
              <strong>Limitação fixa de upload: {formatBytes(form.maxUploadBytes)}</strong>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Arquivos acima de 4 GB são barrados automaticamente antes do envio para evitar travamentos e consumo excessivo de banda.
              </div>
            </div>
          </div>
        </div>

        <div className="row-between" style={{ marginTop: 12 }}>
          <span>
            {savedNotice && (
              <span className="row-gap" style={{ color: 'var(--success)', fontSize: 13 }}>
                <CheckCircle2 size={15} /> Configurações salvas
              </span>
            )}
          </span>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar configurações'}
          </button>
        </div>
      </form>

      <div className="card">
        <div className="row-gap" style={{ marginBottom: 6 }}>
          <Share2 size={16} color="var(--primary)" />
          <strong>Compartilhar o DriveSync</strong>
        </div>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-muted)' }}>
          Envie o link abaixo para instalar no Windows (.exe / .msi), Linux (.AppImage / .deb / .rpm / .pacman) ou Android (.apk):
        </p>
        <code
          style={{
            display: 'block',
            fontSize: 12,
            padding: '8px 10px',
            borderRadius: 8,
            background: 'var(--surface-muted)',
            wordBreak: 'break-all',
            marginBottom: 10,
          }}
        >
          {DOWNLOAD_SITE_URL}
        </code>
        <div className="row-gap">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={async () => {
              await navigator.clipboard.writeText(DOWNLOAD_SITE_URL);
              setCopiedAppLink(true);
              setTimeout(() => setCopiedAppLink(false), 2000);
            }}
          >
            {copiedAppLink ? <Check size={14} /> : <Copy size={14} />}
            {copiedAppLink ? 'Link de download copiado!' : 'Copiar link de download do app'}
          </button>

          <a className="btn btn-sm" href={DOWNLOAD_SITE_URL} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> Abrir site de downloads
          </a>

          <a className="btn btn-sm" href={RELEASES_URL} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> GitHub Releases
          </a>
        </div>
      </div>
    </div>
  );
};

export default MobileApp;
