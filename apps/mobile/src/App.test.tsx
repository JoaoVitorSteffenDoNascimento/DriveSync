import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { MAX_UPLOAD_BYTES } from '@drivesync/shared';
import { MobileApp } from './App';
import type { DriveSyncNativePlugin, MobileSnapshot } from './native/driveSyncNative';

const mockMobileSnap: MobileSnapshot = {
  account: {
    connected: true,
    email: 'brendha@gmail.com',
    displayName: 'Brendha',
    authSource: 'oauth_pkce',
    hasCustomOAuthClient: true,
  },
  settings: {
    deviceId: 'android-1',
    deviceName: 'Celular Android',
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
      id: 'm1',
      name: 'Drive Master Equipe',
      localPath: 'content://tree/primary%3AMaster',
      remoteFolderId: 'rem-1',
      remoteFolderName: 'Master',
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
      createdAt: '2026-11-17T16:00:00Z',
    },
  ],
  runtime: {
    m1: {
      folderId: 'm1',
      status: 'ok',
      message: 'Tudo sincronizado',
      blocked4gbCount: 0,
      ignoredSenderCount: 1,
      keptLocalCount: 0,
      syncedFilesCount: 5,
    },
  },
  devices: [
    {
      deviceId: 'android-1',
      deviceName: 'Celular Android',
      platform: 'android',
      arch: 'arm64',
      appVersion: '0.1.0',
      accountEmail: 'brendha@gmail.com',
      syncMode: 'bidirectional',
      folderId: 'm1',
      status: 'online',
      lastSeenAt: '2026-11-17T16:00:00Z',
      isCurrentDevice: true,
    },
  ],
  knownSenders: [],
  blockedFiles: [],
  recentActivity: [],
};

describe('MobileApp DriveSync', () => {
  it('exibe pastas, dispositivos móveis e link de compartilhamento', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const mockBridge = {
      getSnapshot: vi.fn().mockResolvedValue(mockMobileSnap),
    } as unknown as DriveSyncNativePlugin;

    await act(async () => {
      root.render(<MobileApp bridge={mockBridge} />);
    });

    expect(container.textContent).toContain('Drive Master Equipe');
    expect(container.textContent).toContain('Mantém no celular');

    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('button.bottom-tab'));
    const ajustesTab = tabs.find((b) => b.textContent?.includes('Ajustes'));
    await act(async () => {
      ajustesTab!.click();
    });

    expect(container.textContent).toContain('Copiar link de download do app');
    expect(container.textContent).toContain('4,00 GB');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
