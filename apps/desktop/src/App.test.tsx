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
    discoverAccountFolders: vi.fn().mockResolvedValue(snapshot.discoveredFolders ?? []),
    syncDiscoveredFolders: vi.fn().mockResolvedValue(snapshot.folders),
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
          syncStatus: 'sending',
          senderName: 'João',
          senderEmail: 'joao@gmail.com',
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
  discoveredFolders: [
    {
      remoteFolderId: 'gdrive-celular-1',
      remoteFolderName: 'Fotos Celular',
      kind: 'personal',
      shortCode: 'DS-CEL1-2026',
      ownerEmail: 'brendha@gmail.com',
      ownerName: 'Brendha',
      canWrite: true,
      deviceNames: ['Galaxy S24'],
      onRemoteDelete: 'keep_local',
      onLocalDelete: 'ignore',
      direction: 'bidirectional',
    },
  ],
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
    expect(container.textContent).toContain('Pastas da sua conta em outros dispositivos (1)');
    expect(container.textContent).toContain('Fotos Celular');
    expect(container.textContent).toContain('Escolher onde salvar todas');
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
    expect(container.textContent).toContain('Enviando agora...');
    expect(container.textContent).toContain('Enviado por: João');

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

    // Navega para Configurações e confirma card de atualização do app
    const settingsBtn = navButtons.find((b) => b.textContent?.includes('Configurações'));
    expect(settingsBtn).toBeDefined();
    await act(async () => {
      settingsBtn!.click();
    });
    expect(container.textContent).toContain('Atualização do Aplicativo');
    expect(container.textContent).toContain('Verificar atualizações');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('avisa quando há atualização disponível e inicia atualização em 1 clique', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const mockClient = createMockClient(sampleSnapshot);
    const installUpdate = vi.fn().mockResolvedValue({
      started: true,
      mode: 'appimage_relaunch',
      detail: 'Reiniciando...',
    });
    const uninstallApp = vi.fn().mockResolvedValue({
      started: true,
      detail: 'Desinstalação iniciada.',
    });

    window.driveSyncDesktop = {
      getDaemonConnection: vi.fn(),
      selectLocalFolder: vi.fn(),
      selectFilesToAdd: vi.fn(),
      selectFoldersToAdd: vi.fn(),
      getDroppedFilePaths: vi.fn(() => []),
      openExternalUrl: vi.fn(),
      openPathInExplorer: vi.fn(),
      setAutoStart: vi.fn(),
      getPlatformInfo: () => ({ platform: 'linux', arch: 'x64' }),
      checkForUpdates: vi.fn().mockResolvedValue({
        currentVersion: '0.4.0',
        latestVersion: '0.5.0',
        hasUpdate: true,
        releaseUrl: 'https://github.com/JoaoVitorSteffenDoNascimento/DriveSync/releases/tag/v0.5.0',
        downloadUrl: 'https://github.com/JoaoVitorSteffenDoNascimento/DriveSync/releases/download/v0.5.0/DriveSync-Linux-x64.AppImage',
        assetName: 'DriveSync-Linux-x64.AppImage',
        assetSizeBytes: 122358540,
        checkedAt: '2026-11-18T04:00:00Z',
      }),
      installUpdate,
      onUpdateAvailable: () => () => {},
      uninstallApp,
    };

    try {
      await act(async () => {
        root.render(<App overrideClient={mockClient} />);
      });
      await act(async () => {});

      expect(container.textContent).toContain('Nova atualização disponível: v0.5.0');
      const updateBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
        b.textContent?.includes('Atualizar agora'),
      );
      expect(updateBtn).toBeDefined();
      await act(async () => {
        updateBtn!.click();
      });
      expect(installUpdate).toHaveBeenCalledWith(
        'https://github.com/JoaoVitorSteffenDoNascimento/DriveSync/releases/download/v0.5.0/DriveSync-Linux-x64.AppImage',
      );

      // Abre Configurações e valida o fluxo de desinstalação com confirmação
      const settingsBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button.nav-btn')).find((b) =>
        b.textContent?.includes('Configurações'),
      );
      await act(async () => {
        settingsBtn!.click();
      });
      expect(container.textContent).toContain('Desinstalar DriveSync');
      const uninstallBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
        b.textContent?.includes('Desinstalar aplicativo'),
      );
      expect(uninstallBtn).toBeDefined();
      await act(async () => {
        uninstallBtn!.click();
      });
      const confirmBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
        b.textContent?.includes('Confirmar desinstalação'),
      );
      expect(confirmBtn).toBeDefined();
      await act(async () => {
        confirmBtn!.click();
      });
      expect(uninstallApp).toHaveBeenCalledWith({ purgeData: false });
    } finally {
      delete window.driveSyncDesktop;
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
