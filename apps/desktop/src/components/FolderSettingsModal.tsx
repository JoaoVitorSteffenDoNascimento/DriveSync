import React, { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type {
  LocalDeletePolicy,
  RemoteDeletePolicy,
  SyncDirection,
  SyncFolderConfig,
} from '@drivesync/shared';
import type { DaemonClient } from '../api/daemonClient';

interface Props {
  client: DaemonClient;
  folder: SyncFolderConfig;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export const FolderSettingsModal: React.FC<Props> = ({
  client,
  folder,
  onClose,
  onSaved,
}) => {
  const [name, setName] = useState(folder.name);
  const [direction, setDirection] = useState<SyncDirection>(folder.direction);
  const [onRemoteDelete, setOnRemoteDelete] = useState<RemoteDeletePolicy>(folder.onRemoteDelete);
  const [onLocalDelete, setOnLocalDelete] = useState<LocalDeletePolicy>(folder.onLocalDelete);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await client.updateSyncFolder({
        ...folder,
        name: name.trim() || folder.name,
        direction,
        onRemoteDelete,
        onLocalDelete,
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setSaving(true);
    setError(null);
    try {
      await client.deleteSyncFolder(folder.id);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Configurar Pasta">
      <div className="modal-box">
        <div className="page-header" style={{ marginBottom: 12 }}>
          <div>
            <h2 className="page-title" style={{ fontSize: 18 }}>
              Opções de {folder.name}
            </h2>
            <p className="page-subtitle">
              {folder.localPath} ↔ {folder.remoteFolderName}
            </p>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        {error && <div className="alert-banner alert-error">{error}</div>}

        <div className="form-group">
          <label className="form-label">Nome</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="form-group">
          <label className="form-label">Modo de sincronização neste dispositivo</label>
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
          <label className="form-label">Se apagarem no Drive após baixar no PC</label>
          <select
            className="select"
            value={onRemoteDelete}
            onChange={(e) => setOnRemoteDelete(e.target.value as RemoteDeletePolicy)}
          >
            <option value="keep_local">Não apagar do PC (manter arquivos já baixados)</option>
            <option value="mirror_trash">Apagar do PC também (mover para Quarentena local)</option>
          </select>
        </div>

        {direction === 'bidirectional' && (
          <div className="form-group">
            <label className="form-label">Se você apagar um arquivo neste PC</label>
            <select
              className="select"
              value={onLocalDelete}
              onChange={(e) => setOnLocalDelete(e.target.value as LocalDeletePolicy)}
            >
              <option value="ignore">Manter arquivo no Google Drive</option>
              <option value="trash_remote">Mover para lixeira do Google Drive</option>
            </select>
          </div>
        )}

        <div className="row-inline" style={{ justifyContent: 'space-between', marginTop: 18 }}>
          <button
            type="button"
            className="btn btn-danger"
            disabled={saving}
            onClick={handleDisconnect}
            title="Remove apenas o vínculo; não apaga seus arquivos do PC nem do Drive"
          >
            <Trash2 size={15} /> Desconectar pasta
          </button>

          <div className="row-inline">
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
