import React, { useEffect, useState } from 'react';
import { Check, Copy, Globe, KeyRound, UserPlus, X } from 'lucide-react';
import type { FolderInviteInfo, SyncFolderConfig } from '@drivesync/shared';
import type { DriveSyncNativePlugin } from '../native/driveSyncNative';

interface Props {
  bridge: DriveSyncNativePlugin;
  folder: SyncFolderConfig;
  onClose: () => void;
}

export const MobileShareSheet: React.FC<Props> = ({ bridge, folder, onClose }) => {
  const [invite, setInvite] = useState<FolderInviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'reader' | 'writer'>('reader');
  const [anyoneRole, setAnyoneRole] = useState<'reader' | 'writer'>('reader');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void bridge
      .generateFolderInvite({ folderId: folder.id })
      .then((res) => {
        if (!cancelled) setInvite(res);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, folder.id]);

  const copyText = async (key: string, val: string) => {
    await navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Código e Convite">
      <div className="sheet-box">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 17 }}>Código — {folder.name}</strong>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        {err && <div className="alert alert-error">{err}</div>}
        {msg && <div className="alert alert-info">{msg}</div>}

        {loading ? (
          <div className="card">Gerando código na API do Google Drive...</div>
        ) : (
          invite && (
            <>
              <div className="card" style={{ background: 'var(--surface-muted)' }}>
                <div className="form-group">
                  <label className="form-label">Código Completo (recomendado)</label>
                  <div className="row-gap">
                    <input className="input" style={{ flex: 1 }} readOnly value={invite.fullCode} />
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

                <div className="form-group">
                  <label className="form-label">
                    <KeyRound size={13} style={{ verticalAlign: 'middle' }} /> Código Curto (quem já tem acesso Google)
                  </label>
                  <div className="row-gap">
                    <input className="input" style={{ flex: 1 }} readOnly value={invite.shortCode} />
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

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Link direto da pasta no Google Drive</label>
                  <div className="row-gap">
                    <input className="input" style={{ flex: 1 }} readOnly value={invite.driveUrl} />
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void copyText('url', invite.driveUrl)}
                    >
                      {copiedKey === 'url' ? <Check size={14} /> : <Copy size={14} />}
                      {copiedKey === 'url' ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="row-gap" style={{ marginBottom: 10 }}>
                  <UserPlus size={16} color="var(--primary)" />
                  <strong>Liberar acesso para uma pessoa no Drive</strong>
                </div>

                <form
                  style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!email.trim()) return;
                    setErr(null);
                    setMsg(null);
                    try {
                      await bridge.shareFolder({
                        folderId: folder.id,
                        input: { accessType: 'user', role, email: email.trim() },
                      });
                      setMsg(`Acesso liberado para ${email.trim()}.`);
                      setEmail('');
                    } catch (ex) {
                      setErr(ex instanceof Error ? ex.message : String(ex));
                    }
                  }}
                >
                  <input
                    className="input"
                    type="email"
                    placeholder="E-mail Google (ex.: joao@gmail.com)"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <div className="row-gap">
                    <select
                      className="select"
                      style={{ flex: 1 }}
                      value={role}
                      onChange={(e) => setRole(e.target.value as 'reader' | 'writer')}
                    >
                      <option value="reader">Só baixar (Leitor)</option>
                      <option value="writer">Baixar e enviar</option>
                    </select>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={!email.trim()}>
                      Liberar
                    </button>
                  </div>
                </form>

                <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                    <Globe size={13} style={{ verticalAlign: 'middle' }} /> Ou liberar para qualquer pessoa com o código completo:
                  </div>
                  <div className="row-gap">
                    <select
                      className="select"
                      style={{ flex: 1 }}
                      value={anyoneRole}
                      onChange={(e) => setAnyoneRole(e.target.value as 'reader' | 'writer')}
                    >
                      <option value="reader">Só baixar</option>
                      <option value="writer">Baixar e enviar</option>
                    </select>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        setErr(null);
                        setMsg(null);
                        try {
                          await bridge.shareFolder({
                            folderId: folder.id,
                            input: { accessType: 'anyone', role: anyoneRole },
                          });
                          setMsg('Pasta liberada para qualquer pessoa com o código completo.');
                        } catch (ex) {
                          setErr(ex instanceof Error ? ex.message : String(ex));
                        }
                      }}
                    >
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
