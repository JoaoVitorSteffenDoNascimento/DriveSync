import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  Check,
  ClipboardPaste,
  Cloud,
  Copy,
  FileCode2,
  FileJson,
  KeyRound,
  Trash2,
  X,
} from 'lucide-react';
import type { DriveSyncNativePlugin, OAuthClientStatus } from '../native/driveSyncNative';

interface Props {
  bridge: DriveSyncNativePlugin;
  hasClient: boolean;
  onClose: () => void;
  onUpdated: () => Promise<void>;
}

export const MobileAuthSheet: React.FC<Props> = ({ bridge, hasClient, onClose, onUpdated }) => {
  const [oauthStatus, setOauthStatus] = useState<OAuthClientStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [remoteName, setRemoteName] = useState('gdrive');
  const [pastedJson, setPastedJson] = useState('');
  const [pastedRclone, setPastedRclone] = useState('');
  const [showPasteJson, setShowPasteJson] = useState(false);
  const [showRclonePanel, setShowRclonePanel] = useState(false);
  const [showManual, setShowManual] = useState(!hasClient);
  const [loading, setLoading] = useState(false);
  const [activeAuthUrl, setActiveAuthUrl] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadStatus = async () => {
    try {
      const st = await bridge.getOAuthStatus();
      setOauthStatus(st);
    } catch {
      // Optional in minimal mock bridges
    }
  };

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        await loadStatus();
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
      await loadStatus();
      setShowManual(false);
      setShowPasteJson(false);
      setMessage('Credenciais carregadas! Toque em "Entrar com Google pelo navegador" para conectar.');
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
      await loadStatus();
      setPastedJson('');
      setShowPasteJson(false);
      setShowManual(false);
      setMessage('JSON salvo! Agora toque em "Entrar com Google pelo navegador".');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePickRcloneFile = async () => {
    setErr(null);
    setMessage(null);
    setLoading(true);
    try {
      const acc = await bridge.pickAndImportRcloneConf({ remoteName: remoteName.trim() || undefined });
      await onUpdated();
      await loadStatus();
      if (acc.connected) {
        onClose();
      } else {
        setMessage('Chaves Client ID / Secret importadas do rclone.conf! Toque em "Entrar com Google".');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleApplyPastedRclone = async () => {
    if (!pastedRclone.trim()) return;
    setErr(null);
    setMessage(null);
    setLoading(true);
    try {
      const acc = await bridge.importRcloneConf({
        rawConf: pastedRclone.trim(),
        remoteName: remoteName.trim() || undefined,
      });
      await onUpdated();
      await loadStatus();
      setPastedRclone('');
      if (acc.connected) {
        onClose();
      } else {
        setShowRclonePanel(false);
        setMessage('Chaves do rclone.conf salvas! Agora toque em "Entrar com Google pelo navegador".');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const effectiveClient = oauthStatus ? oauthStatus.hasEffectiveClient : hasClient;

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Conectar Google Drive">
      <div className="sheet-box">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div>
            <strong style={{ fontSize: 17 }}>Conectar Google Drive</strong>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {oauthStatus?.hasCustomClient
                ? `Chave personalizada ativa (${oauthStatus.maskedClientId})`
                : oauthStatus?.hasEmbeddedClient
                  ? `Chave padrão do app ativa (${oauthStatus.maskedClientId})`
                  : effectiveClient
                    ? 'Chave OAuth ativa'
                    : 'Nenhuma chave OAuth configurada ainda'}
            </div>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => void handleClose()} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        {!effectiveClient && !message && (
          <div className="alert alert-info">
            Este APK ainda veio sem Client ID padrão embutido. Carregue o <strong>credentials.json</strong>,
            importe seu <strong>rclone.conf</strong> (aceita Client ID, Secret e Token) ou digite a chave
            manualmente abaixo.
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

        <div className="card" style={{ background: 'var(--surface-muted)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void handleLogin()}>
              <Cloud size={17} /> {loading ? 'Aguardando Google...' : 'Entrar com Google pelo navegador'}
            </button>

            {Capacitor.isNativePlatform() ? (
              <button type="button" className="btn" disabled={loading} onClick={() => void handlePickJson()}>
                <FileJson size={16} /> Carregar arquivo credentials.json do Google Cloud
              </button>
            ) : (
              <label className="btn">
                <FileJson size={16} /> Carregar arquivo credentials.json do Google Cloud
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
                      await loadStatus();
                      setShowManual(false);
                      setMessage('Credenciais carregadas! Toque em "Entrar com Google pelo navegador".');
                    } catch (ex) {
                      setErr(ex instanceof Error ? ex.message : String(ex));
                    }
                  }}
                />
              </label>
            )}

            <button
              type="button"
              className="btn"
              disabled={loading}
              onClick={() =>
                Capacitor.isNativePlatform() ? void handlePickRcloneFile() : setShowRclonePanel((v) => !v)
              }
            >
              <FileCode2 size={16} /> Aproveitar Client ID / token de rclone.conf ({remoteName || 'gdrive'}:)
            </button>
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>
            Dica: contas institucionais/acadêmicas podem bloquear apps externos (<code>access_not_configured</code>).
            Prefira uma conta <strong>@gmail.com</strong> pessoal (ou um app OAuth já publicado em produção).
          </p>
        </div>

        <div className="row-gap" style={{ marginBottom: 8 }}>
          <button type="button" className="btn btn-sm" onClick={() => setShowPasteJson((v) => !v)}>
            <ClipboardPaste size={14} /> {showPasteJson ? 'Ocultar campo JSON' : 'Colar texto do JSON'}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setShowRclonePanel((v) => !v)}>
            <FileCode2 size={14} /> {showRclonePanel ? 'Ocultar rclone.conf' : 'Colar rclone.conf'}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setShowManual((v) => !v)}>
            <KeyRound size={14} /> {showManual ? 'Ocultar Client ID' : 'Client ID e Secret manual'}
          </button>
          {oauthStatus?.hasCustomClient && (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={loading}
              onClick={async () => {
                await bridge.clearOAuthClient();
                await onUpdated();
                await loadStatus();
                setMessage('Chave OAuth personalizada removida.');
              }}
            >
              <Trash2 size={14} /> Remover chave salva
            </button>
          )}
        </div>

        {showPasteJson && (
          <div className="card" style={{ marginTop: 10 }}>
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

        {showRclonePanel && (
          <div className="card" style={{ marginTop: 10 }}>
            <div className="form-group">
              <label className="form-label">Nome do perfil no rclone.conf (ex.: gdrive)</label>
              <input
                className="input"
                value={remoteName}
                onChange={(e) => setRemoteName(e.target.value)}
                placeholder="gdrive"
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                Cole o conteúdo da seção do rclone.conf (ou selecione o arquivo abaixo)
              </label>
              <textarea
                className="textarea"
                placeholder={'[gdrive]\ntype = drive\nclient_id = ...\nclient_secret = ...\ntoken = {"access_token":"..."}'}
                value={pastedRclone}
                onChange={(e) => setPastedRclone(e.target.value)}
              />
            </div>
            <div className="row-gap">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={loading || !pastedRclone.trim()}
                onClick={() => void handleApplyPastedRclone()}
              >
                Importar rclone.conf colado
              </button>
              {!Capacitor.isNativePlatform() && (
                <label className="btn btn-sm">
                  <FileCode2 size={14} /> Escolher arquivo rclone.conf
                  <input
                    type="file"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setPastedRclone(await file.text());
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        )}

        {showManual && (
          <div className="card" style={{ marginTop: 10 }}>
            <div className="form-group">
              <label className="form-label">Google OAuth Client ID (Desktop App)</label>
              <input
                className="input"
                placeholder="1234567890-xxxx.apps.googleusercontent.com"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label className="form-label">Google OAuth Client Secret</label>
              <input
                className="input"
                type="password"
                placeholder="GOCSPX-..."
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-sm"
              disabled={loading || !clientId.trim()}
              onClick={async () => {
                setErr(null);
                await bridge.saveOAuthClient({
                  clientId: clientId.trim(),
                  clientSecret: clientSecret.trim(),
                });
                await onUpdated();
                await loadStatus();
                setMessage('Chave Client ID / Secret salva! Agora toque em "Entrar com Google".');
              }}
            >
              Salvar chave manual
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
