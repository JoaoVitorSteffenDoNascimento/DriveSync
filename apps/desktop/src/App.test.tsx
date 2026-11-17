import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { MAX_UPLOAD_BYTES, type DaemonSnapshot } from '@drivesync/shared';
import type { DaemonClient } from './api/daemonClient';
import { App } from './App';

function createMockClient(snapshot: DaemonSnapshot): DaemonClient {
  return {
    getSnapshot: vi.fn().mockResolvedValue(snapshot),
    connectWebSocket: vi.fn().mockReturnValue(() => {}),
    updateSyncFolder: vi.fn().mockResolvedValue(snapshot.folders[0]),
    syncNow: vi.fn().mockResolvedValue({ started: true }),
    forgetDevice: vi.fn().mockResolvedValue({ deleted: true }),
    listFolderContents: vi.fn().mockResolvedValue({
      folderId: snapshot.folders[0].id,
      folderName: snapshot.folders[0].name,
      localPath: snapshot.folders[0].localPath,
      subpath: '',
      items: [
        {
          name: 'relatorio.pdf',
          relativePath: 'relatorio.pdf',
          isDir: false,
          sizeBytes: 1024,
          modifiedAt: '2026-11-17T12:00:00Z',
          exceeds4gb: false,
        },
      ],
    }),
  } as unknown as DaemonClient;
}

const sampleSnapshot: DaemonSnapshot = {
  account: {
    connected: true,
    email: 'brendha@gmail.com',
    displayName: 'Brendha',
    authSource: 'oauth_pkce',
    hasCustomOAuthClient: true,
  },
  settings: {
    deviceId: 'dev-arch',
    deviceName: 'Arch Desktop',
    maxUploadBytes: MAX_UPLOAD_BYTES,
    pollIntervalSeconds: 45,
    startOnBoot: false,
    minimizeToTray: true,
    enableWaybarBridge: true,
    defaultOnRemoteDelete: 'keep_local',
  },
  folders: [
    {
      id: 'master-1',
      name: 'Drive Master Equipe',
      localPath: '/home/brendha/Master',
      remoteFolderId: 'gdrive-master-id',
      remoteFolderName: 'Master-Equipe',
      kind: 'master',
      direction: 'bidirectional',
      onRemoteDelete: 'keep_local',
      onLocalDelete: 'ignore',
      senderPolicy: {
        mode: 'blocklist',
        unknownSenderAction: 'block',
        rules: [
          { email: 'joao@gmail.com', displayName: 'João', allowed: true },
          { email: 'luiz@gmail.com', displayName: 'Luiz', allowed: false },
        ],
      },
      paused: false,
      createdAt: '2026-11-17T12:00:00Z',
    },
  ],
  runtime: {
    'master-1': {
      folderId: 'master-1',
      status: 'warning',
      message: 'Sincronizado (1 arquivo acima de 4 GB bloqueado)',
      blocked4gbCount: 1,
      ignoredSenderCount: 1,
      keptLocalCount: 2,
      syncedFilesCount: 10,
    },
  },
  devices: [
    {
      deviceId: 'dev-arch',
      deviceName: 'Arch Desktop',
      platform: 'linux',
      arch: 'amd64',
      appVersion: '0.1.0',
      accountEmail: 'brendha@gmail.com',
      syncMode: 'bidirectional',
      folderId: 'master-1',
      status: 'online',
      lastSeenAt: '2026-11-17T12:05:00Z',
      isCurrentDevice: true,
    },
    {
      deviceId: 'dev-win11',
      deviceName: 'Notebook Windows 11',
      platform: 'windows',
      arch: 'amd64',
      appVersion: '0.1.0',
      accountEmail: 'joao@gmail.com',
      syncMode: 'receive_only',
      folderId: 'master-1',
      status: 'online',
      lastSeenAt: '2026-11-17T12:04:00Z',
    },
  ],
  knownSenders: [
    { folderId: 'master-1', email: 'joao@gmail.com', displayName: 'João', lastSeenAt: '2026-11-17T12:00:00Z' },
    { folderId: 'master-1', email: 'luiz@gmail.com', displayName: 'Luiz', lastSeenAt: '2026-11-17T12:00:00Z' },
  ],
  blockedFiles: [
    {
      id: 1,
      folderId: 'master-1',
      folderName: 'Drive Master Equipe',
      relativePath: 'video-bruto.mkv',
      localPath: '/home/brendha/Master/video-bruto.mkv',
      fileSizeBytes: 5 * 1024 * 1024 * 1024,
      reason: 'exceeds_4gb',
      detail: 'Excede o limite de 4 GB por upload.',
      detectedAt: '2026-11-17T12:05:00Z',
    },
  ],
  recentActivity: [],
};

describe('App UI DriveSync', () => {
  it('renderiza pasta Master, alerta de 4 GB, dispositivos e alternância de remetentes', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const mockClient = createMockClient(sampleSnapshot);

    await act(async () => {
      root.render(<App overrideClient={mockClient} />);
    });

    expect(container.textContent).toContain('Drive Master Equipe');
    expect(container.textContent).toContain('video-bruto.mkv');
    expect(container.textContent).toContain('4 GB');

    // Abre a pasta dentro do próprio app para visualizar e adicionar arquivos
    const openBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.includes('Abrir pasta'),
    );
    expect(openBtn).toBeDefined();
    await act(async () => {
      openBtn!.click();
    });
    expect(container.textContent).toContain('Adicionar Arquivos');
    expect(container.textContent).toContain('relatorio.pdf');

    const closeModalBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Fechar"]');
    await act(async () => {
      closeModalBtn?.click();
    });

    // Navega para Dispositivos & Pessoas
    const navButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button.nav-btn'));
    const devicesBtn = navButtons.find((b) => b.textContent?.includes('Dispositivos'));
    expect(devicesBtn).toBeDefined();

    await act(async () => {
      devicesBtn!.click();
    });

    expect(container.textContent).toContain('Notebook Windows 11');
    expect(container.textContent).toContain('João');
    expect(container.textContent).toContain('Luiz');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
