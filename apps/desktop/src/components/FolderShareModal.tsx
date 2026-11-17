import React, { useEffect, useState } from 'react';
import { Check, Copy, Globe, KeyRound, UserPlus, X } from 'lucide-react';
import type { FolderInviteInfo, SyncFolderConfig } from '@drivesync/shared';
import type { DaemonClient } from '../api/daemonClient';

interface Props {
  client: DaemonClient;
  folder: SyncFolderConfig;
  onClose: () => void;
}

export const FolderShareModal: React.FC<Props> = ({ client, folder, onClose }) => {
  const [invite, setInvite] = useState<FolderInviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'reader' | 'writer'>('reader');
  const [anyoneRole, setAnyoneRole] = useState<'reader' | 'writer'>('reader');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function gen() {
      setLoading(true);
      setError(null);
      try {
        const res = await client.generateFolderInvite(folder.id);
        if (!cancelled) setInvite(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void gen();
    return () => {
      cancelled = true;
    };
  }, [client, folder.id]);

  const copyText = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleShareUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);
    setStatusMsg(null);
    try {
      await client.shareFolder(folder.id, {
        accessType: 'user',
        role,
        email: email.trim(),
      });
      setStatusMsg(`Acesso liberado para ${email.trim()} no Google Drive.`);
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleShareAnyone = async () => {
    setError(null);
    setStatusMsg(null);
    try {
      await client.shareFolder(folder.id, {
        accessType: 'anyone',
        role: anyoneRole,
      });
      setStatusMsg('Pasta liberada no Google Drive para qualquer pessoa que receber o código ou link.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Código e Convite da Pasta">
      <div className="modal-box">
        <div className="page-header" style={{ marginBottom: 12 }}>
          <div>
            <h2 className="page-title" style={{ fontSize: 18 }}>
              Código de Conexão — {folder.name}
            </h2>
            <p className="page-subtitle">
              Envie o código abaixo para outro computador ou pessoa entrar direto nesta pasta.
            </p>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        {error && <div className="alert-banner alert-error">{error}</div>}
        {statusMsg && (
          <div className="alert-banner" style={{ background: 'var(--success-soft)', color: 'var(--success)', borderColor: 'var(--success)' }}>
            {statusMsg}
          </div>
        )}

        {loading ? (
          <div className="card">Gerando código na API do Google Drive...</div>
        ) : (
          invite && (
            <>
              <div className="card" style={{ background: 'var(--surface-muted)', boxShadow: 'none' }}>
                <div className="form-group">
                  <label className="form-label">
                    Código Completo (recomendado — encontra automático mesmo se for por link)
                  </label>
                  <div className="row-inline">
                    <input className="input" readOnly value={invite.fullCode} />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void copyText('full', invite.fullCode)}
                    >
                      {copiedKey === 'full' ? <Check size={14} /> : <Copy size={14} />}
                      {copiedKey === 'full' ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">
                    <KeyRound size={13} style={{ verticalAlign: 'middle' }} /> Código Curto (para quem já tem acesso na conta Google)
                  </label>
                  <div className="row-inline">
                    <input className="input" readOnly value={invite.shortCode} />
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void copyText('short', invite.shortCode)}
                    >
                      {copiedKey === 'short' ? <Check size={14} /> : <Copy size={14} />}
                      {copiedKey === 'short' ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="row-inline" style={{ marginBottom: 10 }}>
                  <UserPlus size={16} color="var(--primary)" />
                  <strong>Liberar acesso para uma pessoa no Google Drive</strong>
                </div>

                <form onSubmit={handleShareUser} className="row-inline" style={{ marginBottom: 12 }}>
                  <input
                    className="input"
                    type="email"
                    placeholder="E-mail Google da pessoa (ex.: joao@gmail.com)"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <select
                    className="select"
                    style={{ width: 170 }}
                    value={role}
                    onChange={(e) => setRole(e.target.value as 'reader' | 'writer')}
                  >
                    <option value="reader">Só baixar (Leitor)</option>
                    <option value="writer">Baixar e enviar</option>
                  </select>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={!email.trim()}>
                    Liberar
                  </button>
                </form>

                <div className="row-inline" style={{ justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    <Globe size={13} style={{ verticalAlign: 'middle' }} /> Ou liberar para qualquer pessoa que tiver o código completo:
                  </span>
                  <div className="row-inline">
                    <select
                      className="select"
                      style={{ width: 150 }}
                      value={anyoneRole}
                      onChange={(e) => setAnyoneRole(e.target.value as 'reader' | 'writer')}
                    >
                      <option value="reader">Só baixar</option>
                      <option value="writer">Baixar e enviar</option>
                    </select>
                    <button type="button" className="btn btn-sm" onClick={handleShareAnyone}>
                      Liberar por código
                    </button>
                  </div>
                </div>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
};
