const REPO_OWNER = 'JoaoVitorSteffenDoNascimento';
const REPO_NAME = 'DriveSync';
const RELEASES_PAGE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const CACHE_KEY = 'drivesync_latest_release_v1';

function detectPlatform() {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux') || ua.includes('x11')) return 'linux';
  return 'windows';
}

function formatSizeMb(bytes) {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1).replace('.', ',')} MB`;
}

function selectViewTab(tabName) {
  document.querySelectorAll('[data-view-tab]').forEach((btn) => {
    const active = btn.getAttribute('data-view-tab') === tabName;
    btn.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-view-panel]').forEach((panel) => {
    panel.classList.toggle('is-active', panel.getAttribute('data-view-panel') === tabName);
  });
}

function selectOsTab(osName) {
  document.querySelectorAll('[data-os-tab]').forEach((btn) => {
    const active = btn.getAttribute('data-os-tab') === osName;
    btn.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-os-panel]').forEach((panel) => {
    panel.classList.toggle('is-active', panel.getAttribute('data-os-panel') === osName);
  });
}

function updateHeroCta(osName, matchedUrls = {}) {
  const cta = document.getElementById('hero-primary-cta');
  const meta = document.getElementById('hero-detected-meta');
  if (!cta || !meta) return;

  if (osName === 'android') {
    cta.textContent = 'Baixar DriveSync APK (Android)';
    cta.href = matchedUrls['android-apk'] || '#baixar';
    meta.textContent = 'Sistema detectado: Android • APK assinado pronto para instalação';
  } else if (osName === 'linux') {
    cta.textContent = 'Baixar para Linux (.AppImage)';
    cta.href = matchedUrls['linux-appimage'] || '#baixar';
    meta.textContent = 'Sistema detectado: Linux • Disponível em .AppImage, .deb, .rpm e .pacman';
  } else {
    cta.textContent = 'Baixar para Windows (.exe)';
    cta.href = matchedUrls['win-exe'] || '#baixar';
    meta.textContent = 'Sistema detectado: Windows 10/11 (x64) • Instalador .exe e pacote .msi';
  }
}

async function fetchLatestRelease() {
  try {
    const cachedRaw = sessionStorage.getItem(CACHE_KEY);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (Date.now() - cached.savedAt < 10 * 60 * 1000) {
        return cached.data;
      }
    }
  } catch {
    // Ignore storage read restrictions
  }

  const res = await fetch(LATEST_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = await res.json();
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // Ignore storage write restrictions
  }
  return data;
}

function bindReleaseAssets(release, detectedOs) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const version = release.tag_name || 'v0.1.0';
  document.querySelectorAll('[data-release-version]').forEach((el) => {
    el.textContent = version;
  });

  const matchers = {
    'win-exe': (name) => /\.exe$/i.test(name),
    'win-msi': (name) => /\.msi$/i.test(name),
    'linux-appimage': (name) => /\.AppImage$/i.test(name),
    'linux-deb': (name) => /\.deb$/i.test(name),
    'linux-rpm': (name) => /\.rpm$/i.test(name),
    'linux-pacman': (name) => /\.pacman$/i.test(name),
    'android-apk': (name) => /\.apk$/i.test(name),
  };

  const resolvedUrls = {};
  Object.entries(matchers).forEach(([key, predicate]) => {
    const asset = assets.find((item) => predicate(item.name || ''));
    const linkEl = document.querySelector(`[data-asset-link="${key}"]`);
    const metaEl = document.querySelector(`[data-asset-meta="${key}"]`);
    if (asset && linkEl) {
      linkEl.setAttribute('href', asset.browser_download_url);
      resolvedUrls[key] = asset.browser_download_url;
      if (metaEl) {
        const sizeLabel = formatSizeMb(asset.size);
        metaEl.textContent = sizeLabel ? `${asset.name} • ${sizeLabel}` : asset.name;
      }
    }
  });

  updateHeroCta(detectedOs, resolvedUrls);

  const statusEl = document.getElementById('release-status-text');
  if (statusEl) {
    const dateStr = release.published_at
      ? new Date(release.published_at).toLocaleDateString('pt-BR')
      : '';
    statusEl.textContent = dateStr
      ? `Última release publicada: ${version} (${dateStr}) • ${assets.length} arquivo(s) disponíveis.`
      : `Última release publicada: ${version}.`;
  }
}

function setupCopyButtons() {
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const value = btn.getAttribute('data-copy');
      if (!value) return;
      const original = btn.textContent;
      try {
        await navigator.clipboard.writeText(value);
        btn.textContent = 'Copiado!';
        setTimeout(() => {
          btn.textContent = original;
        }, 2000);
      } catch {
        btn.textContent = original;
      }
    });
  });
}

async function init() {
  const detectedOs = detectPlatform();
  selectOsTab(detectedOs);
  updateHeroCta(detectedOs);
  setupCopyButtons();

  document.querySelectorAll('[data-view-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-view-tab');
      if (target) selectViewTab(target);
    });
  });

  document.querySelectorAll('[data-os-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-os-tab');
      if (target) selectOsTab(target);
    });
  });

  try {
    const release = await fetchLatestRelease();
    bindReleaseAssets(release, detectedOs);
  } catch {
    const statusEl = document.getElementById('release-status-text');
    if (statusEl) {
      statusEl.innerHTML =
        `Nenhuma release final publicada ainda — abra <a href="${RELEASES_PAGE}" target="_blank" rel="noreferrer" style="color:var(--craft-accent-bright)">GitHub Releases</a> ou execute o workflow <code>Release Multiplataforma</code>.`;
    }
  }
}

init();
