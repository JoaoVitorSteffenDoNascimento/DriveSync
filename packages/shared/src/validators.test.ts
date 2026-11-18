import { describe, expect, it } from 'vitest';
import {
  APP_VERSION,
  MAX_UPLOAD_BYTES,
  computeAndroidVersionCode,
  formatBytes,
  formatStoragePath,
  isSenderAllowed,
  isUploadWithinLimit,
  parseFolderCodeOrLink,
  validateCreateFolderInput,
} from './index.js';
import type { SenderPolicy } from './types.js';

describe('regras compartilhadas DriveSync', () => {
  it('impõe teto de 4 GiB para uploads', () => {
    expect(isUploadWithinLimit(0)).toBe(true);
    expect(isUploadWithinLimit(MAX_UPLOAD_BYTES)).toBe(true);
    expect(isUploadWithinLimit(MAX_UPLOAD_BYTES + 1)).toBe(false);
    expect(isUploadWithinLimit(-1)).toBe(false);
  });

  it('formata tamanhos em português com vírgula decimal', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2,50 MB');
    expect(formatBytes(MAX_UPLOAD_BYTES)).toBe('4,00 GB');
  });

  it('filtra remetentes em blocklist (aceita João, bloqueia Luiz)', () => {
    const policy: SenderPolicy = {
      mode: 'blocklist',
      unknownSenderAction: 'block',
      rules: [
        { email: 'joao@gmail.com', allowed: true },
        { email: 'luiz@gmail.com', allowed: false },
      ],
    };

    expect(isSenderAllowed('JOAO@gmail.com', policy)).toBe(true);
    expect(isSenderAllowed('luiz@gmail.com', policy)).toBe(false);
    expect(isSenderAllowed('maria@gmail.com', policy)).toBe(true);
    expect(isSenderAllowed('', policy)).toBe(false);
  });

  it('filtra remetentes em allowlist estrita', () => {
    const policy: SenderPolicy = {
      mode: 'allowlist',
      unknownSenderAction: 'block',
      rules: [
        { email: 'joao@gmail.com', allowed: true },
        { email: 'luiz@gmail.com', allowed: false },
      ],
    };

    expect(isSenderAllowed('joao@gmail.com', policy)).toBe(true);
    expect(isSenderAllowed('luiz@gmail.com', policy)).toBe(false);
    expect(isSenderAllowed('desconhecido@gmail.com', policy)).toBe(false);
  });

  it('valida campos mínimos ao criar pasta conectada', () => {
    const errs = validateCreateFolderInput({
      name: '',
      localPath: '',
      remoteFolderId: '',
      remoteFolderName: '',
      kind: 'master',
      direction: 'receive_only',
      onRemoteDelete: 'keep_local',
      onLocalDelete: 'ignore',
      senderPolicy: {
        mode: 'all',
        unknownSenderAction: 'allow',
        rules: [],
      },
    });
    expect(errs).toHaveLength(3);
  });

  it('interpreta código completo DS1, link do Drive e código curto', () => {
    expect(parseFolderCodeOrLink('DS1.1AbCdEfGhIjK99.ds-4829-kp7m')).toEqual({
      kind: 'full_code',
      folderId: '1AbCdEfGhIjK99',
      shortCode: 'DS-4829-KP7M',
    });
    expect(
      parseFolderCodeOrLink('https://drive.google.com/drive/folders/1AbCdEfGhIjK99?usp=sharing'),
    ).toEqual({
      kind: 'drive_link',
      folderId: '1AbCdEfGhIjK99',
    });
    expect(parseFolderCodeOrLink('ds-4829-kp7m')).toEqual({
      kind: 'short_code',
      shortCode: 'DS-4829-KP7M',
    });
    expect(parseFolderCodeOrLink('abc')).toEqual({ kind: 'invalid' });
  });

  it('mantém versão SemVer 2.0.0 e calcula versionCode compatível com Google Play Store', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(computeAndroidVersionCode('0.2.0')).toBe(200);
    expect(computeAndroidVersionCode('1.2.3')).toBe(10203);
    expect(computeAndroidVersionCode(APP_VERSION)).toBeGreaterThanOrEqual(200);
  });

  it('formata URIs SAF do Android e caminhos de PC de forma limpa', () => {
    expect(
      formatStoragePath(
        'content://com.android.externalstorage.documents/tree/primary%3ATeste%20DriveSync/document/primary%3ATeste%20DriveSync%2FTeste',
      ),
    ).toBe('Memória interna/Teste DriveSync/Teste');
    expect(formatStoragePath('/home/brendha/Master')).toBe('~/Master');
    expect(formatStoragePath('')).toBe('Não definida');
  });
});
