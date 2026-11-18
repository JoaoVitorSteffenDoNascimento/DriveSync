import React, { useState } from 'react';
import { FolderOpen, ShieldAlert, UserX } from 'lucide-react';
import type { DaemonSnapshot } from '@drivesync/shared';
import { formatBytes } from '@drivesync/shared';

interface Props {
  snapshot: DaemonSnapshot;
  initialTab?: 'activity' | 'blocked_4gb' | 'blocked_sender';
}

export const ActivityPage: React.FC<Props> = ({ snapshot, initialTab = 'activity' }) => {
  const [tab, setTab] = useState<'activity' | 'blocked_4gb' | 'blocked_sender'>(initialTab);

  const blocked4gb = snapshot.blockedFiles.filter((b) => b.reason === 'exceeds_4gb');
  const blockedSenders = snapshot.blockedFiles.filter((b) => b.reason === 'sender_blocked');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Atividade & Bloqueios</h1>
          <p className="page-subtitle">
            Histórico simples de transferências, arquivos mantidos no PC e bloqueios acima de 4 GB.
          </p>
        </div>
      </div>

      <div className="row-inline" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={`btn btn-sm ${tab === 'activity' ? 'btn-primary' : ''}`}
          onClick={() => setTab('activity')}
        >
          Atividade recente ({snapshot.recentActivity.length})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${tab === 'blocked_4gb' ? 'btn-primary' : ''}`}
          onClick={() => setTab('blocked_4gb')}
        >
          <ShieldAlert size={14} /> Acima de 4 GB ({blocked4gb.length})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${tab === 'blocked_sender' ? 'btn-primary' : ''}`}
          onClick={() => setTab('blocked_sender')}
        >
          <UserX size={14} /> Ignorados por remetente ({blockedSenders.length})
        </button>
      </div>

      {tab === 'activity' && (
        <div className="card">
          {snapshot.recentActivity.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>
              Nenhuma movimentação registrada ainda.
            </p>
          ) : (
            snapshot.recentActivity.map((ev) => (
              <div key={ev.id} className="list-row">
                <div>
                  <strong>{ev.message}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Pasta: {ev.folderName}
                    {ev.fileSizeBytes ? ` • ${formatBytes(ev.fileSizeBytes)}` : ''}
                    {ev.authorEmail ? ` • Enviado por: ${ev.authorEmail}` : ''}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {new Date(ev.createdAt).toLocaleString('pt-BR')}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'blocked_4gb' && (
        <div className="card">
          {blocked4gb.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>
              Nenhum arquivo bloqueado por ultrapassar 4 GB.
            </p>
          ) : (
            blocked4gb.map((b) => (
              <div key={b.id} className="list-row">
                <div>
                  <strong>{b.relativePath}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Pasta: {b.folderName} • Tamanho: <strong>{formatBytes(b.fileSizeBytes)}</strong> •{' '}
                    {b.detail}
                  </div>
                </div>
                {b.localPath && window.driveSyncDesktop && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void window.driveSyncDesktop?.openPathInExplorer(b.localPath!)}
                  >
                    <FolderOpen size={14} /> Mostrar arquivo
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'blocked_sender' && (
        <div className="card">
          {blockedSenders.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>
              Nenhum arquivo ignorado por filtro de remetente.
            </p>
          ) : (
            blockedSenders.map((b) => (
              <div key={b.id} className="list-row">
                <div>
                  <strong>{b.relativePath}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Pasta: {b.folderName} • Enviado por:{' '}
                    <strong>{b.authorName || b.authorEmail || 'Desconhecido'}</strong> •{' '}
                    {formatBytes(b.fileSizeBytes)}
                  </div>
                </div>
                <span className="badge badge-muted">Não baixado</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
