import {
  GITHUB_LATEST_DOWNLOAD_BASE,
  GITHUB_RELEASES_URL,
  MAX_UPLOAD_BYTES,
  computeAndroidVersionCode,
} from './constants.js';
import type {
  AppUpdateCheckResult,
  AppUpdatePlatform,
  CreateFolderInput,
  SenderPolicy,
} from './types.js';

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

/**
 * Converte caminhos internos (como URIs SAF `content://...` do Android ou
 * caminhos absolutos longos de PC) em uma trilha curta e legível para exibição.
 */
export function formatStoragePath(rawPath: string | undefined | null): string {
  const input = (rawPath ?? '').trim();
  if (!input) return 'Não definida';

  if (input.startsWith('content://')) {
    let decoded = input;
    try {
      decoded = decodeURIComponent(input);
    } catch {
      decoded = input;
    }
    const docIdx = decoded.lastIndexOf('/document/');
    const treeIdx = decoded.lastIndexOf('/tree/');
    let tail = '';
    if (docIdx >= 0) {
      tail = decoded.slice(docIdx + '/document/'.length);
    } else if (treeIdx >= 0) {
      tail = decoded.slice(treeIdx + '/tree/'.length);
    } else {
      tail = decoded.replace(/^content:\/\/[^/]+\//, '');
    }
    tail = tail.replace(/\/+$/, '');
    if (tail.startsWith('primary:')) {
      const sub = tail.slice('primary:'.length).replace(/^\/+/, '');
      return sub ? `Memória interna/${sub}` : 'Memória interna';
    }
    if (tail.startsWith('home:')) {
      const sub = tail.slice('home:'.length).replace(/^\/+/, '');
      return sub ? `Documentos/${sub}` : 'Documentos';
    }
    const sdMatch = /^([0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}):(.*)$/.exec(tail);
    if (sdMatch) {
      const sub = sdMatch[2].replace(/^\/+/, '');
      return sub ? `Cartão SD/${sub}` : 'Cartão SD';
    }
    return tail;
  }

  const linuxHome = /^\/home\/[^/]+(\/.*)?$/.exec(input);
  if (linuxHome) {
    return `~${linuxHome[1] || ''}`;
  }
  const winHome = /^[A-Za-z]:\\Users\\[^\\]+(\\.*)?$/.exec(input);
  if (winHome) {
    return `~${winHome[1] || ''}`;
  }
  return input;
}

const PLATFORM_DEFAULT_INSTALLERS: Record<
  AppUpdatePlatform,
  { extPattern: RegExp; fallbackName: string }
> = {
  android: { extPattern: /\.apk$/i, fallbackName: 'DriveSync-Android.apk' },
  windows: { extPattern: /\.exe$/i, fallbackName: 'DriveSync-Setup-Windows-x64.exe' },
  linux: { extPattern: /\.AppImage$/i, fallbackName: 'DriveSync-Linux-x64.AppImage' },
};

/** Normaliza uma string de versão para o formato SemVer `MAJOR.MINOR.PATCH`. */
export function normalizeSemVer(raw: string | undefined | null): string {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/^[vV]/, '');
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(cleaned);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : '';
}

/** Compara duas versões SemVer (`> 0` se `a > b`, `0` se iguais, `< 0` se `a < b`). */
export function compareSemVer(a: string, b: string): number {
  const normA = normalizeSemVer(a);
  const normB = normalizeSemVer(b);
  if (!normA || !normB) return 0;
  return computeAndroidVersionCode(normA) - computeAndroidVersionCode(normB);
}

/** Retorna true quando `remoteVersion` é estritamente mais nova que `currentVersion`. */
export function isNewerVersionAvailable(currentVersion: string, remoteVersion: string): boolean {
  const cur = normalizeSemVer(currentVersion);
  const rem = normalizeSemVer(remoteVersion);
  if (!cur || !rem) return false;
  return compareSemVer(rem, cur) > 0;
}

interface GitHubReleaseAssetLike {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
}

interface GitHubReleasePayloadLike {
  tag_name?: unknown;
  html_url?: unknown;
  body?: unknown;
  published_at?: unknown;
  assets?: unknown;
}

/** Interpreta a resposta JSON de `/releases/latest` para a plataforma alvo. */
export function parseGitHubReleaseForPlatform(
  releasePayload: unknown,
  currentVersion: string,
  platform: AppUpdatePlatform,
): AppUpdateCheckResult {
  const payload =
    releasePayload && typeof releasePayload === 'object'
      ? (releasePayload as GitHubReleasePayloadLike)
      : {};
  const normalizedCurrent = normalizeSemVer(currentVersion) || String(currentVersion).trim();
  const latestVersion = normalizeSemVer(typeof payload.tag_name === 'string' ? payload.tag_name : '');
  const spec = PLATFORM_DEFAULT_INSTALLERS[platform];
  const assets = Array.isArray(payload.assets) ? (payload.assets as GitHubReleaseAssetLike[]) : [];
  const matchedAsset = assets.find(
    (item) => typeof item?.name === 'string' && spec.extPattern.test(item.name),
  );

  const assetName =
    typeof matchedAsset?.name === 'string' && matchedAsset.name
      ? matchedAsset.name
      : spec.fallbackName;
  const downloadUrl =
    typeof matchedAsset?.browser_download_url === 'string' && matchedAsset.browser_download_url
      ? matchedAsset.browser_download_url
      : `${GITHUB_LATEST_DOWNLOAD_BASE}/${assetName}`;
  const assetSizeBytes =
    typeof matchedAsset?.size === 'number' && matchedAsset.size > 0 ? matchedAsset.size : undefined;

  return {
    currentVersion: normalizedCurrent,
    latestVersion: latestVersion || normalizedCurrent,
    hasUpdate: latestVersion ? isNewerVersionAvailable(normalizedCurrent, latestVersion) : false,
    releaseUrl:
      typeof payload.html_url === 'string' && payload.html_url ? payload.html_url : GITHUB_RELEASES_URL,
    downloadUrl,
    assetName,
    assetSizeBytes,
    releaseNotes: typeof payload.body === 'string' ? payload.body : undefined,
    publishedAt: typeof payload.published_at === 'string' ? payload.published_at : undefined,
    checkedAt: new Date().toISOString(),
  };
}
