import React, { act } from 'react';
import { Capacitor } from '@capacitor/core';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_UPLOAD_BYTES } from '@drivesync/shared';
import { MobileApp } from './App';
import type { DriveSyncNativePlugin, MobileSnapshot } from './native/driveSyncNative';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function makeSnapshot(overrides: Partial<MobileSnapshot> = {}): MobileSnapshot {
  return {
    account: {
      connected: true,
      email: 'equipe@gmail.com',
      displayName: 'Equipe',
      authSource: 'oauth_pkce',
      hasCustomOAuthClient: true,
    },
    settings: {
      deviceId: 'dev-cell',
      deviceName: 'Pixel Equipe',
      maxUploadBytes: MAX_UPLOAD_BYTES,
      pollIntervalSeconds: 900,
      startOnBoot: true,
      minimizeToTray: false,
      enableWaybarBridge: false,
      defaultOnRemoteDelete: 'keep_local',
      wifiOnly: true,
      backgroundSyncEnabled: true,
    },
    folders: [
      {
        id: 'folder-1',
        name: 'Drive Master Equipe',
        localPath: 'content://mock/tree/DriveMaster',
        remoteFolderId: 'remote-1',
        remoteFolderName: 'Drive Master Equipe',
        kind: 'master',
        direction: 'bidirectional',
        onRemoteDelete: 'keep_local',
        onLocalDelete: 'ignore',
        senderPolicy: {
          mode: 'blocklist',
          unknownSenderAction: 'allow',
          rules: [{ email: 'spam@example.com', allowed: false }],
        },
        paused: false,
        createdAt: '2026-11-17T10:00:00Z',
      },
    ],
    runtime: {
      'folder-1': {
        folderId: 'folder-1',
        status: 'ok',
        message: 'Sincronização concluída.',
        blocked4gbCount: 1,
        ignoredSenderCount: 0,
        keptLocalCount: 2,
        syncedFilesCount: 14,
      },
    },
    devices: [
      {
        deviceId: 'dev-cell',
        deviceName: 'Pixel Equipe',
        platform: 'android',
        arch: 'arm64',
        appVersion: '0.1.0',
        accountEmail: 'equipe@gmail.com',
        syncMode: 'bidirectional',
        folderId: 'folder-1',
        status: 'online',
        lastSeenAt: '2026-11-17T12:00:00Z',
        isCurrentDevice: true,
      },
      {
        deviceId: 'dev-pc',
        deviceName: 'Notebook Escritório',
        platform: 'linux',
        arch: 'x64',
        appVersion: '0.1.0',
        accountEmail: 'equipe@gmail.com',
        syncMode: 'bidirectional',
        folderId: 'folder-1',
        status: 'online',
        lastSeenAt: '2026-11-17T11:55:00Z',
        isCurrentDevice: false,
      },
    ],
    knownSenders: [
      {
        folderId: 'folder-1',
        email: 'joao@gmail.com',
        displayName: 'João Vitor',
        lastSeenAt: '2026-11-17T11:50:00Z',
      },
    ],
    blockedFiles: [
      {
        id: 1,
        folderId: 'folder-1',
        folderName: 'Drive Master Equipe',
        relativePath: 'backup-pesado.iso',
        fileSizeBytes: MAX_UPLOAD_BYTES + 1024,
        reason: 'exceeds_4gb',
        detail: 'Passa de 4 GB permitidos para upload.',
        detectedAt: '2026-11-17T11:30:00Z',
      },
    ],
    recentActivity: [
      {
        id: 10,
        folderId: 'folder-1',
        folderName: 'Drive Master Equipe',
        kind: 'upload',
        level: 'success',
        message: 'Enviado contrato.pdf',
        relativePath: 'contrato.pdf',
        fileSizeBytes: 256000,
        createdAt: '2026-11-17T11:59:00Z',
      },
    ],
    ...overrides,
  };
}

function makeMockBridge(snap: MobileSnapshot): DriveSyncNativePlugin {
  return {
    getSnapshot: vi.fn().mockResolvedValue(snap),
    saveOAuthClient: vi.fn().mockResolvedValue(snap.account),
    uploadGoogleOAuthJson: vi.fn().mockResolvedValue(snap.account),
    pickAndLoadOAuthJson: vi.fn().mockResolvedValue(snap.account),
    startGoogleOAuth: vi.fn().mockResolvedValue(snap.account),
    cancelGoogleOAuth: vi.fn().mockResolvedValue({ ok: true }),
    disconnectAccount: vi.fn().mockResolvedValue({ ok: true }),
    pickLocalFolder: vi.fn().mockResolvedValue({ uri: 'content://mock/tree/Nova', displayName: 'Nova' }),
    pickAndImportFiles: vi.fn().mockResolvedValue({ addedCount: 1, skippedOver4GB: [], errors: [] }),
    listFolderContents: vi.fn().mockResolvedValue({
      folderId: 'folder-1',
      folderName: 'Drive Master Equipe',
      localPath: 'content://mock/tree/DriveMaster',
      subpath: '',
      items: [
        {
          name: 'contrato.pdf',
          relativePath: 'contrato.pdf',
          isDir: false,
          sizeBytes: 256000,
          modifiedAt: '2026-11-17T11:59:00Z',
          exceeds4gb: false,
        },
      ],
    }),
    createSubfolder: vi.fn().mockResolvedValue({ ok: true }),
    listDriveFolders: vi.fn().mockResolvedValue({ items: [] }),
    createDriveFolder: vi.fn().mockResolvedValue({ id: 'r2', name: 'Nova', shared: false, canWrite: true }),
    resolveFolderCode: vi.fn().mockResolvedValue({
      remoteFolderId: 'r2',
      remoteFolderName: 'Nova',
      kind: 'master',
      canWrite: true,
      matchedBy: 'full_code',
    }),
    generateFolderInvite: vi.fn().mockResolvedValue({
      folderId: 'folder-1',
      folderName: 'Drive Master Equipe',
      shortCode: 'DS-ABCD-1234',
      fullCode: 'DS1.remote-1.DS-ABCD-1234',
      driveUrl: 'https://drive.google.com/drive/folders/remote-1',
      kind: 'master',
    }),
    shareFolder: vi.fn().mockResolvedValue({ shared: true }),
    createSyncFolder: vi.fn().mockResolvedValue(snap.folders[0]),
    updateSyncFolder: vi.fn().mockResolvedValue(snap.folders[0]),
    deleteSyncFolder: vi.fn().mockResolvedValue({ deleted: true }),
    forgetDevice: vi.fn().mockResolvedValue({ ok: true }),
    syncNow: vi.fn().mockResolvedValue({ started: true }),
    updateSettings: vi.fn().mockResolvedValue(snap.settings),
  };
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  );
}

describe('MobileApp', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('exibe pastas, ações completas do desktop, bloqueio > 4 GB e ajustes', async () => {
    const snap = makeSnapshot();
    const bridge = makeMockBridge(snap);

    await act(async () => {
      root.render(<MobileApp bridge={bridge} />);
    });
    await act(async () => {});

    expect(container.textContent).toContain('Drive Master Equipe');
    expect(container.textContent).toContain('Mantém no celular');
    expect(container.textContent).toContain('Abrir pasta');
    expect(container.textContent).toContain('Opções');
    expect(container.textContent).toContain('Pausar');

    // Pausar pasta via botão
    const pauseBtn = findButton(container, 'Pausar');
    expect(pauseBtn).toBeDefined();
    await act(async () => {
      pauseBtn?.click();
    });
    expect(bridge.updateSyncFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: expect.objectContaining({ id: 'folder-1', paused: true }),
      }),
    );

    // Abrir navegador de arquivos da pasta
    const openBtn = findButton(container, 'Abrir pasta');
    await act(async () => {
      openBtn?.click();
    });
    await act(async () => {});
    expect(bridge.listFolderContents).toHaveBeenCalledWith({ folderId: 'folder-1', subpath: '' });
    expect(container.textContent).toContain('contrato.pdf');
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Fechar"]')?.click();
    });

    // Abrir sheet de Opções
    const optBtn = findButton(container, 'Opções');
    await act(async () => {
      optBtn?.click();
    });
    expect(container.textContent).toContain('Opções de Drive Master Equipe');
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Fechar"]')?.click();
    });

    // Ver detalhes > 4 GB leva para Atividade -> Acima de 4 GB
    const detailsBtn = findButton(container, 'Ver detalhes');
    await act(async () => {
      detailsBtn?.click();
    });
    expect(container.textContent).toContain('backup-pesado.iso');

    // Aba Dispositivos: lista celular atual e permite remover outro dispositivo
    const peopleTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button.bottom-tab'),
    ).find((b) => b.textContent?.includes('Dispositivos'));
    await act(async () => {
      peopleTab?.click();
    });
    expect(container.textContent).toContain('Regra geral');
    expect(container.textContent).toContain('Notebook Escritório');
    const removeDevBtn = findButton(container, 'Remover');
    await act(async () => {
      removeDevBtn?.click();
    });
    expect(bridge.forgetDevice).toHaveBeenCalledWith({
      folderId: 'folder-1',
      deviceId: 'dev-pc',
    });

    // Aba Ajustes: compartilhamento, intervalo e trava 4,00 GB
    const settingsTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button.bottom-tab'),
    ).find((b) => b.textContent?.includes('Ajustes'));
    await act(async () => {
      settingsTab?.click();
    });
    expect(container.textContent).toContain('Copiar link de download do app');
    expect(container.textContent).toContain('4,00 GB');
    expect(container.textContent).toContain('Intervalo da sincronização automática');
  });

  it('mostra seleção de credentials.json no celular quando não há OAuth embutido', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const snap = makeSnapshot({
      account: {
        connected: false,
        email: '',
        displayName: '',
        authSource: 'none',
        hasCustomOAuthClient: false,
      },
      folders: [],
      blockedFiles: [],
    });
    const bridge = makeMockBridge(snap);

    await act(async () => {
      root.render(<MobileApp bridge={bridge} />);
    });
    await act(async () => {});

    const loginBtn = findButton(container, 'Conectar Google Drive');
    await act(async () => {
      loginBtn?.click();
    });

    expect(container.textContent).toContain('Colar texto do JSON');
    const jsonBtn = findButton(container, 'Selecionar arquivo credentials.json');
    expect(jsonBtn).toBeDefined();
    await act(async () => {
      jsonBtn?.click();
    });
    expect(bridge.pickAndLoadOAuthJson).toHaveBeenCalledTimes(1);
  });
});
