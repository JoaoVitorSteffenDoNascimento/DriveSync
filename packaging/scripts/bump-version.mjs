#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function parseSemver(version) {
  const match = SEMVER_RE.exec(String(version).trim());
  if (!match) {
    throw new Error(`Versão SemVer 2.0.0 inválida: "${version}" (esperado MAJOR.MINOR.PATCH, ex.: 0.2.0)`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function computeAndroidVersionCode(version) {
  const { major, minor, patch } = parseSemver(version);
  return major * 10000 + minor * 100 + patch;
}

function nextSemver(current, bumpArg) {
  const arg = bumpArg.trim().replace(/^v/, '');
  const cur = parseSemver(current);
  if (arg === 'patch') return `${cur.major}.${cur.minor}.${cur.patch + 1}`;
  if (arg === 'minor') return `${cur.major}.${cur.minor + 1}.0`;
  if (arg === 'major') return `${cur.major + 1}.0.0`;
  parseSemver(arg);
  return arg;
}

/**
 * Tabela declarativa de todos os arquivos que carregam a versão ou versionCode no monorepo.
 */
const TARGETS = [
  {
    file: 'package.json',
    rules: [{ name: 'root version', pattern: /("version"\s*:\s*")([^"]+)(")/, value: (v) => v, format: (v) => `$1${v}$3` }],
  },
  {
    file: 'packages/shared/package.json',
    rules: [{ name: '@drivesync/shared version', pattern: /("version"\s*:\s*")([^"]+)(")/, value: (v) => v, format: (v) => `$1${v}$3` }],
  },
  {
    file: 'apps/desktop/package.json',
    rules: [{ name: '@drivesync/desktop version', pattern: /("version"\s*:\s*")([^"]+)(")/, value: (v) => v, format: (v) => `$1${v}$3` }],
  },
  {
    file: 'apps/mobile/package.json',
    rules: [{ name: '@drivesync/mobile version', pattern: /("version"\s*:\s*")([^"]+)(")/, value: (v) => v, format: (v) => `$1${v}$3` }],
  },
  {
    file: 'packages/shared/src/constants.ts',
    rules: [
      {
        name: 'APP_VERSION',
        pattern: /(export const APP_VERSION = ')([^']+)(';)/,
        value: (v) => v,
        format: (v) => `$1${v}$3`,
      },
    ],
  },
  {
    file: 'apps/engine/internal/config/types.go',
    rules: [
      {
        name: 'Go AppVersion',
        pattern: /(AppVersion\s*=\s*")([^"]+)(")/,
        value: (v) => v,
        format: (v) => `$1${v}$3`,
      },
    ],
  },
  {
    file: 'apps/mobile/android/app/build.gradle',
    rules: [
      {
        name: 'Android versionCode',
        pattern: /(versionCode\s+)(\d+)/,
        value: (v) => String(computeAndroidVersionCode(v)),
        format: (val) => `$1${val}`,
      },
      {
        name: 'Android versionName',
        pattern: /(versionName\s+")([^"]+)(")/,
        value: (v) => v,
        format: (val) => `$1${val}$3`,
      },
    ],
  },
  {
    file: 'packaging/arch/PKGBUILD',
    rules: [
      {
        name: 'PKGBUILD pkgver',
        pattern: /^(pkgver=)([^\r\n]+)/m,
        value: (v) => v,
        format: (val) => `$1${val}`,
      },
    ],
  },
  {
    file: 'docs/index.html',
    rules: [
      {
        name: 'Site badge vX.Y.Z',
        pattern: /(<span class="brand-version" data-release-tag>v)([^<]+)(<\/span>)/,
        value: (v) => v,
        format: (val) => `$1${val}$3`,
      },
    ],
  },
  {
    file: 'docs/app.js',
    rules: [
      {
        name: 'app.js _tag fallback',
        pattern: /(resolvedAssets\._tag \|\| 'v)([^']+)(')/,
        value: (v) => v,
        format: (val) => `$1${val}$3`,
      },
      {
        name: 'app.js release fallback',
        pattern: /(release\.tag_name \|\| 'v)([^']+)(')/,
        value: (v) => v,
        format: (val) => `$1${val}$3`,
      },
    ],
  },
];

function runCheck(expectedVersion) {
  const expectedCode = computeAndroidVersionCode(expectedVersion);
  const errors = [];

  for (const target of TARGETS) {
    const absPath = path.join(REPO_ROOT, target.file);
    const content = fs.readFileSync(absPath, 'utf8');
    for (const rule of target.rules) {
      const match = rule.pattern.exec(content);
      if (!match) {
        errors.push(`${target.file}: padrão ausente para ${rule.name}`);
        continue;
      }
      const actual = match[2];
      const expected = rule.value(expectedVersion);
      if (actual !== expected) {
        errors.push(`${target.file} (${rule.name}): esperado "${expected}", encontrado "${actual}"`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`[version:check] Inconsistências encontradas (referência ${expectedVersion}, versionCode ${expectedCode}):`);
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log(`[version:check] OK — v${expectedVersion} (Android versionCode ${expectedCode}) sincronizada em todos os ${TARGETS.length} arquivos.`);
}

function runBump(bumpArg) {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const targetVersion = nextSemver(rootPkg.version, bumpArg);
  const targetCode = computeAndroidVersionCode(targetVersion);

  for (const target of TARGETS) {
    const absPath = path.join(REPO_ROOT, target.file);
    let content = fs.readFileSync(absPath, 'utf8');
    for (const rule of target.rules) {
      if (!rule.pattern.test(content)) {
        throw new Error(`${target.file}: padrão não encontrado para ${rule.name}`);
      }
      const val = rule.value(targetVersion);
      content = content.replace(rule.pattern, rule.format(val));
    }
    fs.writeFileSync(absPath, content, 'utf8');
  }

  console.log(`[version:bump] Versão atualizada: ${rootPkg.version} -> v${targetVersion} (Android versionCode ${targetCode})`);
  runCheck(targetVersion);
}

const arg = process.argv[2];
if (!arg) {
  console.error('Uso: node packaging/scripts/bump-version.mjs <--check | patch | minor | major | X.Y.Z>');
  process.exit(1);
}

if (arg === '--check') {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  parseSemver(rootPkg.version);
  runCheck(rootPkg.version);
} else {
  runBump(arg);
}
