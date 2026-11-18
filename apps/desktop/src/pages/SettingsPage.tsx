import React, { useState } from 'react';
import { Check, CheckCircle2, Copy, ExternalLink, FolderOpen, LogOut, Share2, ShieldCheck } from 'lucide-react';
import type { AppSettings, DaemonSnapshot, RemoteDeletePolicy } from '@drivesync/shared';
import { formatBytes } from '@drivesync/shared';
import type { DaemonClient } from '../api/daemonClient';

const DOWNLOAD_SITE_URL = 'https://joaovitorsteffendonascimento.github.io/DriveSync/';
const RELEASES_URL = 'https://github.com/JoaoVitorSteffenDoNascimento/DriveSync/releases';

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
  const [copiedLink, setCopiedLink] = useState(false);

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(DOWNLOAD_SITE_URL);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      setCopiedLink(false);
    }
  };

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
          <label className="form-label" htmlFor="cfg-sync-root">
            Pasta base onde novas pastas sincronizadas da sua conta serão salvas neste PC
          </label>
          <div className="row-inline">
            <input
              id="cfg-sync-root"
              className="input"
              placeholder="Ex.: /home/usuario/DriveSync ou C:\Users\Usuario\DriveSync"
              value={form.syncRootPath ?? ''}
              onChange={(e) => setForm({ ...form, syncRootPath: e.target.value })}
            />
            {window.driveSyncDesktop && (
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  const chosen = await window.driveSyncDesktop?.selectLocalFolder();
                  if (chosen) setForm({ ...form, syncRootPath: chosen });
                }}
              >
                <FolderOpen size={15} /> Escolher pasta
              </button>
            )}
          </div>
        </div>

        <div className="form-group">
          <label className="row-inline" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(form.autoSyncAccountFolders)}
              onChange={(e) => setForm({ ...form, autoSyncAccountFolders: e.target.checked })}
            />
            <span>Conectar automaticamente pastas encontradas na mesma conta Google usando essa pasta base</span>
          </label>
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

      <div className="card">
        <div className="row-inline" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div className="row-inline" style={{ gap: 8 }}>
              <Share2 size={17} color="var(--primary)" />
              <strong style={{ fontSize: 15 }}>Compartilhar o DriveSync</strong>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0 10px' }}>
              Envie o link abaixo para outras pessoas baixarem o instalador do Windows (.exe / .msi),
              Linux (.AppImage / .deb / .rpm / .pacman) ou Android (.apk):
            </p>
            <code
              style={{
                display: 'block',
                fontSize: 12,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'var(--surface-muted)',
                wordBreak: 'break-all',
              }}
            >
              {DOWNLOAD_SITE_URL}
            </code>
          </div>
        </div>
        <div className="row-inline" style={{ marginTop: 12, gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={handleCopyShareLink}>
            {copiedLink ? <Check size={15} /> : <Copy size={15} />}
            {copiedLink ? 'Link copiado!' : 'Copiar link de download'}
          </button>
          <a
            className="btn"
            href={DOWNLOAD_SITE_URL}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: 'none' }}
          >
            <ExternalLink size={15} /> Abrir site de downloads
          </a>
          <a
            className="btn"
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: 'none' }}
          >
            <ExternalLink size={15} /> GitHub Releases
          </a>
        </div>
      </div>
    </div>
  );
};
