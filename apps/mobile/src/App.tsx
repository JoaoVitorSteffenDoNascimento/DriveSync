import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Check,
  Copy,
  Crown,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  FolderSync,
  Laptop,
  Lock,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Share2,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import {
  formatBytes,
  normalizeEmail,
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
    return <span className="badge badge-warning">Pausada</span>;
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
      return <span className="badge badge-warning">Pausada</span>;
    default:
      return <span className="badge">Pronto</span>;
  }
}

function describeSenderPolicy(mode: SenderPolicyMode): string {
  if (mode === 'all') return 'Recebe de todos';
  if (mode === 'allowlist') return 'Somente lista permitida';
  return 'Lista de bloqueio';
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

  const refresh = useCallback(async () => {
    try {
      const next = await bridge.getSnapshot();
      setSnap(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [bridge]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  if (!snap) {
    return (
      <div className="mobile-content" style={{ paddingTop: 48 }}>
        <div className="card">Carregando DriveSync Mobile...</div>
      </div>
    );
  }

  const blocked4gb = snap.blockedFiles.filter((b) => b.reason === 'exceeds_4gb');

  const handleSyncAll = async () => {
    setError(null);
    const activeFolders = snap.folders.filter((f) => !f.paused);
    for (const f of activeFolders) {
      await bridge.syncNow({ folderId: f.id }).catch(() => {});
    }
    setNotice('Sincronização iniciada para todas as pastas ativas.');
    await refresh();
  };

  return (
    <div className="mobile-shell">
      <header className="mobile-header">
        <div className="row-gap">
          <DriveSyncLogoMark />
          <div>
            <strong style={{ fontSize: 16 }}>DriveSync</strong>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {snap.account.connected ? snap.account.email : 'Desconectado'}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setShowAuthModal(true)}
        >
          {snap.account.connected ? 'Conta' : 'Entrar'}
        </button>
      </header>

      <main className="mobile-content">
        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-info">{notice}</div>}

        {tab === 'folders' && (
          <div>
            <div className="row-between" style={{ marginBottom: 12 }}>
              <h1 style={{ margin: 0, fontSize: 19 }}>Pastas</h1>
              <div className="row-gap">
                {snap.account.connected && snap.folders.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void handleSyncAll()}
                  >
                    <RefreshCw size={14} /> Sincronizar tudo
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => (snap.account.connected ? setShowWizard(true) : setShowAuthModal(true))}
                >
                  <Plus size={15} /> Conectar Pasta
                </button>
              </div>
            </div>

            {!snap.account.connected && (
              <div className="card" style={{ textAlign: 'center', padding: 24 }}>
                <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>
                  Conecte sua conta Google Drive para escolher uma pasta do celular e sincronizar com seu Drive Pessoal ou Drive Master.
                </p>
                <button type="button" className="btn btn-primary" onClick={() => setShowAuthModal(true)}>
                  Conectar Google Drive
                </button>
              </div>
            )}

            {blocked4gb.length > 0 && (
              <div className="alert row-between">
                <span>
                  <strong>{blocked4gb.length}</strong> arquivo(s) bloqueado(s) no upload por passarem de{' '}
                  <strong>4 GB</strong>.
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

            {snap.account.connected && snap.folders.length === 0 && (
              <div className="card" style={{ textAlign: 'center', padding: 24 }}>
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
                      <div>
                        <strong>{f.name}</strong>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                          {f.kind === 'master' ? 'Drive Master' : 'Pasta Pessoal'}
                        </div>
                      </div>
                    </div>
                    {renderStatusBadge(f.paused, rt)}
                  </div>

                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 10 }}>
                    <div>
                      Drive: <strong>{f.remoteFolderName}</strong>
                    </div>
                    <div>
                      Modo: {f.direction === 'receive_only' ? 'Somente Receber' : 'Enviar e Receber'} • Apagar no
                      Drive: {f.onRemoteDelete === 'keep_local' ? 'Mantém no celular' : 'Apaga do celular'}
                    </div>
                    {f.kind === 'master' && (
                      <div>Remetentes: {describeSenderPolicy(f.senderPolicy.mode)}</div>
                    )}
                    {rt && (
                      <div>
                        {rt.syncedFilesCount} arquivo(s) mapeado(s)
                        {rt.keptLocalCount > 0 ? ` • ${rt.keptLocalCount} mantido(s) no celular` : ''}
                      </div>
                    )}
                    {rt?.message && <div>Status: {rt.message}</div>}
                  </div>

                  {rt?.status === 'syncing' && (
                    <div style={{ marginBottom: 10 }}>
                      <div className="row-between" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        <span>{rt.currentFile || 'Processando arquivos...'}</span>
                        <span>
                          {rt.bytesTotal
                            ? `${formatBytes(rt.bytesTransferred ?? 0)} / ${formatBytes(rt.bytesTotal)}`
                            : `${pct}%`}
                        </span>
                      </div>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${Math.max(8, pct)}%` }} />
                      </div>
                    </div>
                  )}

                  <div className="row-gap">
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
                            setNotice(`${res.addedCount} arquivo(s) adicionado(s) e sincronizando.`);
                          }
                          await refresh();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      <FilePlus2 size={14} /> Adicionar arquivos
                    </button>

                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setBrowserFolder(f)}
                    >
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
                      <RefreshCw size={14} /> Sincronizar agora
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
                      <Share2 size={14} /> Código / Convidar
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
            snap={snap}
            subTab={activitySubTab}
            onSubTabChange={setActivitySubTab}
          />
        )}

        {tab === 'settings' && (
          <MobileSettingsTab
            bridge={bridge}
            snap={snap}
            onOpenAuth={() => setShowAuthModal(true)}
            onRefresh={refresh}
            onNotice={setNotice}
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
        </button>
        <button
          type="button"
          className={`bottom-tab ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => setTab('settings')}
        >
          <Settings size={18} />
          <span>Ajustes</span>
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
  const [selectedFolderId, setSelectedFolderId] = useState(snap.folders[0]?.id ?? '');
  const [newEmail, setNewEmail] = useState('');
  const [newAllowed, setNewAllowed] = useState<'allow' | 'block'>('allow');
  const folder = snap.folders.find((f) => f.id === selectedFolderId) ?? snap.folders[0];

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
      const nextRules = [
        ...folder.senderPolicy.rules.filter((r) => normalizeEmail(r.email) !== norm),
        { email: norm, allowed },
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
      <h1 style={{ margin: '0 0 12px', fontSize: 19 }}>Dispositivos & Pessoas</h1>

      <div className="card">
        <strong style={{ display: 'block', marginBottom: 8 }}>
          Dispositivos Conectados ({snap.devices.length})
        </strong>
        {snap.devices.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>Nenhum dispositivo listado ainda.</p>
        ) : (
          snap.devices.map((d) => (
            <div key={`${d.folderId}-${d.deviceId}`} className="list-row">
              <div className="row-gap">
                {d.platform === 'android' || d.platform === 'ios' ? (
                  <Smartphone size={17} />
                ) : (
                  <Laptop size={17} />
                )}
                <div>
                  <strong>{d.deviceName}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {d.platform} • {d.accountEmail} •{' '}
                    {d.syncMode === 'receive_only' ? 'Só recebe' : 'Envia e recebe'}
                  </div>
                </div>
              </div>
              {d.isCurrentDevice ? (
                <span className="badge badge-ok">Este celular</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
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
          ))
        )}
      </div>

      {folder && (
        <div className="card">
          <div className="row-between" style={{ marginBottom: 10 }}>
            <strong>De quem receber no Master</strong>
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

          {snap.folders.length > 1 && (
            <div className="form-group">
              <label className="form-label">Pasta</label>
              <select
                className="select"
                value={folder.id}
                onChange={(e) => setSelectedFolderId(e.target.value)}
              >
                {snap.folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Regra geral</label>
            <select
              className="select"
              value={folder.senderPolicy.mode}
              onChange={(e) => void updatePolicyMode(e.target.value as SenderPolicyMode)}
            >
              <option value="blocklist">Receber de todos (exceto bloqueados)</option>
              <option value="allowlist">Receber somente de quem eu permitir</option>
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
              placeholder="Adicionar e-mail (ex.: joao@gmail.com)"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <select
              className="select"
              style={{ width: 145 }}
              value={newAllowed}
              onChange={(e) => setNewAllowed(e.target.value as 'allow' | 'block')}
            >
              <option value="allow">Receber dele(a)</option>
              <option value="block">Não receber</option>
            </select>
            <button type="submit" className="btn btn-primary btn-sm">
              Adicionar
            </button>
          </form>

          {rulesMap.size === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
              Nenhuma regra ou remetente detectado ainda nesta pasta.
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
                      <UserCheck size={14} /> Recebendo
                    </>
                  ) : (
                    <>
                      <UserX size={14} /> Bloqueado
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
  snap: MobileSnapshot;
  subTab: ActivitySubTab;
  onSubTabChange: (next: ActivitySubTab) => void;
}> = ({ snap, subTab, onSubTabChange }) => {
  const blocked4gb = snap.blockedFiles.filter((b) => b.reason === 'exceeds_4gb');
  const blockedSenders = snap.blockedFiles.filter((b) => b.reason === 'sender_blocked');

  return (
    <div>
      <h1 style={{ margin: '0 0 12px', fontSize: 19 }}>Atividade & Bloqueios</h1>

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
          Acima de 4 GB ({blocked4gb.length})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${subTab === 'blocked_sender' ? 'btn-primary' : ''}`}
          onClick={() => onSubTabChange('blocked_sender')}
        >
          Ignorados por remetente ({blockedSenders.length})
        </button>
      </div>

      {subTab === 'recent' && (
        <div className="card">
          {snap.recentActivity.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Nenhuma atividade registrada ainda.</p>
          ) : (
            snap.recentActivity.map((ev) => (
              <div key={ev.id} className="list-row">
                <div>
                  <strong style={{ fontSize: 13 }}>{ev.message}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {ev.folderName}
                    {ev.fileSizeBytes ? ` • ${formatBytes(ev.fileSizeBytes)}` : ''}
                  </div>
                </div>
                <span className="badge">{ev.kind}</span>
              </div>
            ))
          )}
        </div>
      )}

      {subTab === 'blocked_4gb' && (
        <div className="card">
          {blocked4gb.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>
              Nenhum arquivo acima de 4 GB detectado.
            </p>
          ) : (
            blocked4gb.map((b) => (
              <div key={b.id} className="list-row">
                <div>
                  <strong style={{ fontSize: 13 }}>{b.relativePath}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {b.folderName} • {formatBytes(b.fileSizeBytes)} — {b.detail}
                  </div>
                </div>
                <span className="badge badge-warning">&gt; 4 GB</span>
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
                    {b.folderName} • Remetente: {b.authorEmail || 'desconhecido'}
                  </div>
                </div>
                <span className="badge badge-error">Ignorado</span>
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
}> = ({ bridge, snap, onOpenAuth, onRefresh, onNotice }) => {
  const [form, setForm] = useState<MobileSettings>(snap.settings);
  const [copiedAppLink, setCopiedAppLink] = useState(false);

  useEffect(() => {
    setForm(snap.settings);
  }, [snap.settings]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await bridge.updateSettings({ settings: form });
    await onRefresh();
    onNotice('Configurações salvas.');
  };

  return (
    <div>
      <h1 style={{ margin: '0 0 12px', fontSize: 19 }}>Ajustes</h1>

      <div className="card">
        <strong style={{ display: 'block', marginBottom: 6 }}>Compartilhar o DriveSync</strong>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-muted)' }}>
          Envie o link abaixo para instalar no Windows 10/11, Linux ou Android (APK):
        </p>
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
            <ExternalLink size={14} /> Abrir site
          </a>

          <a className="btn btn-sm" href={RELEASES_URL} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> Releases
          </a>
        </div>
      </div>

      <div className="card">
        <div className="row-between">
          <div>
            <strong>Conta Google</strong>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {snap.account.connected ? snap.account.email : 'Não conectada'}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {snap.account.hasCustomOAuthClient
                ? 'Credencial OAuth configurada'
                : 'Credencial OAuth (credentials.json) pendente'}
            </div>
          </div>
          <div className="row-gap">
            <button type="button" className="btn btn-sm" onClick={onOpenAuth}>
              {snap.account.connected ? 'Trocar' : 'Conectar'}
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
                Sair
              </button>
            )}
          </div>
        </div>
      </div>

      <form className="card" onSubmit={save}>
        <div className="form-group">
          <label className="form-label">Nome deste celular</label>
          <input
            className="input"
            value={form.deviceName}
            onChange={(e) => setForm({ ...form, deviceName: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Se apagarem no Drive após baixar no celular</label>
          <select
            className="select"
            value={form.defaultOnRemoteDelete}
            onChange={(e) => setForm({ ...form, defaultOnRemoteDelete: e.target.value as RemoteDeletePolicy })}
          >
            <option value="keep_local">Manter no celular (só apaga no Drive)</option>
            <option value="mirror_trash">Apagar do celular também</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Intervalo da sincronização automática</label>
          <select
            className="select"
            value={form.pollIntervalSeconds}
            onChange={(e) => setForm({ ...form, pollIntervalSeconds: Number(e.target.value) })}
          >
            <option value={900}>A cada 15 minutos</option>
            <option value={1800}>A cada 30 minutos</option>
            <option value={3600}>A cada 60 minutos</option>
          </select>
        </div>

        <label className="row-gap" style={{ marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={form.backgroundSyncEnabled}
            onChange={(e) => setForm({ ...form, backgroundSyncEnabled: e.target.checked })}
          />
          <span>Sincronizar automaticamente em segundo plano</span>
        </label>

        <label className="row-gap" style={{ marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={form.wifiOnly}
            onChange={(e) => setForm({ ...form, wifiOnly: e.target.checked })}
          />
          <span>Sincronizar em segundo plano apenas no Wi-Fi</span>
        </label>

        <div className="alert alert-info" style={{ marginBottom: 12 }}>
          Limite máximo fixo por upload: <strong>{formatBytes(form.maxUploadBytes)}</strong> por arquivo.
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
          Salvar ajustes
        </button>
      </form>
    </div>
  );
};

export default MobileApp;
