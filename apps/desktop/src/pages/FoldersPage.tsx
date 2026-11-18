import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CloudDownload,
  Crown,
  FilePlus2,
  FolderOpen,
  Lock,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Share2,
} from 'lucide-react';
import type { DaemonSnapshot, DiscoveredRemoteFolder, SyncFolderConfig } from '@drivesync/shared';
import { formatBytes } from '@drivesync/shared';
import type { DaemonClient } from '../api/daemonClient';
import { FolderBrowserModal } from '../components/FolderBrowserModal';
import { FolderSettingsModal } from '../components/FolderSettingsModal';
import { FolderShareModal } from '../components/FolderShareModal';

interface Props {
  client: DaemonClient;
  snapshot: DaemonSnapshot;
  onOpenWizard: () => void;
  onOpenConnectGoogle: () => void;
  onNavigateBlocked: () => void;
  onRefresh: () => Promise<void>;
}

function statusBadge(status: string) {
  switch (status) {
    case 'ok':
      return { cls: 'badge badge-ok', label: 'Sincronizado' };
    case 'syncing':
      return { cls: 'badge badge-syncing', label: 'Sincronizando' };
    case 'warning':
      return { cls: 'badge badge-warning', label: 'Atenção' };
    case 'error':
      return { cls: 'badge badge-error', label: 'Erro' };
    case 'paused':
      return { cls: 'badge badge-muted', label: 'Pausado' };
    default:
      return { cls: 'badge badge-muted', label: 'Aguardando' };
  }
}

export const FoldersPage: React.FC<Props> = ({
  client,
  snapshot,
  onOpenWizard,
  onOpenConnectGoogle,
  onNavigateBlocked,
  onRefresh,
}) => {
  const [editingFolder, setEditingFolder] = useState<SyncFolderConfig | null>(null);
  const [sharingFolder, setSharingFolder] = useState<SyncFolderConfig | null>(null);
  const [browsingFolder, setBrowsingFolder] = useState<SyncFolderConfig | null>(null);
  const [quickNotice, setQuickNotice] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredRemoteFolder[]>(
    snapshot.discoveredFolders ?? [],
  );
  const [loadingDiscovered, setLoadingDiscovered] = useState(false);
  const [syncingDiscovered, setSyncingDiscovered] = useState(false);
  const blocked4gb = snapshot.blockedFiles.filter((b) => b.reason === 'exceeds_4gb');

  const loadDiscovered = useCallback(async () => {
    if (!snapshot.account.connected || !client.discoverAccountFolders) return;
    setLoadingDiscovered(true);
    try {
      const list = await client.discoverAccountFolders();
      setDiscovered(list);
    } catch {
      // ignora silenciosamente se offline ou mock
    } finally {
      setLoadingDiscovered(false);
    }
  }, [client, snapshot.account.connected]);

  useEffect(() => {
    void loadDiscovered();
  }, [loadDiscovered, snapshot.folders.length]);

  const handleConnectDiscovered = async (items: DiscoveredRemoteFolder[], pickSingleFolder = false) => {
    if (items.length === 0) return;
    let chosenPath = '';
    if (pickSingleFolder || !snapshot.settings.syncRootPath) {
      chosenPath = (await window.driveSyncDesktop?.selectLocalFolder()) ?? '';
    } else {
      chosenPath = snapshot.settings.syncRootPath;
    }
    if (!chosenPath) return;

    setSyncingDiscovered(true);
    try {
      if (pickSingleFolder && items.length === 1) {
        const one = items[0];
        await client.createSyncFolder({
          name: one.remoteFolderName,
          localPath: chosenPath,
          remoteFolderId: one.remoteFolderId,
          remoteFolderName: one.remoteFolderName,
          kind: one.kind,
          direction: one.direction,
          onRemoteDelete: one.onRemoteDelete,
          onLocalDelete: one.onLocalDelete,
          senderPolicy: one.senderPolicy ?? {
            mode: one.kind === 'master' ? 'blocklist' : 'all',
            unknownSenderAction: 'allow',
            rules: [],
          },
        });
      } else {
        await client.syncDiscoveredFolders(chosenPath, items);
      }
      setQuickNotice(
        `${items.length} pasta(s) da sua conta conectada(s) e sincronização iniciada em "${chosenPath}".`,
      );
      await onRefresh();
      await loadDiscovered();
    } catch (err) {
      setQuickNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncingDiscovered(false);
    }
  };

  const handleTogglePause = async (folder: SyncFolderConfig) => {
    await client.updateSyncFolder({ ...folder, paused: !folder.paused });
    await onRefresh();
  };

  const handleQuickAddFiles = async (folder: SyncFolderConfig) => {
    if (!window.driveSyncDesktop) return;
    const paths = await window.driveSyncDesktop.selectFilesToAdd();
    if (paths.length === 0) return;
    const res = await client.importLocalPaths(folder.id, '', paths);
    if (res.skippedOver4GB.length > 0) {
      setQuickNotice(
        `Ignorado(s) por passarem de 4 GB: ${res.skippedOver4GB.join(', ')}`,
      );
    } else if (res.addedCount > 0) {
      setQuickNotice(
        `${res.addedCount} arquivo(s) adicionado(s) em "${folder.name}".`,
      );
    }
    await onRefresh();
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Suas Pastas Conectadas</h1>
          <p className="page-subtitle">
            Escolha pastas do PC para espelhar com seu Google Drive ou um Drive Master da equipe.
          </p>
        </div>

        <div className="row-inline">
          {snapshot.account.connected && (
            <button
              type="button"
              className="btn"
              disabled={loadingDiscovered}
              onClick={() => void loadDiscovered()}
            >
              <RefreshCw size={15} /> Buscar pastas da conta
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={snapshot.account.connected ? onOpenWizard : onOpenConnectGoogle}
          >
            <Plus size={16} /> Conectar Pasta
          </button>
        </div>
      </div>

      {!snapshot.account.connected && (
        <div className="card empty-state">
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Passo 1: Conecte sua conta Google Drive</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: 460, margin: '8px auto 18px' }}>
            Para escolher uma pasta do computador e sincronizar com o Drive Pessoal ou Drive Master,
            conecte sua conta Google primeiro.
          </p>
          <button type="button" className="btn btn-primary" onClick={onOpenConnectGoogle}>
            Conectar Google Drive
          </button>
        </div>
      )}

      {quickNotice && (
        <div
          className="alert-banner"
          style={{
            background: 'var(--primary-soft)',
            color: 'var(--primary)',
            borderColor: 'var(--primary)',
          }}
        >
          <span>{quickNotice}</span>
          <button type="button" className="btn btn-sm" onClick={() => setQuickNotice(null)}>
            Fechar
          </button>
        </div>
      )}

      {blocked4gb.length > 0 && (
        <div className="alert-banner">
          <div className="row-inline">
            <AlertTriangle size={18} />
            <span>
              <strong>{blocked4gb.length}</strong> arquivo(s) não enviado(s) porque ultrapassam o limite
              máximo de <strong>4 GB</strong> por upload (ex.: {blocked4gb[0].relativePath} —{' '}
              {formatBytes(blocked4gb[0].fileSizeBytes)}).
            </span>
          </div>
          <button type="button" className="btn btn-sm" onClick={onNavigateBlocked}>
            Ver detalhes
          </button>
        </div>
      )}

      {snapshot.account.connected && discovered.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--primary)' }}>
          <div className="folder-card-head" style={{ marginBottom: 10 }}>
            <div>
              <div className="row-inline">
                <CloudDownload size={18} color="var(--primary)" />
                <strong style={{ fontSize: 15 }}>
                  Pastas da sua conta em outros dispositivos ({discovered.length})
                </strong>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
                Encontramos pastas já sincronizadas na sua conta Google. Escolha onde salvar neste PC para sincronizar.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={syncingDiscovered}
              onClick={() => void handleConnectDiscovered(discovered, false)}
            >
              <FolderOpen size={14} />{' '}
              {snapshot.settings.syncRootPath
                ? 'Sincronizar todas na pasta padrão'
                : 'Escolher onde salvar todas'}
            </button>
          </div>

          {discovered.map((item) => (
            <div key={item.remoteFolderId} className="list-row">
              <div>
                <div className="row-inline">
                  <strong>{item.remoteFolderName}</strong>
                  <span className="badge badge-muted">
                    {item.kind === 'master' ? 'Drive Master' : 'Pessoal'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {item.deviceNames.length > 0
                    ? `Conectada em: ${item.deviceNames.join(', ')}`
                    : item.ownerEmail
                      ? `Dono: ${item.ownerEmail}`
                      : 'Disponível na conta Google'}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                disabled={syncingDiscovered}
                onClick={() => void handleConnectDiscovered([item], true)}
              >
                <FolderOpen size={14} /> Escolher onde salvar
              </button>
            </div>
          ))}
        </div>
      )}

      {snapshot.account.connected && snapshot.folders.length === 0 && (
        <div className="card empty-state">
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Nenhuma pasta conectada ainda</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: 460, margin: '8px auto 18px' }}>
            Clique em <strong>+ Conectar Pasta</strong> para escolher uma pasta neste computador e
            vincular a um Drive Pessoal ou Drive Master compartilhado.
          </p>
          <button type="button" className="btn btn-primary" onClick={onOpenWizard}>
            <Plus size={16} /> Conectar primeira pasta
          </button>
        </div>
      )}

      {snapshot.folders.map((folder) => {
        const rt = snapshot.runtime[folder.id];
        const badge = statusBadge(folder.paused ? 'paused' : (rt?.status ?? 'idle'));
        const blockedSendersCount = folder.senderPolicy.rules.filter((r) => !r.allowed).length;

        return (
          <div key={folder.id} className="card">
            <div className="folder-card-head">
              <div>
                <div className="row-inline">
                  {folder.kind === 'master' ? (
                    <Crown size={18} color="var(--primary)" />
                  ) : (
                    <Lock size={18} color="var(--primary)" />
                  )}
                  <strong style={{ fontSize: 16 }}>{folder.name}</strong>
                  <span className="badge badge-muted">
                    {folder.kind === 'master' ? 'Drive Master' : 'Pessoal'}
                  </span>
                </div>

                <div className="folder-meta">
                  <span>
                    <strong>PC:</strong> {folder.localPath} ↔ <strong>Drive:</strong>{' '}
                    {folder.remoteFolderName}
                  </span>
                  <span>
                    <strong>Modo:</strong>{' '}
                    {folder.direction === 'receive_only' ? 'Somente receber' : 'Enviar e receber'} •{' '}
                    <strong>Apagar no Drive:</strong>{' '}
                    {folder.onRemoteDelete === 'keep_local'
                      ? 'Mantém arquivos já baixados no PC'
                      : 'Move para Quarentena local'}
                  </span>
                  {folder.kind === 'master' && (
                    <span>
                      <strong>Remetentes:</strong>{' '}
                      {folder.senderPolicy.mode === 'all'
                        ? 'Recebendo de todos'
                        : folder.senderPolicy.mode === 'allowlist'
                          ? `Somente pessoas aprovadas (${folder.senderPolicy.rules.filter((r) => r.allowed).length})`
                          : blockedSendersCount > 0
                            ? `Todos, exceto ${blockedSendersCount} bloqueado(s)`
                            : 'Recebendo de todos'}
                    </span>
                  )}
                  {rt?.message && (
                    <span>
                      <strong>Status:</strong> {rt.message}
                      {rt.syncedFilesCount ? ` • ${rt.syncedFilesCount} arquivo(s) acompanhado(s)` : ''}
                      {rt.keptLocalCount ? ` • ${rt.keptLocalCount} mantido(s) no PC após exclusão no Drive` : ''}
                    </span>
                  )}
                </div>
              </div>

              <span className={badge.cls}>{badge.label}</span>
            </div>

            {rt?.status === 'syncing' && (
              <div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.min(100, Math.max(8, rt.progressPercent ?? 15))}%` }}
                  />
                </div>
                {rt.currentFile && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    {rt.currentFile}
                    {rt.bytesTotal ? ` (${formatBytes(rt.bytesTransferred ?? 0)} / ${formatBytes(rt.bytesTotal)})` : ''}
                  </div>
                )}
              </div>
            )}

            <div className="folder-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handleQuickAddFiles(folder)}
              >
                <FilePlus2 size={14} /> Adicionar arquivos
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setBrowsingFolder(folder)}
              >
                <FolderOpen size={14} /> Abrir pasta
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={folder.paused}
                onClick={() => void client.syncNow(folder.id)}
              >
                <RefreshCw size={14} /> Sincronizar agora
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void handleTogglePause(folder)}
              >
                {folder.paused ? <Play size={14} /> : <Pause size={14} />}
                {folder.paused ? 'Retomar' : 'Pausar'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setSharingFolder(folder)}
              >
                <Share2 size={14} /> Código / Convidar
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setEditingFolder(folder)}
              >
                <Settings2 size={14} /> Opções
              </button>
            </div>
          </div>
        );
      })}

      {editingFolder && (
        <FolderSettingsModal
          client={client}
          folder={editingFolder}
          onClose={() => setEditingFolder(null)}
          onSaved={onRefresh}
        />
      )}

      {sharingFolder && (
        <FolderShareModal
          client={client}
          folder={sharingFolder}
          onClose={() => setSharingFolder(null)}
        />
      )}

      {browsingFolder && (
        <FolderBrowserModal
          client={client}
          folder={browsingFolder}
          onClose={() => setBrowsingFolder(null)}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
};
