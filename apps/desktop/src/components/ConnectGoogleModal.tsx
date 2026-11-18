import React, { useEffect, useRef, useState } from 'react';
import { Check, Cloud, Copy, X } from 'lucide-react';
import type { AccountInfo } from '@drivesync/shared';
import type { DaemonClient } from '../api/daemonClient';

interface Props {
  client: DaemonClient;
  account: AccountInfo;
  externalError?: string | null;
  onClose: () => void;
  onUpdated: () => Promise<void>;
}

export const ConnectGoogleModal: React.FC<Props> = ({
  client,
  account,
  externalError,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [waitingBrowser, setWaitingBrowser] = useState(false);
  const [activeAuthUrl, setActiveAuthUrl] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wasConnectedRef = useRef(account.connected);

  useEffect(() => {
    if (waitingBrowser && account.connected && !wasConnectedRef.current) {
      onClose();
    }
    wasConnectedRef.current = account.connected;
  }, [account.connected, waitingBrowser, onClose]);

  const handleClose = async () => {
    if (waitingBrowser) {
      try {
        await client.cancelOAuth();
      } catch {
        // silencioso
      }
    }
    onClose();
  };

  const handleBrowserLogin = async () => {
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const { authUrl } = await client.startOAuth();
      setActiveAuthUrl(authUrl);
      if (window.driveSyncDesktop) {
        await window.driveSyncDesktop.openExternalUrl(authUrl);
      } else {
        window.open(authUrl, '_blank', 'noopener,noreferrer');
      }
      setWaitingBrowser(true);
      setMessage('Abrimos seu navegador para autorizar sua conta Google Drive. Ao concluir, você volta ao app automaticamente.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCopyAuthUrl = async () => {
    if (!activeAuthUrl) return;
    await navigator.clipboard.writeText(activeAuthUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Conectar Google Drive">
      <div className="modal-box">
        <div className="page-header" style={{ marginBottom: 12 }}>
          <div>
            <h2 className="page-title" style={{ fontSize: 18 }}>
              Conectar Google Drive
            </h2>
            <p className="page-subtitle">
              Entre com sua conta Google no navegador para sincronizar suas pastas e dispositivos.
            </p>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => void handleClose()} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        {(error || externalError) && (
          <div className="alert-banner alert-error">{error || externalError}</div>
        )}
        {message && (
          <div
            className="alert-banner"
            style={{
              background: 'var(--primary-soft)',
              color: 'var(--primary)',
              borderColor: 'var(--primary)',
              flexDirection: 'column',
              alignItems: 'flex-start',
            }}
          >
            <span>{message}</span>
            {activeAuthUrl && (
              <button type="button" className="btn btn-sm" onClick={() => void handleCopyAuthUrl()}>
                {copiedUrl ? <Check size={14} /> : <Copy size={14} />}
                {copiedUrl ? 'Link copiado' : 'Copiar link de login'}
              </button>
            )}
          </div>
        )}

        <div className="card" style={{ background: 'var(--surface-muted)', boxShadow: 'none', marginBottom: 0 }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={loading}
            onClick={handleBrowserLogin}
          >
            <Cloud size={17} /> {loading ? 'Abrindo navegador...' : 'Conectar com Google Drive'}
          </button>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>
            Use sua conta Google pessoal (<code>@gmail.com</code>) para encontrar automaticamente suas pastas e dispositivos sincronizados.
          </p>
        </div>
      </div>
    </div>
  );
};
