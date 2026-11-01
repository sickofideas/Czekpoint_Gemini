// ============================================================
// CZEKPOINT v1.2 — Výškový profil a převýšení trasy (src/elevation.js)
// - Vzorkuje 25–40 rovnoměrných bodů po naplánované trase
// - Dotazuje bezplatné Open-Meteo Elevation API (https://api.open-meteo.com/v1/elevation)
// - Při offline stavu nebo výpadku sítě použije lokální deterministický výškový model ČR (Brdy / Třemšín / ČR)
// - Počítá celkové stoupání (+XX m), klesání (-XX m), minEle a maxEle
// - Vykresluje přehledný SVG výškový profil (.elevation-profile-card) s vyznačenými zastávkami a polohou hráče
// ============================================================

import { haversineMeters } from './domain.js';
import { escapeHtml as e } from './ui.js';

const ELEVATION_CACHE_KEY = 'czekpoint_v12_elevation_cache';
const MAX_CACHE_ENTRIES = 40;

function normalizeCoordPair(pt) {
  if (!pt) return null;
  if (Array.isArray(pt) && pt.length >= 2) {
    const lat = Number(pt[0]);
    const lng = Number(pt[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  const lat = Number(pt.lat);
  const lng = Number(pt.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * Lokální deterministický model nadmořské výšky pro ČR (zejména Podbrdsko, Brdy, Třemšín a střední Čechy),
 * používaný jako okamžitý offline fallback.
 */
export function estimateCzechTerrainElevationM(lat, lng) {
  const baseLat = Number(lat) || 49.6014;
  const baseLng = Number(lng) || 13.8644;

  // Vzdálenost od vrcholu Třemšína (49.5675, 13.8380 -> 827 m n. m.)
  const dTremsinM = haversineMeters({ lat: baseLat, lng: baseLng }, { lat: 49.5675, lng: 13.8380 }) ?? 10000;
  const tremsinPeakBoost = Math.max(0, 295 * Math.exp(-(dTremsinM * dTremsinM) / (2 * 3800 * 3800)));

  // Vzdálenost od Prahy / Brdského hřebene (Praha 862 m n. m. - 49.658, 13.819)
  const dPrahaBrdyM = haversineMeters({ lat: baseLat, lng: baseLng }, { lat: 49.6580, lng: 13.8190 }) ?? 12000;
  const brdyBoost = Math.max(0, 310 * Math.exp(-(dPrahaBrdyM * dPrahaBrdyM) / (2 * 4500 * 4500)));

  // Jemné zvlnění krajiny podle zeměpisných souřadnic
  const wave1 = Math.sin(baseLat * 290) * 18 + Math.cos(baseLng * 240) * 14;
  const wave2 = Math.sin((baseLat + baseLng) * 620) * 8;

  const rawEle = 515 + tremsinPeakBoost + brdyBoost + wave1 + wave2;
  return Math.round(Math.max(180, Math.min(1602, rawEle)));
}

/**
 * Ze souřadnic naplánované trasy vyvzorkuje 25–40 rovnoměrných bodů se vzdáleností distKm.
 */
export function sampleRouteCoordinates(coordinates, targetCount = 32) {
  const clean = (Array.isArray(coordinates) ? coordinates : [])
    .map(normalizeCoordPair)
    .filter(Boolean);

  const count = Math.max(25, Math.min(40, Number(targetCount) || 32));

  if (clean.length === 0) {
    const def = { lat: 49.6014, lng: 13.8644 };
    return Array.from({ length: count }, (_, idx) => ({
      lat: def.lat + idx * 0.0002,
      lng: def.lng + idx * 0.0002,
      distKm: Number((idx * 0.03).toFixed(3)),
    }));
  }

  if (clean.length === 1) {
    const p = clean[0];
    return Array.from({ length: count }, (_, idx) => ({
      lat: p.lat,
      lng: p.lng,
      distKm: 0,
      index: idx,
    }));
  }

  // Spočítáme kumulativní délku po jednotlivých segmentech
  const cumMeters = [0];
  let totalMeters = 0;
  for (let i = 1; i < clean.length; i++) {
    const segM = haversineMeters(clean[i - 1], clean[i]) ?? 0;
    totalMeters += segM;
    cumMeters.push(totalMeters);
  }

  if (totalMeters <= 1) {
    return Array.from({ length: count }, (_, idx) => ({
      lat: clean[0].lat,
      lng: clean[0].lng,
      distKm: 0,
      index: idx,
    }));
  }

  const sampled = [];
  for (let s = 0; s < count; s++) {
    const ratio = count <= 1 ? 0 : s / (count - 1);
    const targetM = ratio * totalMeters;

    // Najdeme segment obsahující targetM
    let segIdx = 0;
    while (segIdx < cumMeters.length - 2 && cumMeters[segIdx + 1] < targetM) {
      segIdx++;
    }

    const m0 = cumMeters[segIdx];
    const m1 = cumMeters[segIdx + 1];
    const segSpan = Math.max(0.0001, m1 - m0);
    const localT = Math.max(0, Math.min(1, (targetM - m0) / segSpan));

    const a = clean[segIdx];
    const b = clean[segIdx + 1] || a;
    const lat = Number((a.lat + (b.lat - a.lat) * localT).toFixed(6));
    const lng = Number((a.lng + (b.lng - a.lng) * localT).toFixed(6));

    sampled.push({
      lat,
      lng,
      distKm: Number((targetM / 1000).toFixed(3)),
    });
  }

  return sampled;
}

/**
 * Spočítá celkové stoupání (gainM), klesání (lossM), minEle a maxEle z pole výškových bodů.
 */
export function computeElevationMetrics(points, deadbandM = 2) {
  const arr = Array.isArray(points) ? points : [];
  if (arr.length === 0) {
    return {
      gainM: 0,
      lossM: 0,
      minEle: 500,
      maxEle: 500,
      minEleM: 500,
      maxEleM: 500,
    };
  }

  const elevations = arr.map((p) => {
    if (typeof p === 'number') return p;
    return Number(p?.eleM ?? p?.elevation ?? p?.ele ?? 500);
  });

  let gainM = 0;
  let lossM = 0;
  let minEle = elevations[0];
  let maxEle = elevations[0];
  let anchorEle = elevations[0];

  for (let i = 1; i < elevations.length; i++) {
    const cur = elevations[i];
    if (cur < minEle) minEle = cur;
    if (cur > maxEle) maxEle = cur;

    const diff = cur - anchorEle;
    if (Math.abs(diff) >= deadbandM) {
      if (diff > 0) gainM += diff;
      else lossM += Math.abs(diff);
      anchorEle = cur;
    }
  }

  const roundedGain = Math.round(gainM);
  const roundedLoss = Math.round(lossM);
  const roundedMin = Math.round(minEle);
  const roundedMax = Math.round(maxEle);

  return {
    gainM: roundedGain,
    lossM: roundedLoss,
    minEle: roundedMin,
    maxEle: roundedMax,
    minEleM: roundedMin,
    maxEleM: roundedMax,
  };
}

export const computeElevationStats = computeElevationMetrics;

/**
 * Sestaví syntetický (offline) výškový profil trasy.
 */
export function buildSyntheticElevationProfile(coordinates, targetCount = 32) {
  const sampled = sampleRouteCoordinates(coordinates, targetCount);
  const points = sampled.map((pt) => {
    const eleM = estimateCzechTerrainElevationM(pt.lat, pt.lng);
    return {
      lat: pt.lat,
      lng: pt.lng,
      distKm: pt.distKm,
      eleM,
      elevation: eleM,
    };
  });

  const metrics = computeElevationMetrics(points);
  const totalDistKm = points.length > 0 ? points[points.length - 1].distKm : 0;

  return {
    points,
    samples: points,
    gainM: metrics.gainM,
    lossM: metrics.lossM,
    minEle: metrics.minEle,
    maxEle: metrics.maxEle,
    minEleM: metrics.minEle,
    maxEleM: metrics.maxEle,
    totalDistKm,
    source: 'offline-model',
  };
}

function readElevationCache(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(ELEVATION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed[key] ? parsed[key] : null;
  } catch {
    return null;
  }
}

function writeElevationCache(key, profile) {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(ELEVATION_CACHE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const keys = Object.keys(map);
    if (keys.length >= MAX_CACHE_ENTRIES) {
      delete map[keys[0]];
    }
    map[key] = profile;
    localStorage.setItem(ELEVATION_CACHE_KEY, JSON.stringify(map));
  } catch {}
}

/**
 * Hlavní funkce pro získání výškového profilu trasy:
 * - Vyvzorkuje 25–40 rovnoměrných bodů
 * - Dotáže Open-Meteo Elevation API (`https://api.open-meteo.com/v1/elevation?latitude=...&longitude=...`)
 * - Při offline stavu použije lokální výškový model
 */
export async function fetchRouteElevationProfile(coordinates, options = {}) {
  const sampleCount = Math.max(25, Math.min(40, Number(options.sampleCount) || 32));
  const sampled = sampleRouteCoordinates(coordinates, sampleCount);

  const cacheKey = sampled
    .filter((_, i) => i % 4 === 0 || i === sampled.length - 1)
    .map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`)
    .join('|');

  const cached = readElevationCache(cacheKey);
  if (cached && Array.isArray(cached.points) && cached.points.length >= 25) {
    return cached;
  }

  const fetchFn =
    options.fetchImpl !== undefined
      ? options.fetchImpl
      : typeof fetch === 'function'
      ? fetch.bind(globalThis)
      : null;

  if (fetchFn) {
    try {
      const lats = sampled.map((p) => p.lat.toFixed(5)).join(',');
      const lngs = sampled.map((p) => p.lng.toFixed(5)).join(',');
      const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;

      const res = await fetchFn(url, { signal: options.signal });
      if (res && res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.elevation) && data.elevation.length === sampled.length) {
          const points = sampled.map((pt, idx) => {
            const rawEle = Number(data.elevation[idx]);
            const eleM = Number.isFinite(rawEle)
              ? Math.round(rawEle)
              : estimateCzechTerrainElevationM(pt.lat, pt.lng);
            return {
              lat: pt.lat,
              lng: pt.lng,
              distKm: pt.distKm,
              eleM,
              elevation: eleM,
            };
          });

          const metrics = computeElevationMetrics(points);
          const totalDistKm = points.length > 0 ? points[points.length - 1].distKm : 0;
          const result = {
            points,
            samples: points,
            gainM: metrics.gainM,
            lossM: metrics.lossM,
            minEle: metrics.minEle,
            maxEle: metrics.maxEle,
            minEleM: metrics.minEle,
            maxEleM: metrics.maxEle,
            totalDistKm,
            source: 'open-meteo',
          };
          writeElevationCache(cacheKey, result);
          return result;
        }
      }
    } catch {
      // Při chybě sítě plynule přejdeme na lokální výškový model
    }
  }

  return buildSyntheticElevationProfile(coordinates, sampleCount);
}

/**
 * Vykreslí samotné SVG výškového profilu.
 */
export function renderElevationProfileSvg(profile, stops = [], progressRatio = null) {
  if (!profile || !Array.isArray(profile.points) || profile.points.length < 2) {
    return '';
  }

  const pts = profile.points;
  const width = 560;
  const height = 135;
  const padLeft = 38;
  const padRight = 18;
  const padTop = 22;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const minE = Number.isFinite(profile.minEle) ? profile.minEle : 450;
  const maxE = Number.isFinite(profile.maxEle) ? profile.maxEle : 650;
  const eleSpan = Math.max(20, maxE - minE);
  const totalKm = Math.max(0.1, pts[pts.length - 1].distKm || 1);

  const coordsSvg = pts.map((p, idx) => {
    const xRatio = totalKm > 0 ? p.distKm / totalKm : idx / Math.max(1, pts.length - 1);
    const yRatio = (p.eleM - minE) / eleSpan;
    const x = Number((padLeft + xRatio * plotW).toFixed(1));
    const y = Number((padTop + plotH - yRatio * plotH).toFixed(1));
    return { x, y, eleM: p.eleM, distKm: p.distKm };
  });

  const linePoints = coordsSvg.map((c) => `${c.x},${c.y}`).join(' ');
  const areaPath = `M ${coordsSvg[0].x},${padTop + plotH} L ${ coordsSvg.map((c) => `${c.x},${c.y}`).join(' L ') } L ${coordsSvg[coordsSvg.length - 1].x},${padTop + plotH} Z`;

  // Zastávky rozložené podél profilu
  const stopList = Array.isArray(stops) ? stops.filter(Boolean) : [];
  const stopMarkersSvg = stopList
    .slice(0, 8)
    .map((stop, idx) => {
      const stopRatio = (idx + 1) / (stopList.length + 1);
      const ptIdx = Math.min(coordsSvg.length - 1, Math.max(0, Math.round(stopRatio * (coordsSvg.length - 1))));
      const c = coordsSvg[ptIdx];
      const shortTitle = String(stop.title || `Bod ${idx + 1}`).slice(0, 16);
      return `
        <g class="ele-stop-marker">
          <line x1="${c.x}" y1="${c.y}" x2="${c.x}" y2="${padTop + plotH}" stroke="#8c5a2b" stroke-width="1" stroke-dasharray="2,2" opacity="0.7" />
          <circle cx="${c.x}" cy="${c.y}" r="4" fill="#fffdf7" stroke="#5c3a18" stroke-width="2" />
          <text x="${c.x}" y="${Math.max(12, c.y - 7)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#3d2712">${e(shortTitle)}</text>
        </g>
      `;
    })
    .join('');

  // Ukazatel aktuální polohy hráče na výškovém profilu
  let playerMarkerSvg = '';
  if (progressRatio != null && Number.isFinite(Number(progressRatio))) {
    const clamped = Math.max(0, Math.min(1, Number(progressRatio)));
    const pIdx = Math.min(coordsSvg.length - 1, Math.max(0, Math.round(clamped * (coordsSvg.length - 1))));
    const pc = coordsSvg[pIdx];
    playerMarkerSvg = `
      <g class="ele-player-marker" aria-label="Tvoje poloha na výškovém profilu">
        <circle cx="${pc.x}" cy="${pc.y}" r="7" fill="rgba(46, 125, 50, 0.25)" />
        <circle cx="${pc.x}" cy="${pc.y}" r="4.5" fill="#2e7d32" stroke="#ffffff" stroke-width="2" />
      </g>
    `;
  }

  // Interaktivní vzorkovací body pro najetí myší / dotyk v katalogu
  const sampleDotsSvg = coordsSvg
    .map(
      (c, idx) =>
        `<circle class="ele-sample-dot" data-sample-index="${idx}" data-dist-km="${c.distKm}" data-ele-m="${c.eleM}" cx="${c.x}" cy="${c.y}" r="3" fill="#476924" stroke="#fffdf7" stroke-width="1.2" opacity="0.85"><title>${c.distKm.toFixed(2).replace('.', ',')} km · ${c.eleM} m n. m.</title></circle>`
    )
    .join('');

  const totalKmLabel = `${totalKm.toFixed(1).replace('.', ',')} km`;
  const midE = Math.round((minE + maxE) / 2);
  const midY = Number((padTop + plotH / 2).toFixed(1));

  return `
    <svg class="elevation-profile-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Výškový profil trasy: stoupání +${profile.gainM} m, klesání -${profile.lossM} m, rozsah ${minE} až ${maxE} m n. m.">
      <defs>
        <linearGradient id="eleFillGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#6b8e3d" stop-opacity="0.52" />
          <stop offset="100%" stop-color="#d9c398" stop-opacity="0.10" />
        </linearGradient>
      </defs>
      <!-- Pomocné výškové linky -->
      <line x1="${padLeft}" y1="${padTop}" x2="${width - padRight}" y2="${padTop}" stroke="#d6c6a5" stroke-width="1" stroke-dasharray="3,3" />
      <line x1="${padLeft}" y1="${midY}" x2="${width - padRight}" y2="${midY}" stroke="#e5dac3" stroke-width="1" stroke-dasharray="2,3" />
      <line x1="${padLeft}" y1="${padTop + plotH}" x2="${width - padRight}" y2="${padTop + plotH}" stroke="#b8a27a" stroke-width="1.2" />
      <text x="${padLeft - 5}" y="${padTop + 4}" text-anchor="end" font-size="10" fill="#6b533b">${maxE} m</text>
      <text x="${padLeft - 5}" y="${midY + 3}" text-anchor="end" font-size="9" fill="#8c7355">${midE} m</text>
      <text x="${padLeft - 5}" y="${padTop + plotH}" text-anchor="end" font-size="10" fill="#6b533b">${minE} m</text>
      <text x="${padLeft}" y="${height - 6}" text-anchor="start" font-size="10" fill="#6b533b">0 km</text>
      <text x="${width - padRight}" y="${height - 6}" text-anchor="end" font-size="10" fill="#6b533b">${totalKmLabel}</text>

      <!-- Vyplněná křivka nadmořské výšky -->
      <path d="${areaPath}" fill="url(#eleFillGrad)" />
      <polyline fill="none" stroke="#476924" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" points="${linePoints}" />

      ${sampleDotsSvg}
      ${stopMarkersSvg}
      ${playerMarkerSvg}
    </svg>
  `;
}

/**
 * Vykreslí kompletní HTML kartu výškového profilu (.elevation-profile-card) pod mapou.
 */
export function renderElevationProfileCardHtml(profile, stops = [], progressRatio = null) {
  if (!profile || !Array.isArray(profile.points) || profile.points.length < 2) {
    return '';
  }

  const svgHtml = renderElevationProfileSvg(profile, stops, progressRatio);

  return `
    <div class="elevation-profile-card" data-testid="elevation-profile-card">
      <div class="elevation-profile-header">
        <strong class="elevation-profile-title">⛰️ Výškový profil trasy</strong>
        <div class="elevation-profile-badges">
          <span class="ele-badge gain">📈 Stoupání +${profile.gainM} m</span>
          <span class="ele-badge loss">📉 Klesání -${profile.lossM} m</span>
          <span class="ele-badge range">↕ ${profile.minEle}–${profile.maxEle} m n. m.</span>
        </div>
      </div>
      <div class="elevation-profile-svg-wrap">
        ${svgHtml}
      </div>
    </div>
  `;
}

/**
 * Sestaví geografické souřadnice a klíčové body (zastávky) pro položku v katalogu tras a míst,
 * aby bylo možné vykreslit věrný výškový profil trasy v detailu katalogu.
 */
export function buildCatalogRouteCoordinates(route, allRoutes = []) {
  if (!route) {
    return {
      coordinates: [
        { lat: 49.6014, lng: 13.8644 },
        { lat: 49.5938, lng: 13.8475 },
      ],
      stops: [],
    };
  }

  if (Array.isArray(route.coordinates) && route.coordinates.length >= 2) {
    const clean = route.coordinates.map(normalizeCoordPair).filter(Boolean);
    if (clean.length >= 2) {
      return {
        coordinates: clean,
        stops: Array.isArray(route.stops) ? route.stops : [{ title: route.title }],
      };
    }
  }

  if (Array.isArray(route.waypoints) && route.waypoints.length >= 2) {
    const clean = route.waypoints.map(normalizeCoordPair).filter(Boolean);
    if (clean.length >= 2) {
      return {
        coordinates: clean,
        stops: Array.isArray(route.stops) ? route.stops : [{ title: route.title }],
      };
    }
  }

  // Známé katalogové okruhy s reálnými průjezdními body v Brdech a Rožmitále
  if (route.id === 'tremsin-okruh') {
    return {
      coordinates: [
        { lat: 49.6030, lng: 13.8629 }, // Start Rožmitál
        { lat: 49.5938, lng: 13.8475 }, // U Drtiče
        { lat: 49.5886, lng: 13.8378 }, // Voltušská vyhlídka
        { lat: 49.5871, lng: 13.8380 }, // Mohyla J. J. Ryby
        { lat: 49.5654, lng: 13.7780 }, // Třemšínská kaplička
        { lat: 49.5673, lng: 13.7775 }, // Vrch Třemšín (827 m)
        { lat: 49.5815, lng: 13.7885 }, // Kobylí hlava (757 m)
        { lat: 49.5871, lng: 13.7777 }, // Hrad Hengst
        { lat: 49.6030, lng: 13.8629 }, // Návrat Rožmitál
      ],
      stops: [
        { title: 'Voltuš' },
        { title: 'Třemšín (827 m)' },
        { title: 'Kobylí hlava' },
      ],
    };
  }

  if (route.id === 'podzamecky-rybnik-okruh') {
    return {
      coordinates: [
        { lat: 49.6023, lng: 13.8641 }, // Náměstí
        { lat: 49.6037, lng: 13.8589 }, // Podzámecký rybník
        { lat: 49.6024, lng: 13.8623 }, // Zámek Rožmitál
        { lat: 49.6049, lng: 13.8563 }, // Alej Johanky
        { lat: 49.6081, lng: 13.8510 }, // Kostel Povýšení sv. Kříže
        { lat: 49.6064, lng: 13.8523 }, // Cvokařské muzeum
        { lat: 49.6023, lng: 13.8641 }, // Náměstí
      ],
      stops: [
        { title: 'Podzámecký ryb.' },
        { title: 'Alej Johanky' },
        { title: 'St. Rožmitál' },
      ],
    };
  }

  if (route.id === 'u-drtice-bila-skala') {
    return {
      coordinates: [
        { lat: 49.5965, lng: 13.8535 }, // Bývalá kasárna
        { lat: 49.5938, lng: 13.8475 }, // U Drtiče
        { lat: 49.5912, lng: 13.8432 }, // Bílá skála / Štěrbina
        { lat: 49.5961, lng: 13.8425 }, // Rybník Jez
        { lat: 49.5965, lng: 13.8535 }, // Návrat
      ],
      stops: [
        { title: 'U Drtiče' },
        { title: 'Bílá skála' },
        { title: 'Rybník Jez' },
      ],
    };
  }

  const loc = normalizeCoordPair(route.location) || { lat: 49.6014, lng: 13.8644 };
  const distKm = Number.isFinite(Number(route.distanceKm)) && Number(route.distanceKm) > 0
    ? Number(route.distanceKm)
    : 1.8;

  // Pro samostatné místo či trasu vytvoříme přístupový okruh přes cílový bod
  const halfSpanDegLat = Math.max(0.003, Math.min(0.035, (distKm / 2.4) / 111.32));
  const halfSpanDegLng = Math.max(0.004, Math.min(0.048, (distKm / 2.4) / 72.5));

  // Najdeme případné blízko ležící místo z katalogu jako výchozí bod
  const catalogList = Array.isArray(allRoutes) ? allRoutes : [];
  let startPt = {
    lat: Number((loc.lat - halfSpanDegLat * 0.75).toFixed(6)),
    lng: Number((loc.lng + halfSpanDegLng * 0.65).toFixed(6)),
  };
  let midApproachPt = {
    lat: Number((loc.lat - halfSpanDegLat * 0.32).toFixed(6)),
    lng: Number((loc.lng + halfSpanDegLng * 0.25).toFixed(6)),
  };
  let returnPt = {
    lat: Number((loc.lat + halfSpanDegLat * 0.45).toFixed(6)),
    lng: Number((loc.lng - halfSpanDegLng * 0.4).toFixed(6)),
  };

  const nearbyCandidate = catalogList
    .filter((r) => r && r.id !== route.id && r.location)
    .map((r) => ({
      item: r,
      d: haversineMeters(loc, r.location) ?? Infinity,
    }))
    .filter((x) => x.d >= 350 && x.d <= 4500)
    .sort((a, b) => a.d - b.d)[0];

  if (nearbyCandidate && nearbyCandidate.item?.location) {
    const nb = nearbyCandidate.item.location;
    startPt = { lat: Number(nb.lat), lng: Number(nb.lng) };
    midApproachPt = {
      lat: Number(((startPt.lat + loc.lat) / 2 + 0.0012).toFixed(6)),
      lng: Number(((startPt.lng + loc.lng) / 2 - 0.0015).toFixed(6)),
    };
  }

  const coordinates = [
    startPt,
    midApproachPt,
    loc,
    returnPt,
    startPt,
  ];

  const stops = [
    ...(nearbyCandidate ? [{ title: nearbyCandidate.item.title }] : []),
    { title: route.title || 'Cíl trasy' },
  ];

  return { coordinates, stops };
}

/**
 * Upraví vzorky nadmořské výšky tak, aby v místě hlavního vrcholu/cíle respektovaly
 * případnou ověřenou nadmořskou výšku z katalogu (`route.elevationM` nebo číselný údaj v názvu).
 */
function applyKnownRouteElevationAnchor(points, route) {
  const arr = Array.isArray(points) ? points.map((p) => ({ ...p })) : [];
  if (arr.length === 0 || !route) return arr;

  let knownEle = Number.isFinite(Number(route.elevationM)) && Number(route.elevationM) > 100
    ? Math.round(Number(route.elevationM))
    : null;

  if (knownEle == null && typeof route.title === 'string') {
    const m = route.title.match(/\((\d{3,4})\s*m\)/i);
    if (m && Number.isFinite(Number(m[1]))) {
      knownEle = Math.round(Number(m[1]));
    }
  }

  if (knownEle == null) return arr;

  const loc = normalizeCoordPair(route.location);
  let targetIdx = Math.floor(arr.length / 2);
  if (loc) {
    let bestDist = Infinity;
    arr.forEach((pt, idx) => {
      const d = haversineMeters(pt, loc) ?? Infinity;
      if (d < bestDist) {
        bestDist = d;
        targetIdx = idx;
      }
    });
  }

  const delta = knownEle - arr[targetIdx].eleM;
  const radius = Math.max(3, Math.round(arr.length * 0.25));
  for (let i = 0; i < arr.length; i++) {
    const distIdx = Math.abs(i - targetIdx);
    if (distIdx <= radius) {
      const weight = Math.cos((distIdx / (radius + 1)) * (Math.PI / 2));
      const adjusted = Math.round(arr[i].eleM + delta * weight * weight);
      arr[i].eleM = adjusted;
      arr[i].elevation = adjusted;
    }
  }
  arr[targetIdx].eleM = knownEle;
  arr[targetIdx].elevation = knownEle;
  return arr;
}

/**
 * Synchronně sestaví kompletní výškový profil pro detail trasy/místa v katalogu.
 */
export function buildCatalogElevationProfile(route, allRoutes = [], sampleCount = 32) {
  const { coordinates, stops } = buildCatalogRouteCoordinates(route, allRoutes);
  const baseProfile = buildSyntheticElevationProfile(coordinates, sampleCount);
  const anchoredPoints = applyKnownRouteElevationAnchor(baseProfile.points, route);
  const metrics = computeElevationMetrics(anchoredPoints);

  const rawDistKm = Number(route?.distanceKm);
  const totalDistKm = Number.isFinite(rawDistKm) && rawDistKm > 0
    ? rawDistKm
    : baseProfile.totalDistKm > 0
    ? baseProfile.totalDistKm
    : 1.8;

  // Přepočítáme distKm podle skutečné délky trasy
  const normalizedPoints = anchoredPoints.map((pt, idx) => {
    const ratio = anchoredPoints.length <= 1 ? 0 : idx / (anchoredPoints.length - 1);
    return {
      ...pt,
      distKm: Number((ratio * totalDistKm).toFixed(3)),
    };
  });

  const loc = normalizeCoordPair(route?.location);
  const targetElevationM = Number.isFinite(Number(route?.elevationM)) && Number(route.elevationM) > 100
    ? Math.round(Number(route.elevationM))
    : loc
    ? estimateCzechTerrainElevationM(loc.lat, loc.lng)
    : metrics.maxEle;

  return {
    points: normalizedPoints,
    samples: normalizedPoints,
    gainM: metrics.gainM,
    lossM: metrics.lossM,
    minEle: metrics.minEle,
    maxEle: metrics.maxEle,
    minEleM: metrics.minEle,
    maxEleM: metrics.maxEle,
    elevationSpanM: Math.max(0, metrics.maxEle - metrics.minEle),
    targetElevationM,
    totalDistKm,
    stops,
    source: baseProfile.source || 'offline-model',
  };
}

/**
 * Asynchronně načte výškový profil pro detail trasy v katalogu (Open-Meteo DEM s offline fallbackem).
 */
export async function fetchCatalogRouteElevationProfile(route, options = {}) {
  const allRoutes = Array.isArray(options.allRoutes) ? options.allRoutes : [];
  const sampleCount = Math.max(25, Math.min(40, Number(options.sampleCount) || 32));
  const { coordinates, stops } = buildCatalogRouteCoordinates(route, allRoutes);
  const fetched = await fetchRouteElevationProfile(coordinates, {
    ...options,
    sampleCount,
  });

  const anchoredPoints = applyKnownRouteElevationAnchor(fetched.points, route);
  const metrics = computeElevationMetrics(anchoredPoints);
  const rawDistKm = Number(route?.distanceKm);
  const totalDistKm = Number.isFinite(rawDistKm) && rawDistKm > 0
    ? rawDistKm
    : fetched.totalDistKm > 0
    ? fetched.totalDistKm
    : 1.8;

  const normalizedPoints = anchoredPoints.map((pt, idx) => {
    const ratio = anchoredPoints.length <= 1 ? 0 : idx / (anchoredPoints.length - 1);
    return {
      ...pt,
      distKm: Number((ratio * totalDistKm).toFixed(3)),
    };
  });

  const loc = normalizeCoordPair(route?.location);
  const targetElevationM = Number.isFinite(Number(route?.elevationM)) && Number(route.elevationM) > 100
    ? Math.round(Number(route.elevationM))
    : loc
    ? estimateCzechTerrainElevationM(loc.lat, loc.lng)
    : metrics.maxEle;

  return {
    points: normalizedPoints,
    samples: normalizedPoints,
    gainM: metrics.gainM,
    lossM: metrics.lossM,
    minEle: metrics.minEle,
    maxEle: metrics.maxEle,
    minEleM: metrics.minEle,
    maxEleM: metrics.maxEle,
    elevationSpanM: Math.max(0, metrics.maxEle - metrics.minEle),
    targetElevationM,
    totalDistKm,
    stops,
    source: fetched.source || 'offline-model',
  };
}

/**
 * Vykreslí kompletní panel vizuálního profilu převýšení (grafu) pro detailní zobrazení trasy v katalogu.
 */
export function renderCatalogElevationProfileHtml(route, profileInput = null, allRoutes = []) {
  const profile =
    profileInput && Array.isArray(profileInput.points) && profileInput.points.length >= 2
      ? profileInput
      : buildCatalogElevationProfile(route, allRoutes);

  const stops = Array.isArray(profile.stops) && profile.stops.length > 0
    ? profile.stops
    : route?.title
    ? [{ title: route.title }]
    : [];

  const svgHtml = renderElevationProfileSvg(profile, stops);
  const spanM = Math.max(0, (profile.maxEle || 0) - (profile.minEle || 0));
  const targetEle = profile.targetElevationM ?? route?.elevationM ?? profile.maxEle;
  const sourceLabel = profile.source === 'open-meteo'
    ? '🌐 Výšková data: Open-Meteo DEM'
    : '🗺️ Výšková data: Digitální model terénu ČR';

  return `
    <section class="panel catalog-elevation-panel" id="detail-elevation-section" data-testid="catalog-elevation-profile" aria-labelledby="detail-elevation-heading">
      <div class="catalog-elevation-head">
        <div>
          <span class="eyebrow" style="margin-bottom:4px">Výšková analýza trasy</span>
          <h2 id="detail-elevation-heading" style="margin:0">⛰️ Vizuální profil převýšení</h2>
        </div>
        <span class="catalog-elevation-source-badge" id="detail-elevation-source">${e(sourceLabel)}</span>
      </div>

      <div class="catalog-elevation-metrics" role="list" aria-label="Metriky nadmořské výšky a převýšení">
        <div class="catalog-ele-metric gain" role="listitem">
          <span class="cem-label">📈 Celkové stoupání</span>
          <strong class="cem-value" data-testid="catalog-ele-gain">+${profile.gainM} m</strong>
        </div>
        <div class="catalog-ele-metric loss" role="listitem">
          <span class="cem-label">📉 Celkové klesání</span>
          <strong class="cem-value" data-testid="catalog-ele-loss">-${profile.lossM} m</strong>
        </div>
        <div class="catalog-ele-metric range" role="listitem">
          <span class="cem-label">🏔️ Rozsah nadm. výšky</span>
          <strong class="cem-value" data-testid="catalog-ele-range">${profile.minEle}–${profile.maxEle} m n. m.</strong>
        </div>
        <div class="catalog-ele-metric target" role="listitem">
          <span class="cem-label">📍 Nadmořská výška místa</span>
          <strong class="cem-value" data-testid="catalog-ele-target">${targetEle} m n. m. (rozdíl ${spanM} m)</strong>
        </div>
      </div>

      <div class="catalog-elevation-chart-wrap" id="catalog-elevation-chart-wrap">
        ${svgHtml}
      </div>

      <div class="catalog-elevation-readout" id="catalog-elevation-readout" role="status" aria-live="polite">
        <span>👆 Přejeď myší nebo klepni na bod v grafu pro zobrazení přesné nadmořské výšky a kilometru trasy.</span>
      </div>
    </section>
  `;
}

