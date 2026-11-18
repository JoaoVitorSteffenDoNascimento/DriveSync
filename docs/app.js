const REPO_OWNER = 'JoaoVitorSteffenDoNascimento';
const REPO_NAME = 'DriveSync';
const LATEST_DOWNLOAD_BASE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const CACHE_KEY = 'drivesync_release_cache_v3';

const PLATFORM_ASSETS = {
  'win-exe': {
    platform: 'windows',
    filename: 'DriveSync-Setup-Windows-x64.exe',
    heroLabel: 'Baixar para Windows (.exe)',
    hint: 'Windows 10/11 (x64) • Download direto do instalador .exe',
    baseLabel: 'x64 • Instalador .exe',
    match: (name) => /\.exe$/i.test(name),
  },
  'win-msi': {
    platform: 'windows',
    filename: 'DriveSync-Windows-x64.msi',
    match: (name) => /\.msi$/i.test(name),
  },
  'linux-appimage': {
    platform: 'linux',
    filename: 'DriveSync-Linux-x64.AppImage',
    heroLabel: 'Baixar para Linux (.AppImage)',
    hint: 'Linux (x86_64) • Download direto do AppImage universal',
    baseLabel: 'x86_64 • AppImage universal',
    match: (name) => /\.AppImage$/i.test(name),
  },
  'linux-deb': {
    platform: 'linux',
    filename: 'DriveSync-Linux-x64.deb',
    match: (name) => /\.deb$/i.test(name),
  },
  'linux-rpm': {
    platform: 'linux',
    filename: 'DriveSync-Linux-x64.rpm',
    match: (name) => /\.rpm$/i.test(name),
  },
  'linux-pacman': {
    platform: 'linux',
    filename: 'DriveSync-Linux-x64.pacman',
    match: (name) => /\.pacman$/i.test(name),
  },
  'android-apk': {
    platform: 'android',
    filename: 'DriveSync-Android.apk',
    heroLabel: 'Baixar APK para Android',
    hint: 'Android 7+ • Download direto do APK assinado',
    baseLabel: 'Android 7+ • APK assinado',
    match: (name) => /\.apk$/i.test(name),
  },
};

function detectOS() {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux') || ua.includes('x11')) return 'linux';
  return 'windows';
}

function primaryKeyForOS(os) {
  if (os === 'android') return 'android-apk';
  if (os === 'linux') return 'linux-appimage';
  return 'win-exe';
}

function formatSizeMb(bytes) {
  if (!bytes || bytes <= 0) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function showToast(message) {
  const toast = document.getElementById('dl-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 3200);
}

/* Neon-inspired refractive vertical optical curtain in hero */
function initLightCurtain() {
  const canvas = document.getElementById('light-curtain');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const beams = Array.from({ length: 42 }, (_, i) => ({
    xRatio: (i + 0.5) / 42,
    heightRatio: 0.28 + ((i * 37) % 50) / 100,
    offsetY: ((i * 53) % 100) / 100,
    speed: 0.0007 + ((i % 7) * 0.00022),
    hue: i % 3 === 0 ? '34, 211, 238' : i % 3 === 1 ? '59, 130, 246' : '16, 185, 129',
    alpha: 0.14 + ((i % 5) * 0.06),
  }));

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  let tick = 0;
  const render = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    for (const b of beams) {
      const x = b.xRatio * w;
      const barH = b.heightRatio * h * 0.72;
      const phase = Math.sin(tick * b.speed * 14 + b.offsetY * Math.PI * 2);
      const y = (h * 0.08) + ((phase + 1) * 0.5) * (h * 0.36);

      const grad = ctx.createLinearGradient(x, y, x, y + barH);
      grad.addColorStop(0, `rgba(${b.hue}, 0)`);
      grad.addColorStop(0.5, `rgba(${b.hue}, ${b.alpha})`);
      grad.addColorStop(1, `rgba(${b.hue}, 0)`);

      ctx.fillStyle = grad;
      ctx.fillRect(x, y, 2.2, barH);
    }

    if (!reduced) {
      tick += 1;
      window.requestAnimationFrame(render);
    }
  };

  resize();
  window.addEventListener('resize', resize);
  render();
}

/* Pointer-tracking spotlight illumination across Bento & Download cards */
function initSpotlightCards() {
  const cards = Array.from(document.querySelectorAll('.spotlight-card'));
  for (const card of cards) {
    card.addEventListener('pointermove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--mx', `${x}px`);
      card.style.setProperty('--my', `${y}px`);
    });
  }
}

function applyDetectedOS(os, resolvedAssets = {}) {
  const primaryKey = primaryKeyForOS(os);
  const cfg = PLATFORM_ASSETS[primaryKey];
  const resolved = resolvedAssets[primaryKey];
  const url = resolved?.url || `${LATEST_DOWNLOAD_BASE}/${cfg.filename}`;
  const filename = resolved?.filename || cfg.filename;
  const tag = resolvedAssets._tag || 'v0.3.0';

  const heroBtn = document.getElementById('hero-download-btn');
  const heroLabel = document.getElementById('hero-download-label');
  const navBtn = document.getElementById('nav-download-btn');
  const hint = document.getElementById('hero-detected-hint');

  if (heroBtn) {
    heroBtn.setAttribute('href', url);
    heroBtn.setAttribute('download', filename);
  }
  if (heroLabel) {
    heroLabel.textContent = cfg.heroLabel;
  }
  if (navBtn) {
    navBtn.setAttribute('href', url);
    navBtn.setAttribute('download', filename);
  }
  if (hint) {
    hint.textContent = `${cfg.hint} • ${tag}`;
  }

  document.querySelectorAll('[data-platform-card]').forEach((card) => {
    card.classList.toggle('is-recommended', card.getAttribute('data-platform-card') === os);
  });
}

function bindInteractions() {
  document.querySelectorAll('a[data-asset-key], #hero-download-btn, #nav-download-btn').forEach((link) => {
    link.addEventListener('click', () => {
      const file = link.getAttribute('download') || 'instalador';
      showToast(`Baixando diretamente: ${file}`);
    });
  });

  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.getAttribute('data-copy');
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        showToast('Link copiado para a área de transferência');
      } catch {
        // Ignore clipboard errors
      }
    });
  });
}

async function resolveLatestRelease(os) {
  let release = null;
  try {
    const cachedRaw = sessionStorage.getItem(CACHE_KEY);
    if (cachedRaw) {
      const parsed = JSON.parse(cachedRaw);
      if (Date.now() - parsed.savedAt < 5 * 60 * 1000) {
        release = parsed.data;
      }
    }
  } catch {
    // Ignore storage read restrictions
  }

  if (!release) {
    try {
      const res = await fetch(LATEST_RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (res.ok) {
        release = await res.json();
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data: release }));
        } catch {
          // Ignore storage write restrictions
        }
      }
    } catch {
      // Fallback stays on latest/download links
    }
  }

  if (!release || !Array.isArray(release.assets)) return;

  const tag = release.tag_name || 'v0.3.0';
  document.querySelectorAll('[data-release-tag]').forEach((el) => {
    el.textContent = tag;
  });

  const resolvedMap = { _tag: tag };
  Object.entries(PLATFORM_ASSETS).forEach(([key, cfg]) => {
    const asset = release.assets.find((item) => cfg.match(item.name || ''));
    if (!asset) return;

    resolvedMap[key] = {
      url: asset.browser_download_url,
      filename: asset.name,
      size: asset.size,
    };

    document.querySelectorAll(`a[data-asset-key="${key}"]`).forEach((link) => {
      link.setAttribute('href', asset.browser_download_url);
      link.setAttribute('download', asset.name);
    });

    const sizeEl = document.querySelector(`[data-size-label="${key}"]`);
    if (sizeEl && cfg.baseLabel && asset.size) {
      sizeEl.textContent = `${cfg.baseLabel} • ${formatSizeMb(asset.size)}`;
    }
  });

  applyDetectedOS(os, resolvedMap);
}

const currentOS = detectOS();
initLightCurtain();
initSpotlightCards();
bindInteractions();
applyDetectedOS(currentOS);
void resolveLatestRelease(currentOS);
