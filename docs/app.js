const REPO_OWNER = 'JoaoVitorSteffenDoNascimento';
const REPO_NAME = 'DriveSync';
const LATEST_DOWNLOAD_BASE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const THEME_KEY = 'drivesync_theme_v1';
const CACHE_KEY = 'drivesync_release_cache_v2';

const DEFAULT_ASSETS = {
  'win-exe': {
    filename: 'DriveSync-Setup-Windows-x64.exe',
    label: 'Baixar para Windows (.exe)',
    strip: 'PARA WINDOWS 10/11 · EXECUTÁVEL .EXE (X64)',
    matcher: (n) => /\.exe$/i.test(n),
  },
  'win-msi': {
    filename: 'DriveSync-Windows-x64.msi',
    label: 'Baixar Windows (.msi)',
    strip: 'PARA WINDOWS 10/11 · PACOTE .MSI (X64)',
    matcher: (n) => /\.msi$/i.test(n),
  },
  'linux-appimage': {
    filename: 'DriveSync-Linux-x64.AppImage',
    label: 'Baixar para Linux (.AppImage)',
    strip: 'PARA LINUX · APPIMAGE (X86_64)',
    matcher: (n) => /\.AppImage$/i.test(n),
  },
  'linux-deb': {
    filename: 'DriveSync-Linux-x64.deb',
    label: 'Baixar Debian/Ubuntu (.deb)',
    strip: 'PARA LINUX · PACOTE .DEB',
    matcher: (n) => /\.deb$/i.test(n),
  },
  'linux-rpm': {
    filename: 'DriveSync-Linux-x64.rpm',
    label: 'Baixar Fedora (.rpm)',
    strip: 'PARA LINUX · PACOTE .RPM',
    matcher: (n) => /\.rpm$/i.test(n),
  },
  'linux-pacman': {
    filename: 'DriveSync-Linux-x64.pacman',
    label: 'Baixar Arch (.pacman)',
    strip: 'PARA ARCH LINUX · PACOTE .PACMAN',
    matcher: (n) => /\.pacman$/i.test(n),
  },
  'android-apk': {
    filename: 'DriveSync-Android.apk',
    label: 'Baixar para Android (.apk)',
    strip: 'PARA ANDROID 7+ · APK INSTALÁVEL',
    matcher: (n) => /\.apk$/i.test(n),
  },
};

function detectPrimaryKey() {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('android')) return 'android-apk';
  if (ua.includes('win')) return 'win-exe';
  if (ua.includes('linux') || ua.includes('x11')) return 'linux-appimage';
  return 'win-exe';
}

function formatSizeMb(bytes) {
  if (!bytes || bytes <= 0) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function showToast(text) {
  const toast = document.getElementById('dl-toast');
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add('is-visible');
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 3400);
}

function applyTheme(theme) {
  const root = document.documentElement;
  const icon = document.getElementById('theme-icon');
  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
    if (icon) {
      icon.innerHTML =
        '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    }
  } else {
    root.removeAttribute('data-theme');
    if (icon) {
      icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    }
  }
}

function initTheme() {
  const saved = (() => {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch {
      return null;
    }
  })();
  applyTheme(saved || 'light');
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Ignore storage failures
    }
  });
}

function initOrbitalCanvas() {
  const canvas = document.getElementById('orbital-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let angle = 0;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const drawFrame = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const cx = w * 0.5;
    const cy = h * 0.52;
    const maxR = Math.max(w, h) * 0.62;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    ctx.clearRect(0, 0, w, h);

    const rings = [0.22, 0.34, 0.48, 0.64, 0.82, 1.0];
    rings.forEach((ratio, idx) => {
      const r = maxR * ratio;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = isDark ? 'rgba(242,241,238,0.08)' : 'rgba(16,16,20,0.09)';
      ctx.lineWidth = 1;
      ctx.stroke();

      const start = angle * (idx % 2 === 0 ? 1 : -0.75) + idx * 1.1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, start + 0.85);
      ctx.strokeStyle = isDark ? 'rgba(242,241,238,0.34)' : 'rgba(16,16,20,0.38)';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      const px = cx + Math.cos(start + 0.85) * r;
      const py = cy + Math.sin(start + 0.85) * r;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = idx % 2 === 0 ? '#2f7bf5' : '#02c487';
      ctx.fill();
    });

    if (!reduced) {
      angle += 0.0022;
      window.requestAnimationFrame(drawFrame);
    }
  };

  resize();
  window.addEventListener('resize', resize);
  drawFrame();
}

function applyPrimaryAsset(primaryKey, assetMap) {
  const cfg = DEFAULT_ASSETS[primaryKey] || DEFAULT_ASSETS['win-exe'];
  const url = assetMap[primaryKey]?.url || `${LATEST_DOWNLOAD_BASE}/${cfg.filename}`;
  const filename = assetMap[primaryKey]?.filename || cfg.filename;
  const tag = assetMap._tag || 'v0.1.0';

  const heroBtn = document.getElementById('hero-dl-main');
  const heroLabel = document.getElementById('hero-dl-label');
  const navBtn = document.getElementById('nav-primary-dl');
  const strip = document.getElementById('hero-os-strip');

  if (heroBtn) {
    heroBtn.setAttribute('href', url);
    heroBtn.setAttribute('download', filename);
  }
  if (heroLabel) {
    heroLabel.textContent = cfg.label;
  }
  if (navBtn) {
    navBtn.setAttribute('href', url);
    navBtn.setAttribute('download', filename);
  }
  if (strip) {
    strip.innerHTML = `${cfg.strip} · <span data-release-tag>${tag}</span>`;
  }
}

function bindDownloadTracking() {
  document.querySelectorAll('a[data-asset-key], #hero-dl-main, #nav-primary-dl').forEach((link) => {
    link.addEventListener('click', () => {
      const name = link.getAttribute('download') || 'instalador';
      showToast(`Iniciando download direto: ${name}`);
    });
  });
}

function setupMenusAndTabs() {
  const splitToggle = document.getElementById('split-toggle');
  const splitMenu = document.getElementById('split-menu');
  splitToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = splitMenu?.classList.toggle('is-open');
    splitToggle.setAttribute('aria-expanded', String(Boolean(open)));
  });

  document.addEventListener('click', () => {
    splitMenu?.classList.remove('is-open');
    splitToggle?.setAttribute('aria-expanded', 'false');
  });

  document.querySelectorAll('[data-view-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-view-tab');
      if (!tab) return;
      document.querySelectorAll('[data-view-tab]').forEach((el) => {
        el.setAttribute('aria-selected', String(el.getAttribute('data-view-tab') === tab));
      });
      document.querySelectorAll('[data-view-panel]').forEach((panel) => {
        panel.classList.toggle('is-active', panel.getAttribute('data-view-panel') === tab);
      });
    });
  });

  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const val = btn.getAttribute('data-copy');
      if (!val) return;
      try {
        await navigator.clipboard.writeText(val);
        showToast('Copiado para a área de transferência');
      } catch {
        // Ignore clipboard errors
      }
    });
  });

  window.addEventListener('scroll', () => {
    const bar = document.getElementById('ruler-progress');
    if (!bar) return;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const pct = Math.min(1, Math.max(0, window.scrollY / maxScroll));
    const maxTravel = Math.max(40, window.innerHeight - 64);
    bar.style.transform = `translateY(${Math.round(pct * maxTravel)}px)`;
  });
}

async function resolveLiveRelease(primaryKey) {
  let release = null;
  try {
    const cachedRaw = sessionStorage.getItem(CACHE_KEY);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (Date.now() - cached.savedAt < 5 * 60 * 1000) {
        release = cached.data;
      }
    }
  } catch {
    // Ignore storage failures
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
          // Ignore storage failures
        }
      }
    } catch {
      // Offline or blocked
    }
  }

  if (!release || !Array.isArray(release.assets)) return;

  const tag = release.tag_name || 'v0.1.0';
  document.querySelectorAll('[data-release-tag]').forEach((el) => {
    el.textContent = tag;
  });

  const resolvedMap = { _tag: tag };
  Object.entries(DEFAULT_ASSETS).forEach(([key, cfg]) => {
    const found = release.assets.find((a) => cfg.matcher(a.name || ''));
    if (found) {
      resolvedMap[key] = {
        url: found.browser_download_url,
        filename: found.name,
        size: found.size,
      };
      document.querySelectorAll(`a[data-asset-key="${key}"]`).forEach((link) => {
        link.setAttribute('href', found.browser_download_url);
        link.setAttribute('download', found.name);
      });
      const sizeEl = document.querySelector(`[data-asset-size="${key}"]`);
      if (sizeEl && found.size) {
        const mb = formatSizeMb(found.size);
        const suffix = key === 'win-exe' ? '.EXE' : key === 'win-msi' ? '.MSI' : key === 'android-apk' ? '.APK' : 'APPIMAGE';
        sizeEl.textContent = `${suffix} · ${mb}`;
      }
    }
  });

  applyPrimaryAsset(primaryKey, resolvedMap);

  const statusText = document.getElementById('release-status-text');
  const summaryEl = document.querySelector('[data-release-summary]');
  if (statusText) {
    statusText.innerHTML = `Release <strong>${tag}</strong> online com download direto para Windows, Linux e Android (${release.assets.length} arquivos).`;
  }
  if (summaryEl) {
    summaryEl.textContent = `${tag} · DOWNLOAD DIRETO ATIVO`;
  }
}

initTheme();
initOrbitalCanvas();
setupMenusAndTabs();
bindDownloadTracking();

const primaryKey = detectPrimaryKey();
applyPrimaryAsset(primaryKey, {});
void resolveLiveRelease(primaryKey);
