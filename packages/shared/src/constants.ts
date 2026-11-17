/**
 * Limite rígido de 4 GiB (4.294.967.296 bytes) por arquivo enviado no upload.
 * Corresponde ao "4,00 GB" reportado pelo explorador de arquivos do Windows.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

/** Nome do diretório interno de controle de dispositivos no Google Drive. */
export const CONTROL_DIR_NAME = '.drivesync';

/** Pasta local de quarentena quando exclusões espelhadas estão habilitadas. */
export const QUARANTINE_DIR_NAME = '.DriveSync-Quarentena';

/** Padrões padrão de arquivos ignorados (espelhando config/sync-filters.txt). */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  'node_modules',
  '.git',
  'venv',
  '.venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  'dist',
  'build',
  'target',
  '.next',
  '.nuxt',
  '.turbo',
  '.parcel-cache',
  '.image-build',
  '.addon-cache',
  '*.tmp',
  '*.swp',
  '*.swo',
  '*~',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '*.part',
  '*.crdownload',
  '*.iso',
  '*.img',
  '*.qcow2',
  '*.vdi',
  '*.vmdk',
  '*.ova',
  '*.pkg.tar.zst',
  '*.deb',
  '*.AppImage',
  'Cache',
  'Code Cache',
  'GPUCache',
  'CachedData',
  'CachedExtensionVSIXs',
  'Service Worker',
];
