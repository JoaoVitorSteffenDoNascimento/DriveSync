import React, { useState } from 'react';
import { Laptop, Plus, RefreshCw, Smartphone, Trash2, UserCheck, UserX } from 'lucide-react';
import type { DaemonSnapshot, SenderPolicyMode, SyncFolderConfig } from '@drivesync/shared';
import { normalizeEmail } from '@drivesync/shared';
import type { DaemonClient } from '../api/daemonClient';

interface Props {
  client: DaemonClient;
  snapshot: DaemonSnapshot;
  onRefresh: () => Promise<void>;
}

export const DevicesAndPeoplePage: React.FC<Props> = ({ client, snapshot, onRefresh }) => {
  const masterFolders = snapshot.folders.filter((f) => f.kind === 'master');
  const [selectedFolderId, setSelectedFolderId] = useState<string>(
    masterFolders[0]?.id ?? snapshot.folders[0]?.id ?? '',
  );
  const [newEmail, setNewEmail] = useState('');
  const [newAllowed, setNewAllowed] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedFolder: SyncFolderConfig | undefined =
    snapshot.folders.find((f) => f.id === selectedFolderId) ?? masterFolders[0] ?? snapshot.folders[0];

  const sendersForFolder = snapshot.knownSenders.filter(
    (s) => !selectedFolder || s.folderId === selectedFolder.id,
  );

  // Combina remetentes detectados automaticamente no Drive com regras manuais da pasta
  const combinedSenders = (() => {
    if (!selectedFolder) return [];
    const map = new Map<string, { email: string; displayName: string; allowed: boolean }>();
    for (const ks of sendersForFolder) {
      const e = normalizeEmail(ks.email);
      const defaultAllow = selectedFolder.senderPolicy.mode !== 'allowlist';
      map.set(e, { email: e, displayName: ks.displayName, allowed: defaultAllow });
    }
    for (const rule of selectedFolder.senderPolicy.rules) {
      const e = normalizeEmail(rule.email);
      const prev = map.get(e);
      map.set(e, {
        email: e,
        displayName: rule.displayName || prev?.displayName || '',
        allowed: rule.allowed,
      });
    }
    return Array.from(map.values());
  })();

  const updateSenderPolicy = async (
    folder: SyncFolderConfig,
    nextPolicy: SyncFolderConfig['senderPolicy'],
  ) => {
    setSaving(true);
    try {
      await client.updateSyncFolder({
        ...folder,
        senderPolicy: nextPolicy,
      });
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePerson = async (email: string, nextAllowed: boolean) => {
    if (!selectedFolder) return;
    const norm = normalizeEmail(email);
    const existing = selectedFolder.senderPolicy.rules.filter(
      (r) => normalizeEmail(r.email) !== norm,
    );
    const known = sendersForFolder.find((s) => normalizeEmail(s.email) === norm);
    const nextRules = [
      ...existing,
      { email: norm, displayName: known?.displayName, allowed: nextAllowed },
    ];
    const nextMode: SenderPolicyMode =
      selectedFolder.senderPolicy.mode === 'all' ? 'blocklist' : selectedFolder.senderPolicy.mode;

    await updateSenderPolicy(selectedFolder, {
      ...selectedFolder.senderPolicy,
      mode: nextMode,
      rules: nextRules,
    });
  };

  const handleAddPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFolder) return;
    const norm = normalizeEmail(newEmail);
    if (!norm) return;
    setNewEmail('');
    await handleTogglePerson(norm, newAllowed);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dispositivos & Pessoas</h1>
          <p className="page-subtitle">
            Veja todos os PCs e celulares conectados e escolha de quem este computador recebe no Drive Master.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="row-inline" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <strong style={{ fontSize: 15 }}>Dispositivos Conectados ({snapshot.devices.length})</strong>
        </div>

        {snapshot.devices.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            Conecte uma pasta para registrar este computador e descobrir outros dispositivos conectados.
          </p>
        ) : (
          snapshot.devices.map((dev) => {
            const folderName =
              snapshot.folders.find((f) => f.id === dev.folderId)?.name ?? dev.folderId;
            const isMobile = dev.platform === 'android' || dev.platform === 'ios';

            return (
              <div key={`${dev.folderId}-${dev.deviceId}`} className="list-row">
                <div className="row-inline">
                  {isMobile ? <Smartphone size={18} /> : <Laptop size={18} />}
                  <div>
                    <div className="row-inline">
                      <strong>{dev.deviceName}</strong>
                      {dev.isCurrentDevice && <span className="badge badge-ok">Este dispositivo</span>}
                      <span className="badge badge-muted">{dev.platform}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Pasta: {folderName} • Conta: {dev.accountEmail || '—'} • Modo:{' '}
                      {dev.syncMode === 'receive_only' ? 'Somente recebe' : 'Envia e recebe'}
                    </div>
                  </div>
                </div>

                <div className="row-inline">
                  <span className="badge badge-muted">{dev.status}</span>
                  {!dev.isCurrentDevice && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      title="Remover da lista"
                      onClick={async () => {
                        await client.forgetDevice(dev.folderId, dev.deviceId);
                        await onRefresh();
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="card">
        <div className="page-header" style={{ marginBottom: 12 }}>
          <div>
            <strong style={{ fontSize: 15 }}>De quem receber arquivos (Drive Master)</strong>
            <p className="page-subtitle">
              Exemplo: bloqueie "luiz@..." para não baixar arquivos dele e mantenha "joao@..." permitido.
            </p>
          </div>
          {selectedFolder && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={saving}
              onClick={() => void client.syncNow(selectedFolder.id)}
            >
              <RefreshCw size={14} /> Reaplicar filtros agora
            </button>
          )}
        </div>

        {!selectedFolder ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            Nenhuma pasta conectada ainda.
          </p>
        ) : (
          <>
            {snapshot.folders.length > 1 && (
              <div className="form-group">
                <label className="form-label">Pasta selecionada</label>
                <select
                  className="select"
                  value={selectedFolder.id}
                  onChange={(e) => setSelectedFolderId(e.target.value)}
                >
                  {snapshot.folders.map((f) => (
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
                disabled={saving}
                value={selectedFolder.senderPolicy.mode}
                onChange={(e) =>
                  void updateSenderPolicy(selectedFolder, {
                    ...selectedFolder.senderPolicy,
                    mode: e.target.value as SenderPolicyMode,
                  })
                }
              >
                <option value="blocklist">Receber de todos, exceto quem eu bloquear</option>
                <option value="allowlist">Receber somente de pessoas aprovadas abaixo</option>
                <option value="all">Receber de qualquer pessoa (sem filtro)</option>
              </select>
            </div>

            <form onSubmit={handleAddPerson} className="row-inline" style={{ marginBottom: 14 }}>
              <input
                className="input"
                type="email"
                placeholder="Adicionar e-mail manualmente (ex.: joao@gmail.com ou luiz@gmail.com)"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
              <select
                className="select"
                style={{ width: 170 }}
                value={newAllowed ? 'allow' : 'block'}
                onChange={(e) => setNewAllowed(e.target.value === 'allow')}
              >
                <option value="allow">Receber dele(a)</option>
                <option value="block">Não receber</option>
              </select>
              <button type="submit" className="btn btn-primary" disabled={saving || !newEmail.trim()}>
                <Plus size={15} /> Adicionar
              </button>
            </form>

            {combinedSenders.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>
                Nenhuma pessoa detectada ainda nesta pasta. Assim que alguém jogar um arquivo no Drive
                Master, ela aparecerá aqui automaticamente.
              </p>
            ) : (
              combinedSenders.map((person) => (
                <div key={person.email} className="list-row">
                  <div>
                    <strong>{person.displayName || person.email}</strong>
                    {person.displayName && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{person.email}</div>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={saving}
                    className={`toggle-pill ${person.allowed ? 'allowed' : 'blocked'}`}
                    onClick={() => void handleTogglePerson(person.email, !person.allowed)}
                  >
                    {person.allowed ? (
                      <span className="row-inline">
                        <UserCheck size={14} /> Recebendo arquivos
                      </span>
                    ) : (
                      <span className="row-inline">
                        <UserX size={14} /> Não receber (bloqueado)
                      </span>
                    )}
                  </button>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
};
