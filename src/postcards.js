/**
 * Czekpoint v1.4-part3 — Pohlednice z výpravy („Vzpomínka na procházku“)
 *
 * DÁVKA 3:
 * - 3 vizuální motivy pohlednice podle zvoleného herního stylu:
 *   1. `explorer` (`🧭 Objevování`)
 *   2. `gamified` (`📜 Výprava s pergamenem`)
 *   3. `casual` (`🗺️ Turistická mapa`)
 * - Koláž z fotek potvrzených míst + Vlastní uložené symboly (`✨ Moje malé objevy`: 🌳, 🌄, 🍃, 💧, 🐾, 🔎).
 * - Mini-mapa skutečně prošlých segmentů (`walkSegments` se zachováním případných výpadků GPS),
 *   bod `🟢 Start`, `🏁 Konec` a počet nově odkrytých dílků mapy (`+X dílků`).
 * - Pravdivé statistiky: ušlá vzdálenost, čistý aktivní čas, `👣 Odhad kroků: ~X` a `📈 Odhad převýšení`
 *   (nebo `nedostupné`, pokud chybí výšková data).
 * - Ochrana soukromí domova (`trimTrackForHomePrivacy`): při zapnutém přepínači ořízne prvních
 *   a posledních 150 metrů trasy a skryje přesné časy průchodu.
 */

import { haversineMeters } from './domain.js';
import { generateCategoryPlaceSvgDataUrl } from './place-photos.js';
import { formatPostcardDistance, renderPostcard as renderCanvasPostcard } from './postcard.js';

export const POSTCARD_THEMES = Object.freeze({
  explorer: {
    id: 'explorer',
    label: '🧭 Objevování',
    badge: '🧭 MOTIV: OBJEVOVÁNÍ KRAJINY',
    bgStart: '#f4ebd9',
    bgMid: '#eadbc0',
    bgEnd: '#dcc7a1',
    borderOuter: '#1c3329',
    borderInner: '#c4a668',
    headerInk: '#1b3026',
    subInk: '#5c4b32',
    divider: '#b39762',
    cardBg: '#fdfaf2',
    cardBorder: '#cbb78c',
    accentBg: '#f3e5c2',
    accentBorder: '#b8862d',
    accentInk: '#593b0c',
    mapFill: '#e6dac0',
    mapStroke: '#9c8354',
    pathStroke: '#1c3b2b',
    stampInk: '#7a3520',
  },
  gamified: {
    id: 'gamified',
    label: '📜 Výprava s pergamenem',
    badge: '📜 MOTIV: VÝPRAVA S PERGAMENEM',
    bgStart: '#faf8f0',
    bgMid: '#f3efe2',
    bgEnd: '#e8e3d1',
    borderOuter: '#1e4032',
    borderInner: '#b9cba8',
    headerInk: '#193e32',
    subInk: '#596f60',
    divider: '#9eb592',
    cardBg: '#ffffff',
    cardBorder: '#c8d6bd',
    accentBg: '#eef5dc',
    accentBorder: '#a6c46c',
    accentInk: '#234718',
    mapFill: '#ebe6d5',
    mapStroke: '#b5a886',
    pathStroke: '#23573c',
    stampInk: '#8c3b2b',
  },
  casual: {
    id: 'casual',
    label: '🗺️ Turistická mapa',
    badge: '🗺️ MOTIV: TURISTICKÁ MAPA',
    bgStart: '#f4f9fc',
    bgMid: '#ebf4f8',
    bgEnd: '#dfeee6',
    borderOuter: '#1b4965',
    borderInner: '#89b0ae',
    headerInk: '#153b50',
    subInk: '#476a7d',
    divider: '#8cb3c5',
    cardBg: '#ffffff',
    cardBorder: '#b8d4de',
    accentBg: '#e3f4ec',
    accentBorder: '#5fa88a',
    accentInk: '#134b36',
    mapFill: '#e3f1f6',
    mapStroke: '#7fa9bd',
    pathStroke: '#1b4965',
    stampInk: '#1b4965',
  },
});

function escapeXml(str = '') {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Vrátí odhad počtu kroků z ušlých metrů (průměrný krok ~0,74 m).
 */
export function estimateStepsFromMeters(meters = 0) {
  const m = Math.max(0, Number(meters) || 0);
  return Math.round(m / 0.74);
}

/**
 * Formátuje čistý aktivní čas procházky v češtině.
 */
export function formatActiveDuration(durationMs = 0) {
  const ms = Math.max(0, Number(durationMs) || 0);
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) {
    return `${Math.max(1, totalSec)} s`;
  }
  const totalMin = Math.max(1, Math.round(ms / 60000));
  if (totalMin < 60) {
    return `${totalMin} min`;
  }
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
}

/**
 * Formátuje odhad převýšení — pokud data chybí, vrátí „nedostupné“ (žádné falešné 0 m).
 */
export function formatElevationSummary(summary = {}) {
  const known = summary?.elevationKnown === true ||
    (summary?.elevationKnown !== false && Number.isFinite(Number(summary?.elevationGainM)) && Number(summary?.elevationGainM) > 0);
  if (!known || summary?.elevationGainM == null || !Number.isFinite(Number(summary.elevationGainM))) {
    return 'nedostupné';
  }
  return `+${Math.max(0, Math.round(Number(summary.elevationGainM)))} m`;
}

/**
 * Převede vstupní souřadnice (`walkSegments` nebo `trailCoordinates`) na pole souvislých segmentů
 * `Array<Array<{lat: number, lng: number}>>`, čímž zachová přerušení při výpadcích GPS.
 */
export function normalizeWalkSegments(segmentsOrCoords = []) {
  if (!Array.isArray(segmentsOrCoords) || segmentsOrCoords.length === 0) return [];

  const isPointCoordPair = item =>
    Array.isArray(item) &&
    item.length >= 2 &&
    Number.isFinite(Number(item[0])) &&
    Number.isFinite(Number(item[1]));

  const isPointObj = item =>
    Boolean(item && typeof item === 'object' && !Array.isArray(item) && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng)));

  // Pokud první prvek je přímo bod [lat, lng] nebo {lat, lng}, jde o ploché pole bodů (s případným segmentBreak)
  if (isPointCoordPair(segmentsOrCoords[0]) || isPointObj(segmentsOrCoords[0])) {
    const segments = [];
    let current = [];
    for (const pt of segmentsOrCoords) {
      if (isPointCoordPair(pt)) {
        current.push({ lat: Number(pt[0]), lng: Number(pt[1]) });
      } else if (isPointObj(pt)) {
        if (pt.segmentBreak && current.length > 0) {
          segments.push(current);
          current = [];
        }
        current.push({ lat: Number(pt.lat), lng: Number(pt.lng) });
      }
    }
    if (current.length > 0) segments.push(current);
    return segments.filter(seg => seg.length >= 1);
  }

  // Jinak jde o pole segmentů [[[lat, lng], ...], ...]
  const segments = [];
  for (const rawSeg of segmentsOrCoords) {
    if (!Array.isArray(rawSeg)) continue;
    const cleanSeg = [];
    for (const pt of rawSeg) {
      if (isPointCoordPair(pt)) {
        cleanSeg.push({ lat: Number(pt[0]), lng: Number(pt[1]) });
      } else if (isPointObj(pt)) {
        cleanSeg.push({ lat: Number(pt.lat), lng: Number(pt.lng) });
      }
    }
    if (cleanSeg.length > 0) {
      segments.push(cleanSeg);
    }
  }
  return segments;
}

function interpolatePoint(a, b, ratio) {
  const t = Math.max(0, Math.min(1, Number(ratio) || 0));
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}

function trimFromStartOfSegments(segments, trimM) {
  let remaining = Math.max(0, Number(trimM) || 0);
  const out = [];
  let trimmingDone = remaining <= 0;

  for (const seg of segments) {
    if (!Array.isArray(seg) || seg.length === 0) continue;
    if (trimmingDone) {
      out.push(seg.map(p => ({ ...p })));
      continue;
    }
    if (seg.length === 1) continue;

    const newSeg = [];
    for (let i = 0; i < seg.length - 1; i++) {
      const a = seg[i];
      const b = seg[i + 1];
      const d = haversineMeters(a, b) ?? 0;
      if (!trimmingDone) {
        if (remaining >= d) {
          remaining -= d;
        } else {
          const cutPt = d > 0 ? interpolatePoint(a, b, remaining / d) : { ...a };
          remaining = 0;
          trimmingDone = true;
          newSeg.push(cutPt, { ...b });
        }
      } else {
        newSeg.push({ ...b });
      }
    }
    if (newSeg.length >= 2) {
      out.push(newSeg);
    }
  }
  return out;
}

function reverseSegments(segments) {
  return [...segments].reverse().map(seg => [...seg].reverse());
}

/**
 * DÁVKA 3 (Bod 2.2): Ochrana soukromí při sdílení a záznamu (Domov v bezpečí).
 * Ořízne prvních `trimMeters` (150 m) a posledních `trimMeters` (150 m) trasy
 * se zachováním případných přerušení segmentů uprostřed.
 */
export function trimTrackForHomePrivacy(segmentsOrCoords = [], trimMeters = 150) {
  const segments = normalizeWalkSegments(segmentsOrCoords);
  const trimM = Math.max(0, Number(trimMeters) || 0);

  let totalMeters = 0;
  for (const seg of segments) {
    for (let i = 0; i < seg.length - 1; i++) {
      totalMeters += haversineMeters(seg[i], seg[i + 1]) ?? 0;
    }
  }

  if (trimM <= 0) {
    return {
      segments,
      totalMeters: Math.round(totalMeters),
      trimmed: false,
      tooShortToShowPath: false,
      tooShortToDisplay: false,
      trimmedStartM: 0,
      trimmedEndM: 0,
    };
  }

  // Pokud je celková trasa kratší než 2 * trimM + 20 m, oříznutí obou konců skryje celou čáru,
  // aby se nikdy neprozradila poloha domova u krátké procházky kolem domu.
  if (totalMeters <= trimM * 2 + 20) {
    return {
      segments: [],
      totalMeters: Math.round(totalMeters),
      trimmed: true,
      tooShortToShowPath: true,
      tooShortToDisplay: true,
      trimmedStartM: trimM,
      trimmedEndM: trimM,
    };
  }

  const afterStart = trimFromStartOfSegments(segments, trimM);
  const reversed = reverseSegments(afterStart);
  const afterBothReversed = trimFromStartOfSegments(reversed, trimM);
  const finalSegments = reverseSegments(afterBothReversed);
  const isEmpty = finalSegments.length === 0;

  return {
    segments: finalSegments,
    totalMeters: Math.round(totalMeters),
    trimmed: true,
    tooShortToShowPath: isEmpty,
    tooShortToDisplay: isEmpty,
    trimmedStartM: trimM,
    trimmedEndM: trimM,
  };
}

export function buildMiniMapPathSvg(
  segmentsOrCoords = [],
  boxX = 696,
  boxY = 918,
  boxW = 298,
  boxH = 216,
  options = {}
) {
  const theme = POSTCARD_THEMES[options.theme] || POSTCARD_THEMES.gamified;
  const privacyTrim = Boolean(options.privacyTrim);
  const hideMap = Boolean(options.hideMap || options.privacyMode === 'no_map');
  const newCellsCount = Math.max(0, Math.round(Number(options.newCellsCount) || 0));

  const cellsBadgeText = `+${newCellsCount} dílků (${newCellsCount === 1 ? 'nový dílek' : newCellsCount >= 2 && newCellsCount <= 4 ? 'nové dílky' : 'nových dílků'} mapy)`;

  if (hideMap) {
    const cx = boxX + boxW / 2;
    const cy = boxY + boxH / 2 - 6;
    return `
      <g class="postcard-minimap" data-privacy-no-map="true" data-segment-count="0">
        <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="16" fill="${theme.mapFill}" stroke="${theme.mapStroke}" stroke-width="2.5"/>
        <rect x="${boxX + 14}" y="${boxY + 10}" width="${boxW - 28}" height="24" rx="8" fill="rgba(255,255,255,0.86)"/>
        <text x="${cx}" y="${boxY + 26}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11.5" font-weight="800" fill="${theme.headerInk}">🛡️ MAXIMÁLNÍ SOUKROMÍ (BEZ MAPY)</text>
        <circle cx="${cx}" cy="${cy - 8}" r="28" fill="rgba(255,255,255,0.75)" stroke="${theme.mapStroke}" stroke-width="2"/>
        <text x="${cx}" y="${cy + 1}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="26">🛡️</text>
        <text x="${cx}" y="${boxY + boxH - 42}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" font-weight="800" fill="${theme.headerInk}">🗺️ ODKRYTÁ OBLAST: ${escapeXml(cellsBadgeText)}</text>
        <text x="${cx}" y="${boxY + boxH - 25}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11.5" font-weight="700" fill="${theme.subInk}">Trasa a souřadnice jsou skryty</text>
        <text x="${cx}" y="${boxY + boxH - 9}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" font-weight="700" fill="${theme.headerInk}">🔒 Režim: Bez mapy (soukromí)</text>
      </g>
    `;
  }

  const rawSegments = normalizeWalkSegments(segmentsOrCoords);
  const trimResult = privacyTrim
    ? trimTrackForHomePrivacy(rawSegments, 150)
    : { segments: rawSegments, trimmed: false, tooShortToShowPath: false };

  const activeSegments = trimResult.segments.filter(s => Array.isArray(s) && s.length >= 1);
  const flatPts = activeSegments.flat();

  const pad = 24;
  const innerW = boxW - pad * 2;
  const innerH = boxH - pad * 2 - 34;

  const privacyCaption = privacyTrim ? '🔒 Ochrana soukromí domova (±150 m)' : '🟢 Start · 🏁 Konec · Skutečná trasa';

  if (flatPts.length < 2) {
    const cx = boxX + boxW / 2;
    const cy = boxY + boxH / 2 - 14;
    const emptyMsg = trimResult.tooShortToShowPath
      ? '🔒 Trasa < 320 m skryta (ochrana domova)'
      : '🟢 Start · 🏁 Konec';
    return `
      <g class="postcard-minimap">
        <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="16" fill="${theme.mapFill}" stroke="${theme.mapStroke}" stroke-width="2.5"/>
        <!-- Mřížka nově odkryté oblasti -->
        <line x1="${boxX + 40}" y1="${cy - 30}" x2="${boxX + boxW - 40}" y2="${cy - 30}" stroke="${theme.mapStroke}" stroke-width="1" stroke-dasharray="4,4" opacity="0.45"/>
        <line x1="${boxX + 40}" y1="${cy + 10}" x2="${boxX + boxW - 40}" y2="${cy + 10}" stroke="${theme.mapStroke}" stroke-width="1" stroke-dasharray="4,4" opacity="0.45"/>
        <path d="M ${cx - 64} ${cy + 18} Q ${cx - 20} ${cy - 42} ${cx + 22} ${cy - 14} T ${cx + 68} ${cy + 14}" fill="none" stroke="${theme.pathStroke}" stroke-width="4" stroke-dasharray="7,5" stroke-linecap="round"/>
        <circle cx="${cx - 64}" cy="${cy + 18}" r="6" fill="#16a34a" stroke="#ffffff" stroke-width="2"/>
        <circle cx="${cx + 68}" cy="${cy + 14}" r="7" fill="#dc2626" stroke="#ffffff" stroke-width="2"/>
        <rect x="${boxX + 14}" y="${boxY + 10}" width="${boxW - 28}" height="24" rx="8" fill="rgba(255,255,255,0.82)"/>
        <text x="${boxX + boxW / 2}" y="${boxY + 26}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" font-weight="800" fill="${theme.headerInk}">🗺️ ODKRYTÁ OBLAST: ${escapeXml(cellsBadgeText)}</text>
        <text x="${boxX + boxW / 2}" y="${boxY + boxH - 26}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11.5" font-weight="700" fill="${theme.subInk}">${escapeXml(emptyMsg)}</text>
        <text x="${boxX + boxW / 2}" y="${boxY + boxH - 10}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" font-weight="700" fill="${theme.headerInk}">${escapeXml(privacyCaption)}</text>
      </g>
    `;
  }

  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of flatPts) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const latSpan = Math.max(0.0008, maxLat - minLat);
  const lngSpan = Math.max(0.0008, maxLng - minLng);

  const toX = lng => boxX + pad + ((lng - minLng) / lngSpan) * innerW;
  const toY = lat => boxY + pad + 18 + innerH - ((lat - minLat) / latSpan) * innerH;

  // Vykreslíme každý segment zvlášť, aby se případné výpadky GPS nikdy nespojovaly falešnou čarou
  const segmentPathsWhite = [];
  const segmentPathsColor = [];
  for (const seg of activeSegments) {
    if (seg.length < 2) continue;
    const pts = seg.map(p => `${toX(p.lng).toFixed(1)},${toY(p.lat).toFixed(1)}`);
    const d = `M ${pts.join(' L ')}`;
    segmentPathsWhite.push(`<path d="${d}" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`);
    segmentPathsColor.push(`<path d="${d}" fill="none" stroke="${theme.pathStroke}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`);
  }

  const startPt = activeSegments[0][0];
  const lastSeg = activeSegments[activeSegments.length - 1];
  const endPt = lastSeg[lastSeg.length - 1];
  const sx = toX(startPt.lng).toFixed(1);
  const sy = toY(startPt.lat).toFixed(1);
  const ex = toX(endPt.lng).toFixed(1);
  const ey = toY(endPt.lat).toFixed(1);

  return `
    <g class="postcard-minimap" data-segment-count="${activeSegments.length}" data-privacy-trimmed="${privacyTrim}">
      <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="16" fill="${theme.mapFill}" stroke="${theme.mapStroke}" stroke-width="2.5"/>
      <rect x="${boxX + 12}" y="${boxY + 10}" width="${boxW - 24}" height="24" rx="8" fill="rgba(255,255,255,0.86)"/>
      <text x="${boxX + boxW / 2}" y="${boxY + 26}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" font-weight="800" fill="${theme.headerInk}">🗺️ ODKRYTO: ${escapeXml(cellsBadgeText)}</text>
      ${segmentPathsWhite.join('\n      ')}
      ${segmentPathsColor.join('\n      ')}
      <circle cx="${sx}" cy="${sy}" r="6.5" fill="#16a34a" stroke="#ffffff" stroke-width="2.2"/>
      <circle cx="${ex}" cy="${ey}" r="7" fill="#dc2626" stroke="#ffffff" stroke-width="2.2"/>
      <text x="${boxX + boxW / 2}" y="${boxY + boxH - 25}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11.5" font-weight="800" fill="${theme.headerInk}">🟢 Start · 🏁 Konec (${activeSegments.length} ${activeSegments.length === 1 ? 'úsek' : activeSegments.length <= 4 ? 'úseky' : 'úseků'})</text>
      <text x="${boxX + boxW / 2}" y="${boxY + boxH - 9}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" font-weight="700" fill="${theme.subInk}">${escapeXml(privacyCaption)}</text>
    </g>
  `;
}

function renderPolaroidSlotSvg({ x, y, w, h, rot = 0, place, clipId }) {
  const title = String(place?.title || 'Navštívené místo').trim();
  const shortTitle = title.length > 30 ? title.slice(0, 28).trim() + '…' : title;
  const badgePrefix = place?.isUserMemory ? (place.symbolIcon || '✨') : '📍';
  const rawPhoto = place?.photoUrl || generateCategoryPlaceSvgDataUrl(place);
  const safeHref = escapeXml(rawPhoto);
  const borderPad = 14;
  const bottomCaptionH = 54;
  const imgW = Math.max(40, w - borderPad * 2);
  const imgH = Math.max(40, h - borderPad - bottomCaptionH);
  const cx = x + w / 2;
  const cy = y + h / 2;

  return `
    <g class="postcard-polaroid" transform="rotate(${rot} ${cx} ${cy})">
      <rect x="${x + 4}" y="${y + 7}" width="${w}" height="${h}" rx="12" fill="rgba(22, 36, 28, 0.18)"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#ffffff" stroke="#dcd6c6" stroke-width="2"/>
      <defs>
        <clipPath id="${clipId}">
          <rect x="${x + borderPad}" y="${y + borderPad}" width="${imgW}" height="${imgH}" rx="7"/>
        </clipPath>
      </defs>
      <g clip-path="url(#${clipId})">
        <rect x="${x + borderPad}" y="${y + borderPad}" width="${imgW}" height="${imgH}" fill="#264738"/>
        <image href="${safeHref}" x="${x + borderPad}" y="${y + borderPad}" width="${imgW}" height="${imgH}" preserveAspectRatio="xMidYMid slice"/>
      </g>
      <text x="${x + w / 2}" y="${y + h - 20}" text-anchor="middle" font-family="Georgia, serif" font-size="19" font-weight="700" fill="#193e32">${escapeXml(badgePrefix)} ${escapeXml(shortTitle)}</text>
    </g>
  `;
}

function renderPersonalMemoriesRibbonSvg(memories = [], theme) {
  const list = Array.isArray(memories) ? memories.filter(Boolean).slice(0, 4) : [];
  if (list.length === 0) {
    return `
      <g class="postcard-memories-ribbon">
        <rect x="86" y="844" width="908" height="62" rx="14" fill="${theme.cardBg}" stroke="${theme.cardBorder}" stroke-width="2"/>
        <text x="112" y="881" font-family="system-ui, sans-serif" font-size="16" font-weight="700" fill="${theme.headerInk}">✨ MOJE MALÉ OBJEVY:</text>
        <text x="315" y="881" font-family="Georgia, serif" font-style="italic" font-size="16" fill="${theme.subInk}">Při příští procházce si můžeš uložit vlastní symbol (🌳 Strom, 🌄 Výhled, 🍃 Klidné místo…)</text>
      </g>
    `;
  }

  const chips = list.map(m => {
    const icon = m.symbolIcon || '✨';
    const label = m.title || m.symbolLabel || 'Vlastní vzpomínka';
    const note = m.note ? ` (${String(m.note).slice(0, 22)}${String(m.note).length > 22 ? '…' : ''})` : '';
    return `${icon} ${label}${note}`;
  }).join('  ·  ');

  return `
    <g class="postcard-memories-ribbon">
      <rect x="86" y="844" width="908" height="62" rx="14" fill="${theme.accentBg}" stroke="${theme.accentBorder}" stroke-width="2.2"/>
      <text x="110" y="871" font-family="system-ui, sans-serif" font-size="13" font-weight="800" fill="${theme.accentInk}">✨ MOJE MALÉ OBJEVY (VLASTNÍ VZPOMÍNKY V ZAŘÍZENÍ · ${list.length}):</text>
      <text x="110" y="894" font-family="Georgia, serif" font-size="16" font-weight="700" fill="${theme.headerInk}">${escapeXml(chips.slice(0, 96))}</text>
    </g>
  `;
}

/**
 * Vygeneruje kompletní SVG pohlednici („Vzpomínka na procházku“) s podporou 3 vizuálních motivů,
 * koláží potvrzených míst + vlastních symbolů (`✨ Moje malé objevy`), mini-mapou ušlé cesty
 * (`walkSegments`), pravdivými statistikami a ochranou soukromí domova (±150 m).
 */
export function renderPostcardSvg(summary = {}, options = {}) {
  const W = 1080;
  const H = 1350;
  const themeKey = options.theme || summary.postcardTheme || summary.gameMode || 'gamified';
  const theme = POSTCARD_THEMES[themeKey] || POSTCARD_THEMES.gamified;
  const privacyTrim = options.privacyTrim !== undefined
    ? Boolean(options.privacyTrim)
    : Boolean(summary.privacyTrimmed);
  const hideMap = options.hideMap !== undefined
    ? Boolean(options.hideMap)
    : Boolean(options.privacyMode === 'no_map' || summary.hideMap);

  const rawPlaces = Array.isArray(summary.visitedPlacesWithPhotos)
    ? summary.visitedPlacesWithPhotos.filter(Boolean)
    : [];
  const personalMemories = Array.isArray(summary.personalMemories)
    ? summary.personalMemories.filter(Boolean)
    : [];

  // Pokud nejsou fotky míst, ale uživatel uložil vlastní vzpomínky, zobrazíme je i jako karty v koláži
  const memoryPlaceCards = personalMemories.map(m => ({
    id: m.id,
    title: m.note ? `${m.title}: ${m.note}` : (m.title || m.symbolLabel || 'Moje vzpomínka'),
    kind: m.symbolId === 'water' ? 'water' : m.symbolId === 'view' ? 'view' : 'forest',
    category: m.symbolId === 'water' ? 'water' : m.symbolId === 'view' ? 'views' : 'nature',
    symbolIcon: m.symbolIcon || '✨',
    isUserMemory: true,
  }));

  const collageItems = rawPlaces.length > 0 ? rawPlaces : memoryPlaceCards;

  const distanceMeters = Math.max(0, Number(summary.distanceMeters) || 0);
  const distLabel = formatPostcardDistance(distanceMeters);
  const activeDurationLabel = formatActiveDuration(summary.activeDurationMs ?? summary.durationMs ?? 60000);
  const estimatedSteps = summary.estimatedSteps != null
    ? Math.max(0, Math.round(Number(summary.estimatedSteps)))
    : estimateStepsFromMeters(distanceMeters);
  const elevationLabel = formatElevationSummary(summary);
  const newCellsCount = Math.max(0, Math.round(Number(summary.newCellsCount ?? summary.cellsCount) || 0));
  const stampsCount = Math.max(rawPlaces.length, Math.round(Number(summary.newStampsCount ?? summary.stampsCount) || 0));

  const dateObj = summary.date ? new Date(summary.date) : new Date();
  const dateOnlyStr = dateObj.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = !privacyTrim && !hideMap && summary.date
    ? ` · ${dateObj.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}`
    : '';

  let collageHtml = '';
  const areaX = 86;
  const areaY = 256;
  const areaW = W - 172; // 908
  const areaH = 572;

  if (collageItems.length === 0) {
    const defaultPlace = {
      title: summary.areaLabel || 'Putování krajinou s Czekpointem',
      kind: 'view',
      category: 'views',
    };
    collageHtml = renderPolaroidSlotSvg({
      x: areaX + 30,
      y: areaY + 8,
      w: areaW - 60,
      h: areaH - 16,
      rot: -0.8,
      place: defaultPlace,
      clipId: 'pc-clip-0',
    });
  } else if (collageItems.length === 1) {
    collageHtml = renderPolaroidSlotSvg({
      x: areaX + 24,
      y: areaY + 6,
      w: areaW - 48,
      h: areaH - 12,
      rot: -1.1,
      place: collageItems[0],
      clipId: 'pc-clip-single',
    });
  } else if (collageItems.length === 2) {
    const colW = Math.floor((areaW - 28) / 2);
    collageHtml =
      renderPolaroidSlotSvg({
        x: areaX,
        y: areaY + 14,
        w: colW,
        h: areaH - 28,
        rot: -1.6,
        place: collageItems[0],
        clipId: 'pc-clip-2a',
      }) +
      renderPolaroidSlotSvg({
        x: areaX + colW + 28,
        y: areaY + 18,
        w: colW,
        h: areaH - 28,
        rot: 1.4,
        place: collageItems[1],
        clipId: 'pc-clip-2b',
      });
  } else if (collageItems.length === 3) {
    const leftW = Math.floor(areaW * 0.53);
    const rightW = areaW - leftW - 24;
    const halfH = Math.floor((areaH - 20) / 2);
    collageHtml =
      renderPolaroidSlotSvg({
        x: areaX,
        y: areaY,
        w: leftW,
        h: areaH,
        rot: -1.1,
        place: collageItems[0],
        clipId: 'pc-clip-3a',
      }) +
      renderPolaroidSlotSvg({
        x: areaX + leftW + 24,
        y: areaY,
        w: rightW,
        h: halfH,
        rot: 1.3,
        place: collageItems[1],
        clipId: 'pc-clip-3b',
      }) +
      renderPolaroidSlotSvg({
        x: areaX + leftW + 24,
        y: areaY + halfH + 20,
        w: rightW,
        h: halfH,
        rot: -1.0,
        place: collageItems[2],
        clipId: 'pc-clip-3c',
      });
  } else {
    const items = collageItems.slice(0, 4);
    const colW = Math.floor((areaW - 26) / 2);
    const rowH = Math.floor((areaH - 22) / 2);
    const rots = [-1.3, 1.2, 1.0, -1.2];
    collageHtml = items
      .map((pl, idx) => {
        const col = idx % 2;
        const row = Math.floor(idx / 2);
        return renderPolaroidSlotSvg({
          x: areaX + col * (colW + 26),
          y: areaY + row * (rowH + 22),
          w: colW,
          h: rowH,
          rot: rots[idx] || 0,
          place: pl,
          clipId: `pc-clip-4-${idx}`,
        });
      })
      .join('');
  }

  const memoriesRibbonSvg = renderPersonalMemoriesRibbonSvg(personalMemories, theme);

  const trackSource = (Array.isArray(summary.walkSegments) && summary.walkSegments.length > 0)
    ? summary.walkSegments
    : (summary.trailCoordinates || []);

  const miniMapSvg = buildMiniMapPathSvg(
    trackSource,
    696,
    922,
    298,
    212,
    {
      theme: theme.id,
      privacyTrim,
      hideMap,
      newCellsCount,
    }
  );

  const footerPrivacyNote = hideMap
    ? '🛡️ Maximální soukromí (Bez mapy) zapnuto: trasa, souřadnice i přesné časy jsou skryty.'
    : (privacyTrim
        ? '🔒 Ochrana soukromí domova zapnuta: začátek a konec trasy (±150 m) i přesné časy jsou skryty.'
        : 'Czekpoint · Osobní atlas procházek a objevování krajiny');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-postcard-theme="${escapeXml(theme.id)}" data-privacy-trim="${privacyTrim}" data-privacy-no-map="${hideMap}">
    <defs>
      <linearGradient id="pcBg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${theme.bgStart}"/>
        <stop offset="55%" stop-color="${theme.bgMid}"/>
        <stop offset="100%" stop-color="${theme.bgEnd}"/>
      </linearGradient>
    </defs>

    <!-- Podklad pohlednice podle zvoleného motivu -->
    <rect width="${W}" height="${H}" fill="url(#pcBg)"/>
    <rect x="34" y="34" width="${W - 68}" height="${H - 68}" rx="18" fill="none" stroke="${theme.borderOuter}" stroke-width="12"/>
    <rect x="50" y="50" width="${W - 100}" height="${H - 100}" rx="10" fill="none" stroke="${theme.borderInner}" stroke-width="3"/>

    <!-- Hlavička pohlednice -->
    <text x="${W / 2}" y="104" text-anchor="middle" font-family="system-ui, sans-serif" font-size="18" font-weight="800" fill="${theme.subInk}" letter-spacing="2.5">${escapeXml(theme.label)} · ${escapeXml(theme.badge)}</text>
    <text x="${W / 2}" y="164" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="40" font-weight="700" fill="${theme.headerInk}">POZDRAV Z VÝPRAVY · VZPOMÍNKA NA PROCHÁZKU</text>
    <text x="${W / 2}" y="204" text-anchor="middle" font-family="system-ui, sans-serif" font-size="19" font-weight="600" fill="${theme.subInk}" letter-spacing="1.5">CZEKPOINT · ${escapeXml((dateOnlyStr + timeStr).toUpperCase())}</text>

    <line x1="140" y1="228" x2="${W - 140}" y2="228" stroke="${theme.divider}" stroke-width="2"/>

    <!-- Koláž navštívených míst a objevů -->
    <g class="postcard-collage-group">
      ${collageHtml}
    </g>

    <!-- Pás vlastních uložených vzpomínek (✨ Moje malé objevy) -->
    ${memoriesRibbonSvg}

    <!-- Pravdivé statistiky výpravy vlevo dole + Mini-mapa prošlé trasy vpravo dole -->
    <g class="postcard-stats-group">
      <!-- Karta 1: Ušlá vzdálenost a čistý aktivní čas -->
      <rect x="86" y="922" width="290" height="98" rx="14" fill="${theme.cardBg}" stroke="${theme.cardBorder}" stroke-width="2.5"/>
      <text x="110" y="954" font-family="system-ui, sans-serif" font-size="13" font-weight="800" fill="${theme.subInk}">📏 VZDÁLENOST A AKTIVNÍ ČAS</text>
      <text x="110" y="990" font-family="Georgia, serif" font-size="27" font-weight="700" fill="${theme.headerInk}">${escapeXml(distLabel)} · ${escapeXml(activeDurationLabel)}</text>
      <text x="110" y="1010" font-family="system-ui, sans-serif" font-size="12" font-weight="600" fill="${theme.subInk}">Čistý čas chůze bez pauz</text>

      <!-- Karta 2: Odhad kroků -->
      <rect x="392" y="922" width="288" height="98" rx="14" fill="${theme.cardBg}" stroke="${theme.cardBorder}" stroke-width="2.5"/>
      <text x="416" y="954" font-family="system-ui, sans-serif" font-size="13" font-weight="800" fill="${theme.subInk}">👣 Odhad kroků: ~${estimatedSteps.toLocaleString('cs-CZ')}</text>
      <text x="416" y="990" font-family="Georgia, serif" font-size="27" font-weight="700" fill="${theme.headerInk}">~${estimatedSteps.toLocaleString('cs-CZ')}</text>
      <text x="416" y="1010" font-family="system-ui, sans-serif" font-size="12" font-weight="600" fill="${theme.subInk}">Orientační odhad podle délky trasy</text>

      <!-- Karta 3: Odhad převýšení -->
      <rect x="86" y="1036" width="290" height="98" rx="14" fill="${theme.cardBg}" stroke="${theme.cardBorder}" stroke-width="2.5"/>
      <text x="110" y="1068" font-family="system-ui, sans-serif" font-size="13" font-weight="800" fill="${theme.subInk}">📈 Odhad převýšení: ${escapeXml(elevationLabel)}</text>
      <text x="110" y="1104" font-family="Georgia, serif" font-size="27" font-weight="700" fill="${theme.headerInk}">${escapeXml(elevationLabel)}</text>
      <text x="110" y="1124" font-family="system-ui, sans-serif" font-size="12" font-weight="600" fill="${theme.subInk}">${elevationLabel === 'nedostupné' ? 'Výškový profil nebyl načten' : 'Nastoupané metry dle výškového modelu'}</text>

      <!-- Karta 4: Potvrzená místa a malé objevy -->
      <rect x="392" y="1036" width="288" height="98" rx="14" fill="${theme.accentBg}" stroke="${theme.accentBorder}" stroke-width="2.5"/>
      <text x="416" y="1068" font-family="system-ui, sans-serif" font-size="13" font-weight="800" fill="${theme.accentInk}">📍 POTVRZENO DLE GPS &amp; OBJEVY</text>
      <text x="416" y="1104" font-family="Georgia, serif" font-size="25" font-weight="700" fill="${theme.accentInk}">${stampsCount} ${stampsCount === 1 ? 'místo' : stampsCount >= 2 && stampsCount <= 4 ? 'místa' : 'míst'} · ✨ ${personalMemories.length}</text>
      <text x="416" y="1124" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="${theme.accentInk}">+${newCellsCount} dílků mapy</text>
    </g>

    <!-- Mini-mapa prošlé trasy -->
    ${miniMapSvg}

    <!-- Poštovní razítko Czekpointu a patička -->
    <g transform="translate(185, 1225) rotate(-6)">
      <circle cx="0" cy="0" r="62" fill="none" stroke="${theme.stampInk}" stroke-width="4" stroke-dasharray="7,4"/>
      <circle cx="0" cy="0" r="52" fill="none" stroke="${theme.stampInk}" stroke-width="2"/>
      <text x="0" y="-18" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="800" fill="${theme.stampInk}" letter-spacing="2">CZEKPOINT</text>
      <text x="0" y="5" text-anchor="middle" font-family="Georgia, serif" font-size="16" font-weight="700" fill="${theme.stampInk}">OSOBNÍ ATLAS</text>
      <text x="0" y="25" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11.5" font-weight="700" fill="${theme.stampInk}">v2.0 · ČR</text>
    </g>

    <text x="290" y="1206" font-family="Georgia, serif" font-style="italic" font-size="26" fill="${theme.headerInk}">„Každý krok zanechá stopu v paměti.“</text>
    <text x="290" y="1238" font-family="system-ui, sans-serif" font-size="16" font-weight="600" fill="${theme.subInk}">${escapeXml(footerPrivacyNote)}</text>
    <text x="290" y="1266" font-family="monospace" font-size="14" fill="${theme.subInk}">ID výpravy: ${escapeXml(String(summary.id || summary.expeditionId || 'exp_v2.0').slice(0, 24))}</text>
  </svg>`;
}

/**
 * Vrátí Data URL SVG pohlednice s koláží navštívených míst a zvoleným motivem.
 */
export function renderPostcardSvgDataUrl(summary = {}, options = {}) {
  const svg = renderPostcardSvg(summary, options);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export { renderCanvasPostcard as renderPostcard, formatPostcardDistance };
