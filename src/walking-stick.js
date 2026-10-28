import { escapeHtml as e } from './ui.js';
import { createRng } from './postcard.js';

export const STICK_HEADS = Object.freeze([
  { id: 'shepherd', label: 'Pastýřská', icon: '🦯', desc: 'Tradiční zakřivená pastýřská rukojeť' },
  { id: 'fork', label: 'Horalská rozsocha', icon: '🔱', desc: 'Dvojitá přírodní rozsocha horských vůdců' },
  { id: 'crystal', label: 'S krystalem', icon: '💎', desc: 'Horský křišťál zasazený v tepané objímce' },
  { id: 'falcon', label: 'Hlava sokola', icon: '🦅', desc: 'Vyřezávaná hlava dravce s bystrým zrakem' },
]);

export const STICK_WOODS = Object.freeze([
  {
    id: 'oak',
    label: 'Dub',
    color: '#5d4037',
    capColor: '#78909c',
    highlight: '#8d6e63',
    shadow: '#2e1c14',
    leather: '#3e2723',
    gradient: 'linear-gradient(90deg, #3e2723 0%, #795548 25%, #a1887f 45%, #5d4037 75%, #2e1c14 100%)',
    desc: 'Hluboké a tvrdé dubové dřevo z brdských hvozdů',
  },
  {
    id: 'walnut',
    label: 'Ořech',
    color: '#3e2723',
    capColor: '#ffd700',
    highlight: '#5d4037',
    shadow: '#1b0c03',
    leather: '#271406',
    gradient: 'linear-gradient(90deg, #1b0c03 0%, #3e2723 25%, #5d4037 45%, #3e2723 75%, #140801 100%)',
    desc: 'Tmavé ušlechtilé ořechové dřevo s hedvábným leskem',
  },
  {
    id: 'birch',
    label: 'Bříza',
    color: '#d7ccc8',
    capColor: '#607d8b',
    highlight: '#ffffff',
    shadow: '#8d6e63',
    leather: '#5d4037',
    gradient: 'linear-gradient(90deg, #8d6e63 0%, #cfd8dc 25%, #ffffff 45%, #eceff1 70%, #78909c 100%)',
    desc: 'Světlé houževnaté březové dřevo s jemnou kresbou',
  },
  {
    id: 'larch',
    label: 'Modřín',
    color: '#8d6e63',
    capColor: '#b87333',
    highlight: '#bcaaa4',
    shadow: '#4e342e',
    leather: '#4e342e',
    gradient: 'linear-gradient(90deg, #4e342e 0%, #8d6e63 25%, #d7ccc8 45%, #a1887f 75%, #3e2723 100%)',
    desc: 'Pryskyřičnatý červenavý horský modřín s vysokou pružností',
  },
]);

export const WALKING_STICK_TIERS = Object.freeze([
  {
    id: 'leskova',
    minScore: 0,
    title: 'Lísková hůl poutníka',
    subtitle: 'Pevná lísková větev seříznutá u cesty',
    woodColor: '#8d6e63',
    capColor: '#4e342e',
    accentColor: '#bcaaa4',
  },
  {
    id: 'bukova',
    minScore: 200,
    title: 'Buková hůl s koženým řemínkem',
    subtitle: 'Hladce opracovaný lesní buk s koženým poutkem',
    woodColor: '#a1887f',
    capColor: '#6d4c41',
    accentColor: '#d7ccc8',
  },
  {
    id: 'dubova',
    minScore: 600,
    title: 'Vyřezávaná dubová hůl s kovovým hrotem',
    subtitle: 'Dubové dřevo s ornamenty a kovanou špičkou',
    woodColor: '#5d4037',
    capColor: '#78909c',
    accentColor: '#cfd8dc',
  },
  {
    id: 'strazce-brd',
    minScore: 1200,
    title: 'Mistrovská hůl Strážce Brd s mosaznou hlavicí',
    subtitle: 'Tmavé leštěné dřevo s tepanou mosaznou rukojetí',
    woodColor: '#3e2723',
    capColor: '#ffd700',
    accentColor: '#ffe082',
  },
]);

export const BADGE_SHAPES = Object.freeze(['shield', 'crest', 'oval', 'hex']);
export const BADGE_METALS = Object.freeze(['copper', 'brass', 'silver', 'enamel']);

const COMPANION_ICONS = Object.freeze({
  solo: '🥾',
  dog: '🐕',
  stroller: '👶',
  family: '👨‍👩‍👧',
});

export function getWalkingStickTier(score = 0) {
  const pts = Number(score) || 0;
  let currentTier = WALKING_STICK_TIERS[0];
  for (const tier of WALKING_STICK_TIERS) {
    if (pts >= tier.minScore) {
      currentTier = tier;
    }
  }
  return currentTier;
}

export function validateStickCustomization(raw = {}) {
  const headIds = new Set(STICK_HEADS.map(h => h.id));
  const woodIds = new Set(STICK_WOODS.map(w => w.id));

  const rawHead = raw?.headId || raw?.head;
  const rawWood = raw?.woodId || raw?.wood;

  const head = headIds.has(rawHead) ? rawHead : 'shepherd';
  const wood = woodIds.has(rawWood) ? rawWood : 'oak';
  const viewMode = raw?.viewMode === 'clean' ? 'clean' : 'badges';

  return {
    head,
    wood,
    headId: head,
    woodId: wood,
    viewMode,
  };
}

export function createStickBadge({
  expId = '',
  distanceMeters = 0,
  stampsCount = 0,
  companionMode = 'solo',
  categories = [],
  createdAt = new Date().toISOString(),
}) {
  const rng = createRng(expId || String(Date.now()));

  const shapeIndex = Math.floor(rng() * BADGE_SHAPES.length);
  const shape = BADGE_SHAPES[shapeIndex];

  let metal = 'copper';
  const mRand = rng();
  if (stampsCount >= 3 || distanceMeters >= 5000) {
    metal = mRand > 0.5 ? 'silver' : 'enamel';
  } else if (stampsCount >= 1 || distanceMeters >= 2000) {
    metal = mRand > 0.4 ? 'brass' : 'silver';
  } else {
    metal = mRand > 0.5 ? 'brass' : 'copper';
  }

  let areaLabel = 'Rožmitálsko · Toulky krajem';
  if (categories.includes('forest') && categories.includes('view')) {
    areaLabel = 'Brdské hřebeny · Lesní výprava';
  } else if (categories.includes('forest')) {
    areaLabel = 'Rožmitálsko · Lesní výprava';
  } else if (categories.includes('views')) {
    areaLabel = 'Třemšínsko · Vrcholová stezka';
  } else if (categories.includes('water')) {
    areaLabel = 'Rožmitálsko · Vodní okruh';
  } else if (categories.includes('culture') || categories.includes('sacral')) {
    areaLabel = 'Rožmitál · Historická stezka';
  }

  const id = `badge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    expId: String(expId || 'exp'),
    shape,
    metal,
    areaLabel,
    distanceMeters: Math.max(0, Math.round(Number(distanceMeters) || 0)),
    stampsCount: Math.max(0, Math.round(Number(stampsCount) || 0)),
    companionMode: ['solo', 'dog', 'stroller', 'family'].includes(companionMode) ? companionMode : 'solo',
    pinned: false,
    createdAt: String(createdAt),
  };
}

export function renderStickBadgeSvg(badge, options = {}) {
  const b = badge || {};
  const width = options.width || 120;
  const height = options.height || 64;
  const companionIcon = COMPANION_ICONS[b.companionMode] || '🥾';
  const distKm = b.distanceMeters >= 1000 ? `${(b.distanceMeters / 1000).toFixed(1)} km` : `${b.distanceMeters || 0} m`;
  const stampsText = b.stampsCount > 0 ? `${b.stampsCount} razítko` : 'Cesta';
  const metal = b.metal || 'brass';
  const shape = b.shape || 'shield';

  let fillDef = '';
  let textColor = '#2a1e12';
  let borderColor = '#6c4a1e';
  let nailColor = '#3a2a1b';

  if (metal === 'copper') {
    fillDef = `
      <linearGradient id="g_${b.id}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#d48a56"/>
        <stop offset="35%" stop-color="#f0b284"/>
        <stop offset="70%" stop-color="#bf703d"/>
        <stop offset="100%" stop-color="#914d24"/>
      </linearGradient>`;
    borderColor = '#5f2e12';
    textColor = '#351608';
  } else if (metal === 'silver') {
    fillDef = `
      <linearGradient id="g_${b.id}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#bdc3c7"/>
        <stop offset="35%" stop-color="#ffffff"/>
        <stop offset="70%" stop-color="#bdc3c7"/>
        <stop offset="100%" stop-color="#7f8c8d"/>
      </linearGradient>`;
    borderColor = '#4a555c';
    textColor = '#22292e';
    nailColor = '#22292e';
  } else if (metal === 'enamel') {
    fillDef = `
      <linearGradient id="g_${b.id}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#215241"/>
        <stop offset="40%" stop-color="#2d6a54"/>
        <stop offset="100%" stop-color="#14362b"/>
      </linearGradient>`;
    borderColor = '#d4af37';
    textColor = '#f4f6e6';
    nailColor = '#ffd700';
  } else {
    fillDef = `
      <linearGradient id="g_${b.id}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#e0be62"/>
        <stop offset="35%" stop-color="#fff1b0"/>
        <stop offset="70%" stop-color="#c99c35"/>
        <stop offset="100%" stop-color="#8c6819"/>
      </linearGradient>`;
    borderColor = '#5e430c';
    textColor = '#3b2904';
  }

  let pathD = '';
  if (shape === 'shield') {
    pathD = `M 6,4 Q ${width / 2},0 ${width - 6},4 Q ${width - 2},${height * 0.65} ${width / 2},${height - 2} Q 2,${height * 0.65} 6,4 Z`;
  } else if (shape === 'crest') {
    pathD = `M 8,3 Q ${width / 2},7 ${width - 8},3 Q ${width - 2},${height / 2} ${width - 8},${height - 3} Q ${width / 2},${height - 7} 8,${height - 3} Q 2,${height / 2} 8,3 Z`;
  } else if (shape === 'hex') {
    pathD = `M 12,3 L ${width - 12},3 L ${width - 2},${height / 2} L ${width - 12},${height - 3} L 12,${height - 3} L 2,${height / 2} Z`;
  } else {
    pathD = `M 14,3 Q ${width / 2},1 ${width - 14},3 Q ${width - 2},${height / 2} ${width - 14},${height - 3} Q ${width / 2},${height - 1} 14,${height - 3} Q 2,${height / 2} 14,3 Z`;
  }

  return `
    <svg class="stick-badge-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Štítek: ${e(b.areaLabel)}">
      <defs>
        ${fillDef}
        <filter id="sh_${b.id}" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1" flood-opacity="0.35"/>
        </filter>
      </defs>
      <path d="${pathD}" fill="url(#g_${b.id})" stroke="${borderColor}" stroke-width="1.6" filter="url(#sh_${b.id})"/>
      <path d="${pathD}" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.8" transform="scale(0.92) translate(${width * 0.04}, ${height * 0.04})"/>
      <circle cx="${width / 2}" cy="5" r="1.7" fill="${nailColor}" stroke="rgba(255,255,255,0.6)" stroke-width="0.6"/>
      <circle cx="${width / 2}" cy="${height - 5}" r="1.7" fill="${nailColor}" stroke="rgba(255,255,255,0.6)" stroke-width="0.6"/>
      <text x="${width / 2}" y="19" font-family="Georgia, serif" font-size="7.5" font-weight="bold" fill="${textColor}" text-anchor="middle" letter-spacing="0.2">
        ${e(b.areaLabel)}
      </text>
      <text x="${width / 2}" y="36" font-family="system-ui, sans-serif" font-size="11" font-weight="800" fill="${textColor}" text-anchor="middle">
        ${companionIcon} ${e(distKm)}
      </text>
      <text x="${width / 2}" y="49" font-family="system-ui, sans-serif" font-size="7" font-weight="600" fill="${textColor}" opacity="0.85" text-anchor="middle">
        ${e(stampsText)}
      </text>
    </svg>
  `.trim();
}

/**
 * Vykreslí vícevrstvou prostorově stínovanou SVG ilustraci hole s koženým opletem,
 * vybranou hlavicí a kovovými štítky (DÁVKA 4).
 */
export function renderWalkingStickSvg(customization = {}, pinnedBadges = [], options = {}) {
  const { head = 'shepherd', wood = 'oak', viewMode = 'badges' } = customization;
  const woodMeta = STICK_WOODS.find(w => w.id === wood) || STICK_WOODS[0];
  const width = options.width || 240;
  const height = options.height || 480;
  const isClean = viewMode === 'clean';
  const badgesToRender = isClean ? [] : pinnedBadges;

  // SVG hlavičky podle zvoleného tvaru
  let headSvg = '';
  if (head === 'fork') {
    // Horalská rozsocha
    headSvg = `
      <g class="stick-head-shape head-fork">
        <!-- Spodní prstenec rozsochy -->
        <rect x="94" y="58" width="52" height="14" rx="4" fill="${woodMeta.capColor}" stroke="#1f140a" stroke-width="2"/>
        <!-- Levé a pravé rameno rozsochy -->
        <path d="M 104,60 C 90,44 76,28 82,10 C 86,22 106,42 114,56 Z" fill="url(#woodCylinderGrad)" stroke="#1a0f05" stroke-width="2"/>
        <path d="M 136,60 C 150,44 164,28 158,10 C 154,22 134,42 126,56 Z" fill="url(#woodCylinderGrad)" stroke="#1a0f05" stroke-width="2"/>
        <!-- Mosazné špičky rozsochy -->
        <circle cx="82" cy="10" r="5" fill="#d4af37" stroke="#3d2a08" stroke-width="1.5"/>
        <circle cx="158" cy="10" r="5" fill="#d4af37" stroke="#3d2a08" stroke-width="1.5"/>
      </g>
    `;
  } else if (head === 'crystal') {
    // S horským krystalem v mosazné objímce
    headSvg = `
      <g class="stick-head-shape head-crystal">
        <!-- Horský krystal -->
        <polygon points="120,4 138,20 132,44 120,52 108,44 102,20" fill="url(#crystalGrad)" stroke="#e0f2fe" stroke-width="1.5" filter="url(#stickGlow)"/>
        <line x1="120" y1="4" x2="120" y2="52" stroke="#ffffff" stroke-width="1" opacity="0.7"/>
        <line x1="102" y1="20" x2="138" y2="20" stroke="#ffffff" stroke-width="1" opacity="0.6"/>
        <!-- Mosazná kovaná koruna objímky -->
        <path d="M 96,48 L 102,36 L 108,48 L 120,38 L 132,48 L 138,36 L 144,48 L 142,62 L 98,62 Z" fill="#d4af37" stroke="#3d2a08" stroke-width="2"/>
      </g>
    `;
  } else if (head === 'falcon') {
    // Hlava sokola
    headSvg = `
      <g class="stick-head-shape head-falcon">
        <!-- Vyřezávaná hlava dravce -->
        <path d="M 104,60 C 94,48 96,26 112,14 C 126,6 142,10 148,22 C 152,30 162,32 168,36 C 158,40 148,46 142,48 C 138,58 126,62 104,60 Z" fill="url(#woodCylinderGrad)" stroke="#1a0f05" stroke-width="2"/>
        <!-- Zahnutý zobák sokola -->
        <path d="M 148,22 C 160,26 166,32 168,36 C 158,40 152,36 148,34 Z" fill="#d4af37" stroke="#3d2a08" stroke-width="1.5"/>
        <!-- Oko sokola -->
        <circle cx="132" cy="22" r="3.5" fill="#ffd700" stroke="#000000" stroke-width="1.2"/>
        <circle cx="132" cy="22" r="1.5" fill="#000000"/>
        <!-- Mosazný prstenec pod hlavou -->
        <rect x="100" y="58" width="40" height="8" rx="2" fill="#d4af37" stroke="#3d2a08" stroke-width="1.5"/>
      </g>
    `;
  } else {
    // Tradiční pastýřská rukojeť
    headSvg = `
      <g class="stick-head-shape head-shepherd">
        <!-- Zakřivený pastýřský oblouk -->
        <path d="M 106,62 C 104,42 98,24 112,12 C 128,0 158,4 162,26 C 166,44 144,48 140,36 C 136,28 144,22 148,22 C 146,14 132,12 122,20 C 114,28 118,44 122,62 Z" fill="url(#woodCylinderGrad)" stroke="#1a0f05" stroke-width="2"/>
        <!-- Kovaný horní lem -->
        <rect x="102" y="58" width="36" height="8" rx="3" fill="${woodMeta.capColor}" stroke="#1f140a" stroke-width="1.5"/>
      </g>
    `;
  }

  // Kožený oplet rukojeti (cross-laced leather grip)
  const gripSvg = `
    <g class="stick-leather-grip">
      <rect x="104" y="70" width="32" height="74" rx="4" fill="${woodMeta.leather}" stroke="#1f140a" stroke-width="1.5"/>
      <!-- Křížové stehy koženého řemínku -->
      <line x1="104" y1="74" x2="136" y2="88" stroke="rgba(255,255,255,0.45)" stroke-width="2"/>
      <line x1="136" y1="74" x2="104" y2="88" stroke="rgba(0,0,0,0.4)" stroke-width="2"/>
      <line x1="104" y1="92" x2="136" y2="106" stroke="rgba(255,255,255,0.45)" stroke-width="2"/>
      <line x1="136" y1="92" x2="104" y2="106" stroke="rgba(0,0,0,0.4)" stroke-width="2"/>
      <line x1="104" y1="110" x2="136" y2="124" stroke="rgba(255,255,255,0.45)" stroke-width="2"/>
      <line x1="136" y1="110" x2="104" y2="124" stroke="rgba(0,0,0,0.4)" stroke-width="2"/>
      <line x1="104" y1="128" x2="136" y2="142" stroke="rgba(255,255,255,0.45)" stroke-width="2"/>
      <line x1="136" y1="128" x2="104" y2="142" stroke="rgba(0,0,0,0.4)" stroke-width="2"/>
      <!-- Mosazné kroužky na koncích opletu -->
      <rect x="103" y="68" width="34" height="4" rx="1.5" fill="#d4af37" stroke="#3d2a08" stroke-width="1"/>
      <rect x="103" y="142" width="34" height="4" rx="1.5" fill="#d4af37" stroke="#3d2a08" stroke-width="1"/>
    </g>
  `;

  // Kovaný hrot na spodku hole
  const tipSvg = `
    <g class="stick-iron-tip">
      <path d="M 108,446 L 132,446 L 126,474 L 114,474 Z" fill="#2d3748" stroke="#1a202c" stroke-width="2"/>
      <line x1="120" y1="446" x2="120" y2="472" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/>
      <rect x="106" y="442" width="28" height="5" rx="1" fill="#718096" stroke="#1a202c" stroke-width="1"/>
    </g>
  `;

  return `
    <svg class="walking-stick-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Turistická hůl: ${e(woodMeta.label)}, hlavice ${e(head)}">
      <defs>
        <!-- 3D válcový přechod dřeva se světlem a stínem -->
        <linearGradient id="woodCylinderGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${woodMeta.shadow}"/>
          <stop offset="25%" stop-color="${woodMeta.color}"/>
          <stop offset="42%" stop-color="${woodMeta.highlight}"/>
          <stop offset="55%" stop-color="${woodMeta.color}"/>
          <stop offset="85%" stop-color="${woodMeta.color}"/>
          <stop offset="100%" stop-color="${woodMeta.shadow}"/>
        </linearGradient>

        <!-- Krystalový zářivý přechod -->
        <linearGradient id="crystalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="35%" stop-color="#bae6fd"/>
          <stop offset="70%" stop-color="#38bdf8"/>
          <stop offset="100%" stop-color="#0284c7"/>
        </linearGradient>

        <filter id="stickShadow" x="-20%" y="-10%" width="140%" height="120%">
          <feDropShadow dx="4" dy="8" stdDeviation="6" flood-opacity="0.32"/>
        </filter>

        <filter id="stickGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
      </defs>

      <g filter="url(#stickShadow)">
        <!-- Hlavní dřevěné tělo hole s mírným zúžením dolů -->
        <path d="M 106,62 L 134,62 L 131,446 L 109,446 Z" fill="url(#woodCylinderGrad)" stroke="#1a0f05" stroke-width="2"/>
        
        <!-- Přirozené léta dřeva (jemné podélné linie) -->
        <path d="M 116,66 Q 114,240 117,442" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1.2"/>
        <path d="M 124,66 Q 126,260 123,442" fill="none" stroke="rgba(0,0,0,0.28)" stroke-width="1.2"/>

        <!-- Kožený oplet pro ruku -->
        ${gripSvg}

        <!-- Kovaný hrot hole -->
        ${tipSvg}

        <!-- Hlavice hole -->
        ${headSvg}

        <!-- Přibité plechové štítky na těle hole -->
        ${badgesToRender.length > 0 ? `
          <g class="stick-pinned-badges-layer">
            ${badgesToRender.slice(0, 6).map((b, idx) => {
              const yPos = 160 + idx * 46;
              const rot = (idx % 2 === 0 ? -1.2 : 1.4) * ((idx % 3) + 0.6);
              return `
                <g transform="translate(60, ${yPos}) rotate(${rot} 60 25)" class="pinned-stick-badge-item">
                  ${renderStickBadgeSvg(b, { width: 120, height: 50 })}
                </g>
              `;
            }).join('')}
          </g>
        ` : ''}
      </g>
    </svg>
  `.trim();
}

/**
 * Vykreslí kompletní rozhraní hole v Mém pasu s přepínači hlavice, dřeva a zobrazení odznaků (DÁVKA 4).
 */
export function renderWalkingStickHtml(stateObj, actions = {}) {
  const s = stateObj || {};
  const badges = Array.isArray(s.stickBadges) ? s.stickBadges : [];
  const pinnedBadges = badges.filter(b => b.pinned);
  const unpinnedBadges = badges.filter(b => !b.pinned);

  const customization = validateStickCustomization(s.stickCustomization);
  const c = Array.isArray(s.cells) ? s.cells.length : 0;
  const m = Number(s.meters) || 0;
  const d = Array.isArray(s.discoveries) ? s.discoveries.length : 0;
  const pts = (Number(s.legacyScore) || 0) + 10 * c + Math.floor(m / 50) + 25 * Math.floor(c / 6) + 30 * d;
  const tier = getWalkingStickTier(pts);
  const woodMeta = STICK_WOODS.find(w => w.id === customization.wood) || STICK_WOODS[0];

  return `
    <div class="walking-stick-section" id="walking-stick-customizer">
      <div class="stick-tier-banner" style="border-left: 5px solid ${woodMeta.capColor}">
        <div>
          <span class="eyebrow">Virtuální turistická hůl</span>
          <h3 class="stick-tier-title">${e(tier.title)}</h3>
          <p class="small-note">${e(tier.subtitle)} · Dřevo: <strong>${e(woodMeta.label)}</strong> · Hlavice: <strong>${e(STICK_HEADS.find(h => h.id === customization.head)?.label || 'Pastýřská')}</strong></p>
        </div>
        <div class="stick-badge-count-pill">
          <strong>${pinnedBadges.length}</strong>
          <span>přibitých štítků</span>
        </div>
      </div>

      <!-- Přizpůsobení hole: Hlavice, Odstín dřeva a Režim zobrazení (DÁVKA 4) -->
      <div class="stick-customizer-card">
        <div class="stick-customizer-group">
          <span class="sc-label">Tvar hlavice hole:</span>
          <div class="stick-chip-row" role="radiogroup" aria-label="Tvar hlavice">
            ${STICK_HEADS.map(h => `
              <button type="button" class="stick-custom-chip ${customization.head === h.id ? 'is-active' : ''}" data-stick-head="${e(h.id)}" role="radio" aria-checked="${customization.head === h.id}">
                ${e(h.icon)} ${e(h.label)}
              </button>
            `).join('')}
          </div>
        </div>

        <div class="stick-customizer-group" style="margin-top:10px">
          <span class="sc-label">Odstín a druh dřeva:</span>
          <div class="stick-chip-row" role="radiogroup" aria-label="Druh dřeva">
            ${STICK_WOODS.map(w => `
              <button type="button" class="stick-custom-chip ${customization.wood === w.id ? 'is-active' : ''}" data-stick-wood="${e(w.id)}" role="radio" aria-checked="${customization.wood === w.id}">
                <span class="wood-color-dot" style="background:${e(w.color)}"></span> ${e(w.label)}
              </button>
            `).join('')}
          </div>
        </div>

        <div class="stick-customizer-group" style="margin-top:10px">
          <span class="sc-label">Zobrazení štítků:</span>
          <div class="stick-chip-row" role="radiogroup" aria-label="Režim zobrazení">
            <button type="button" class="stick-custom-chip ${customization.viewMode === 'badges' ? 'is-active' : ''}" data-stick-view="badges" role="radio" aria-checked="${customization.viewMode === 'badges'}">
              🔨 S odznaky (${pinnedBadges.length})
            </button>
            <button type="button" class="stick-custom-chip ${customization.viewMode === 'clean' ? 'is-active' : ''}" data-stick-view="clean" role="radio" aria-checked="${customization.viewMode === 'clean'}">
              ✨ Čistá hůl (pouze dřevo a rukojeť)
            </button>
          </div>
        </div>
      </div>

      ${unpinnedBadges.length > 0 ? `
        <div class="unpinned-badges-box">
          <div class="unpinned-header">
            <strong>🔨 Nové štítky k přibití (${unpinnedBadges.length}):</strong>
            <span class="small-note">Klepni na „Přibít na hůl“ a připevni si získaný plechový štítek ze své výpravy</span>
          </div>
          <div class="unpinned-badges-grid">
            ${unpinnedBadges.map(b => `
              <div class="unpinned-badge-card" data-badge-id="${e(b.id)}">
                <div class="badge-preview-slot">
                  ${renderStickBadgeSvg(b, { width: 110, height: 58 })}
                </div>
                <button type="button" class="button small hammer-badge-btn" data-action="hammer-badge" data-badge-id="${e(b.id)}">
                  🔨 Přibít na hůl
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Výstavní plocha vybrané hole s jemným prostorovým náklonem a floating animací -->
      <div class="stick-showcase">
        <div class="stick-float-wrap">
          ${renderWalkingStickSvg(customization, pinnedBadges, { width: 240, height: 480 })}
        </div>
      </div>
    </div>
  `;
}