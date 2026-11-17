import React, { useEffect, useState } from 'react';
import {
  Crown,
  Folder,
  FolderOpen,
  FolderPlus,
  KeyRound,
  Lock,
  Search,
  ShieldAlert,
  UserCheck,
  X,
} from 'lucide-react';
import type {
  FolderKind,
  LocalDeletePolicy,
  RemoteDeletePolicy,
  RemoteFolderItem,
  SenderPolicyMode,
  SyncDirection,
} from '@drivesync/shared';
import { validateCreateFolderInput } from '@drivesync/shared';
import type { DaemonClient } from '../api/daemonClient';

interface Props {
  client: DaemonClient;
  defaultOnRemoteDelete: RemoteDeletePolicy;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

export const ConnectFolderWizard: React.FC<Props> = ({
  client,
  defaultOnRemoteDelete,
  onClose,
  onCreated,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [joinByCode, setJoinByCode] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [resolvingCode, setResolvingCode] = useState(false);
  const [resolvedInfo, setResolvedInfo] = useState<string | null>(null);
  const [kind, setKind] = useState<FolderKind>('master');
  const [name, setName] = useState('Drive Master');
  const [localPath, setLocalPath] = useState('');

  const [driveTab, setDriveTab] = useState<'my_drive' | 'shared'>('my_drive');
  const [driveParentStack, setDriveParentStack] = useState<{ id: string; name: string }[]>([
    { id: 'root', name: 'Meu Drive' },
  ]);
  const [driveFolders, setDriveFolders] = useState<RemoteFolderItem[]>([]);
  const [selectedDriveFolder, setSelectedDriveFolder] = useState<RemoteFolderItem | null>(null);
  const [newDriveFolderName, setNewDriveFolderName] = useState('');
  const [loadingDrive, setLoadingDrive] = useState(false);

  const [direction, setDirection] = useState<SyncDirection>('bidirectional');
  const [onRemoteDelete, setOnRemoteDelete] = useState<RemoteDeletePolicy>(defaultOnRemoteDelete);
  const [onLocalDelete, setOnLocalDelete] = useState<LocalDeletePolicy>('ignore');
  const [senderMode, setSenderMode] = useState<SenderPolicyMode>('blocklist');
  const [unknownSenderAction, setUnknownSenderAction] = useState<'allow' | 'block'>('allow');
  const [initialAllowedEmails, setInitialAllowedEmails] = useState('');
  const [initialBlockedEmails, setInitialBlockedEmails] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentDriveParent = driveParentStack[driveParentStack.length - 1];

  const loadDriveFolders = async () => {
    setLoadingDrive(true);
    setError(null);
    try {
      const items = await client.listDriveFolders(
        driveTab === 'shared' ? 'root' : currentDriveParent.id,
        driveTab === 'shared',
      );
      setDriveFolders(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDrive(false);
    }
  };

  useEffect(() => {
    if (step === 2 && !(joinByCode && selectedDriveFolder)) {
      void loadDriveFolders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, driveTab, currentDriveParent.id, joinByCode]);

  const handleSelectKind = (nextKind: FolderKind) => {
    setJoinByCode(false);
    setKind(nextKind);
    if (nextKind === 'personal') {
      setName('Minha Pasta Pessoal');
      setDirection('bidirectional');
      setSenderMode('all');
    } else {
      setName('Drive Master Compartilhado');
      setDirection('bidirectional');
      setOnRemoteDelete('keep_local');
      setOnLocalDelete('ignore');
      setSenderMode('blocklist');
    }
  };

  const handleResolveCode = async () => {
    const trimmed = codeInput.trim();
    if (!trimmed) return;
    setResolvingCode(true);
    setError(null);
    setResolvedInfo(null);
    try {
      const res = await client.resolveFolderCode(trimmed);
      setKind(res.kind);
      setName(res.remoteFolderName || 'Drive Master');
      setSelectedDriveFolder({
        id: res.remoteFolderId,
        name: res.remoteFolderName,
        shared: true,
        ownerEmail: res.ownerEmail,
        ownerName: res.ownerName,
        canWrite: res.canWrite,
      });
      setDirection(res.canWrite ? 'bidirectional' : 'receive_only');
      setOnRemoteDelete('keep_local');
      setOnLocalDelete('ignore');
      setSenderMode('blocklist');
      setResolvedInfo(
        `Pasta encontrada: ${res.remoteFolderName}${res.ownerEmail ? ` (Dono: ${res.ownerEmail})` : ''} — ${res.canWrite ? 'Leitura e escrita' : 'Somente leitura'}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolvingCode(false);
    }
  };

  const handleBrowseLocal = async () => {
    if (window.driveSyncDesktop) {
      const chosen = await window.driveSyncDesktop.selectLocalFolder();
      if (chosen) setLocalPath(chosen);
    }
  };

  const handleCreateDriveFolder = async () => {
    const trimmed = newDriveFolderName.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const created = await client.createDriveFolder(trimmed, currentDriveParent.id);
      setNewDriveFolderName('');
      setSelectedDriveFolder(created);
      await loadDriveFolders();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSubmit = async () => {
    const rules = [
      ...initialAllowedEmails
        .split(/[,;\n]/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
        .map((email) => ({ email, allowed: true })),
      ...initialBlockedEmails
        .split(/[,;\n]/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
        .map((email) => ({ email, allowed: false })),
    ];

    const payload = {
      name: name.trim(),
      localPath: localPath.trim(),
      remoteFolderId: selectedDriveFolder?.id ?? '',
      remoteFolderName: selectedDriveFolder?.name ?? '',
      kind,
      direction,
      onRemoteDelete,
      onLocalDelete,
      senderPolicy: {
        mode: kind === 'personal' ? ('all' as const) : senderMode,
        unknownSenderAction,
        rules,
      },
    };

    const errs = validateCreateFolderInput(payload);
    if (errs.length > 0) {
      setError(errs[0]);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await client.createSyncFolder(payload);
      await onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Conectar Pasta">
      <div className="modal-box">
        <div className="page-header" style={{ marginBottom: 12 }}>
          <div>
            <h2 className="page-title" style={{ fontSize: 18 }}>
              Conectar nova pasta — Passo {step} de 3
            </h2>
            <p className="page-subtitle">
              Escolha a pasta do computador, a pasta do Drive e quem pode enviar arquivos.
            </p>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        {error && <div className="alert-banner alert-error">{error}</div>}

        {step === 1 && (
          <div>
            <div className="choice-grid" style={{ marginBottom: 14 }}>
              <button
                type="button"
                className={`choice-card ${!joinByCode && kind === 'master' ? 'selected' : ''}`}
                onClick={() => handleSelectKind('master')}
              >
                <Crown size={20} color="var(--primary)" />
                <strong>Drive Master (Compartilhado)</strong>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Pessoas jogam arquivos no Drive Master e você escolhe de quem quer receber neste PC.
                </span>
              </button>

              <button
                type="button"
                className={`choice-card ${!joinByCode && kind === 'personal' ? 'selected' : ''}`}
                onClick={() => handleSelectKind('personal')}
              >
                <Lock size={20} color="var(--primary)" />
                <strong>Pasta Pessoal</strong>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Espelha seus próprios arquivos entre vários PCs e celular na sua conta.
                </span>
              </button>
            </div>

            <button
              type="button"
              className={`choice-card ${joinByCode ? 'selected' : ''}`}
              style={{ width: '100%', marginBottom: 14 }}
              onClick={() => setJoinByCode(true)}
            >
              <div className="row-inline">
                <KeyRound size={18} color="var(--primary)" />
                <strong>Entrar usando Código ou Link de uma Pasta</strong>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Cole o código gerado pelo DriveSync em outro PC (ex.: DS1... ou DS-XXXX-XXXX) ou link do Drive e o app acha a pasta automático.
              </span>
            </button>

            {joinByCode && (
              <div className="card" style={{ background: 'var(--surface-muted)', boxShadow: 'none' }}>
                <div className="form-group" style={{ marginBottom: 8 }}>
                  <label className="form-label" htmlFor="wizard-join-code">
                    Código do app ou link do Google Drive
                  </label>
                  <div className="row-inline">
                    <input
                      id="wizard-join-code"
                      className="input"
                      placeholder="Ex.: DS1.1AbCd...DS-4829-KP7M ou DS-4829-KP7M ou https://drive.google.com/..."
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={resolvingCode || !codeInput.trim()}
                      onClick={handleResolveCode}
                    >
                      <Search size={14} /> {resolvingCode ? 'Buscando...' : 'Buscar Pasta'}
                    </button>
                  </div>
                </div>
                {resolvedInfo && (
                  <div style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>
                    {resolvedInfo}
                  </div>
                )}
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="wizard-folder-name">
                Nome fácil para esta conexão
              </label>
              <input
                id="wizard-folder-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="row-inline" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn" onClick={onClose}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={joinByCode && !selectedDriveFolder}
                onClick={() => setStep(2)}
              >
                Continuar
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="form-group">
              <label className="form-label" htmlFor="wizard-local-path">
                1. Pasta neste computador que vai sincronizar
              </label>
              <div className="row-inline">
                <input
                  id="wizard-local-path"
                  className="input"
                  placeholder="Ex.: /home/usuario/Master ou C:\Users\Usuario\Master"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                />
                <button type="button" className="btn" onClick={handleBrowseLocal}>
                  <FolderOpen size={16} /> Escolher
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">2. Pasta no Google Drive que receberá/enviará os arquivos</label>
              {joinByCode && selectedDriveFolder ? (
                <div className="card" style={{ background: 'var(--surface-muted)', boxShadow: 'none' }}>
                  <div className="row-inline" style={{ justifyContent: 'space-between' }}>
                    <span className="row-inline">
                      <Folder size={17} color="var(--primary)" />
                      <strong>{selectedDriveFolder.name}</strong>
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setJoinByCode(false);
                        setSelectedDriveFolder(null);
                      }}
                    >
                      Escolher outra pasta
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                    Localizada automaticamente pelo código/link informado.
                  </div>
                </div>
              ) : (
                <>
                  <div className="row-inline" style={{ marginBottom: 8 }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${driveTab === 'my_drive' ? 'btn-primary' : ''}`}
                      onClick={() => {
                        setDriveTab('my_drive');
                        setDriveParentStack([{ id: 'root', name: 'Meu Drive' }]);
                      }}
                    >
                      Meu Drive
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${driveTab === 'shared' ? 'btn-primary' : ''}`}
                      onClick={() => setDriveTab('shared')}
                    >
                      Compartilhados comigo
                    </button>
                    {driveTab === 'my_drive' && driveParentStack.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setDriveParentStack((s) => s.slice(0, -1))}
                      >
                        Voltar ({driveParentStack[driveParentStack.length - 2].name})
                      </button>
                    )}
                  </div>

                  <div className="drive-browser">
                    {loadingDrive && (
                      <div style={{ padding: 14, color: 'var(--text-muted)' }}>
                        Carregando pastas do Google Drive...
                      </div>
                    )}
                    {!loadingDrive && driveFolders.length === 0 && (
                      <div style={{ padding: 14, color: 'var(--text-muted)' }}>
                        Nenhuma subpasta encontrada aqui.
                      </div>
                    )}
                    {!loadingDrive &&
                      driveFolders.map((item) => {
                        const isSelected = selectedDriveFolder?.id === item.id;
                        return (
                          <div
                            key={item.id}
                            className={`drive-row ${isSelected ? 'selected' : ''}`}
                            onClick={() => setSelectedDriveFolder(item)}
                            onDoubleClick={() => {
                              setDriveTab('my_drive');
                              setDriveParentStack((s) => [...s, { id: item.id, name: item.name }]);
                            }}
                          >
                            <span className="row-inline">
                              <Folder size={16} />
                              <span>{item.name}</span>
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {item.ownerName || item.ownerEmail || (item.canWrite ? 'Leitura e escrita' : 'Somente leitura')}
                            </span>
                          </div>
                        );
                      })}
                  </div>

                  {selectedDriveFolder && (
                    <div style={{ fontSize: 12, color: 'var(--success)', marginTop: 4 }}>
                      Pasta selecionada: <strong>{selectedDriveFolder.name}</strong>
                    </div>
                  )}

                  {driveTab === 'my_drive' && (
                    <div className="row-inline" style={{ marginTop: 8 }}>
                      <input
                        className="input"
                        placeholder="Ou criar nova pasta no Drive aqui..."
                        value={newDriveFolderName}
                        onChange={(e) => setNewDriveFolderName(e.target.value)}
                      />
                      <button type="button" className="btn btn-sm" onClick={handleCreateDriveFolder}>
                        <FolderPlus size={15} /> Criar
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="row-inline" style={{ justifyContent: 'space-between', marginTop: 16 }}>
              <button type="button" className="btn" onClick={() => setStep(1)}>
                Voltar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!localPath.trim() || !selectedDriveFolder}
                onClick={() => setStep(3)}
              >
                Continuar
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="form-group">
              <label className="form-label" htmlFor="wizard-direction">
                Como este computador deve atuar?
              </label>
              <select
                id="wizard-direction"
                className="select"
                value={direction}
                onChange={(e) => setDirection(e.target.value as SyncDirection)}
              >
                <option value="bidirectional">Enviar e Receber (baixa do Drive e envia arquivos deste PC)</option>
                <option value="receive_only">Somente Receber (apenas espelha para este PC, não envia nada)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="wizard-remote-delete">
                Se apagarem um arquivo no Drive depois que ele já baixou no PC:
              </label>
              <select
                id="wizard-remote-delete"
                className="select"
                value={onRemoteDelete}
                onChange={(e) => setOnRemoteDelete(e.target.value as RemoteDeletePolicy)}
              >
                <option value="keep_local">
                  Não apagar do PC — manter a cópia já baixada (apaga somente no Drive)
                </option>
                <option value="mirror_trash">
                  Apagar do PC também (mover para pasta de Quarentena local)
                </option>
              </select>
            </div>

            {direction === 'bidirectional' && (
              <div className="form-group">
                <label className="form-label" htmlFor="wizard-local-delete">
                  Se você apagar um arquivo neste PC:
                </label>
                <select
                  id="wizard-local-delete"
                  className="select"
                  value={onLocalDelete}
                  onChange={(e) => setOnLocalDelete(e.target.value as LocalDeletePolicy)}
                >
                  <option value="ignore">Manter no Drive (não apagar para os outros)</option>
                  <option value="trash_remote">Mover para lixeira do Drive também</option>
                </select>
              </div>
            )}

            {kind === 'master' && (
              <div className="card" style={{ background: 'var(--surface-muted)', boxShadow: 'none' }}>
                <div className="row-inline" style={{ marginBottom: 8 }}>
                  <UserCheck size={16} color="var(--primary)" />
                  <strong>Quem pode enviar arquivos para este PC?</strong>
                </div>

                <div className="form-group">
                  <select
                    className="select"
                    value={senderMode}
                    onChange={(e) => setSenderMode(e.target.value as SenderPolicyMode)}
                  >
                    <option value="blocklist">Receber de todos, exceto quem eu bloquear</option>
                    <option value="allowlist">Receber somente das pessoas aprovadas</option>
                    <option value="all">Receber de qualquer pessoa sem filtro</option>
                  </select>
                </div>

                {senderMode !== 'all' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Pessoas permitidas (e-mails separados por vírgula)</label>
                      <input
                        className="input"
                        placeholder="ex.: joao@gmail.com, maria@gmail.com"
                        value={initialAllowedEmails}
                        onChange={(e) => setInitialAllowedEmails(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Pessoas bloqueadas (não receber arquivos delas)</label>
                      <input
                        className="input"
                        placeholder="ex.: luiz@gmail.com"
                        value={initialBlockedEmails}
                        onChange={(e) => setInitialBlockedEmails(e.target.value)}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Se o Drive não identificar o remetente:</label>
                      <select
                        className="select"
                        value={unknownSenderAction}
                        onChange={(e) => setUnknownSenderAction(e.target.value as 'allow' | 'block')}
                      >
                        <option value="allow">Permitir download</option>
                        <option value="block">Bloquear por segurança</option>
                      </select>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="alert-banner" style={{ marginTop: 12 }}>
              <span className="row-inline">
                <ShieldAlert size={16} />
                <span>
                  Limite ativo: uploads individuais maiores que <strong>4 GB</strong> serão bloqueados automaticamente.
                </span>
              </span>
            </div>

            <div className="row-inline" style={{ justifyContent: 'space-between', marginTop: 14 }}>
              <button type="button" className="btn" onClick={() => setStep(2)}>
                Voltar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={handleSubmit}
              >
                {saving ? 'Conectando...' : 'Concluir e Sincronizar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
