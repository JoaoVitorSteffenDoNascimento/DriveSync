import { MAX_UPLOAD_BYTES } from './constants.js';
import type { CreateFolderInput, SenderPolicy } from './types.js';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx++;
  }
  const formatted = value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${formatted.replace('.', ',')} ${units[unitIdx]}`;
}

export function isUploadWithinLimit(
  sizeBytes: number,
  maxBytes: number = MAX_UPLOAD_BYTES,
): boolean {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return false;
  return sizeBytes <= Math.min(maxBytes, MAX_UPLOAD_BYTES);
}

export function normalizeEmail(email: string | undefined | null): string {
  return (email ?? '').trim().toLowerCase();
}

export function isSenderAllowed(
  senderEmail: string | undefined | null,
  policy: SenderPolicy,
): boolean {
  const normalized = normalizeEmail(senderEmail);
  if (!normalized) {
    return policy.unknownSenderAction === 'allow';
  }

  if (policy.mode === 'all') {
    return true;
  }

  const rule = policy.rules.find((r) => normalizeEmail(r.email) === normalized);
  if (policy.mode === 'blocklist') {
    return rule ? rule.allowed : true;
  }

  // allowlist: somente explicitamente permitidos
  return Boolean(rule && rule.allowed);
}

export function validateCreateFolderInput(input: CreateFolderInput): string[] {
  const errors: string[] = [];
  if (!input.name.trim()) {
    errors.push('Informe um nome simples para identificar a pasta.');
  }
  if (!input.localPath.trim()) {
    errors.push('Escolha uma pasta no computador.');
  }
  if (!input.remoteFolderId.trim()) {
    errors.push('Escolha uma pasta no Google Drive.');
  }
  if (input.kind === 'master' && input.senderPolicy.mode === 'allowlist') {
    const allowedCount = input.senderPolicy.rules.filter((r) => r.allowed).length;
    if (allowedCount === 0 && input.senderPolicy.unknownSenderAction === 'block') {
      errors.push('No modo "Somente aprovados", permita ao menos uma pessoa ou permita remetentes depois.');
    }
  }
  return errors;
}

export type ParsedCodeInput =
  | { kind: 'full_code'; folderId: string; shortCode: string }
  | { kind: 'drive_link'; folderId: string }
  | { kind: 'short_code'; shortCode: string }
  | { kind: 'invalid' };

export function parseFolderCodeOrLink(raw: string): ParsedCodeInput {
  const input = raw.trim();
  if (!input) return { kind: 'invalid' };

  // Formato gerado pelo app: DS1.<folderId>.<DS-XXXX-XXXX>
  const fullMatch = /^DS1\.([A-Za-z0-9_-]{8,})\.(DS-[A-Z0-9]{4}-[A-Z0-9]{4})$/i.exec(input);
  if (fullMatch) {
    return {
      kind: 'full_code',
      folderId: fullMatch[1],
      shortCode: fullMatch[2].toUpperCase(),
    };
  }

  // Link direto do Google Drive
  const linkMatch =
    /drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|open\?id=|folderview\?id=)([A-Za-z0-9_-]{8,})/i.exec(
      input,
    );
  if (linkMatch) {
    return {
      kind: 'drive_link',
      folderId: linkMatch[1],
    };
  }

  // Código curto gerado pelo app: DS-XXXX-XXXX
  const shortMatch = /^(DS-[A-Z0-9]{4}-[A-Z0-9]{4})$/i.exec(input);
  if (shortMatch) {
    return {
      kind: 'short_code',
      shortCode: shortMatch[1].toUpperCase(),
    };
  }

  return { kind: 'invalid' };
}
