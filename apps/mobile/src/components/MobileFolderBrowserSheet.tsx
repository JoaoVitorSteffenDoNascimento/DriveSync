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
import {
  formatBytes,
  type FolderContentsResponse,
  type ImportPathsResult,
  type SyncFolderConfig,
} from '@drivesync/shared';
import type { DriveSyncNativePlugin } from '../native/driveSyncNative';

interface Props {
  bridge: DriveSyncNativePlugin;
  folder: SyncFolderConfig;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export const MobileFolderBrowserSheet: React.FC<Props> = ({
  bridge,
  folder,
  onClose,
  onRefresh,
}) => {
  const [subpath, setSubpath] = useState('');
  const [contents, setContents] = useState<FolderContentsResponse | null>(null);
  const [newSubName, setNewSubName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await bridge.listFolderContents({ folderId: folder.id, subpath });
      setContents(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bridge, folder.id, subpath]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyImportResult = async (res: ImportPathsResult) => {
    if (res.skippedOver4GB.length > 0) {
      setErr(`Não adicionado(s) por passarem do limite de 4 GB: ${res.skippedOver4GB.join(', ')}`);
    }
    if (res.errors.length > 0) {
      setErr(res.errors.join(' | '));
    }
    if (res.addedCount > 0) {
      setNotice(
        `${res.addedCount} arquivo(s) adicionado(s) em "${folder.name}"${
          folder.direction === 'bidirectional' ? ' e envio iniciado para o Drive.' : '.'
        }`,
      );
    }
    await load();
    await onRefresh();
  };

  const handleAddFiles = async () => {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const res = await bridge.pickAndImportFiles({ folderId: folder.id, subpath });
      await applyImportResult(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleAddFolder = async () => {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const res = await bridge.pickAndImportFolder({ folderId: folder.id, subpath });
      await applyImportResult(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateSubfolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newSubName.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    try {
      await bridge.createSubfolder({ folderId: folder.id, subpath, name: trimmed });
      setNewSubName('');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const parentSubpath = subpath.includes('/') ? subpath.slice(0, subpath.lastIndexOf('/')) : '';

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={`Arquivos de ${folder.name}`}>
      <div className="sheet-box">
        <div className="row-between" style={{ marginBottom: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong style={{ fontSize: 17 }}>{folder.name}</strong>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {subpath ? `/${subpath}` : 'Raiz da pasta sincronizada'}
            </div>
          </div>
          <div className="row-gap">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void bridge.openLocalItem({ folderId: folder.id, relativePath: subpath }).catch((e) => setErr(e instanceof Error ? e.message : String(e)))}
            >
              <ExternalLink size={14} /> Abrir no gerenciador
            </button>
            <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Fechar">
              <X size={16} />
            </button>
          </div>
        </div>

        {folder.direction === 'receive_only' && (
          <div className="alert">
            <span className="row-gap">
              <AlertTriangle size={15} />
              <span>
                Esta pasta está em modo <strong>Somente Receber</strong>: arquivos adicionados aqui ficam apenas neste celular e não sobem para o Drive.
              </span>
            </span>
          </div>
        )}

        {err && <div className="alert alert-error">{err}</div>}
        {notice && (
          <div
            className="alert"
            style={{ background: 'var(--success-soft)', color: 'var(--success)' }}
          >
            {notice}
          </div>
        )}

        <div
          style={{
            border: '2px dashed var(--border)',
            background: 'var(--surface-muted)',
            borderRadius: 12,
            padding: 14,
            textAlign: 'center',
            marginBottom: 12,
          }}
        >
          <UploadCloud size={22} color="var(--primary)" />
          <div style={{ fontWeight: 600, fontSize: 13.5, marginTop: 4 }}>
            Adicionar arquivos ou pastas em &ldquo;{folder.name}&rdquo;
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '3px 0 10px' }}>
            Copiados para cá e enviados automaticamente ao Drive (limite 4 GB por arquivo).
          </div>
          <div className="row-gap" style={{ justifyContent: 'center' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => void handleAddFiles()}
            >
              <FilePlus2 size={14} /> {busy ? 'Adicionando...' : 'Adicionar Arquivos'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => void handleAddFolder()}
            >
              <FolderPlus size={14} /> Adicionar Pasta
            </button>
          </div>
        </div>

        <form onSubmit={handleCreateSubfolder} className="row-gap" style={{ marginBottom: 12 }}>
          {subpath && (
            <button type="button" className="btn btn-sm" onClick={() => setSubpath(parentSubpath)}>
              <ArrowLeft size={14} /> Voltar
            </button>
          )}
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Criar nova subpasta aqui..."
            value={newSubName}
            onChange={(e) => setNewSubName(e.target.value)}
          />
          <button type="submit" className="btn btn-sm" disabled={busy || !newSubName.trim()}>
            <FolderPlus size={14} /> Criar Subpasta
          </button>
        </form>

        <div className="drive-browser" style={{ maxHeight: 300 }}>
          {loading ? (
            <div style={{ padding: 14, color: 'var(--text-muted)' }}>Carregando arquivos...</div>
          ) : !contents || contents.items.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
              Esta pasta ainda está vazia. Adicione arquivos ou crie uma subpasta.
            </div>
          ) : (
            contents.items.map((item) => (
              <div
                key={item.relativePath}
                className="drive-row"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  if (item.isDir) {
                    setSubpath(item.relativePath);
                  } else {
                    void bridge
                      .openLocalItem({ folderId: folder.id, relativePath: item.relativePath })
                      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
                  }
                }}
              >
                <span className="row-gap" style={{ flex: 1, minWidth: 0 }}>
                  {item.isDir ? <Folder size={16} color="var(--primary)" /> : <File size={16} color="var(--text-muted)" />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
                  {item.exceeds4gb && (
                    <span className="badge badge-warning">Acima de 4 GB (não sobe)</span>
                  )}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {item.isDir ? 'Pasta' : formatBytes(item.sizeBytes)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
