import React, { useEffect, useRef, useState } from 'react';
import { Check, Cloud, Copy, FileJson, KeyRound, X } from 'lucide-react';
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
  onUpdated,
}) => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [remoteName, setRemoteName] = useState('gdrive');
  const [showCustomOAuth, setShowCustomOAuth] = useState(!account.hasCustomOAuthClient);
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
      if (clientId.trim()) {
        await client.saveOAuthClient(clientId.trim(), clientSecret.trim());
      }
      const { authUrl } = await client.startOAuth();
      setActiveAuthUrl(authUrl);
      if (window.driveSyncDesktop) {
        await window.driveSyncDesktop.openExternalUrl(authUrl);
      } else {
        window.open(authUrl, '_blank', 'noopener,noreferrer');
      }
      setWaitingBrowser(true);
      setMessage(
        'Abrimos seu navegador para escolher a conta e autorizar direto na API do Google Drive. Se já apareceu erro em outra aba, feche-a ou abra o link abaixo em aba anônima.',
      );
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

  const handleUploadGoogleJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      const raw = await file.text();
      await client.uploadGoogleOAuthJson(raw);
      await onUpdated();
      setMessage('Credenciais do Google Cloud carregadas! Agora clique em "Entrar com Google pelo navegador".');
      setShowCustomOAuth(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const handleImportRcloneConf = async () => {
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      await client.importFromRclone(remoteName.trim() || 'gdrive');
      await onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
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
              Conexão direta usando exclusivamente a Google Drive API (OAuth 2.0 no navegador).
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
                {copiedUrl ? 'Link copiado' : 'Copiar link de login (para aba anônima)'}
              </button>
            )}
          </div>
        )}

        <div className="card" style={{ background: 'var(--surface-muted)', boxShadow: 'none' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading}
              onClick={handleBrowserLogin}
            >
              <Cloud size={17} /> Entrar com Google pelo navegador
            </button>

            <label className="btn" style={{ cursor: 'pointer' }}>
              <FileJson size={16} /> Carregar arquivo credentials.json do Google Cloud
              <input
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={handleUploadGoogleJson}
              />
            </label>

            <button
              type="button"
              className="btn"
              disabled={loading}
              onClick={handleImportRcloneConf}
            >
              Aproveitar Client ID / token de rclone.conf ({remoteName}:)
            </button>
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>
            Dica: contas institucionais/acadêmicas podem bloquear apps externos (<code>access_not_configured</code>).
            Prefira uma conta <strong>@gmail.com</strong> pessoal (cadastrada em <em>Test users</em> no Google Cloud se o app estiver em Testing).
          </p>
        </div>

        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setShowCustomOAuth((v) => !v)}
          >
            <KeyRound size={14} />{' '}
            {showCustomOAuth ? 'Ocultar preenchimento manual' : 'Digitar Client ID e Secret manualmente'}
          </button>

          {showCustomOAuth && (
            <div style={{ marginTop: 12 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="oauth-client-id">
                  Google OAuth Client ID (Desktop App)
                </label>
                <input
                  id="oauth-client-id"
                  className="input"
                  placeholder="1234567890-xxxx.apps.googleusercontent.com"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="oauth-client-secret">
                  Google OAuth Client Secret
                </label>
                <input
                  id="oauth-client-secret"
                  type="password"
                  className="input"
                  placeholder="GOCSPX-..."
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="rclone-remote-name">
                  Perfil em rclone.conf (opcional, leitura direta sem rclone)
                </label>
                <input
                  id="rclone-remote-name"
                  className="input"
                  value={remoteName}
                  onChange={(e) => setRemoteName(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
