import React, { useEffect, useState } from 'react';
import { ArrowLeft, Crown, Folder, FolderOpen, FolderPlus, KeyRound, Lock, Search, X } from 'lucide-react';
import {
  validateCreateFolderInput,
  type FolderKind,
  type LocalDeletePolicy,
  type RemoteDeletePolicy,
  type RemoteFolderItem,
  type SenderPolicyMode,
  type SyncDirection,
} from '@drivesync/shared';
import type { DriveSyncNativePlugin } from '../native/driveSyncNative';

interface Props {
  bridge: DriveSyncNativePlugin;
  defaultOnRemoteDelete: RemoteDeletePolicy;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

export const MobileConnectSheet: React.FC<Props> = ({
  bridge,
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
  const [localUri, setLocalUri] = useState('');
  const [localLabel, setLocalLabel] = useState('');

  const [driveTab, setDriveTab] = useState<'my_drive' | 'shared'>('my_drive');
  const [parentStack, setParentStack] = useState<{ id: string; name: string }[]>([
    { id: 'root', name: 'Meu Drive' },
  ]);
  const [driveFolders, setDriveFolders] = useState<RemoteFolderItem[]>([]);
  const [remoteFolder, setRemoteFolder] = useState<RemoteFolderItem | null>(null);
  const [newDriveName, setNewDriveName] = useState('');
  const [loadingDrive, setLoadingDrive] = useState(false);

  const [direction, setDirection] = useState<SyncDirection>('bidirectional');
  const [onRemoteDelete, setOnRemoteDelete] = useState<RemoteDeletePolicy>(defaultOnRemoteDelete);
  const [onLocalDelete, setOnLocalDelete] = useState<LocalDeletePolicy>('ignore');
  const [senderMode, setSenderMode] = useState<SenderPolicyMode>('blocklist');
  const [unknownSenderAction, setUnknownSenderAction] = useState<'allow' | 'block'>('allow');
  const [allowedEmails, setAllowedEmails] = useState('');
  const [blockedEmails, setBlockedEmails] = useState('');

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const currentParent = parentStack[parentStack.length - 1];

  const loadDrive = async () => {
    setLoadingDrive(true);
    setErr(null);
    try {
      const res = await bridge.listDriveFolders({
        parentId: driveTab === 'shared' ? 'root' : currentParent.id,
        shared: driveTab === 'shared',
      });
      setDriveFolders(res.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDrive(false);
    }
  };

  useEffect(() => {
    if (step === 2 && !(joinByCode && remoteFolder)) {
      void loadDrive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, driveTab, currentParent.id, joinByCode]);

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
    if (!codeInput.trim()) return;
    setResolvingCode(true);
    setErr(null);
    setResolvedInfo(null);
    try {
      const res = await bridge.resolveFolderCode({ codeOrLink: codeInput.trim() });
      setKind(res.kind);
      setName(res.remoteFolderName || 'Drive Master');
      setRemoteFolder({
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
        `Encontrada: ${res.remoteFolderName}${res.ownerEmail ? ` (${res.ownerEmail})` : ''} — ${
          res.canWrite ? 'Leitura e escrita' : 'Somente leitura'
        }`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setResolvingCode(false);
    }
  };

  const handleSubmit = async () => {
    const rules = [
      ...allowedEmails
        .split(/[,;\n]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .map((email) => ({ email, allowed: true })),
      ...blockedEmails
        .split(/[,;\n]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .map((email) => ({ email, allowed: false })),
    ];

    const payload = {
      name: name.trim() || remoteFolder?.name || 'Pasta DriveSync',
      localPath: localUri,
      remoteFolderId: remoteFolder?.id ?? '',
      remoteFolderName: remoteFolder?.name ?? '',
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
      setErr(errs[0]);
      return;
    }

    setBusy(true);
    setErr(null);
    try {
      await bridge.createSyncFolder({ input: payload });
      await onCreated();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Conectar Pasta">
      <div className="sheet-box">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 17 }}>Conectar Nova Pasta</strong>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        <div className="step-pills">
          <div className={`step-pill ${step === 1 ? 'active' : ''}`}>1. Tipo</div>
          <div className={`step-pill ${step === 2 ? 'active' : ''}`}>2. Pastas</div>
          <div className={`step-pill ${step === 3 ? 'active' : ''}`}>3. Regras</div>
        </div>

        {err && <div className="alert alert-error">{err}</div>}

        {step === 1 && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                className="btn"
                style={{
                  justifyContent: 'flex-start',
                  borderColor: !joinByCode && kind === 'personal' ? 'var(--primary)' : 'var(--border)',
                  background: !joinByCode && kind === 'personal' ? 'var(--primary-soft)' : 'var(--surface)',
                }}
                onClick={() => handleSelectKind('personal')}
              >
                <Lock size={17} color="var(--primary)" /> Pasta Pessoal (só sua)
              </button>

              <button
                type="button"
                className="btn"
                style={{
                  justifyContent: 'flex-start',
                  borderColor: !joinByCode && kind === 'master' ? 'var(--primary)' : 'var(--border)',
                  background: !joinByCode && kind === 'master' ? 'var(--primary-soft)' : 'var(--surface)',
                }}
                onClick={() => handleSelectKind('master')}
              >
                <Crown size={17} color="var(--primary)" /> Drive Master (equipe e filtro de remetentes)
              </button>

              <button
                type="button"
                className="btn"
                style={{
                  justifyContent: 'flex-start',
                  borderColor: joinByCode ? 'var(--primary)' : 'var(--border)',
                  background: joinByCode ? 'var(--primary-soft)' : 'var(--surface)',
                }}
                onClick={() => setJoinByCode(true)}
              >
                <KeyRound size={17} color="var(--primary)" /> Entrar por Código ou Link do Drive
              </button>
            </div>

            {joinByCode && (
              <div className="card" style={{ marginTop: 12, background: 'var(--surface-muted)' }}>
                <label className="form-label">Código DS1 / DS-XXXX-XXXX ou Link</label>
                <div className="row-gap" style={{ marginTop: 6 }}>
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    placeholder="Cole código ou link..."
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={resolvingCode || !codeInput.trim()}
                    onClick={() => void handleResolveCode()}
                  >
                    <Search size={14} /> {resolvingCode ? '...' : 'Buscar'}
                  </button>
                </div>
                {resolvedInfo && <div className="alert alert-info" style={{ marginTop: 10 }}>{resolvedInfo}</div>}
              </div>
            )}

            <div className="row-between" style={{ marginTop: 16 }}>
              <span />
              <button
                type="button"
                className="btn btn-primary"
                disabled={joinByCode && !remoteFolder}
                onClick={() => setStep(2)}
              >
                Próximo
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="form-group">
              <label className="form-label">Pasta no celular (Android SAF)</label>
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

            {joinByCode && remoteFolder ? (
              <div className="alert alert-info">
                Pasta do Drive vinculada pelo código: <strong>{remoteFolder.name}</strong>
              </div>
            ) : (
              <div className="form-group">
                <label className="form-label">Pasta no Google Drive</label>
                <div className="row-gap" style={{ marginBottom: 8 }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${driveTab === 'my_drive' ? 'btn-primary' : ''}`}
                    onClick={() => {
                      setDriveTab('my_drive');
                      setParentStack([{ id: 'root', name: 'Meu Drive' }]);
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
                  {driveTab === 'my_drive' && parentStack.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setParentStack((s) => s.slice(0, -1))}
                    >
                      <ArrowLeft size={14} /> Voltar
                    </button>
                  )}
                </div>

                {driveTab === 'my_drive' && (
                  <div className="row-gap" style={{ marginBottom: 8 }}>
                    <input
                      className="input"
                      style={{ flex: 1 }}
                      placeholder={`Criar subpasta em ${currentParent.name}...`}
                      value={newDriveName}
                      onChange={(e) => setNewDriveName(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!newDriveName.trim() || loadingDrive}
                      onClick={async () => {
                        try {
                          const created = await bridge.createDriveFolder({
                            name: newDriveName.trim(),
                            parentId: currentParent.id,
                          });
                          setNewDriveName('');
                          setRemoteFolder(created);
                          await loadDrive();
                        } catch (e) {
                          setErr(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      <FolderPlus size={14} /> Criar
                    </button>
                  </div>
                )}

                {remoteFolder && (
                  <div className="alert alert-info" style={{ marginBottom: 8 }}>
                    Selecionada: <strong>{remoteFolder.name}</strong>
                  </div>
                )}

                <div className="drive-browser">
                  {loadingDrive ? (
                    <div style={{ padding: 12, color: 'var(--text-muted)' }}>Listando pastas...</div>
                  ) : driveFolders.length === 0 ? (
                    <div style={{ padding: 14, color: 'var(--text-muted)' }}>Nenhuma pasta encontrada aqui.</div>
                  ) : (
                    driveFolders.map((item) => (
                      <div
                        key={item.id}
                        className={`drive-row ${remoteFolder?.id === item.id ? 'selected' : ''}`}
                      >
                        <button
                          type="button"
                          style={{
                            flex: 1,
                            background: 'none',
                            border: 0,
                            textAlign: 'left',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: 0,
                          }}
                          onClick={() => setRemoteFolder(item)}
                        >
                          <Folder size={16} color="var(--primary)" />
                          <span>{item.name}</span>
                        </button>
                        {driveTab === 'my_drive' && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => setParentStack((s) => [...s, { id: item.id, name: item.name }])}
                          >
                            Abrir
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            <div className="row-between" style={{ marginTop: 14 }}>
              <button type="button" className="btn btn-sm" onClick={() => setStep(1)}>
                Voltar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!localUri || !remoteFolder}
                onClick={() => {
                  if (remoteFolder && (name === 'Drive Master Compartilhado' || name === 'Minha Pasta Pessoal')) {
                    setName(remoteFolder.name);
                  }
                  setStep(3);
                }}
              >
                Próximo
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="form-group">
              <label className="form-label">Nome da conexão</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
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
                <option value="keep_local">Não apagar do celular (manter já baixados)</option>
                <option value="mirror_trash">Apagar do celular também (Quarentena local)</option>
              </select>
            </div>

            {direction === 'bidirectional' && (
              <div className="form-group">
                <label className="form-label">Se você apagar neste celular</label>
                <select
                  className="select"
                  value={onLocalDelete}
                  onChange={(e) => setOnLocalDelete(e.target.value as LocalDeletePolicy)}
                >
                  <option value="ignore">Manter no Google Drive</option>
                  <option value="trash_remote">Mover para lixeira do Drive</option>
                </select>
              </div>
            )}

            {kind === 'master' && (
              <>
                <div className="form-group">
                  <label className="form-label">Filtro de remetentes no Drive Master</label>
                  <select
                    className="select"
                    value={senderMode}
                    onChange={(e) => setSenderMode(e.target.value as SenderPolicyMode)}
                  >
                    <option value="blocklist">Receber de todos, exceto bloqueados</option>
                    <option value="allowlist">Receber somente de aprovados</option>
                    <option value="all">Receber de todos sem filtro</option>
                  </select>
                </div>

                {senderMode === 'blocklist' && (
                  <div className="form-group">
                    <label className="form-label">Pessoas novas desconhecidas</label>
                    <select
                      className="select"
                      value={unknownSenderAction}
                      onChange={(e) => setUnknownSenderAction(e.target.value as 'allow' | 'block')}
                    >
                      <option value="allow">Receber até eu bloquear</option>
                      <option value="block">Ignorar até eu aprovar</option>
                    </select>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">E-mails aceitos inicialmente (opcional)</label>
                  <input
                    className="input"
                    placeholder="joao@gmail.com, maria@gmail.com"
                    value={allowedEmails}
                    onChange={(e) => setAllowedEmails(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">E-mails bloqueados inicialmente (opcional)</label>
                  <input
                    className="input"
                    placeholder="luiz@gmail.com"
                    value={blockedEmails}
                    onChange={(e) => setBlockedEmails(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="row-between" style={{ marginTop: 14 }}>
              <button type="button" className="btn btn-sm" onClick={() => setStep(2)}>
                Voltar
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void handleSubmit()}>
                {busy ? 'Salvando...' : 'Concluir e Sincronizar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
