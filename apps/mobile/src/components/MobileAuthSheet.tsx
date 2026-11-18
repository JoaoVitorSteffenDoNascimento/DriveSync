import React, { useEffect, useState } from 'react';
import { Check, Cloud, Copy, X } from 'lucide-react';
import type { DriveSyncNativePlugin } from '../native/driveSyncNative';

interface Props {
  bridge: DriveSyncNativePlugin;
  hasClient: boolean;
  onClose: () => void;
  onUpdated: () => Promise<void>;
}

export const MobileAuthSheet: React.FC<Props> = ({ bridge, onClose, onUpdated }) => {
  const [loading, setLoading] = useState(false);
  const [activeAuthUrl, setActiveAuthUrl] = useState<string | null>(null);
  const [callbackUrlInput, setCallbackUrlInput] = useState('');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let handle: { remove: () => Promise<void> } | null = null;
    if (bridge.addListener) {
      void bridge
        .addListener('authUrlReady', ({ authUrl }) => {
          setActiveAuthUrl(authUrl);
        })
        .then((h) => {
          handle = h;
        })
        .catch(() => {});
    }
    return () => {
      if (handle) {
        void handle.remove().catch(() => {});
      }
    };
  }, [bridge]);

  const handleClose = async () => {
    if (loading) {
      await bridge.cancelGoogleOAuth().catch(() => {});
    }
    onClose();
  };

  const handleLogin = async () => {
    setErr(null);
    setLoading(true);
    try {
      await bridge.startGoogleOAuth();
      await onUpdated();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setActiveAuthUrl(null);
    }
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Conectar Google Drive">
      <div className="sheet-box">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div>
            <strong style={{ fontSize: 17 }}>Conectar Google Drive</strong>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Entre com sua conta Google pelo navegador para sincronizar pastas entre este celular e seus computadores.
            </div>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => void handleClose()} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        {err && <div className="alert alert-error">{err}</div>}

        {activeAuthUrl && (
          <div className="alert alert-info">
            <div style={{ marginBottom: 8 }}>
              Autorize no navegador aberto. Ao concluir, você volta automaticamente para o DriveSync.
            </div>
            <div className="row-gap" style={{ marginBottom: 10 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(activeAuthUrl);
                  setCopiedUrl(true);
                  setTimeout(() => setCopiedUrl(false), 2000);
                }}
              >
                {copiedUrl ? <Check size={14} /> : <Copy size={14} />}
                {copiedUrl ? 'Link copiado' : 'Copiar link'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => void bridge.cancelGoogleOAuth()}
              >
                Cancelar
              </button>
            </div>
            <div className="form-group" style={{ marginBottom: 4 }}>
              <label className="form-label" style={{ fontSize: 11.5 }}>
                Se o navegador não voltar sozinho, cole o endereço final aqui:
              </label>
              <div className="row-gap">
                <input
                  className="input"
                  style={{ flex: 1, fontSize: 12 }}
                  placeholder="http://127.0.0.1:53682/?code=..."
                  value={callbackUrlInput}
                  onChange={(e) => setCallbackUrlInput(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!callbackUrlInput.trim()}
                  onClick={async () => {
                    setErr(null);
                    try {
                      await bridge.completeGoogleOAuthFromUrl({ callbackUrl: callbackUrlInput.trim() });
                      await onUpdated();
                      onClose();
                    } catch (ex) {
                      setErr(ex instanceof Error ? ex.message : String(ex));
                    }
                  }}
                >
                  Concluir
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="card" style={{ background: 'var(--surface-muted)', marginBottom: 0 }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={loading}
            onClick={() => void handleLogin()}
          >
            <Cloud size={17} /> {loading ? 'Conectando ao Google Drive...' : 'Conectar com Google Drive'}
          </button>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>
            Use sua conta Google pessoal (<code>@gmail.com</code>) para encontrar automaticamente suas pastas e dispositivos sincronizados.
          </p>
        </div>
      </div>
    </div>
  );
};
