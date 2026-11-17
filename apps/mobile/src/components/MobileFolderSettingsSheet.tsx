import React, { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type {
  LocalDeletePolicy,
  RemoteDeletePolicy,
  SyncDirection,
  SyncFolderConfig,
} from '@drivesync/shared';
import type { DriveSyncNativePlugin } from '../native/driveSyncNative';

interface Props {
  bridge: DriveSyncNativePlugin;
  folder: SyncFolderConfig;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export const MobileFolderSettingsSheet: React.FC<Props> = ({
  bridge,
  folder,
  onClose,
  onSaved,
}) => {
  const [name, setName] = useState(folder.name);
  const [direction, setDirection] = useState<SyncDirection>(folder.direction);
  const [onRemoteDelete, setOnRemoteDelete] = useState<RemoteDeletePolicy>(folder.onRemoteDelete);
  const [onLocalDelete, setOnLocalDelete] = useState<LocalDeletePolicy>(folder.onLocalDelete);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      await bridge.updateSyncFolder({
        folder: {
          ...folder,
          name: name.trim() || folder.name,
          direction,
          onRemoteDelete,
          onLocalDelete,
        },
      });
      await onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setSaving(true);
    setErr(null);
    try {
      await bridge.deleteSyncFolder({ folderId: folder.id });
      await onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Opções da pasta">
      <div className="sheet-box">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div>
            <strong style={{ fontSize: 17 }}>Opções de {folder.name}</strong>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Drive: {folder.remoteFolderName}</div>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        {err && <div className="alert alert-error">{err}</div>}

        <div className="form-group">
          <label className="form-label">Nome</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="form-group">
          <label className="form-label">Modo de sincronização neste celular</label>
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
            <label className="form-label">Se você apagar um arquivo neste celular</label>
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

        <div className="row-between" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={saving}
            onClick={() => void handleDisconnect()}
          >
            <Trash2 size={14} /> Desconectar pasta
          </button>
          <div className="row-gap">
            <button type="button" className="btn btn-sm" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void handleSave()}>
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
