import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Check,
  Cloud,
  Copy,
  Crown,
  FileJson,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderSync,
  KeyRound,
  Laptop,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Share2,
  Smartphone,
  Trash2,
  UserCheck,
  UserX,
  Users,
  X,
} from 'lucide-react';
import {
  formatBytes,
  normalizeEmail,
  type FolderInviteInfo,
  type FolderKind,
  type RemoteDeletePolicy,
  type RemoteFolderItem,
  type SenderPolicyMode,
  type SyncDirection,
  type SyncFolderConfig,
} from '@drivesync/shared';
import {
  mobileBridge,
  type DriveSyncNativePlugin,
  type MobileSettings,
  type MobileSnapshot,
} from './native/driveSyncNative';

type Tab = 'folders' | 'people' | 'activity' | 'settings';

const DOWNLOAD_SITE_URL = 'https://joaovitorsteffendonascimento.github.io/DriveSync/';

export const MobileApp: React.FC<{ bridge?: DriveSyncNativePlugin }> = ({
  bridge = mobileBridge,
}) => {
  const [snap, setSnap] = useState<MobileSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>('folders');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [shareFolder, setShareFolder] = useState<SyncFolderConfig | null>(null);

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

  if (!snap) {
    return (
      <div className="mobile-content" style={{ paddingTop: 48 }}>
        <div className="card">Carregando DriveSync Mobile...</div>
      </div>
    );
  }

  const blocked4gb = snap.blockedFiles.filter((b) => b.reason === 'exceeds_4gb');

  return (
    <div className="mobile-shell">
      <header className="mobile-header">
        <div className="row-gap">
          <Cloud size={20} color="var(--primary)" />
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
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => (snap.account.connected ? setShowWizard(true) : setShowAuthModal(true))}
              >
                <Plus size={15} /> Conectar Pasta
              </button>
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
              <div className="alert">
                <strong>{blocked4gb.length}</strong> arquivo(s) bloqueado(s) no upload por passarem de{' '}
                <strong>4 GB</strong>.
              </div>
            )}

            {snap.account.connected && snap.folders.length === 0 && (
              <div className="card" style={{ textAlign: 'center', padding: 24 }}>
                <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>
                  Toque em <strong>+ Conectar Pasta</strong> para escolher uma pasta do celular ou entrar pelo código de um Drive Master.
                </p>
              </div>
            )}

            {snap.folders.map((f) => {
              const rt = snap.runtime[f.id];
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
                    </div>
                    <span className={`badge ${rt?.status === 'ok' ? 'badge-ok' : rt?.status === 'error' ? 'badge-error' : ''}`}>
                      {rt?.status === 'ok' ? 'Sincronizado' : rt?.status === 'syncing' ? 'Sincronizando' : rt?.status === 'error' ? 'Erro' : 'Pronto'}
                    </span>
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                    <div>Drive: <strong>{f.remoteFolderName}</strong></div>
                    <div>
                      Modo: {f.direction === 'receive_only' ? 'Só Receber' : 'Enviar e Receber'} • Apagar no Drive:{' '}
                      {f.onRemoteDelete === 'keep_local' ? 'Mantém no celular' : 'Apaga do celular'}
                    </div>
                    {rt?.message && <div>Status: {rt.message}</div>}
                  </div>

                  <div className="row-gap">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={async () => {
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
                      <FilePlus2 size={14} /> Adicionar
                    </button>

                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        await bridge.syncNow({ folderId: f.id });
                        await refresh();
                      }}
                    >
                      <RefreshCw size={14} /> Sincronizar
                    </button>

                    <button type="button" className="btn btn-sm" onClick={() => setShareFolder(f)}>
                      <Share2 size={14} /> Código
                    </button>

                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={async () => {
                        await bridge.deleteSyncFolder({ folderId: f.id });
                        await refresh();
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'people' && (
          <MobilePeopleTab bridge={bridge} snap={snap} onRefresh={refresh} />
        )}

        {tab === 'activity' && (
          <div>
            <h1 style={{ margin: '0 0 12px', fontSize: 19 }}>Atividade & Bloqueios</h1>
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
                  </div>
                ))
              )}
            </div>
          </div>
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
    </div>
  );
};

const MobilePeopleTab: React.FC<{
  bridge: DriveSyncNativePlugin;
  snap: MobileSnapshot;
  onRefresh: () => Promise<void>;
}> = ({ bridge, snap, onRefresh }) => {
  const [selectedFolderId, setSelectedFolderId] = useState(snap.folders[0]?.id ?? '');
  const [newEmail, setNewEmail] = useState('');
  const folder = snap.folders.find((f) => f.id === selectedFolderId) ?? snap.folders[0];

  const senders = snap.knownSenders.filter((s) => !folder || s.folderId === folder.id);
  const rulesMap = new Map<string, { email: string; displayName: string; allowed: boolean }>();
  for (const s of senders) {
    const e = normalizeEmail(s.email);
    rulesMap.set(e, { email: e, displayName: s.displayName, allowed: folder?.senderPolicy.mode !== 'allowlist' });
  }
  for (const r of folder?.senderPolicy.rules ?? []) {
    const e = normalizeEmail(r.email);
    rulesMap.set(e, { email: e, displayName: r.displayName || rulesMap.get(e)?.displayName || '', allowed: r.allowed });
  }

  const toggleSender = async (email: string, allowed: boolean) => {
    if (!folder) return;
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
                    {d.platform} • {d.accountEmail}
                  </div>
                </div>
              </div>
              {d.isCurrentDevice && <span className="badge badge-ok">Este celular</span>}
            </div>
          ))
        )}
      </div>

      {folder && (
        <div className="card">
          <strong style={{ display: 'block', marginBottom: 8 }}>De quem receber no Master</strong>
          {snap.folders.length > 1 && (
            <select
              className="select"
              style={{ marginBottom: 10 }}
              value={folder.id}
              onChange={(e) => setSelectedFolderId(e.target.value)}
            >
              {snap.folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}

          <form
            className="row-gap"
            style={{ marginBottom: 10 }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newEmail.trim()) return;
              await toggleSender(newEmail, true);
              setNewEmail('');
            }}
          >
            <input
              className="input"
              style={{ flex: 1 }}
              type="email"
              placeholder="Adicionar e-mail (ex.: joao@gmail.com)"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <button type="submit" className="btn btn-primary btn-sm">
              Adicionar
            </button>
          </form>

          {Array.from(rulesMap.values()).map((p) => (
            <div key={p.email} className="list-row">
              <div>
                <strong>{p.displayName || p.email}</strong>
                {p.displayName && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.email}</div>}
              </div>
              <button
                type="button"
                className={`btn btn-sm ${p.allowed ? '' : 'btn-danger'}`}
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
          ))}
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
      </div>

      <div className="card">
        <div className="row-between">
          <div>
            <strong>Conta Google</strong>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {snap.account.connected ? snap.account.email : 'Não conectada'}
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

const MobileAuthSheet: React.FC<{
  bridge: DriveSyncNativePlugin;
  hasClient: boolean;
  onClose: () => void;
  onUpdated: () => Promise<void>;
}> = ({ bridge, hasClient, onClose, onUpdated }) => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showManual, setShowManual] = useState(!hasClient);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleLogin = async () => {
    setErr(null);
    setLoading(true);
    try {
      if (clientId.trim()) {
        await bridge.saveOAuthClient({
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
        });
      }
      await bridge.startGoogleOAuth();
      await onUpdated();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sheet-backdrop">
      <div className="sheet-box">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 17 }}>Conectar Google Drive</strong>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {err && <div className="alert alert-error">{err}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          <button type="button" className="btn btn-primary" disabled={loading} onClick={handleLogin}>
            <Cloud size={17} /> {loading ? 'Conectando...' : 'Entrar com Google'}
          </button>

          <label className="btn">
            <FileJson size={16} /> Carregar credentials.json
            <input
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  await bridge.uploadGoogleOAuthJson({ rawJson: await file.text() });
                  await onUpdated();
                  setShowManual(false);
                } catch (ex) {
                  setErr(ex instanceof Error ? ex.message : String(ex));
                }
              }}
            />
          </label>
        </div>

        <button type="button" className="btn btn-sm" onClick={() => setShowManual((v) => !v)}>
          <KeyRound size={14} /> {showManual ? 'Ocultar Client ID' : 'Informar Client ID manual'}
        </button>

        {showManual && (
          <div style={{ marginTop: 12 }}>
            <div className="form-group">
              <label className="form-label">Google Client ID (Desktop App)</label>
              <input className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Client Secret</label>
              <input
                className="input"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const MobileConnectSheet: React.FC<{
  bridge: DriveSyncNativePlugin;
  defaultOnRemoteDelete: RemoteDeletePolicy;
  onClose: () => void;
  onCreated: () => Promise<void>;
}> = ({ bridge, defaultOnRemoteDelete, onClose, onCreated }) => {
  const [name, setName] = useState('Drive Master');
  const [kind, setKind] = useState<FolderKind>('master');
  const [codeInput, setCodeInput] = useState('');
  const [localUri, setLocalUri] = useState('');
  const [localLabel, setLocalLabel] = useState('');
  const [remoteFolder, setRemoteFolder] = useState<RemoteFolderItem | null>(null);
  const [driveList, setDriveList] = useState<RemoteFolderItem[]>([]);
  const [direction, setDirection] = useState<SyncDirection>('bidirectional');
  const [onRemoteDelete, setOnRemoteDelete] = useState<RemoteDeletePolicy>(defaultOnRemoteDelete);
  const [senderMode, setSenderMode] = useState<SenderPolicyMode>('blocklist');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadDrive = async (shared: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await bridge.listDriveFolders({ parentId: 'root', shared });
      setDriveList(res.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop">
      <div className="sheet-box">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 17 }}>Conectar Pasta no Celular</strong>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {err && <div className="alert alert-error">{err}</div>}

        <div className="form-group">
          <label className="form-label">Entrar por Código ou Link (opcional)</label>
          <div className="row-gap">
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="DS1... ou DS-XXXX-XXXX ou link"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy || !codeInput.trim()}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  const res = await bridge.resolveFolderCode({ codeOrLink: codeInput });
                  setKind(res.kind);
                  setName(res.remoteFolderName);
                  setDirection(res.canWrite ? 'bidirectional' : 'receive_only');
                  setRemoteFolder({
                    id: res.remoteFolderId,
                    name: res.remoteFolderName,
                    shared: true,
                    ownerEmail: res.ownerEmail,
                    ownerName: res.ownerName,
                    canWrite: res.canWrite,
                  });
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Search size={14} /> Buscar
            </button>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Nome desta pasta</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="form-group">
          <label className="form-label">Pasta no celular que vai sincronizar</label>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const picked = await bridge.pickLocalFolder();
              setLocalUri(picked.uri);
              setLocalLabel(picked.displayName);
            }}
          >
            <FolderOpen size={16} /> {localLabel || 'Escolher pasta do celular'}
          </button>
        </div>

        <div className="form-group">
          <label className="form-label">Pasta no Google Drive</label>
          <div className="row-gap" style={{ marginBottom: 6 }}>
            <button type="button" className="btn btn-sm" onClick={() => void loadDrive(false)}>
              Meu Drive
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void loadDrive(true)}>
              Compartilhados
            </button>
          </div>
          {remoteFolder && (
            <div className="alert alert-info" style={{ marginBottom: 6 }}>
              Selecionada: <strong>{remoteFolder.name}</strong>
            </div>
          )}
          {driveList.map((item) => (
            <div
              key={item.id}
              className="list-row"
              style={{ cursor: 'pointer' }}
              onClick={() => setRemoteFolder(item)}
            >
              <span className="row-gap">
                <Folder size={15} /> {item.name}
              </span>
            </div>
          ))}
        </div>

        <div className="form-group">
          <label className="form-label">Sentido neste celular</label>
          <select
            className="select"
            value={direction}
            onChange={(e) => setDirection(e.target.value as SyncDirection)}
          >
            <option value="bidirectional">Enviar e Receber</option>
            <option value="receive_only">Somente Receber (Espelho)</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Se apagarem no Drive após baixar no celular</label>
          <select
            className="select"
            value={onRemoteDelete}
            onChange={(e) => setOnRemoteDelete(e.target.value as RemoteDeletePolicy)}
          >
            <option value="keep_local">Manter no celular (só apaga no Drive)</option>
            <option value="mirror_trash">Apagar do celular também</option>
          </select>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{ width: '100%' }}
          disabled={busy || !localUri || !remoteFolder}
          onClick={async () => {
            if (!remoteFolder) return;
            setBusy(true);
            try {
              await bridge.createSyncFolder({
                input: {
                  name: name.trim() || remoteFolder.name,
                  localPath: localUri,
                  remoteFolderId: remoteFolder.id,
                  remoteFolderName: remoteFolder.name,
                  kind,
                  direction,
                  onRemoteDelete,
                  onLocalDelete: 'ignore',
                  senderPolicy: {
                    mode: kind === 'personal' ? 'all' : senderMode,
                    unknownSenderAction: 'allow',
                    rules: [],
                  },
                },
              });
              await onCreated();
              onClose();
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Concluir e Sincronizar
        </button>
      </div>
    </div>
  );
};

const MobileShareSheet: React.FC<{
  bridge: DriveSyncNativePlugin;
  folder: SyncFolderConfig;
  onClose: () => void;
}> = ({ bridge, folder, onClose }) => {
  const [invite, setInvite] = useState<FolderInviteInfo | null>(null);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void bridge.generateFolderInvite({ folderId: folder.id }).then(setInvite).catch(() => {});
  }, [bridge, folder.id]);

  return (
    <div className="sheet-backdrop">
      <div className="sheet-box">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <strong>Código — {folder.name}</strong>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {msg && <div className="alert alert-info">{msg}</div>}

        {invite && (
          <div className="card" style={{ background: 'var(--surface-muted)' }}>
            <div className="form-group">
              <label className="form-label">Código Completo</label>
              <input className="input" readOnly value={invite.fullCode} />
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void navigator.clipboard.writeText(invite.fullCode)}
            >
              <Copy size={14} /> Copiar código
            </button>
          </div>
        )}

        <form
          className="row-gap"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!email.trim()) return;
            await bridge.shareFolder({
              folderId: folder.id,
              input: { accessType: 'user', role: 'reader', email: email.trim() },
            });
            setMsg(`Acesso liberado para ${email.trim()}`);
            setEmail('');
          }}
        >
          <input
            className="input"
            style={{ flex: 1 }}
            type="email"
            placeholder="Liberar e-mail (ex.: joao@gmail.com)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-sm">
            Liberar
          </button>
        </form>
      </div>
    </div>
  );
};
