import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Check, ClipboardPaste, Cloud, Copy, FileJson, KeyRound, X } from 'lucide-react';
import type { DriveSyncNativePlugin } from '../native/driveSyncNative';

interface Props {
  bridge: DriveSyncNativePlugin;
  hasClient: boolean;
  onClose: () => void;
  onUpdated: () => Promise<void>;
}

export const MobileAuthSheet: React.FC<Props> = ({ bridge, hasClient, onClose, onUpdated }) => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [pastedJson, setPastedJson] = useState('');
  const [showPasteJson, setShowPasteJson] = useState(false);
  const [showManual, setShowManual] = useState(!hasClient);
  const [loading, setLoading] = useState(false);
  const [activeAuthUrl, setActiveAuthUrl] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
    setMessage(null);
    setLoading(true);
    try {
      if (clientId.trim()) {
        await bridge.saveOAuthClient({
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
        });
      }
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

  const handlePickJson = async () => {
    setErr(null);
    setMessage(null);
    setLoading(true);
    try {
      await bridge.pickAndLoadOAuthJson();
      await onUpdated();
      setShowManual(false);
      setShowPasteJson(false);
      setMessage('Credenciais carregadas! Toque em "Entrar com Google" para conectar.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleApplyPastedJson = async () => {
    if (!pastedJson.trim()) return;
    setErr(null);
    setMessage(null);
    setLoading(true);
    try {
      await bridge.uploadGoogleOAuthJson({ rawJson: pastedJson.trim() });
      await onUpdated();
      setPastedJson('');
      setShowPasteJson(false);
      setShowManual(false);
      setMessage('JSON salvo! Agora toque em "Entrar com Google".');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Conectar Google Drive">
      <div className="sheet-box">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 17 }}>Conectar Google Drive</strong>
          <button type="button" className="btn btn-sm" onClick={() => void handleClose()} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        {!hasClient && !message && (
          <div className="alert alert-info">
            Este APK ainda não veio com o Client ID padrão embutido. Carregue ou cole o seu{' '}
            <strong>credentials.json</strong> uma única vez abaixo (ou peça a versão já configurada).
          </div>
        )}

        {err && <div className="alert alert-error">{err}</div>}

        {message && <div className="alert alert-info">{message}</div>}

        {activeAuthUrl && (
          <div className="alert alert-info">
            <div style={{ marginBottom: 8 }}>
              Autorize no navegador aberto e depois toque em <strong>Voltar ao DriveSync</strong>.
            </div>
            <div className="row-gap">
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
                {copiedUrl ? 'Link copiado' : 'Copiar link (aba anônima)'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => void bridge.cancelGoogleOAuth()}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void handleLogin()}>
            <Cloud size={17} /> {loading ? 'Aguardando Google...' : 'Entrar com Google'}
          </button>

          {Capacitor.isNativePlatform() ? (
            <button type="button" className="btn" disabled={loading} onClick={() => void handlePickJson()}>
              <FileJson size={16} /> Selecionar arquivo credentials.json
            </button>
          ) : (
            <label className="btn">
              <FileJson size={16} /> Carregar credentials.json
              <input
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    await bridge.uploadGoogleOAuthJson({ rawJson: await file.text() });
                    await onUpdated();
                    setShowManual(false);
                    setMessage('Credenciais carregadas! Toque em "Entrar com Google".');
                  } catch (ex) {
                    setErr(ex instanceof Error ? ex.message : String(ex));
                  }
                }}
              />
            </label>
          )}
        </div>

        <div className="row-gap" style={{ marginBottom: 8 }}>
          <button type="button" className="btn btn-sm" onClick={() => setShowPasteJson((v) => !v)}>
            <ClipboardPaste size={14} /> {showPasteJson ? 'Ocultar campo JSON' : 'Colar texto do JSON'}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setShowManual((v) => !v)}>
            <KeyRound size={14} /> {showManual ? 'Ocultar Client ID' : 'Client ID manual'}
          </button>
        </div>

        {showPasteJson && (
          <div style={{ marginTop: 10 }}>
            <div className="form-group">
              <label className="form-label">Cole o conteúdo completo do credentials.json</label>
              <textarea
                className="textarea"
                placeholder='{"installed":{"client_id":"...","client_secret":"..."}}'
                value={pastedJson}
                onChange={(e) => setPastedJson(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={loading || !pastedJson.trim()}
              onClick={() => void handleApplyPastedJson()}
            >
              Salvar JSON colado
            </button>
          </div>
        )}

        {showManual && (
          <div style={{ marginTop: 12 }}>
            <div className="form-group">
              <label className="form-label">Google Client ID (Desktop App)</label>
              <input className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Client Secret</label>
              <input
                className="input"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
