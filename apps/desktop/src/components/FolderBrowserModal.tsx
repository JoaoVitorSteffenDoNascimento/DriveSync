import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  File,
  FilePlus2,
  Folder,
  FolderPlus,
  UploadCloud,
  X,
} from 'lucide-react';
import type { FolderContentsResponse, SyncFolderConfig } from '@drivesync/shared';
import { formatBytes } from '@drivesync/shared';
import type { DaemonClient } from '../api/daemonClient';

interface Props {
  client: DaemonClient;
  folder: SyncFolderConfig;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export const FolderBrowserModal: React.FC<Props> = ({
  client,
  folder,
  onClose,
  onRefresh,
}) => {
  const [subpath, setSubpath] = useState('');
  const [contents, setContents] = useState<FolderContentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draggingOver, setDraggingOver] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await client.listFolderContents(folder.id, subpath);
      setContents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client, folder.id, subpath]);

  useEffect(() => {
    void load();
  }, [load]);

  const importPaths = async (paths: string[]) => {
    if (paths.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await client.importLocalPaths(folder.id, subpath, paths);
      const msgs: string[] = [];
      if (res.addedCount > 0) {
        msgs.push(
          `${res.addedCount} arquivo(s) adicionado(s) em "${folder.name}"${
            folder.direction === 'bidirectional' ? ' e envio iniciado para o Drive.' : '.'
          }`,
        );
      }
      if (res.skippedOver4GB.length > 0) {
        setError(
          `Não adicionado(s) por passarem do limite de 4 GB: ${res.skippedOver4GB.join(', ')}`,
        );
      }
      if (res.errors.length > 0) {
        setError(res.errors.join(' | '));
      }
      if (msgs.length > 0) {
        setNotice(msgs.join(' '));
      }
      await load();
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleAddFiles = async () => {
    if (!window.driveSyncDesktop) return;
    const paths = await window.driveSyncDesktop.selectFilesToAdd();
    await importPaths(paths);
  };

  const handleAddFolders = async () => {
    if (!window.driveSyncDesktop) return;
    const paths = await window.driveSyncDesktop.selectFoldersToAdd();
    await importPaths(paths);
  };

  const handleCreateSubfolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newSubName.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await client.createSubfolder(folder.id, subpath, trimmed);
      setNewSubName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDraggingOver(false);
    if (!window.driveSyncDesktop || !e.dataTransfer?.files?.length) return;
    const paths = window.driveSyncDesktop.getDroppedFilePaths(e.dataTransfer.files);
    await importPaths(paths);
  };

  const handleOpenExternal = async () => {
    if (!window.driveSyncDesktop) return;
    const target = subpath
      ? `${folder.localPath}/${subpath}`
      : folder.localPath;
    await window.driveSyncDesktop.openPathInExplorer(target);
  };

  const parentSubpath = subpath.includes('/')
    ? subpath.slice(0, subpath.lastIndexOf('/'))
    : '';

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Arquivos de ${folder.name}`}>
      <div className="modal-box" style={{ maxWidth: 720 }}>
        <div className="page-header" style={{ marginBottom: 12 }}>
          <div>
            <h2 className="page-title" style={{ fontSize: 18 }}>
              {folder.name}
            </h2>
            <p className="page-subtitle">
              {folder.localPath}
              {subpath ? `/${subpath}` : ''}
            </p>
          </div>
          <div className="row-inline">
            <button type="button" className="btn btn-sm" onClick={() => void handleOpenExternal()}>
              <ExternalLink size={14} /> Abrir no gerenciador
            </button>
            <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Fechar">
              <X size={16} />
            </button>
          </div>
        </div>

        {folder.direction === 'receive_only' && (
          <div className="alert-banner">
            <span className="row-inline">
              <AlertTriangle size={16} />
              <span>
                Esta pasta está em modo <strong>Somente Receber</strong>: arquivos adicionados aqui
                ficam apenas neste PC e não sobem para o Drive.
              </span>
            </span>
          </div>
        )}

        {error && <div className="alert-banner alert-error">{error}</div>}
        {notice && (
          <div
            className="alert-banner"
            style={{
              background: 'var(--success-soft)',
              color: 'var(--success)',
              borderColor: 'var(--success)',
            }}
          >
            {notice}
          </div>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDraggingOver(true);
          }}
          onDragLeave={() => setDraggingOver(false)}
          onDrop={(e) => void handleDrop(e)}
          style={{
            border: `2px dashed ${draggingOver ? 'var(--primary)' : 'var(--border)'}`,
            background: draggingOver ? 'var(--primary-soft)' : 'var(--surface-muted)',
            borderRadius: 12,
            padding: 18,
            textAlign: 'center',
            marginBottom: 14,
            transition: 'all 0.15s',
          }}
        >
          <UploadCloud size={26} color="var(--primary)" />
          <div style={{ fontWeight: 600, marginTop: 6 }}>
            Arraste e solte arquivos ou pastas aqui para adicionar em &ldquo;{folder.name}&rdquo;
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 12px' }}>
            Os arquivos são copiados para a pasta selecionada e enviados ao Drive automaticamente (até 4 GB por arquivo).
          </div>
          <div className="row-inline" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => void handleAddFiles()}
            >
              <FilePlus2 size={15} /> {busy ? 'Adicionando...' : 'Adicionar Arquivos'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => void handleAddFolders()}
            >
              <FolderPlus size={15} /> Adicionar Pasta
            </button>
          </div>
        </div>

        <form onSubmit={handleCreateSubfolder} className="row-inline" style={{ marginBottom: 12 }}>
          {subpath && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setSubpath(parentSubpath)}
            >
              <ArrowLeft size={14} /> Voltar
            </button>
          )}
          <input
            className="input"
            placeholder="Criar nova subpasta aqui..."
            value={newSubName}
            onChange={(e) => setNewSubName(e.target.value)}
          />
          <button type="submit" className="btn btn-sm" disabled={busy || !newSubName.trim()}>
            <FolderPlus size={14} /> Criar Subpasta
          </button>
        </form>

        <div className="drive-browser" style={{ maxHeight: 280 }}>
          {loading ? (
            <div style={{ padding: 14, color: 'var(--text-muted)' }}>Carregando arquivos...</div>
          ) : !contents || contents.items.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
              Esta pasta ainda está vazia. Adicione ou arraste arquivos acima.
            </div>
          ) : (
            contents.items.map((item) => {
              const statusBadge = item.exceeds4gb
                ? { cls: 'badge badge-warning', label: 'Acima de 4 GB (não sobe)' }
                : item.syncStatus
                  ? {
                      sending: { cls: 'badge badge-syncing', label: 'Enviando agora...' },
                      pending: { cls: 'badge badge-muted', label: 'Na fila de envio' },
                      synced: { cls: 'badge badge-ok', label: 'Sincronizado' },
                      blocked_4gb: { cls: 'badge badge-warning', label: 'Acima de 4 GB (não sobe)' },
                      local_only: { cls: 'badge badge-muted', label: 'Somente neste aparelho' },
                    }[item.syncStatus]
                  : undefined;
              const senderLabel =
                item.senderName ||
                item.senderEmail ||
                (item.syncStatus && item.syncStatus !== 'blocked_4gb' && item.syncStatus !== 'local_only'
                  ? 'Você'
                  : '');
              return (
                <div
                  key={item.relativePath}
                  className="drive-row"
                  style={{ cursor: item.isDir ? 'pointer' : 'default' }}
                  onClick={() => {
                    if (item.isDir) setSubpath(item.relativePath);
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span className="row-inline">
                      {item.isDir ? (
                        <Folder size={16} color="var(--primary)" />
                      ) : (
                        <File size={16} color="var(--text-muted)" />
                      )}
                      <span>{item.name}</span>
                      {!item.isDir && statusBadge && (
                        <span className={statusBadge.cls}>{statusBadge.label}</span>
                      )}
                    </span>
                    {!item.isDir && senderLabel && (
                      <span style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, paddingLeft: 24 }}>
                        Enviado por: {senderLabel}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {item.isDir ? 'Pasta' : formatBytes(item.sizeBytes)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
