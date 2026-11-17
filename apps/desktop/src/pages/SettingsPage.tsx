import React, { useState } from 'react';
import { CheckCircle2, LogOut, ShieldCheck } from 'lucide-react';
import type { AppSettings, DaemonSnapshot, RemoteDeletePolicy } from '@drivesync/shared';
import { formatBytes } from '@drivesync/shared';
import type { DaemonClient } from '../api/daemonClient';

interface Props {
  client: DaemonClient;
  snapshot: DaemonSnapshot;
  onOpenConnectGoogle: () => void;
  onRefresh: () => Promise<void>;
}

export const SettingsPage: React.FC<Props> = ({
  client,
  snapshot,
  onOpenConnectGoogle,
  onRefresh,
}) => {
  const [form, setForm] = useState<AppSettings>(snapshot.settings);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const platform = window.driveSyncDesktop?.getPlatformInfo().platform ?? 'linux';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    try {
      await client.updateSettings(form);
      if (window.driveSyncDesktop) {
        await window.driveSyncDesktop.setAutoStart(form.startOnBoot);
      }
      await onRefresh();
      setSavedNotice(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Configurações</h1>
          <p className="page-subtitle">
            Preferências do dispositivo, conta Google Drive e regras padrão de segurança.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="row-inline" style={{ justifyContent: 'space-between' }}>
          <div>
            <strong style={{ fontSize: 15 }}>Conta Google Drive</strong>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              {snapshot.account.connected
                ? `Conectado como ${snapshot.account.displayName || snapshot.account.email} (${snapshot.account.email})`
                : 'Nenhuma conta conectada ainda.'}
            </div>
          </div>

          <div className="row-inline">
            <button type="button" className="btn btn-sm" onClick={onOpenConnectGoogle}>
              {snapshot.account.connected ? 'Trocar conta' : 'Conectar conta'}
            </button>
            {snapshot.account.connected && (
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={async () => {
                  await client.disconnectAccount();
                  await onRefresh();
                }}
              >
                <LogOut size={14} /> Desconectar
              </button>
            )}
          </div>
        </div>
      </div>

      <form className="card" onSubmit={handleSave}>
        <div className="form-group">
          <label className="form-label" htmlFor="cfg-device-name">
            Nome deste computador (visível na aba Dispositivos)
          </label>
          <input
            id="cfg-device-name"
            className="input"
            value={form.deviceName}
            onChange={(e) => setForm({ ...form, deviceName: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="cfg-default-delete">
            Comportamento padrão quando um arquivo já baixado for apagado no Drive
          </label>
          <select
            id="cfg-default-delete"
            className="select"
            value={form.defaultOnRemoteDelete}
            onChange={(e) =>
              setForm({ ...form, defaultOnRemoteDelete: e.target.value as RemoteDeletePolicy })
            }
          >
            <option value="keep_local">
              Não apagar do PC — manter já baixados (apaga somente no Drive)
            </option>
            <option value="mirror_trash">Apagar do PC também (mover para Quarentena local)</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="cfg-poll-sec">
            Intervalo de checagem de novidades no Drive (segundos)
          </label>
          <input
            id="cfg-poll-sec"
            type="number"
            min={15}
            max={3600}
            className="input"
            value={form.pollIntervalSeconds}
            onChange={(e) =>
              setForm({ ...form, pollIntervalSeconds: Math.max(15, Number(e.target.value) || 45) })
            }
          />
        </div>

        <div className="form-group">
          <label className="row-inline" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.startOnBoot}
              onChange={(e) => setForm({ ...form, startOnBoot: e.target.checked })}
            />
            <span>Iniciar DriveSync automaticamente ao ligar o computador</span>
          </label>
        </div>

        <div className="form-group">
          <label className="row-inline" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.minimizeToTray}
              onChange={(e) => setForm({ ...form, minimizeToTray: e.target.checked })}
            />
            <span>Continuar sincronizando na bandeja do sistema ao fechar a janela</span>
          </label>
        </div>

        {platform === 'linux' && (
          <div className="form-group">
            <label className="row-inline" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.enableWaybarBridge}
                onChange={(e) => setForm({ ...form, enableWaybarBridge: e.target.checked })}
              />
              <span>Atualizar arquivo de status compatível com Waybar (nuvem-status.json)</span>
            </label>
          </div>
        )}

        <div className="card" style={{ background: 'var(--surface-muted)', boxShadow: 'none' }}>
          <div className="row-inline">
            <ShieldCheck size={18} color="var(--primary)" />
            <div>
              <strong>Limitação fixa de upload: {formatBytes(form.maxUploadBytes)}</strong>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Arquivos acima de 4 GB são barrados automaticamente antes do envio para evitar
                travamentos e consumo excessivo de banda.
              </div>
            </div>
          </div>
        </div>

        <div className="row-inline" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <div>
            {savedNotice && (
              <span className="row-inline" style={{ color: 'var(--success)', fontSize: 13 }}>
                <CheckCircle2 size={15} /> Configurações salvas
              </span>
            )}
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar configurações'}
          </button>
        </div>
      </form>
    </div>
  );
};
