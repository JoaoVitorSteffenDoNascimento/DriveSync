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

/* Pointer-tracking spotlight illumination + subtle 3D tilt across cards */
function initSpotlightCards() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cards = Array.from(document.querySelectorAll('.spotlight-card, .metric-box'));
  for (const card of cards) {
    card.addEventListener('pointermove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--mx', `${x}px`);
      card.style.setProperty('--my', `${y}px`);
      if (!reduced && rect.width > 0 && rect.height > 0) {
        const nx = (x / rect.width - 0.5) * 2;
        const ny = (y / rect.height - 0.5) * 2;
        card.style.setProperty('--rx', `${(-ny * 4.5).toFixed(2)}deg`);
        card.style.setProperty('--ry', `${(nx * 5.2).toFixed(2)}deg`);
      }
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    });
  }
}

/* Interactive 3D Scroll Companion (travels smoothly along page scroll) */
function initScroll3DCompanion() {
  const canvas = document.getElementById('scroll-3d-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return () => {};
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const stageLabelEl = document.getElementById('companion-stage-label');
  const depthLabelEl = document.getElementById('companion-depth-label');
  const pulseBtn = document.getElementById('companion-pulse-btn');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const STAGES = [
    { at: 0.0, label: 'Núcleo 3D • Visão Geral', rgb: [59, 130, 246] },
    { at: 0.2, label: 'Núcleo 3D • Downloads', rgb: [34, 211, 238] },
    { at: 0.42, label: 'Núcleo 3D • Como Funciona', rgb: [16, 185, 129] },
    { at: 0.65, label: 'Núcleo 3D • Equipes Master', rgb: [139, 92, 246] },
    { at: 0.85, label: 'Núcleo 3D • Benefícios & Futuro', rgb: [245, 158, 11] },
  ];

  // Octahedral 3D crystal vertices & faces
  const OCT_VERTS = [
    [0, -1, 0],
    [0.95, 0, 0],
    [0, 0, 0.95],
    [-0.95, 0, 0],
    [0, 0, -0.95],
    [0, 1, 0],
  ];
  const OCT_FACES = [
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 4],
    [0, 4, 1],
    [5, 2, 1],
    [5, 3, 2],
    [5, 4, 3],
    [5, 1, 4],
  ];

  const SATELLITES = [
    { label: 'WIN', orbitR: 1.55, speed: 0.9, phase: 0, tiltX: 0.55, color: '#60a5fa' },
    { label: 'APK', orbitR: 1.78, speed: 0.72, phase: 2.1, tiltX: -0.65, color: '#34d399' },
    { label: 'LNX', orbitR: 1.65, speed: 1.05, phase: 4.2, tiltX: 0.25, color: '#22d3ee' },
  ];

  const burstParticles = [];
  let vw = window.innerWidth;
  let vh = window.innerHeight;
  let targetScroll = 0;
  let smoothScroll = 0;
  let lastScrollY = window.scrollY;
  let scrollVel = 0;
  let pulseBoost = 0;
  let time = 0;
  let lastStageText = '';
  let lastDepthPct = -1;

  const updateScrollTarget = () => {
    const curY = window.scrollY || 0;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const vel = Math.min(0.18, Math.abs(curY - lastScrollY) * 0.0008);
    scrollVel = Math.max(scrollVel, vel);
    lastScrollY = curY;
    targetScroll = Math.max(0, Math.min(1, curY / maxScroll));
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = window.innerWidth;
    vh = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(vw * dpr));
    canvas.height = Math.max(1, Math.floor(vh * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    updateScrollTarget();
  };

  const triggerBurst = () => {
    pulseBoost = 1;
    for (let i = 0; i < 16; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI;
      const spd = 0.025 + Math.random() * 0.045;
      burstParticles.push({
        x: 0,
        y: 0,
        z: 0,
        vx: Math.cos(theta) * Math.cos(phi) * spd,
        vy: Math.sin(phi) * spd,
        vz: Math.sin(theta) * Math.cos(phi) * spd,
        life: 1,
      });
    }
  };

  if (pulseBtn) {
    pulseBtn.addEventListener('click', () => {
      triggerBurst();
      showToast('Pulso 3D enviado entre os dispositivos!');
    });
  }

  const rotatePoint = ([x, y, z], rx, ry, rz) => {
    const cy = Math.cos(ry);
    const sy = Math.sin(ry);
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;

    const cx = Math.cos(rx);
    const sx = Math.sin(rx);
    const y2 = y * cx - z1 * sx;
    const z2 = y * sx + z1 * cx;

    const cz = Math.cos(rz);
    const sz = Math.sin(rz);
    const x3 = x1 * cz - y2 * sz;
    const y3 = x1 * sz + y2 * cz;

    return [x3, y3, z2];
  };

  const projectPoint = ([x, y, z], cx, cy, scale) => {
    const fov = 4.6;
    const zOffset = fov / Math.max(1.2, fov + z);
    return {
      x: cx + x * scale * zOffset,
      y: cy + y * scale * zOffset,
      z,
      scale: zOffset,
    };
  };

  const samplePalette = (p) => {
    for (let i = 0; i < STAGES.length - 1; i++) {
      const a = STAGES[i];
      const b = STAGES[i + 1];
      if (p >= a.at && p <= b.at) {
        const t = (p - a.at) / Math.max(0.001, b.at - a.at);
        return {
          label: p > a.at + (b.at - a.at) * 0.55 ? b.label : a.label,
          rgb: a.rgb.map((v, idx) => Math.round(v + (b.rgb[idx] - v) * t)),
        };
      }
    }
    const last = STAGES[STAGES.length - 1];
    return { label: last.label, rgb: last.rgb };
  };

  const drawFrame = () => {
    ctx.clearRect(0, 0, vw, vh);
    smoothScroll += (targetScroll - smoothScroll) * (reduced ? 1 : 0.085);
    scrollVel *= 0.91;
    pulseBoost *= 0.93;
    if (!reduced) {
      time += 0.016 + scrollVel * 0.35 + pulseBoost * 0.04;
    }

    const p = smoothScroll;
    const palette = samplePalette(p);
    const [r, g, b] = palette.rgb;
    const depthPct = Math.round(p * 100);
    if (stageLabelEl && lastStageText !== palette.label) {
      lastStageText = palette.label;
      stageLabelEl.textContent = palette.label;
    }
    if (depthLabelEl && lastDepthPct !== depthPct) {
      lastDepthPct = depthPct;
      depthLabelEl.textContent = `${depthPct}%`;
    }

    // Companion travels gracefully across screen edges alongside vertical scroll
    const mobile = vw < 760;
    const swing = Math.sin(p * Math.PI * 2.4 + 0.65);
    const centerX = mobile ? vw * (0.5 + swing * 0.25) : vw * (0.5 + swing * 0.36);
    const centerY = vh * (0.28 + Math.sin(p * Math.PI * 1.5) * 0.16 + p * 0.34);
    const baseScale = (mobile ? 48 : 74) * (1 + pulseBoost * 0.14);

    const rotX = 0.48 + p * Math.PI * 1.8 + Math.sin(time * 0.55) * 0.25;
    const rotY = time * 0.72 + p * Math.PI * 4.5;
    const rotZ = Math.cos(time * 0.35) * 0.22 + p * 0.9;

    // Soft ambient aura behind the 3D crystal
    const aura = ctx.createRadialGradient(centerX, centerY, 4, centerX, centerY, baseScale * 2.4);
    aura.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.24 + pulseBoost * 0.18})`);
    aura.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, 0.07)`);
    aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(centerX, centerY, baseScale * 2.4, 0, Math.PI * 2);
    ctx.fill();

    // 3 Gyroscopic 3D orbital rings
    for (let ringIdx = 0; ringIdx < 3; ringIdx++) {
      const radius = 1.32 + ringIdx * 0.22;
      const tiltA = rotX + ringIdx * 0.85;
      const tiltB = rotY * (ringIdx % 2 === 0 ? 0.65 : -0.5) + ringIdx * 1.1;
      ctx.beginPath();
      const segs = 44;
      for (let s = 0; s <= segs; s++) {
        const ang = (s / segs) * Math.PI * 2;
        const pt3 = rotatePoint([Math.cos(ang) * radius, 0, Math.sin(ang) * radius], tiltA, tiltB, rotZ);
        const pt2 = projectPoint(pt3, centerX, centerY, baseScale);
        if (s === 0) ctx.moveTo(pt2.x, pt2.y);
        else ctx.lineTo(pt2.x, pt2.y);
      }
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.28 - ringIdx * 0.06 + pulseBoost * 0.25})`;
      ctx.lineWidth = ringIdx === 0 ? 1.5 : 1;
      ctx.stroke();
    }

    // Painter-sorted 3D Crystal Faces
    const transformedVerts = OCT_VERTS.map((v) => rotatePoint(v, rotX, rotY, rotZ));
    const projectedVerts = transformedVerts.map((v) => projectPoint(v, centerX, centerY, baseScale));
    const sortedFaces = OCT_FACES.map((face) => {
      const avgZ = (transformedVerts[face[0]][2] + transformedVerts[face[1]][2] + transformedVerts[face[2]][2]) / 3;
      const light = Math.max(0.2, Math.min(1, 0.55 - avgZ * 0.45));
      return { face, avgZ, light };
    }).sort((a, bFace) => bFace.avgZ - a.avgZ);

    for (const item of sortedFaces) {
      const p0 = projectedVerts[item.face[0]];
      const p1 = projectedVerts[item.face[1]];
      const p2 = projectedVerts[item.face[2]];
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.closePath();
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(0.12 + item.light * 0.24).toFixed(3)})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(224, 242, 254, ${(0.25 + item.light * 0.45).toFixed(3)})`;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }

    // 3 Orbiting 3D Device Satellites
    for (const sat of SATELLITES) {
      const ang = time * sat.speed + sat.phase + p * Math.PI * 3;
      const sx = Math.cos(ang) * sat.orbitR;
      const sz = Math.sin(ang) * sat.orbitR;
      const sy = Math.sin(ang * 2) * 0.28;
      const rPt = rotatePoint([sx, sy, sz], rotX * 0.5 + sat.tiltX, rotY * 0.25, 0.15);
      const p2 = projectPoint(rPt, centerX, centerY, baseScale);

      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.2)`;
      ctx.lineWidth = 1;
      ctx.stroke();

      const nodeR = Math.max(4.5, 7 * p2.scale);
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, nodeR, 0, Math.PI * 2);
      ctx.fillStyle = sat.color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.font = `700 ${Math.round(9 * p2.scale)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = 'rgba(241, 245, 249, 0.85)';
      ctx.textAlign = 'center';
      ctx.fillText(sat.label, p2.x, p2.y - nodeR - 4);
    }

    // 3D Energy Burst Particles
    for (let i = burstParticles.length - 1; i >= 0; i--) {
      const pt = burstParticles[i];
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.z += pt.vz;
      pt.life -= 0.025;
      if (pt.life <= 0) {
        burstParticles.splice(i, 1);
        continue;
      }
      const p2 = projectPoint([pt.x, pt.y, pt.z], centerX, centerY, baseScale);
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, 2.5 * p2.scale * pt.life, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${pt.life.toFixed(2)})`;
      ctx.fill();
    }

    if (!reduced) {
      window.requestAnimationFrame(drawFrame);
    }
  };

  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('scroll', updateScrollTarget, { passive: true });
  drawFrame();
  if (reduced) {
    window.addEventListener('scroll', drawFrame, { passive: true });
  }

  return triggerBurst;
}

/* Interactive controls on Hero SVG & Drive Master Luiz toggle */
function initInteractiveDiagrams(trigger3DPulse) {
  const simBtns = Array.from(document.querySelectorAll('.sim-btn'));
  const heroSvg = document.getElementById('hero-sync-svg');
  const hubSub = document.getElementById('hero-hub-sub');
  const hubPillRect = document.getElementById('hero-hub-pill-rect');
  const hubPillText = document.getElementById('hero-hub-pill-text');
  const anaSub = document.getElementById('hero-ana-sub');
  const joaoSub = document.getElementById('hero-joao-sub');

  const applySimMode = (mode) => {
    simBtns.forEach((b) => b.classList.toggle('is-active', b.getAttribute('data-sim-action') === mode));
    trigger3DPulse();
    if (!heroSvg) return;

    const flowLines = heroSvg.querySelectorAll('.svg-dash-flow');
    flowLines.forEach((el) => {
      el.classList.add('svg-dash-flow--fast');
      window.setTimeout(() => el.classList.remove('svg-dash-flow--fast'), 1800);
    });

    if (mode === 'sync') {
      if (hubSub) hubSub.textContent = 'Sua conta Google Drive';
      if (hubPillRect) hubPillRect.setAttribute('fill', 'rgba(16,185,129,0.22)');
      if (hubPillText) {
        hubPillText.textContent = 'Enviando agora • Em tempo real';
        hubPillText.setAttribute('fill', '#6ee7b7');
      }
      if (anaSub) anaSub.textContent = 'Enviando fotos novas';
      if (joaoSub) joaoSub.textContent = 'Enviado por: João';
      showToast('Simulação: enviando arquivos entre todos os aparelhos!');
    } else if (mode === 'guard') {
      if (hubSub) hubSub.textContent = 'Trava automática ativada';
      if (hubPillRect) hubPillRect.setAttribute('fill', 'rgba(245,158,11,0.28)');
      if (hubPillText) {
        hubPillText.textContent = 'Arquivo 6,2 GB barrado (> 4 GB)';
        hubPillText.setAttribute('fill', '#fde68a');
      }
      showToast('Trava 4 GB: arquivo gigante bloqueado antes de gastar sua internet!');
    } else if (mode === 'team') {
      if (hubSub) hubSub.textContent = 'Grupo Drive Master ativo';
      if (hubPillRect) hubPillRect.setAttribute('fill', 'rgba(139,92,246,0.26)');
      if (hubPillText) {
        hubPillText.textContent = 'Remetente identificado por item';
        hubPillText.setAttribute('fill', '#ddd6fe');
      }
      if (anaSub) anaSub.textContent = 'Enviado por: Ana (Album.zip)';
      if (joaoSub) joaoSub.textContent = 'Recebido de: João (Contrato.pdf)';
      showToast('Drive Master: todos na pasta veem exatamente quem enviou cada arquivo!');
    }
  };

  simBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-sim-action');
      if (mode) applySimMode(mode);
    });
  });

  const NODE_MESSAGES = {
    win: 'PC Windows: seus arquivos aparecem na pasta escolhida com aviso discreto perto do relógio.',
    android: 'Celular Android: leve no bolso, sincroniza no Wi-Fi e avisa quando há atualização.',
    linux: 'Notebook Linux: compatível com AppImage, .deb, .rpm e .pacman com todos os recursos.',
    hub: 'DriveSync Hub: criptografia oficial do Google OAuth + cópia local protegida e trava de 4 GB.',
    ana: 'Ana • Notebook: compartilhando fotos novas em tempo real com autoria identificada.',
    joao: 'João • Celular: enviou documentos com etiqueta "Enviado por: João" visível na pasta.',
    guests: 'Convidados entram em 1 clique usando código simples DS-XXXX-XXXX.',
  };

  document.querySelectorAll('[data-interactive-node]').forEach((node) => {
    node.addEventListener('click', () => {
      const key = node.getAttribute('data-interactive-node') || '';
      trigger3DPulse();
      if (NODE_MESSAGES[key]) {
        showToast(NODE_MESSAGES[key]);
      }
    });
  });

  // Interactive Luiz Node inside Diagram 3 (Drive Master filter toggle!)
  const luizNode = document.getElementById('svg-node-luiz');
  if (luizNode) {
    let luizAllowed = false;
    const toggleLuiz = () => {
      luizAllowed = !luizAllowed;
      trigger3DPulse();
      const rect = document.getElementById('svg-luiz-rect');
      const avatar = document.getElementById('svg-luiz-avatar');
      const title = document.getElementById('svg-luiz-title');
      const sub = document.getElementById('svg-luiz-sub');
      const arrow = document.getElementById('svg-path-luiz');
      const sum2 = document.getElementById('svg-master-summary-2');

      if (luizAllowed) {
        if (rect) {
          rect.setAttribute('stroke', '#10b981');
          rect.removeAttribute('stroke-dasharray');
        }
        if (avatar) avatar.setAttribute('fill', '#059669');
        if (title) title.textContent = 'Luiz (Aceito • Clique para pausar)';
        if (sub) {
          sub.textContent = 'Recebendo arquivos dele também';
          sub.setAttribute('fill', '#6ee7b7');
        }
        if (arrow) {
          arrow.setAttribute('stroke', '#34d399');
          arrow.removeAttribute('stroke-dasharray');
          arrow.setAttribute('marker-end', 'url(#g-green)');
          arrow.classList.add('svg-dash-flow');
        }
        if (sum2) sum2.textContent = 'de João, Ana e Luiz, mostrando';
        showToast('Luiz liberado no exemplo! Agora os arquivos dele descem para o seu PC.');
      } else {
        if (rect) {
          rect.setAttribute('stroke', '#ef4444');
          rect.setAttribute('stroke-dasharray', '4 3');
        }
        if (avatar) avatar.setAttribute('fill', '#b91c1c');
        if (title) title.textContent = 'Luiz (Pausado • Clique aqui)';
        if (sub) {
          sub.textContent = 'Arquivos dele não descem no PC';
          sub.setAttribute('fill', '#fca5a5');
        }
        if (arrow) {
          arrow.setAttribute('stroke', '#f87171');
          arrow.setAttribute('stroke-dasharray', '4 3');
          arrow.setAttribute('marker-end', 'url(#g-red)');
          arrow.classList.remove('svg-dash-flow');
        }
        if (sum2) sum2.textContent = 'de João e Ana, mostrando';
        showToast('Luiz pausado no exemplo! Os arquivos dele ficam isolados no Drive.');
      }
    };

    luizNode.addEventListener('click', toggleLuiz);
    luizNode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleLuiz();
      }
    });
  }
}

function applyDetectedOS(os, resolvedAssets = {}) {
  const primaryKey = primaryKeyForOS(os);
  const cfg = PLATFORM_ASSETS[primaryKey];
  const resolved = resolvedAssets[primaryKey];
  const url = resolved?.url || `${LATEST_DOWNLOAD_BASE}/${cfg.filename}`;
  const filename = resolved?.filename || cfg.filename;
  const tag = resolvedAssets._tag || 'v0.5.0';

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

  const tag = release.tag_name || 'v0.5.0';
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
const trigger3DPulse = initScroll3DCompanion();
initInteractiveDiagrams(trigger3DPulse);
bindInteractions();
applyDetectedOS(currentOS);
void resolveLatestRelease(currentOS);
