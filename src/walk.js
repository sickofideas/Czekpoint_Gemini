import {
  config as defaultAppConfig,
  DEFAULT_3D_PITCH,
  DEFAULT_TERRAIN_EXAGGERATION,
  normalizePointLatLng,
  toMapLibreLngLat,
  toLngLat,
  createGeoJsonCirclePolygon,
  buildMapLibreStyle,
} from '../config.js';
import {
  emptyWalk,
  acceptFix,
  cellBounds,
  cellCenter,
  score,
  trophies,
  discoverNearby,
  appendTrail,
  pruneTrail,
  explorerRank,
  chapterStatus,
  dailyChallenge,
  totalScore,
  expeditionPointsDelta,
  MAX_GPS_ACCURACY_M,
  FOG_REVEAL_RADIUS_M,
  STOP_CONFIRM_RADIUS_M,
  NEARBY_RECORD_RADIUS_M,
  VISIT_RECORD_TYPES,
  classifyVisitRecord,
  evaluateStopConfirmation,
  reorderPlannedStops,
  replacePlannedStop,
  removePlannedStop,
  computeFootprintPlacements,
  appendToWalkSegments,
  validateGpsSample,
} from './walk-engine.js';
import {
  loadState,
  saveState,
  emptyState,
  exportStateJson,
  previewImportState,
  importStateJson,
  STATE_KEY,
  COMPANION_MODES,
  EXPLORATION_MODES,
  DEFAULT_APP_SETTINGS,
  PERSONAL_MEMORY_SYMBOLS,
  MINDFULNESS_PROMPTS,
  sanitizeMemoryNoteText,
  createPersonalMemoryEntry,
  upsertExpeditionHistory,
} from './walk-store.js';
import {
  createExpedition,
  pauseExpedition,
  resumeExpedition,
  updateExpeditionGoal,
  isGoalAchieved,
  recordExpeditionVisit,
  endExpedition,
  DEFAULT_GOALS,
} from './expedition-engine.js';
import { renderPostcard, generatePostcardBlob, generatePostcardDataUrl } from './postcard.js';
import {
  renderPostcardSvgDataUrl,
  POSTCARD_THEMES,
  estimateStepsFromMeters,
  formatActiveDuration,
  formatElevationSummary,
  normalizeWalkSegments,
} from './postcards.js';
import { fetchNearby } from './nearby.js';
import {
  loadAutoPlacesForArea,
  getLastAutoPlacesStatus,
  POI_VISUAL_CATEGORIES,
  resolvePlaceVisualCategory,
} from './auto-places.js';
import {
  getFallbackBitmapUrl,
  getCachedPlacePhoto,
  resolveVerifiedPlacePhoto,
  prefetchVerifiedPhotosForPlaces,
} from './poi-photos.js';
import {
  getPlacePhotoSync,
  resolvePlacePhoto,
  prefetchPlacePhotos,
  formatPhotoSourceLabel,
} from './place-photos.js';
import {
  fetchRouteElevationProfile,
  renderElevationProfileCardHtml,
} from './elevation.js';
import {
  downloadOfflineArea,
  loadOfflineAreaData,
} from './offline-maps.js';
import {
  createCompassStabilizer,
  interpolateBackgroundGap,
  triggerPocketProximityAlert,
  playTurnAudioCue,
  createKeepAliveController,
  unlockSpeechSynthesis,
} from './keep-alive.js';
import { haversineMeters } from './domain.js';
import { escapeHtml as e, number } from './ui.js';
import { CHAPTERS, COLLECTIONS, RELICS } from './data.js';
import {
  START_PRESETS,
  PLANNER_RADII,
  PLANNER_CATEGORIES,
  TERRAIN_DIFFICULTIES,
  CZECH_PLACE_PRESETS,
  COMPANION_STYLES,
  optimizeRouteOrder,
  analyzePlannedRoute,
  autoSuggestTrip,
  fetchWalkingGeometry,
  fetchElevationProfile,
  encodeRouteShareCode,
  decodeRouteShareCode,
  validateDecodedRoutePlan,
  computeRemainingFromSharedRoute,
  buildLocalRoutedGeometry,
  computeActiveTurnInstruction,
  normalizeSearchQuery,
  searchPlaceNominatim,
  buildReturnToOriginRoute,
  computeQuadrantSector,
  sortPlacesClockwise,
  computeLateralLoopWaypoint,
  insertStopAtBestPosition,
  ensureLoopDetourWaypoints,
  snapPointToPedestrianPath,
} from './planner.js';
import { ALLOWED_AVATARS, avatarUrl } from './avatars.js';
import {
  getWalkingStickTier,
  createStickBadge,
  renderStickBadgeSvg,
  renderWalkingStickHtml,
} from './walking-stick.js';
import {
  recordWalkInLedger,
  recordMemoryInLedger,
  recordGpsPlaceInLedger,
  evaluateMilestones,
} from './achievements.js';
import {
  getLocalRevirPilgrims,
  renderPilgrimsSection,
  recordSummitEntry,
} from './pilgrims.js';
import {
  playTick,
  playHammer,
  playRadar,
  playStampChord,
  animateValue,
  triggerHaptic,
  vibrateStopArrival,
  vibrateStampRecorded,
  animateStampEarned,
  applyStaggerAnimation,
} from './fx.js';
import { initGpsSimulator, ROZMITAL_CENTER, moveCoordinates, calculateBearing } from './gps-simulator.js';
import { getHikingTrails, renderOsmcBadgeSvg, parseOsmcSymbol } from './hiking-trails.js';
import {
  computeVisibleMapCenterForPlayer,
  createTelemetryState,
  updateTelemetryTimers,
  updateTelemetryAltitude,
  updateTelemetryFromFix,
  computeTouristStatsSummary,
  GPS_OUTAGE_WARNING_MS,
  formatMetersCz,
} from './telemetry.js';
import { getWeatherForNext60Min } from './weather.js';
import {
  BUILTIN_NATURAL_FEATURES,
  evaluateNaturalFeatureReveals,
  resolveAccessibleStopLocation,
} from './natural-features.js';
import {
  startBackgroundTracking,
  updateBackgroundTracking,
  pauseBackgroundTracking,
  stopBackgroundTracking,
} from './background-keepalive.js';

export function formatDistanceLabel(meters, suffix = '') {
  if (meters == null || !Number.isFinite(meters) || meters < 0) {
    return 'Poloha není určena';
  }
  const base = meters >= 1000
    ? `${(meters / 1000).toFixed(1).replace('.', ',')} km`
    : `${Math.round(meters)} m`;
  return suffix ? `${base} ${suffix}` : base;
}

export function formatDurationCz(minutes) {
  const mins = Math.max(1, Math.round(Number(minutes) || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `~${m} min`;
  if (m === 0) return `~${h} hod`;
  return `~${h} hod ${m} min`;
}

export function formatStopsCountCz(count) {
  const n = Number(count) || 0;
  if (n === 1) return '1 zastávka';
  if (n >= 2 && n <= 4) return `${n} zastávky`;
  return `${n} zastávek`;
}

/**
 * @param {Object} [options]
 * @param {Array<any>} [options.plannedPlaces]
 * @param {Set<string> | Array<string> | null | any} [options.confirmedStopIds]
 * @param {any} [options.rem]
 * @param {number} [options.speedKmH]
 * @returns {{ totalStops: number, mode: string, textHtml: string, plainText: string, nextStop?: any, remDistM?: number, remTimeStr?: string }}
 */
export function getActiveWalkStopsStatus({ plannedPlaces = /** @type {any[]} */ ([]), confirmedStopIds = /** @type {any} */ (null), rem = /** @type {any} */ (null), speedKmH = 4.2 } = {}) {
  const totalStops = Array.isArray(plannedPlaces) ? plannedPlaces.length : 0;
  if (totalStops === 0) {
    return {
      totalStops: 0,
      mode: 'free_walk',
      textHtml: '🥾 <strong>Volná chůze · Odkrývání mapy</strong>',
      plainText: '🥾 Volná chůze · Odkrývání mapy',
      nextStop: null,
    };
  }
  const remDistM = rem?.remainingDistanceM != null ? rem.remainingDistanceM : 0;
  const safeSpeed = Number.isFinite(speedKmH) && speedKmH > 0 ? speedKmH : 4.2;
  const remMins = Math.max(1, Math.round((remDistM / 1000) / safeSpeed * 60));
  const remTimeStr = formatDurationCz(remMins);
  const remDistStr = formatDistanceLabel(remDistM);
  if (rem?.nextStop) {
    const nextDistStr = rem.nextStopDistanceM != null ? formatDistanceLabel(rem.nextStopDistanceM) : '';
    const safeTitle = typeof rem.nextStop.title === 'string' ? rem.nextStop.title : 'Zastávka';
    return {
      totalStops,
      mode: 'in_progress',
      textHtml: `Do cíle <strong>${remTimeStr} (${remDistStr})</strong> · 🎯 Další: <strong>${safeTitle}</strong>${nextDistStr ? ` (${nextDistStr})` : ''}`,
      plainText: `Do cíle ${remTimeStr} (${remDistStr}) · 🎯 Další: ${safeTitle}`,
      nextStop: rem.nextStop,
      remDistM,
      remTimeStr,
    };
  }
  return {
    totalStops,
    mode: 'all_visited',
    textHtml: `Do cíle <strong>${remTimeStr} (${remDistStr})</strong> · 🎉 Všechny zastávky navštíveny`,
    plainText: `Do cíle ${remTimeStr} (${remDistStr}) · 🎉 Všechny zastávky navštíveny`,
    nextStop: null,
    remDistM,
    remTimeStr,
  };
}

/**
 * @param {number | string | Date | null | any} [lastFixTimestamp]
 * @param {number} [now]
 * @returns {string}
 */
export function formatBackgroundGpsStatus(lastFixTimestamp = /** @type {any} */ (null), now = Date.now()) {
  const DISCLAIMER = 'Záznam při zamčené obrazovce závisí na omezeních vašeho telefonu a prohlížeče — pro nejspolehlivější záznam kontrolujte polohu při rozsvíceném displeji.';
  if (!lastFixTimestamp) {
    return `🔋 Záznam na pozadí: Čekám na GPS vzorek · ${DISCLAIMER}`;
  }
  const tsNum = typeof lastFixTimestamp === 'number' ? lastFixTimestamp : new Date(lastFixTimestamp).getTime();
  if (!Number.isFinite(tsNum) || tsNum <= 0) {
    return `🔋 Záznam na pozadí: Čekám na GPS vzorek · ${DISCLAIMER}`;
  }
  const diffSec = Math.max(0, Math.round((now - tsNum) / 1000));
  const timeStr = new Date(tsNum).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const agoStr = diffSec < 5 ? 'právě teď' : `před ${diffSec} s`;
  return `🔋 Záznam na pozadí: Poslední GPS vzorek ${timeStr} (${agoStr}) · ${DISCLAIMER}`;
}

/**
 * Vykreslí jemné vektorové SVG pro vnitřek mapové značky podle kategorie místa.
 * Samotná poloha značky na mapě zůstává výhradně v režii Leafletu; animuje se jen tento vnitřní prvek.
 */
const CATEGORY_MARKER_GLYPH_CACHE = new Map();

export function renderCategoryMarkerGlyph(kind, state = 'default') {
  const cacheKey = `${kind || 'default'}|${state || 'default'}`;
  const cachedSvg = CATEGORY_MARKER_GLYPH_CACHE.get(cacheKey);
  if (cachedSvg) return cachedSvg;

  let svg = '';
  if (state === 'visited') {
    svg = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" class="marker-glyph-svg"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  } else if (kind === 'water') {
    svg = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" class="marker-glyph-svg"><path class="glyph-wave-1" d="M3 10.5c2.2-1.8 4.5-1.8 6.7 0s4.5 1.8 6.7 0 3.4-1.4 4.6-.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path class="glyph-wave-2" d="M3 15.5c2.2-1.8 4.5-1.8 6.7 0s4.5 1.8 6.7 0 3.4-1.4 4.6-.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  } else if (kind === 'forest' || kind === 'nature') {
    svg = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" class="marker-glyph-svg"><g class="glyph-tree-crown"><polygon points="12,3 6,11 9.5,11 5.5,17 18.5,17 14.5,11 18,11" fill="currentColor"/></g><rect x="10.8" y="17" width="2.4" height="4" rx="1" fill="currentColor"/></svg>`;
  } else if (kind === 'view' || kind === 'views') {
    svg = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" class="marker-glyph-svg"><path d="M2.5 18.5L9.5 7.5l4.2 6.2 2.8-4.2 5 9H2.5z" fill="currentColor"/><circle class="glyph-sun-glint" cx="17.5" cy="6" r="2.2" fill="currentColor"/></svg>`;
  } else if (kind === 'sacral') {
    svg = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" class="marker-glyph-svg"><path d="M12 2v5M9.5 4.5h5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M6 20V11l6-4.5L18 11v9H6zm4.2-5v5h3.6v-5a1.8 1.8 0 0 0-3.6 0z" fill="currentColor"/></svg>`;
  } else if (kind === 'culture' || kind === 'castles') {
    svg = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" class="marker-glyph-svg"><path d="M4 19V7h3v2h2V7h6v2h2V7h3v12H4zm6-5v5h4v-5a2 2 0 0 0-4 0z" fill="currentColor"/></svg>`;
  } else if (kind === 'route-start') {
    svg = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" class="marker-glyph-svg"><line x1="6" y1="4" x2="6" y2="20" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path class="glyph-flag-cloth" d="M6 5h11l-2.4 3.8L17 12.5H6V5z" fill="currentColor"/></svg>`;
  } else {
    svg = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" class="marker-glyph-svg"><circle cx="12" cy="12" r="5.5" fill="currentColor"/></svg>`;
  }

  CATEGORY_MARKER_GLYPH_CACHE.set(cacheKey, svg);
  return svg;
}

/**
 * Vykreslí ikonu levé nebo pravé podrážky pohorky (`.footprint-marker`, 26 × 26 px)
 * s vysokým kontrastem: tmavě hnědý/černý obrys (#1a120b) a jasně zlatavý/světlý vnitřek podrážky (#f5c542 / #e8d5a7)
 * s výrazným vzorkem pohorky (Bod 4).
 */
export function renderBootFootprintSvg(side = 'L', bearingDeg = 0, opacity = 0.88) {
  const isLeft = side === 'L';
  const scaleX = isLeft ? 1 : -1;
  const safeOpacity = Number.isFinite(Number(opacity)) ? Math.max(0.2, Math.min(0.95, Number(opacity))) : 0.88;
  return `
    <span class="footprint-marker czekpoint-footprint-rotator" style="opacity:${safeOpacity};transform: rotate(${Math.round(bearingDeg)}deg) scaleX(${scaleX});">
      <svg viewBox="0 0 22 30" width="22" height="26" aria-hidden="true" class="footprint-svg">
        <!-- Obrys a výplň přední části podrážky pohorky -->
        <path d="M6.8 2.2 C4.2 2.7 2.8 5.4 3.2 9.5 C3.6 13.2 4.6 15.4 5.2 17.5 L16.8 17.5 C17.4 15.2 18.2 12.8 18.4 9.2 C18.6 4.9 16.5 2.1 13.2 1.9 C11.3 1.8 9.0 2.0 6.8 2.2 Z"
          fill="#f5c542" stroke="#1a120b" stroke-width="1.8" stroke-linejoin="round"/>
        <!-- Příčné zuby vzorku pohorky (hluboký trek vzorek) -->
        <line x1="5.2" y1="6.0" x2="16.4" y2="6.0" stroke="#1a120b" stroke-width="1.3" stroke-linecap="round"/>
        <line x1="5.5" y1="9.8" x2="16.2" y2="9.8" stroke="#1a120b" stroke-width="1.3" stroke-linecap="round"/>
        <line x1="5.8" y1="13.6" x2="16.0" y2="13.6" stroke="#1a120b" stroke-width="1.3" stroke-linecap="round"/>
        <!-- Podpatek pohorky -->
        <path d="M5.5 19.8 L16.5 19.8 L15.9 26.2 C15.6 28.5 13.8 29.8 11.2 29.8 C8.6 29.8 6.8 28.5 6.4 26.2 Z"
          fill="#e8d5a7" stroke="#1a120b" stroke-width="1.8" stroke-linejoin="round"/>
        <line x1="7.4" y1="24.2" x2="14.6" y2="24.2" stroke="#1a120b" stroke-width="1.3" stroke-linecap="round"/>
      </svg>
    </span>
  `;
}

/**
 * Vykreslí živého animovaného Avatara hráče na mapě (`.player-avatar-marker`, 72 × 72 px ve 2D, 86 × 86 px ve 3D)
 * s obíhající zlatou směrovou šipkou (`.avatar-direction-pointer`), perspektivním stínem a pulzujícím prstencem na zemi (Bod 3).
 */
export function renderPlayerAvatarMarkerHtml(arg1 = 'liska', arg2 = 0, arg3 = false) {
  const opts = typeof arg1 === 'object' && arg1 !== null
    ? arg1
    : { avatarId: arg1, bearingDeg: arg2, isWalking: arg3 };
  const avatarId = opts.avatarId || 'liska';
  const bearingDeg = Number.isFinite(Number(opts.bearingDeg)) ? Number(opts.bearingDeg) : 0;
  const isWalking = Boolean(opts.isWalking);
  const is3D = Boolean(opts.is3D || opts.is3dMode || opts.is3DMode);
  const imgSrc = avatarUrl(avatarId);
  const avatarMeta = ALLOWED_AVATARS.find(a => a.id === avatarId) || ALLOWED_AVATARS[0];
  const showArrow = opts.orbitalArrow !== false && opts.showOrbitalArrow !== false;
  const profileBg = opts.profile?.bgColor || opts.bgColor;
  const profileRing = opts.profile?.ringColor || opts.ringColor;
  const coreStyle = [
    profileBg ? `background: ${profileBg};` : '',
    profileRing ? `border-color: ${profileRing};` : '',
  ].filter(Boolean).join(' ');

  return `
    <div class="player-avatar-marker ${isWalking ? 'is-walking' : 'is-idle'} ${is3D ? 'is-3d-avatar' : ''}" data-avatar-id="${e(avatarMeta.id)}">
      <div class="avatar-ground-shadow" aria-hidden="true"></div>
      <div class="avatar-ground-ring" aria-hidden="true"></div>
      <div class="avatar-direction-pointer" style="transform: rotate(${Math.round(bearingDeg)}deg); ${showArrow ? '' : 'display:none;'}" title="Směr k další zastávce">
        <svg viewBox="0 0 24 24" class="avatar-direction-arrow" aria-hidden="true">
          <path d="M12 1 L21 18 L12 14 L3 18 Z" fill="#ffd25a" stroke="#1a120b" stroke-width="2" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="avatar-medallion-core player-avatar-inner" style="${e(coreStyle)}">
        <img src="${e(imgSrc)}" alt="${e(avatarMeta.name)}" width="58" height="58" class="player-avatar-img">
      </div>
    </div>
  `;
}

export { normalizePointLatLng, toMapLibreLngLat, toLngLat, createGeoJsonCirclePolygon, buildMapLibreStyle };

/**
 * Převede pole bodů trasy (`[lat, lng]` nebo `{ lat, lng }`) na GeoJSON FeatureCollection
 * v pořadí `[lng, lat]` pro vykreslení v MapLibre GL JS.
 */
export function buildPlannedRouteGeoJson(coords = [], isFallback = false) {
  if (!Array.isArray(coords) || coords.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  const lngLats = coords.map(toMapLibreLngLat).filter(Boolean);
  if (lngLats.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          isFallback: Boolean(isFallback),
          lineColor: '#f5b82e',
          lineWidth: 5,
          casingColor: '#2e1065',
          casingWidth: 9,
        },
        geometry: {
          type: 'LineString',
          coordinates: lngLats,
        },
      },
    ],
  };
}

/**
 * Převede prošlé úseky (`walkSegments`) na GeoJSON FeatureCollection v pořadí `[lng, lat]`.
 */
export function buildWalkSegmentsGeoJson(walkSegments = []) {
  if (!Array.isArray(walkSegments) || walkSegments.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }
  const features = [];
  for (let i = 0; i < walkSegments.length; i++) {
    const seg = walkSegments[i];
    if (!Array.isArray(seg) || seg.length < 2) continue;
    const lngLats = seg.map(toLngLat).filter(Boolean);
    if (lngLats.length < 2) continue;
    features.push({
      type: 'Feature',
      properties: { segmentIndex: i },
      geometry: {
        type: 'LineString',
        coordinates: lngLats,
      },
    });
  }
  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Převede načtené turistické trasy KČT na GeoJSON FeatureCollection v pořadí `[lng, lat]`.
 */
export function buildHikingTrailsGeoJson(trails = []) {
  if (!Array.isArray(trails) || trails.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }
  const features = [];
  for (const trail of trails) {
    if (!trail || !Array.isArray(trail.coordinates) || trail.coordinates.length < 2) continue;
    const lngLats = trail.coordinates.map(toLngLat).filter(Boolean);
    if (lngLats.length < 2) continue;
    const parsed = trail.parsedSymbol || parseOsmcSymbol(trail.osmcSymbol, trail.colour);
    features.push({
      type: 'Feature',
      properties: {
        id: trail.id || '',
        name: trail.name || 'Turistická trasa',
        color: parsed?.hex || '#d62828',
        labelCz: parsed?.labelCz || '',
        osmcSymbol: trail.osmcSymbol || '',
        operator: trail.operator || 'KČT',
        distance: trail.distance || '',
      },
      geometry: {
        type: 'LineString',
        coordinates: lngLats,
      },
    });
  }
  return {
    type: 'FeatureCollection',
    features,
  };
}

export const EMPTY_TRANSPARENT_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * DÁVKA 3 (Bod 2.1): Spočítá skutečný geografický azimut z polohy hráče k cíli v rozsahu [0, 360),
 * kde 0° = geografický sever, 90° = východ, 180° = jih, 270° = západ.
 */
export function computeGeodesicBearingDeg(fromPt, toPt) {
  const lat1Num = Number(fromPt?.lat ?? fromPt?.[0]);
  const lng1Num = Number(fromPt?.lng ?? fromPt?.[1]);
  const lat2Num = Number(toPt?.lat ?? toPt?.[0]);
  const lng2Num = Number(toPt?.lng ?? toPt?.[1]);
  if (![lat1Num, lng1Num, lat2Num, lng2Num].every(Number.isFinite)) return null;
  if (Math.abs(lat1Num - lat2Num) < 1e-9 && Math.abs(lng1Num - lng2Num) < 1e-9) return 0;

  const dLng = ((lng2Num - lng1Num) * Math.PI) / 180;
  const lat1 = (lat1Num * Math.PI) / 180;
  const lat2 = (lat2Num * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * DÁVKA 3 (Bod 2.1): Přepočet úhlu směrové šipky u Avatara pro otočenou mapu:
 * screenRelativeAngleDeg = (targetBearingDeg - currentMapBearingDeg + 360) % 360
 * Když uživatel míří telefonem přímo k cíli (targetBearingDeg === currentMapBearingDeg),
 * šipka u Avatara ukazuje přímo nahoru (0°).
 */
export function computeScreenRelativeAngleDeg(targetBearingDeg, currentMapBearingDeg = 0) {
  const t = Number(targetBearingDeg);
  const b = Number(currentMapBearingDeg) || 0;
  if (!Number.isFinite(t)) return 0;
  const screenRelativeAngleDeg = (((t - b) % 360) + 360) % 360;
  return screenRelativeAngleDeg;
}

/**
 * DÁVKA 3 (Bod 3.1): Extrahuje skutečný azimut vůči geografickému severu ze senzoru zařízení.
 * Nikdy si nevymýšlí náhradní hodnoty kompasu — pokud událost neobsahuje absolutní azimut, vrátí null.
 */
export function extractAbsoluteCompassHeadingDeg(event) {
  if (!event || typeof event !== 'object') return null;

  // 1. iOS Safari: webkitCompassHeading (0° = sever, po směru hodinových ručiček)
  if (event.webkitCompassHeading != null && Number.isFinite(Number(event.webkitCompassHeading))) {
    const acc = event.webkitCompassAccuracy != null ? Number(event.webkitCompassAccuracy) : 15;
    if (acc < 0 || acc > 65) return null;
    const h = Number(event.webkitCompassHeading);
    if (h >= 0) {
      return ((h % 360) + 360) % 360;
    }
  }

  // 2. Android / standardní absolutní orientace: musí být explicitně absolute === true nebo deviceorientationabsolute
  const isAbsolute = event.absolute === true || event.type === 'deviceorientationabsolute';
  if (isAbsolute && event.alpha != null && Number.isFinite(Number(event.alpha))) {
    const alpha = Number(event.alpha);
    return (((360 - alpha) % 360) + 360) % 360;
  }

  return null;
}

/**
 * DÁVKA 3 (Bod 3.2): Pravdivě označená náhrada směrem chůze z GPS, když telefon neposkytuje kompas.
 * Použije se POUZE tehdy, když se uživatel prokazatelně a spolehlivě pohybuje
 * (rychlost chůze >= 1.0 m/s a přesnost GPS <= 25 m).
 */
export function computeGpsWalkingCourseDeg(prevFix, currentFix) {
  const GPS_COURSE_FALLBACK_LABEL = '🧭 Směr podle chůze (GPS) — telefon neposkytuje kompas';
  if (!currentFix || !Number.isFinite(Number(currentFix.lat)) || !Number.isFinite(Number(currentFix.lng))) {
    return { valid: false, headingDeg: null, source: 'none', label: null };
  }

  const acc = Number(currentFix.accuracy);
  if (!Number.isFinite(acc) || acc <= 0 || acc > 25) {
    return { valid: false, headingDeg: null, source: 'none', label: null };
  }

  const hasExplicitHeading = currentFix.heading !== null && currentFix.heading !== undefined && currentFix.heading !== '' && Number.isFinite(Number(currentFix.heading));
  const hasExplicitSpeed = currentFix.speed !== null && currentFix.speed !== undefined && currentFix.speed !== '' && Number.isFinite(Number(currentFix.speed));

  let effectiveSpeedMs = hasExplicitSpeed && Number(currentFix.speed) >= 0
    ? Number(currentFix.speed)
    : null;

  let vectorBearing = null;
  let distM = null;
  if (
    prevFix &&
    Number.isFinite(Number(prevFix.lat)) &&
    Number.isFinite(Number(prevFix.lng)) &&
    Number(prevFix.accuracy ?? 15) <= 25
  ) {
    distM = haversineMeters(prevFix, currentFix);
    const dtSec = ((Number(currentFix.timestamp) || 0) - (Number(prevFix.timestamp) || 0)) / 1000;
    if (distM != null && distM >= 4.0) {
      vectorBearing = computeGeodesicBearingDeg(prevFix, currentFix);
      if (effectiveSpeedMs == null && dtSec > 0 && dtSec <= 120) {
        effectiveSpeedMs = distM / dtSec;
      }
    }
  }

  // Pokud hráč stojí na místě nebo je rychlost pod prahem chůze 0.8 m/s, vracíme striktně null (žádné falešné otáčení)
  if (effectiveSpeedMs == null || effectiveSpeedMs < 0.8 || effectiveSpeedMs > 12.0) {
    return { valid: false, headingDeg: null, source: 'none', label: null };
  }

  let rawGpsHeading = null;
  if (hasExplicitHeading && Number(currentFix.heading) >= 0) {
    rawGpsHeading = ((Number(currentFix.heading) % 360) + 360) % 360;
  } else if (vectorBearing != null && distM != null && distM >= 4.0) {
    rawGpsHeading = vectorBearing;
  }

  if (rawGpsHeading == null || !Number.isFinite(rawGpsHeading)) {
    return { valid: false, headingDeg: null, source: 'none', label: null };
  }

  return {
    valid: true,
    headingDeg: Number(rawGpsHeading.toFixed(1)),
    speedMs: Number(effectiveSpeedMs.toFixed(2)),
    source: 'gps_course',
    label: GPS_COURSE_FALLBACK_LABEL,
  };
}

/**
 * DÁVKA 3 (Bod 2.2): Vypočítá pozici štítku u okraje mapy ve směru screenRelativeAngleDeg,
 * když další cíl trasy leží mimo aktuálně viditelnou výseč obrazovky.
 */
export function computeOffscreenIndicatorPlacement(
  screenRelativeAngleDeg,
  viewport = { width: 390, height: 600 },
  marginPx = 44
) {
  const w = Math.max(200, Number(viewport?.width || viewport?.x) || 390);
  const h = Math.max(200, Number(viewport?.height || viewport?.y) || 600);
  const angleDeg = computeScreenRelativeAngleDeg(screenRelativeAngleDeg, 0);
  const rad = (angleDeg * Math.PI) / 180;

  // Směrový vektor na obrazovce: 0° = nahoru (dy = -1), 90° = doprava (dx = +1)
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);

  const cx = w / 2;
  const cy = h / 2;
  const minX = Math.min(cx - 20, Math.max(28, marginPx));
  const maxX = Math.max(cx + 20, w - Math.max(28, marginPx));
  const minY = Math.min(cy - 20, Math.max(54, marginPx + 12));
  const maxY = Math.max(cy + 20, h - Math.max(64, marginPx + 22));

  let tMin = Infinity;
  if (Math.abs(dx) > 1e-6) {
    const tx = dx > 0 ? (maxX - cx) / dx : (minX - cx) / dx;
    if (tx > 0) tMin = Math.min(tMin, tx);
  }
  if (Math.abs(dy) > 1e-6) {
    const ty = dy > 0 ? (maxY - cy) / dy : (minY - cy) / dy;
    if (ty > 0) tMin = Math.min(tMin, ty);
  }
  if (!Number.isFinite(tMin)) tMin = Math.min(cx - minX, cy - minY);

  const x = Math.round(Math.max(minX, Math.min(maxX, cx + dx * tMin)));
  const y = Math.round(Math.max(minY, Math.min(maxY, cy + dy * tMin)));

  return {
    x,
    y,
    angleDeg: Math.round(angleDeg),
  };
}

/**
 * Vypočítá geografický obdélník pokrývající oblast pohledu a prošlé trasy.
 * Vrátí { west, north, east, south, coordinates } pro MapLibre zdroj typu image.
 * coordinates: [[west, north], [east, north], [east, south], [west, south]]
 */
export function computeFogGeographicBounds(center, options = {}) {
  const cLat = Number.isFinite(Number(center?.lat)) ? Number(center.lat) : 49.6014;
  const cLng = Number.isFinite(Number(center?.lng)) ? Number(center.lng) : 13.8644;
  let minLat = cLat, maxLat = cLat, minLng = cLng, maxLng = cLng;

  const maxLocalDeltaLat = 0.04;
  const maxLocalDeltaLng = 0.06;

  const segs = Array.isArray(options.walkSegments) ? options.walkSegments : [];
  for (const seg of segs) {
    if (!Array.isArray(seg)) continue;
    for (const pt of seg) {
      const lat = Number(pt?.lat ?? pt?.[0]);
      const lng = Number(pt?.lng ?? pt?.[1]);
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        Math.abs(lat - cLat) <= maxLocalDeltaLat &&
        Math.abs(lng - cLng) <= maxLocalDeltaLng
      ) {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
      }
    }
  }

  const cells = Array.isArray(options.cells) ? options.cells : [];
  for (const cid of cells) {
    try {
      const c = cellCenter(cid);
      if (
        c &&
        Number.isFinite(c.lat) &&
        Number.isFinite(c.lng) &&
        Math.abs(c.lat - cLat) <= maxLocalDeltaLat &&
        Math.abs(c.lng - cLng) <= maxLocalDeltaLng
      ) {
        minLat = Math.min(minLat, c.lat);
        maxLat = Math.max(maxLat, c.lat);
        minLng = Math.min(minLng, c.lng);
        maxLng = Math.max(maxLng, c.lng);
      }
    } catch {}
  }

  const padLat = Math.max(0.006, Number(options.padLat || 0.008));
  const padLng = Math.max(0.009, Number(options.padLng || 0.012));

  let west = minLng - padLng;
  let east = maxLng + padLng;
  let south = minLat - padLat;
  let north = maxLat + padLat;

  // DÁVKA 2 (P0 Bod 5.1): Přesné měřítko v metrech (minLatSpan = 0.015 ~1.6 km, minLngSpan = 0.022 ~1.6 km)
  const minSpanLat = Math.max(0.015, Number(options.minSpanLat || 0.015));
  const minSpanLng = Math.max(0.022, Number(options.minSpanLng || 0.022));

  if (north - south < minSpanLat) {
    const mid = (north + south) / 2;
    north = mid + minSpanLat / 2;
    south = mid - minSpanLat / 2;
  }
  if (east - west < minSpanLng) {
    const mid = (east + west) / 2;
    east = mid + minSpanLng / 2;
    west = mid - minSpanLng / 2;
  }

  // Zohlednění viditelného výřezu mapy (viewportBounds) s velkorysým bezpečnostním přesahem 45 %:
  // Zabraňuje oříznutí mlhy na malý čtverec ~500 m kolem hráče a odkrytí podkladové mapy na okrajích
  if (options.viewportBounds) {
    const vb = options.viewportBounds;
    const s = Number(vb.south);
    const n = Number(vb.north);
    const w = Number(vb.west);
    const e = Number(vb.east);
    if (Number.isFinite(s) && Number.isFinite(n) && Number.isFinite(w) && Number.isFinite(e)) {
      const vSpanLat = Math.max(0.01, Math.abs(n - s));
      const vSpanLng = Math.max(0.015, Math.abs(e - w));
      const vPadLat = Math.max(0.012, vSpanLat * 0.45);
      const vPadLng = Math.max(0.018, vSpanLng * 0.45);
      south = Math.min(south, s - vPadLat);
      north = Math.max(north, n + vPadLat);
      west = Math.min(west, w - vPadLng);
      east = Math.max(east, e + vPadLng);
    }
  }

  west = Number(west.toFixed(6));
  east = Number(east.toFixed(6));
  south = Number(south.toFixed(6));
  north = Number(north.toFixed(6));

  const coordinates = [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];

  return {
    west,
    north,
    east,
    south,
    coordinates,
  };
}

/**
 * Zjistí, zda se viditelný výřez mapy (viewportBounds) zcela nachází uvnitř aktuálních hranic mlhy.
 */
export function isViewportInsideFogBounds(viewportBounds, bounds) {
  if (!viewportBounds || !bounds) return false;
  return (
    Number(viewportBounds.south) >= Number(bounds.south) &&
    Number(viewportBounds.north) <= Number(bounds.north) &&
    Number(viewportBounds.west) >= Number(bounds.west) &&
    Number(viewportBounds.east) <= Number(bounds.east)
  );
}

/**
 * Zjistí, zda se zadaný bod nachází uvnitř vnitřního bezpečnostního okraje fogBounds.
 */
export function isPointInsideFogSafeBounds(lat, lng, bounds, marginRatio = 0.65) {
  if (!bounds || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return false;
  const nLat = Number(lat);
  const nLng = Number(lng);
  const latSpan = bounds.north - bounds.south;
  const lngSpan = bounds.east - bounds.west;
  if (latSpan <= 0 || lngSpan <= 0) return false;
  const latMargin = latSpan * (1 - marginRatio) / 2;
  const lngMargin = lngSpan * (1 - marginRatio) / 2;
  return (
    nLat >= bounds.south + latMargin &&
    nLat <= bounds.north - latMargin &&
    nLng >= bounds.west + lngMargin &&
    nLng <= bounds.east - lngMargin
  );
}

/**
 * Převod z geografických souřadnic [lng, lat] do pixelových souřadnic offscreen textury mlhy.
 */
export function projectLngLatToFogPixels(lng, lat, bounds, width = 1024, height = 1024) {
  if (!bounds) return { x: width / 2, y: height / 2 };
  const lngSpan = Math.max(1e-6, bounds.east - bounds.west);
  const latSpan = Math.max(1e-6, bounds.north - bounds.south);
  const x = ((Number(lng) - bounds.west) / lngSpan) * width;
  const y = ((bounds.north - Number(lat)) / latSpan) * height;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

/**
 * Převod poloměru v metrech na poloměr v pixelech textury mlhy (DÁVKA 2 P0 Bod 5.1).
 * Přesný poloměr v metrech bez umělého nafukování (odstraněno Math.max(4, ...)).
 */
export function metersToFogPixels(radiusMeters, bounds, arg3 = 49.6, arg4 = 1024, arg5 = 1024) {
  const r = Math.max(1, Number(radiusMeters) || FOG_REVEAL_RADIUS_M);
  if (!bounds) return 8;
  let midLat = 49.6;
  let width = 1024;
  let height = 1024;
  if (typeof arg3 === 'number' && arg3 > 90) {
    width = arg3;
    height = typeof arg4 === 'number' ? arg4 : width;
    midLat = typeof arg5 === 'number' && Math.abs(arg5) <= 90 ? arg5 : (((bounds.north + bounds.south) / 2) || 49.6);
  } else {
    midLat = typeof arg3 === 'number' && Math.abs(arg3) <= 90 ? arg3 : (((bounds.north + bounds.south) / 2) || 49.6);
    width = typeof arg4 === 'number' ? arg4 : 1024;
    height = typeof arg5 === 'number' ? arg5 : width;
  }
  const latRad = (Number(midLat) * Math.PI) / 180;
  const degLatPerMeter = 1 / 111320;
  const degLngPerMeter = 1 / Math.max(1e-6, 111320 * Math.cos(latRad));
  const latSpan = Math.max(1e-6, bounds.north - bounds.south);
  const lngSpan = Math.max(1e-6, bounds.east - bounds.west);
  const py = (r * degLatPerMeter / latSpan) * height;
  const px = (r * degLngPerMeter / lngSpan) * width;
  return Math.max(1, Math.round((px + py) / 2));
}

/**
 * Vykreslí geografickou texturu mlhy do canvasu.
 * Zachovává mezery mezi segmenty (nepřemosťuje výpadky GPS).
 */
export function renderFogTextureToCanvas(canvas, options = {}) {
  if (!canvas) return null;
  const {
    walkSegments = [],
    cells = [],
    revealedFeatures = [],
    activeLocalReveals = [],
    lastFix = null,
    revealRadiusM = options.fogRevealRadiusM ?? FOG_REVEAL_RADIUS_M,
    width = canvas.width || 512,
    height = canvas.height || 512,
  } = options;
  const fogMode = options.fogMode || options.mode || 'explore';
  const fogBounds = options.fogBounds || options.bounds;

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) {
    return { dataUrl: canvas.toDataURL ? canvas.toDataURL() : '', bounds: fogBounds, isEmpty: true };
  }

  ctx.clearRect(0, 0, width, height);

  if (fogMode === 'none' || fogMode === 'clean') {
    return {
      dataUrl: canvas.toDataURL ? canvas.toDataURL('image/png') : EMPTY_TRANSPARENT_PNG,
      bounds: fogBounds,
      isEmpty: true,
    };
  }

  // 1. Podklad pergamenu
  if (fogMode === 'full') {
    ctx.fillStyle = 'rgba(235, 224, 202, 0.98)';
    ctx.fillRect(0, 0, width, height);
  } else {
    // 'explore'
    ctx.fillStyle = 'rgba(224, 210, 178, 0.86)';
    ctx.fillRect(0, 0, width, height);

    if (typeof ctx.createRadialGradient === 'function') {
      const vignette = ctx.createRadialGradient(width / 2, height / 2, width * 0.25, width / 2, height / 2, width * 0.72);
      vignette.addColorStop(0, 'rgba(252, 246, 232, 0.05)');
      vignette.addColorStop(1, 'rgba(148, 116, 72, 0.16)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
    }
  }

  // 2. Vykrojení odkrytých oblastí přes destination-out
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';

  const midLat = fogBounds ? (fogBounds.north + fogBounds.south) / 2 : 49.6;
  const radPx = metersToFogPixels(revealRadiusM, fogBounds, midLat, width, height);

  // DÁVKA 2 (P0 Bod 5.2): Prostorové filtrování historie pro vysoký výkon (rozšířené o 100 m ~ 0.001°)
  const bufDeg = 0.0015;
  const filterWest = fogBounds ? fogBounds.west - bufDeg : -180;
  const filterEast = fogBounds ? fogBounds.east + bufDeg : 180;
  const filterSouth = fogBounds ? fogBounds.south - bufDeg : -90;
  const filterNorth = fogBounds ? fogBounds.north + bufDeg : 90;

  const drawShapes = (expandPx = 0, alpha = 1.0) => {
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.strokeStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, (radPx + expandPx) * 2);

    // a) Prošlé segmenty chůze — vyfiltrujeme segmenty mimo fogBounds (výpadky GPS zanechávají skutečnou mezeru)
    if (Array.isArray(walkSegments)) {
      for (const seg of walkSegments) {
        if (!Array.isArray(seg) || seg.length === 0) continue;
        let hasAnyPtInBounds = false;
        for (let j = 0; j < seg.length; j++) {
          const rawPt = seg[j];
          const lat = Number(rawPt?.lat ?? rawPt?.[0]);
          const lng = Number(rawPt?.lng ?? rawPt?.[1]);
          if (lat >= filterSouth && lat <= filterNorth && lng >= filterWest && lng <= filterEast) {
            hasAnyPtInBounds = true;
            break;
          }
        }
        if (!hasAnyPtInBounds) continue;

        if (seg.length === 1) {
          const pt = Array.isArray(seg[0]) ? { lat: seg[0][0], lng: seg[0][1] } : seg[0];
          const px = projectLngLatToFogPixels(pt.lng, pt.lat, fogBounds, width, height);
          ctx.beginPath();
          ctx.arc(px.x, px.y, Math.max(1, radPx + expandPx), 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          for (let i = 0; i < seg.length; i++) {
            const pt = Array.isArray(seg[i]) ? { lat: seg[i][0], lng: seg[i][1] } : seg[i];
            const px = projectLngLatToFogPixels(pt.lng, pt.lat, fogBounds, width, height);
            if (i === 0) ctx.moveTo(px.x, px.y);
            else ctx.lineTo(px.x, px.y);
          }
          ctx.stroke();
        }
      }
    }

    // b) Odkryté buňky — prostorově filtrované podle aktuálního výřezu
    if (Array.isArray(cells) && cells.length > 0) {
      ctx.beginPath();
      for (const cid of cells) {
        try {
          const cCenter = cellCenter(cid);
          if (
            cCenter &&
            cCenter.lat >= filterSouth &&
            cCenter.lat <= filterNorth &&
            cCenter.lng >= filterWest &&
            cCenter.lng <= filterEast
          ) {
            const px = projectLngLatToFogPixels(cCenter.lng, cCenter.lat, fogBounds, width, height);
            ctx.moveTo(px.x + radPx + expandPx, px.y);
            ctx.arc(px.x, px.y, Math.max(1, radPx + expandPx), 0, Math.PI * 2);
          }
        } catch {}
      }
      ctx.fill();
    }

    // c) Ověřené odhalené polygony přírodních objektů (např. rybníky)
    if (Array.isArray(revealedFeatures)) {
      for (const fid of revealedFeatures) {
        const feat = BUILTIN_NATURAL_FEATURES.find(f => f.id === fid);
        if (!feat || !Array.isArray(feat.polygon) || feat.polygon.length < 3) continue;
        ctx.beginPath();
        for (let i = 0; i < feat.polygon.length; i++) {
          const v = feat.polygon[i];
          const px = projectLngLatToFogPixels(v[1], v[0], fogBounds, width, height);
          if (i === 0) ctx.moveTo(px.x, px.y);
          else ctx.lineTo(px.x, px.y);
        }
        ctx.closePath();
        ctx.fill();
        if (expandPx > 0) {
          ctx.lineWidth = expandPx * 2;
          ctx.stroke();
        }
      }
    }

    // d) Lokální rozšířená odkrytí (lesy, velké vody)
    if (Array.isArray(activeLocalReveals)) {
      for (const locRev of activeLocalReveals) {
        if (!locRev || !Array.isArray(locRev.polygon) || locRev.polygon.length < 3 || !locRev.center) continue;
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < locRev.polygon.length; i++) {
          const v = locRev.polygon[i];
          const px = projectLngLatToFogPixels(v[1], v[0], fogBounds, width, height);
          if (i === 0) ctx.moveTo(px.x, px.y);
          else ctx.lineTo(px.x, px.y);
        }
        ctx.closePath();
        ctx.clip();
        const centerPx = projectLngLatToFogPixels(locRev.center.lng, locRev.center.lat, fogBounds, width, height);
        const locRadPx = metersToFogPixels(locRev.radiusM || 130, fogBounds, locRev.center.lat, width, height) + expandPx;
        ctx.beginPath();
        ctx.arc(centerPx.x, centerPx.y, Math.max(6, locRadPx), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // e) Okamžitá poloha uživatele
    if (lastFix && Number.isFinite(lastFix.lat) && Number.isFinite(lastFix.lng)) {
      const px = projectLngLatToFogPixels(lastFix.lng, lastFix.lat, fogBounds, width, height);
      ctx.beginPath();
      ctx.arc(px.x, px.y, Math.max(4, radPx + expandPx), 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // Jediný průchod pro maximální výkon bez 100ms záseku
  drawShapes(0, 1.0);

  ctx.restore();

  const dataUrl = canvas.toDataURL ? canvas.toDataURL('image/png') : EMPTY_TRANSPARENT_PNG;
  return {
    dataUrl,
    bounds: fogBounds,
    isEmpty: false,
  };
}

/**
 * DÁVKA 4 (Bod 1.1): Ověří dostupnost WebGL kontextu před inicializací MapLibre GL JS.
 * @param {(() => any) | null} [canvasFactory]
 */
export function checkWebGLSupport(canvasFactory = null) {
  try {
    if (typeof window === 'undefined' && !canvasFactory) {
      return { supported: false, reason: 'Prostředí nepodporuje vykreslovací plátno (window není dostupné).' };
    }
    if (typeof window !== 'undefined' && !canvasFactory && !window.WebGLRenderingContext) {
      return { supported: false, reason: 'Prohlížeč nepodporuje WebGLRenderingContext.' };
    }
    const canvas = typeof canvasFactory === 'function'
      ? canvasFactory()
      : (typeof document !== 'undefined' ? document.createElement('canvas') : null);
    if (!canvas || typeof canvas.getContext !== 'function') {
      return { supported: false, reason: 'Nelze vytvořit HTML5 canvas pro WebGL.' };
    }
    const gl =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    if (!gl) {
      return { supported: false, reason: 'Grafický adaptér nebo prohlížeč neumožnil vytvořit WebGL kontext.' };
    }
    return { supported: true, reason: '' };
  } catch (err) {
    return { supported: false, reason: err?.message || 'Chyba při ověřování WebGL.' };
  }
}

/**
 * DÁVKA 4 (Bod 1.1): Sestaví český informační banner při nedostupném WebGL nebo ztrátě grafického kontextu
 * s tlačítkem „🔄 Znovu načíst mapu“ (#btn-reload-webgl-map), aniž by zakryl běžící výpravu nebo smazal data.
 */
export function buildWebGLErrorBannerHtml(detailReason = '') {
  const safeDetail = detailReason ? ` (${e(detailReason)})` : '';
  return `
    <strong>⚠️ Mapu se nepodařilo vykreslit (WebGL)</strong>
    <p>Grafické vykreslování mapy narazilo na omezení zařízení nebo ztrátu WebGL kontextu${safeDetail}. <strong>Záznam tvé procházky, GPS poloha i všechna uložená data běží normálně dál.</strong></p>
    <button type="button" class="button small webgl-reload-btn" id="btn-reload-webgl-map">🔄 Znovu načíst mapu</button>
  `;
}

export function mountWalk(root, routes, config = defaultAppConfig, actions = {}) {
  const maplibregl = typeof window !== 'undefined' ? window.maplibregl : null;
  const { onAddVisit } = actions;
  let stateObj = loadState();
  let progress = {
    version: 1,
    cells: [...(stateObj.cells || [])],
    meters: Number(stateObj.meters) || 0,
    discoveries: [...(stateObj.discoveries || [])],
    walkSegments: Array.isArray(stateObj.walkSegments) ? stateObj.walkSegments.map(s => [...s]) : [],
    revealedFeatures: Array.isArray(stateObj.revealedFeatures) ? [...stateObj.revealedFeatures] : [],
  };
  let storageError = stateObj._corruptedBackupDetected || stateObj.storageCorrupted
    ? (stateObj.storageError || 'Uložený profil byl poškozen. Původní data jsme uložili do nouzové zálohy v prohlížeči a načetli čistý profil.')
    : '';

  // Izolovaný sandbox pro simulátor (Bod 17: Simulátor nesmí měnit skutečný profil, body ani objevená území)
  let simSandboxActive = false;

  // Potvrzené zastávky aktuální výpravy (< 20 m, opakované měření) a záznamy průchodu poblíž (dle GPS)
  let confirmedStopIds = new Set(Array.isArray(stateObj.confirmedStopIds) ? stateObj.confirmedStopIds : []);
  let nearbyRecordedIds = new Set();
  let pendingStopSamples = {};
  let justConfirmedStopId = null;
  let justDiscoveredFlipIds = new Set();
  let replacingStopIndex = null;
  let appearedPlaceIds = new Set();

  // DÁVKA 2 (Bod 1): Osobní atlas malých objevů (soukromé vlastní vzpomínky v zařízení) a bezpečné výzvy všímavosti
  let personalMemories = Array.isArray(stateObj.personalMemories) ? [...stateObj.personalMemories] : [];
  let saveMemoryModalOpen = false;
  let selectedMemorySymbolId = PERSONAL_MEMORY_SYMBOLS[0].id;
  let mindfulnessPromptIndex = 0;
  let mindfulnessSkippedSession = false;

  // Turistická telemetrie a počasí (Body 28 & 29)
  let telemetry = createTelemetryState(Date.now());
  let statsDrawerOpen = false;
  let weatherData = null;
  let weatherExpanded = false;
  let gpsOutageWarning = false;
  let activeLocalReveals = [];

  // Pracovní návrh pro dialog „Upravit procházku“ (Bod 20: Potvrdit změny / Zrušit)
  let editDraft = null;
  let editModalOpen = false;

  let map = null, player = null, accuracyRing = null;
  let fogTextureCanvas = null;
  let fogGeographicBounds = null;
  let fogRenderTimer = null;
  let lastFogUpdateAt = 0;
  let lastFogPlayerPos = null;
  let lastFogRenderedMode = null;
  let lastFogCellsCount = -1;
  let lastFogStateKey = '';
  let isUserTouchingMap = false;
  let is3DMode = true;
  let is3dMode = true;
  let appliedTerrain3D = false;
  let terrainFallbackTriggered = false;
  let footprintMarkers = [];
  let hikingBlazeMarkers = [];
  let routeOverlayMarkers = [];
  let appSettings = { ...DEFAULT_APP_SETTINGS, ...(stateObj.appSettings || {}) };
  if (!appSettings.show3dBuildingsExplicit) {
    appSettings.show3dBuildings = true;
  }
  let showHikingTrails = appSettings.kctTrails !== false;
  let showContourLayer = Boolean(appSettings.contours);
  let loadedHikingTrails = [];

  const routeGeometryCache = new Map();
  let plannedRouteRenderKey = null;
  let plannedRouteRenderToken = 0;
  let plannedRouteCoords = null;
  let lastRoutedGeometry = null;
  let currentElevationProfile = null;
  let elevationProfileToken = 0;
  let autoPlacesLoading = false;
  let autoPanFetchTimer = null;
  let lastAutoPanCenter = null;
  let pendingAutoPanCenter = null;
  let radiusCircle = null;
  let fakeGpsSim = null;

  const compassStabilizer = createCompassStabilizer({ alpha: 0.12, deadbandDeg: 2.5, minIntervalMs: 80 });
  const headingFollowStabilizer = createCompassStabilizer({ alpha: 0.14, deadbandDeg: 2.5, minIntervalMs: 250 });
  let lastCameraEaseAt = 0;
  let followHeadingMode = false;
  let compassSensorState = 'unknown'; // 'unknown' | 'active' | 'denied' | 'unavailable'
  let lastAbsoluteCompassAt = 0;
  let compassCheckTimer = null;
  let lastGpsCourseHeading = null;
  let prevAcceptedFixForCourse = null;
  let currentTargetPlace = null;
  let currentTargetDist = Infinity;
  let orientationListenersBound = false;
  const keepAliveCtrl = createKeepAliveController();
  let lastSampledFix = null;
  const alertedProximityStopIds = new Set();
  let arrivalGoalPromptShownForKey = '';
  let lupaSearchTimer = null;
  let lastLupaResults = [];

  let anchor = null, lastFix = null, lastAcceptedFix = null, visualPlayerPos = null, watch = null;
  let active = false, disposed = false, demo = false, demoIndex = 0;
  let releaseLock = null, wake = null, frame = null, starting = false;
  // DÁVKA 1 (Bod 2.1): Sjednocený stavový model procházky: 'idle' | 'locating' | 'running' | 'paused' | 'finished'
  let walkState = stateObj.activeExpedition ? 'paused' : 'idle';
  let gpsBrowseOnlyMode = false;
  let gpsLocatingTaskId = null;

  // DÁVKA 1 (Bod 1): Počítadlo aktivních úloh v mapě (beginMapTask / endMapTask)
  let mapTaskSeq = 0;
  const activeMapTasks = new Map();

  function updateMapBusyIndicator() {
    if (disposed) return;
    const el = root.querySelector('#map-busy-indicator');
    const textEl = root.querySelector('#map-busy-text');
    if (!el || !textEl) return;
    if (activeMapTasks.size === 0) {
      el.hidden = true;
      textEl.textContent = '';
      return;
    }
    const labels = [...activeMapTasks.values()];
    const currentLabel = labels[labels.length - 1] || '⏳ Pracuji…';
    textEl.textContent = currentLabel;
    el.hidden = false;
  }

  function beginMapTask(label = '⏳ Pracuji…') {
    const taskId = ++mapTaskSeq;
    activeMapTasks.set(taskId, label);
    updateMapBusyIndicator();
    return taskId;
  }

  function endMapTask(taskId) {
    if (taskId != null && activeMapTasks.has(taskId)) {
      activeMapTasks.delete(taskId);
      updateMapBusyIndicator();
    }
  }

  function clearAllMapTasks() {
    activeMapTasks.clear();
    gpsLocatingTaskId = null;
    updateMapBusyIndicator();
  }

  let follow = true, nearby = [];
  let memoryTrail = [];
  let pendingPlaceStamps = {};
  const aborter = new AbortController();

  // Plynulá LERP animace Avatara na mapě (ZADÁNÍ #08 Bod 2)
  let playerLerpRafId = null;

  // Hlasová navigace v češtině (Web Speech API, ZADÁNÍ #08 Bod 5)
  let voiceNavEnabled = appSettings.voiceNav !== false;
  let lastSpokenNavStepKey = '';
  let lastOffRouteRecalcAt = 0;

  // 100% automatické nastavení enginu: Výchozí herní styl je Výprava s pergamenem ('gamified')
  const initialGameMode = (appSettings.gameMode === 'explorer' || appSettings.gameMode === 'casual') ? appSettings.gameMode : 'gamified';
  appSettings.gameMode = initialGameMode;
  stateObj.gameMode = initialGameMode;
  let fogMode = initialGameMode === 'explorer' ? 'full' : (initialGameMode === 'casual' ? 'none' : 'explore');
  showHikingTrails = appSettings.kctTrails !== false;
  showContourLayer = initialGameMode === 'explorer' ? false : (appSettings.contours !== false);

  // UI stavy a Průvodce výpravou
  let sheetCollapsed = false;
  let p1PlannerCollapsed = false;
  let zenMode = false;
  let pickingStartOnMap = false;
  let pickingCustomEndOnMap = false;
  let phase4MenuOpen = false;
  let moreMenuOpen = false;
  let lastRadarAlertId = null;
  let selectedDetailPlace = null;
  let appSettingsModalOpen = false;

  // Aktivní výprava
  let currentExpedition = stateObj.activeExpedition;
  if (currentExpedition && currentExpedition.state === 'active') {
    currentExpedition = pauseExpedition(currentExpedition);
    stateObj.activeExpedition = currentExpedition;
    walkState = 'paused';
    try { stateObj = saveState(stateObj); } catch (err) { storageError = err.message; }
  }

  // ZADÁNÍ #09 (Bod 1 & 2): Výchozí tempo pevně 4,0 km/h ('solo'), střední terén, výchozí délka ~2 hod (6 km), okruh zpět sem
  let plannedRoute = stateObj.plannedRoute || {
    origin: null,
    radiusKm: 10,
    targetKm: 6,
    terrainDifficulty: 'medium',
    categories: PLANNER_CATEGORIES.map(c => c.id),
    selectedPlaceIds: [],
    companionMode: 'solo',
    explorationMode: 'focus',
    routeType: 'loop',
    embeddedStops: [],
  };
  plannedRoute.companionMode = 'solo';
  plannedRoute.terrainDifficulty = 'medium';
  stateObj.companionMode = 'solo';

  let phase1Theme = 'all';
  let phase1DurationKm = Number(plannedRoute.targetKm) === 3 || Number(plannedRoute.targetKm) === 9 ? Number(plannedRoute.targetKm) : 6;
  let phase1EndMode = plannedRoute.routeType === 'oneway' ? 'custom' : 'loop';

  let userExplicitlyPickedOrigin = false;
  let lockedExpeditionOrigin = null;
  let expeditionStartPoint = null;

  let wizardCollapsed = true;
  let wizardScenario = userExplicitlyPickedOrigin ? 'from-home' : 'on-site';
  let wizardCategories = Array.isArray(plannedRoute.categories) && plannedRoute.categories.length
    ? [...plannedRoute.categories]
    : PLANNER_CATEGORIES.map(c => c.id);
  let wizardDistanceMode = String(phase1DurationKm);
  let wizardDifficulty = 'medium';

  const catalogue = routes
    .filter(r => r.location)
    .map(r => {
      const acc = resolveAccessibleStopLocation({ ...r, lat: r.location.lat, lng: r.location.lng });
      return {
        id: r.id,
        routeId: r.id,
        title: r.pointKind === 'place' ? r.title : `Start trasy: ${r.title}`,
        lat: acc ? acc.lat : r.location.lat,
        lng: acc ? acc.lng : r.location.lng,
        originalLat: r.location.lat,
        originalLng: r.location.lng,
        isShoreAccess: Boolean(acc?.isShoreAccess),
        kind: r.kind,
        category: r.kind === 'culture' ? 'castles' : r.kind === 'view' ? 'views' : r.kind === 'water' ? 'water' : 'nature',
        chapter: r.chapter || r.sector,
        hintAnchor: Boolean(r.hintAnchor || r.watchtower),
        url: `#/trasa/${r.id}`,
        pointKind: r.pointKind || 'place',
        collectible: r.collectible !== false && r.pointKind === 'place',
        access: r.access || {},
      };
    });

  root.innerHTML = `
    <h1 tabindex="-1" class="visually-hidden">Mapa objevování a procházka · Czekpoint v4.0.0</h1>

    <!-- Varovný pruh při pozastavení průzkumu kvůli nepřesné GPS (> 40 m), výpadku GPS nebo aktivním sandboxu -->
    <div id="walk-accuracy-banner" class="walk-accuracy-banner" hidden role="alert"></div>
    <div id="walk-sandbox-banner" class="walk-sandbox-banner" hidden role="status">
      🔒 <strong>Testovací režim simulátoru je aktivní:</strong> Veškerý pohyb, odkrývání mapy a potvrzování zastávek probíhá odděleně v paměti a <strong>nemění tvůj skutečný profil, body ani uložená území</strong>.
    </div>
    <div id="walk-demo-banner" class="notice" hidden>UKÁZKA · Simulovaný pohyb v Rožmitále. Žádná GPS, žádné ukládání bodů.</div>
    <div id="walk-radar-banner" class="walk-radar-banner" hidden></div>

    <!-- Hlavní mapa zabírající celou výšku nad spodním iOS Tab Barem -->
    <div class="walk-map-wrap is-3d-mode" id="walk-map-wrap">
      <div id="walk-map" aria-label="Interaktivní Mapa objevování"></div>

      <div id="webgl-error-banner" class="webgl-error-banner" role="alert" hidden></div>

      <!-- ZÓNA 1 — HORNÍ STŘEDOVÁ KAPSLE (.map-top-overlays) -->
      <div class="map-top-overlays" id="map-top-overlays">
        <div class="map-top-subrow" id="map-top-subrow">
          <!-- Jediná čistá plovoucí kapsle (#turn-nav-pill) -->
          <div class="turn-nav-pill" id="turn-nav-pill" role="status" aria-live="polite">
            <span class="turn-pill-compass" id="turn-pill-compass" title="Orientace mapy (Sever) — kliknutím srovnáš na sever" role="button" tabindex="0" aria-label="Kompas orientace mapy">
              <span class="turn-pill-compass-rotor" id="turn-pill-compass-rotor" style="transform: rotate(0deg)">
                <svg viewBox="0 0 36 36" class="turn-pill-compass-svg" aria-hidden="true">
                  <circle cx="18" cy="18" r="16" fill="#14261c" stroke="#d4af37" stroke-width="2"/>
                  <polygon points="18,4 22,18 18,15 14,18" fill="#ef4444"/>
                  <polygon points="18,32 22,18 18,21 14,18" fill="#fef3c7"/>
                  <text x="18" y="11" text-anchor="middle" font-size="6.5" font-weight="900" fill="#ffffff">S</text>
                </svg>
              </span>
            </span>
            <span class="turn-nav-icon" id="turn-nav-icon" hidden>🧭</span>
            <span class="turn-nav-text" id="turn-nav-text">Volný průzkum · 0 m</span>
            <button type="button" class="top-pill-style-btn" id="btn-top-pill-style" aria-expanded="false" aria-controls="map-style-popover" title="Rychlý výběr herního stylu (Objevování / Pergamen / Turistická mapa)">
              ${initialGameMode === 'explorer' ? '🧭 Styl ▾' : initialGameMode === 'casual' ? '🗺️ Styl ▾' : '📜 Styl ▾'}
            </button>
            <button type="button" class="top-pill-style-btn top-pill-sim-btn" id="btn-top-pill-sim" title="Otevřít / zavřít testovací simulátor GPS">
              🧪
            </button>
          </div>
        </div>

        <!-- Rozbalovací výběr herního stylu přímo na mapě po kliknutí na tlačítko Herní styl -->
        <div class="map-style-popover" id="map-style-popover" role="dialog" aria-label="Rychlý výběr herního stylu" hidden>
          <div class="map-style-popover-header">
            <strong class="map-style-popover-title">🎨 Herní styl mapy</strong>
            <button type="button" class="map-style-popover-close" id="btn-close-style-popover" aria-label="Zavřít výběr herního stylu">✕</button>
          </div>
          <div class="map-style-popover-options" role="group" aria-label="Tři herní styly">
            <button type="button" class="map-style-opt-btn ${initialGameMode === 'explorer' ? 'active' : ''}" data-p1-gamemode="explorer" aria-pressed="${initialGameMode === 'explorer'}">
              <span class="ms-opt-icon">🧭</span>
              <span class="ms-opt-body">
                <strong>Objevování v mlze</strong>
                <small>Plná mlha + tajemné siluety míst</small>
              </span>
            </button>
            <button type="button" class="map-style-opt-btn ${initialGameMode === 'gamified' ? 'active' : ''}" data-p1-gamemode="gamified" aria-pressed="${initialGameMode === 'gamified'}">
              <span class="ms-opt-icon">📜</span>
              <span class="ms-opt-body">
                <strong>Výprava s pergamenem</strong>
                <small>Poloprůhledný pergamen + vodicí nit</small>
              </span>
            </button>
            <button type="button" class="map-style-opt-btn ${initialGameMode === 'casual' ? 'active' : ''}" data-p1-gamemode="casual" aria-pressed="${initialGameMode === 'casual'}">
              <span class="ms-opt-icon">🗺️</span>
              <span class="ms-opt-body">
                <strong>Turistická mapa</strong>
                <small>Zcela odkrytá mapa se všemi názvy</small>
              </span>
            </button>
          </div>
          <div class="map-style-popover-footer">
            <button type="button" class="map-style-sub-btn" id="btn-popover-sim-toggle" title="Otevřít/zavřít testovací simulátor GPS">
              🧪 Simulátor GPS
            </button>
            <button type="button" class="map-style-sub-btn" id="btn-popover-all-settings" title="Otevřít podrobné nastavení zvuku a mapy">
              ⚙️ Další nastavení
            </button>
          </div>
        </div>

        <!-- Vyhledávací pole #map-search-overlay (ve výchozím stavu skryté, zobrazí se pod horní kapslí po kliknutí na 🔍) -->
        <div class="map-search-overlay" id="map-search-overlay" role="search" aria-label="Vyhledávání v mapě" hidden>
          <div class="map-search-bar">
            <span class="map-search-icon" aria-hidden="true">🔍</span>
            <input
              type="search"
              id="map-lupa-search-input"
              class="map-search-input"
              placeholder="Hledat město, památku nebo rozcestí..."
              aria-label="Hledat město, památku nebo rozcestí"
              autocomplete="off"
            />
            <button type="button" id="map-lupa-search-clear" class="map-search-clear" hidden aria-label="Vymazat hledání">✕</button>
            <button type="button" id="map-lupa-search-submit" class="button small primary map-search-submit-btn" aria-label="Hledat">Hledat</button>
          </div>
          <div id="map-lupa-search-results" class="map-search-results" hidden role="listbox" aria-label="Výsledky vyhledávání"></div>
        </div>

        <div id="map-busy-indicator" class="map-busy-indicator" role="status" aria-live="polite" hidden>
          <span class="map-spinner" aria-hidden="true"></span>
          <span id="map-busy-text" class="map-busy-text">⏳ Pracuji…</span>
        </div>

        <div id="heading-mode-banner" class="heading-mode-banner" hidden role="status" aria-live="polite"></div>
      </div>

      <!-- Ukazatel uložení offline oblasti -->
      <div id="offline-download-banner" class="offline-download-banner" hidden role="status" aria-live="polite"></div>

      <!-- Bublina po kliknutí na Tajemnou siluetu nebo místo v mapě -->
      <div id="place-detail-sheet" class="place-detail-sheet" hidden role="dialog" aria-label="Detail místa a vodicí nit"></div>

      <!-- Plovoucí tlačítko „🎯 Zpět na postavičku“ (#btn-recenter-avatar) -->
      <button type="button" id="btn-recenter-avatar" class="recenter-avatar-btn" hidden title="Vycentrovat mapu zpět na postavičku (🎯 Zpět ke mně)">
        🎯 Zpět na postavičku
      </button>

      <!-- Okrajový ukazatel cíle mimo obrazovku -->
      <div id="offscreen-target-indicator" class="offscreen-target-indicator" hidden role="status" aria-live="polite"></div>

      <!-- ZÓNA 2 — PRAVÝ SLOUPEC MAPY (.map-right-toolbar — 🎯, 2D/2.5D, 🔍, ＋/－, ⛶) -->
      <div class="walk-map-toolbar map-right-toolbar" role="toolbar" aria-label="Ovládání mapy">
        <button type="button" class="map-right-btn active" id="btn-recenter-map" aria-pressed="true" title="Moje poloha a sledování směru" aria-label="Moje poloha a sledování směru">🎯</button>
        <button type="button" class="map-right-btn map-3d-toggle-btn active" id="btn-toggle-3d" aria-pressed="true" title="Přepnout 2D a 2.5D pohled" aria-label="Přepnout 2D a 2.5D pohled">
          <span class="btn-3d-label" id="btn-toggle-3d-label">2.5D</span>
        </button>
        <button type="button" class="map-right-btn" id="walk-search-toggle" title="Hledat místo" aria-label="Hledat místo">🔍</button>
        <button type="button" class="map-right-btn" id="walk-zoom-in" title="Přiblížit mapu" aria-label="Přiblížit mapu">＋</button>
        <button type="button" class="map-right-btn" id="walk-zoom-out" title="Oddálit mapu" aria-label="Oddálit mapu">－</button>
        <button type="button" class="map-right-btn" id="walk-zen-toggle" aria-pressed="false" title="Celá obrazovka" aria-label="Celá obrazovka">⛶</button>
      </div>

      <!-- Kompaktní atribuce mapových zdrojů -->
      <div class="map-in-wrap-attribution" id="map-in-wrap-attribution" aria-label="Atribuce mapových podkladů">
        <span class="attribution-text">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="https://waymarkedtrails.org" target="_blank" rel="noopener">Waymarked Trails</a> · AWS Terrarium DEM</span>
      </div>

      <!-- ZÓNA 3 — SPODNÍ AKČNÍ LIŠTA (.map-action-bar, bottom: 14px nad iOS Tab Barem) -->
      <div class="map-action-bar" id="map-action-bar" role="region" aria-label="Hlavní ovládání výpravy">
        <!-- Před startem (#mab-inactive-group): 2 tlačítka vedle sebe -->
        <div class="mab-inactive-group" id="mab-inactive-group">
          <button type="button" class="button mab-btn mab-start-btn" id="walk-start">
            ▶ Vyrazit
          </button>
          <button type="button" class="button mab-btn mab-places-drawer-btn" id="btn-open-places-drawer" data-open-places-drawer="places">
            📍 Místa v okolí ▴
          </button>
        </div>
        <!-- Během chůze (#mab-active-group): 2×2 mřížka na mobilu (4 tlačítka vedle sebe na širším displeji) -->
        <div class="mab-active-group" id="mab-active-group" hidden>
          <button type="button" class="button mab-btn mab-memory-btn" id="walk-save-memory" title="Uložit vlastní soukromou vzpomínku na toto místo">
            ✨ Zapsat objev
          </button>
          <button type="button" class="button mab-btn mab-pause-btn" id="walk-pause">
            ⏸ Pauza
          </button>
          <button type="button" class="button mab-btn mab-finish-btn" id="walk-finish">
            ⏹ Dokončit
          </button>
          <button type="button" class="button mab-btn mab-places-drawer-btn" id="btn-open-places-drawer-active" data-open-places-drawer="route">
            📍 Trasa ▴
          </button>
        </div>
      </div>

      <strong id="walk-status" class="visually-hidden" role="status" aria-live="polite">${e(storageError || 'Mapa připravena.')}</strong>
      <button type="button" id="walk-fake-gps-toggle" hidden aria-hidden="true" tabindex="-1">🧪 GPS</button>
    </div>

    <!-- Plovoucí panel simulátoru #simulator-test-zone -->
    <div id="simulator-test-zone" class="simulator-test-zone" hidden></div>
    <p id="tile-status" class="small-note" role="status" hidden></p>

    <!-- Vysouvací spodní šuplík míst a trasy (#walk-bottom-sheet) se 2 přepínacími záložkami -->
    <section class="bottom-sheet" id="walk-bottom-sheet" data-active-drawer-tab="places" hidden aria-label="Plán a zastávky procházky">
      <div class="bottom-sheet-bar">
        <div class="drawer-segmented-tabs" role="tablist" aria-label="Zobrazení šuplíku">
          <button type="button" class="drawer-seg-tab active" role="tab" aria-selected="true" id="btn-drawer-tab-places" data-drawer-tab="places">
            📍 Místa v okolí (<span id="drawer-tab-places-count">0</span>)
          </button>
          <button type="button" class="drawer-seg-tab" role="tab" aria-selected="false" id="btn-drawer-tab-route" data-drawer-tab="route">
            🥾 Moje trasa a vzpomínky (<span id="drawer-tab-route-count">${plannedRoute.selectedPlaceIds.length + personalMemories.length}</span>)
          </button>
        </div>
        <div class="sheet-bar-actions">
          <button type="button" class="button small ghost" id="btn-sheet-edit-walk" title="Otevřít sjednocený editor zastávek s potvrzením/zrušením změn">✏️ Upravit zastávky</button>
          <button type="button" class="button small primary sheet-close-drawer-btn" id="btn-close-places-drawer" aria-label="Zavřít šuplík">✕ Zavřít</button>
        </div>
        <span class="visually-hidden" id="basket-count">${plannedRoute.selectedPlaceIds.length}</span>
      </div>

      <div class="sheet-body" id="sheet-body">
        <!-- ZÁLOŽKA 1 (VÝCHOZÍ): MÍSTA V OKOLÍ HNED NA PRVNÍM MÍSTĚ -->
        <div class="planner-box drawer-places-box" id="drawer-places-box" style="margin-top:0">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px">
            <span class="eyebrow">📍 Zajímavá místa v okolí (seřazeno od nejbližšího)</span>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <button type="button" class="button small lime" id="btn-drawer-quick-loop" data-drawer-quick-loop="true">✨ Navrhnout okruh (~3 km)</button>
              <span id="nearby-places-count-badge" class="poi-total-count-badge"></span>
            </div>
          </div>
          <div id="poi-category-legend" class="poi-category-legend" role="group" aria-label="Rozlišení bodů zájmu podle tvaru a barvy kategorie"></div>
          <div id="nearby-status" role="status"></div>
          <p id="nearby-origin" class="small-note"></p>
          <div id="walk-places"></div>
        </div>

        <!-- ZÁLOŽKA 2: MOJE TRASA A VZPOMÍNKY -->
        <div class="top-route-itinerary-wrap" id="top-route-itinerary-wrap" hidden>
          <div class="top-itinerary-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <span class="top-itinerary-label" id="top-itinerary-label">🗺️ Plán dnešní cesty a zastávky (kliknutím ukážeš místo na mapě):</span>
            <button type="button" class="button small lime" id="btn-drawer-quick-loop-route" data-drawer-quick-loop="true">✨ Navrhnout okruh (~3 km)</button>
          </div>
          <div class="top-route-itinerary-strip" id="top-route-itinerary-strip" role="list" aria-label="Body na naplánované trase"></div>
        </div>

        <div class="planner-box" id="drawer-basket-box" hidden>
          <div id="planner-basket-list" class="planner-basket-list"></div>
          <div id="stop-replace-picker" class="stop-replace-picker" hidden></div>
        </div>

        <div class="route-xray-card" id="route-xray-card" hidden></div>

        <div class="planner-box personal-atlas-box" id="personal-atlas-section" hidden>
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <div>
              <span class="eyebrow">✨ Osobní atlas malých objevů (<span id="personal-memories-count">0</span>)</span>
              <p class="small-note" style="margin:2px 0 0">Vlastnoruční vzpomínky uživatele (soukromé poznámky v zařízení, nikoliv GPS ověřené památky).</p>
            </div>
            <button type="button" class="button small lime" id="btn-sheet-save-memory">✨ Uložit vzpomínku</button>
          </div>
          <div id="personal-memories-list" class="personal-memories-list" style="margin-top:8px"></div>
        </div>

        <div class="mindfulness-prompt-card" id="mindfulness-prompt-card" role="region" aria-label="Volitelná výzva všímavosti" hidden>
          <div class="mindfulness-prompt-head">
            <span class="eyebrow">🍃 Volitelná výzva všímavosti (zůstaň na bezpečné cestě)</span>
            <div class="mindfulness-prompt-actions">
              <button type="button" class="button small ghost" id="btn-next-mindfulness" title="Další jemný tip">↻ Jiný tip</button>
              <button type="button" class="button small ghost" id="btn-skip-mindfulness" title="Přeskočit tuto výzvu bez postihu">Přeskočit</button>
            </div>
          </div>
          <p class="mindfulness-prompt-text" id="mindfulness-prompt-text"></p>
          <div class="mindfulness-prompt-foot">
            <small class="small-note">Bezpečnost: Nikdy nevstupuj na nepřístupné pozemky, nesahej na přírodu a nesleduj displej při přecházení silnice.</small>
            <button type="button" class="button small lime" id="btn-mindfulness-save-memory">✨ Uložit vzpomínku</button>
          </div>
        </div>

        <div class="planner-share-row" id="drawer-share-row" hidden>
          <button type="button" class="button small" id="btn-share-route-code">📤 Sdílet kód trasy</button>
          <button type="button" class="button small" id="btn-import-route-code">📥 Načíst kód trasy</button>
          <button type="button" class="button small" id="walk-export">💾 Exportovat průzkum (JSON)</button>
          <button type="button" class="button small" id="walk-import-btn">📂 Obnovit ze zálohy</button>
          <input type="file" id="walk-import-file" accept=".json,application/json" hidden>
        </div>
      </div>
    </section>

    <!-- Dialogové okno po příchodu do cíle trasy -->
    <div id="arrival-goal-modal" class="arrival-goal-backdrop" hidden role="dialog" aria-modal="true" aria-labelledby="arrival-goal-title">
      <div class="arrival-goal-dialog" style="position:relative">
        <button type="button" class="button small ghost" id="btn-arrival-close-x" aria-label="Zavřít okno" style="position:absolute;top:10px;right:10px;padding:4px 10px;min-height:36px;font-weight:800">✕</button>
        <h2 id="arrival-goal-title" class="arrival-goal-title">🎉 Jsi v cíli své trasy! Co chceš udělat dál?</h2>
        <p class="arrival-goal-sub" id="arrival-goal-sub">Prošel jsi všemi vybranými zastávkami na trase. Chceš se nechat navést zpátky na místo startu, nebo výpravu rovnou uzavřít a převzít pohlednici?</p>
        <div class="arrival-goal-actions">
          <button type="button" class="arrival-goal-btn return-start" id="btn-arrival-return-start">
            🏠 Navést zpět na místo startu
          </button>
          <button type="button" class="arrival-goal-btn finish-postcard" id="btn-arrival-finish-postcard">
            🏁 Ukončit výpravu a převzít pohlednici
          </button>
        </div>
      </div>
    </div>

    <!-- Sjednocený modální dialog „Upravit procházku“ s „Potvrdit změny“ a „Zrušit“ (Bod 20) -->
    <div class="edit-walk-modal-backdrop" id="edit-walk-modal" hidden role="dialog" aria-modal="true" aria-labelledby="edit-walk-title">
      <div class="edit-walk-modal-card">
        <div class="edit-walk-modal-header">
          <div>
            <span class="eyebrow">Nastavení trasy a režimu</span>
            <h2 id="edit-walk-title" style="margin:2px 0 0">✏️ Upravit procházku</h2>
          </div>
          <button type="button" class="button small ghost" id="btn-close-edit-walk-x" aria-label="Zrušit úpravy">✕</button>
        </div>

        <p class="small-note" style="margin:0">
          Změny se projeví až po kliknutí na <strong>Potvrdit změny</strong>. Již ušlá vzdálenost, objevená území ani potvrzené zastávky se při úpravě nesmažou.
        </p>

        <div class="edit-walk-modal-body">
          <!-- 1. Rychlý záměr / generátor -->
          <div class="planner-box">
            <span class="eyebrow">1. Rychlá volba záměru</span>
            <div class="edit-intent-row">
              <button type="button" class="button small" id="draft-btn-free">📡 Volná chůze s radarem (bez pevných zastávek)</button>
              <button type="button" class="button small lime" id="draft-btn-auto-2">✨ Krátký okruh (~2 km)</button>
              <button type="button" class="button small lime" id="draft-btn-auto-5">✨ Střední okruh (~5 km)</button>
              <button type="button" class="button small lime" id="draft-btn-auto-10">✨ Delší okruh (~10 km)</button>
            </div>
            <p class="small-note" id="draft-auto-feedback" style="margin:6px 0 0" hidden></p>
          </div>

          <!-- 2. Startovní bod a Okruh -->
          <div class="planner-controls-grid">
            <div class="planner-box">
              <span class="eyebrow">2. Startovní bod</span>
              <div class="planner-origin-buttons" id="draft-origin-buttons">
                <button type="button" class="button small" data-draft-origin="my-gps">📍 Moje GPS</button>
                <button type="button" class="button small" data-draft-origin="namesti">Náměstí</button>
                <button type="button" class="button small" data-draft-origin="nadrazi">Nádraží</button>
                <button type="button" class="button small" data-draft-origin="stary-rozmital">Starý Rožmitál</button>
                <button type="button" class="button small" id="draft-btn-origin-map">🗺️ Kliknout do mapy</button>
              </div>
              <p class="small-note" id="draft-origin-desc"></p>
            </div>

            <div class="planner-box">
              <span class="eyebrow">3. Parťák a herní režim</span>
              <div class="companion-button-row" id="draft-companion-buttons">
                ${COMPANION_STYLES.map(comp => `
                  <button type="button" class="button small" data-draft-companion="${comp.id}">
                    <span>${comp.icon}</span> ${e(comp.label)}
                  </button>
                `).join('')}
              </div>
              <div class="exploration-button-row" id="draft-mode-buttons" style="margin-top:8px">
                <button type="button" class="button small" data-draft-mode="focus">🎯 Trasa</button>
                <button type="button" class="button small" data-draft-mode="compass">🧭 Kompas</button>
                <button type="button" class="button small" data-draft-mode="radar">📡 Radar</button>
              </div>
            </div>
          </div>

          <!-- 4. Okruh a kategorie -->
          <div class="planner-box">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <span class="eyebrow">4. Okruh hledání a kategorie míst</span>
              <div class="radius-selector" id="draft-radius-buttons">
                ${PLANNER_RADII.map(r => `
                  <button type="button" class="button small" data-draft-radius="${r}">${r} km</button>
                `).join('')}
              </div>
            </div>
            <div class="planner-categories-chips" id="draft-category-chips" style="margin-top:8px">
              ${PLANNER_CATEGORIES.map(cat => `
                <button type="button" class="cat-chip" data-draft-cat="${cat.id}">
                  <span>${cat.icon}</span> ${e(cat.label)}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- 5. Zastávky v návrhu (Nahoru, Dolů, Nahradit, Odebrat + Přidat) -->
          <div class="planner-box">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <span class="eyebrow">5. Zastávky v plánu (<span id="draft-basket-count">0</span> / 10)</span>
              <button type="button" class="button small lime" id="draft-btn-optimize">🔄 Uspořádat zastávky</button>
            </div>
            <div id="draft-stops-list" class="planner-basket-list"></div>

            <div style="margin-top:10px">
              <span class="eyebrow">Přidat další zastávku z okolí:</span>
              <div id="draft-available-places" class="draft-available-places"></div>
            </div>
          </div>
        </div>

        <div class="edit-walk-modal-footer">
          <button type="button" class="button ghost" id="btn-cancel-walk-edit">✕ Zrušit</button>
          <button type="button" class="button accent-action-btn" id="btn-confirm-walk-edit">✓ Potvrdit změny</button>
        </div>
      </div>
    </div>

    <!-- Modální dialog Nastavení aplikace (3 herní módy + pilulkové přepínače [ ✓ Zapnuto ] [ Vypnuto ]) -->
    <div class="edit-walk-modal-backdrop" id="app-settings-modal" hidden role="dialog" aria-modal="true" aria-labelledby="app-settings-title">
      <div class="edit-walk-modal-card">
        <div class="edit-walk-modal-header">
          <div>
            <span class="eyebrow">Předvolby zobrazení a gamifikace</span>
            <h2 id="app-settings-title" style="margin:2px 0 0">⚙️ Nastavení aplikace a herního stylu</h2>
          </div>
          <button type="button" class="button small ghost" id="btn-close-app-settings-x" aria-label="Zavřít nastavení">✕</button>
        </div>

        <div class="edit-walk-modal-body">
          <div class="planner-box">
            <span class="eyebrow">Výběr herního stylu (1 kliknutím nastaví vše):</span>
            <div class="wizard-mode-row" style="margin-top:8px">
              <button type="button" class="wizard-mode-btn ${appSettings.gameMode === 'explorer' ? 'active' : ''}" data-modal-game-mode="explorer">
                <span class="wmode-icon">🧭</span>
                <span class="wmode-text">
                  <strong>🧭 1. Objevování</strong>
                  <small>Zahalená mapa, bez čáry na zemi, jen kompas a orientace v terénu.</small>
                </span>
              </button>
              <button type="button" class="wizard-mode-btn ${appSettings.gameMode === 'gamified' ? 'active' : ''}" data-modal-game-mode="gamified">
                <span class="wmode-icon">📜</span>
                <span class="wmode-text">
                  <strong>📜 2. Výprava s pergamenem</strong>
                  <small>Doporučeno: poloprůhledný pergamen, stopy pohorek, KČT značky a razítka.</small>
                </span>
              </button>
              <button type="button" class="wizard-mode-btn ${appSettings.gameMode === 'casual' ? 'active' : ''}" data-modal-game-mode="casual">
                <span class="wmode-icon">🗺️</span>
                <span class="wmode-text">
                  <strong>🗺️ 3. Turistická mapa</strong>
                  <small>Čistá otevřená turistická mapa bez mlhy, vše viditelné od začátku.</small>
                </span>
              </button>
            </div>
          </div>

          <div class="planner-box">
            <span class="eyebrow">Jednotlivá nastavení (zapnuto / vypnuto):</span>
            <p class="small-note" style="margin:2px 0 10px">Ve výchozím stavu je vše zapnuto pro nejbohatší herní zážitek v terénu.</p>
            <div class="settings-pills-container" id="walk-settings-pills-list"></div>
          </div>
        </div>

        <div class="edit-walk-modal-footer">
          <button type="button" class="button accent-action-btn" id="btn-close-app-settings">✓ Hotovo (Uložit)</button>
        </div>
      </div>
    </div>

    <!-- DÁVKA 2 (Bod 1.1): Modální okno „✨ Uložit vzpomínku“ (soukromé vlastní symboly + čistá textová poznámka) -->
    <div class="edit-walk-modal-backdrop" id="save-memory-modal" hidden role="dialog" aria-modal="true" aria-labelledby="save-memory-title">
      <div class="edit-walk-modal-card" style="max-width:520px">
        <div class="edit-walk-modal-header">
          <div>
            <span class="eyebrow">✨ Vlastnoruční vzpomínka uživatele (soukromě v zařízení)</span>
            <h2 id="save-memory-title" style="margin:2px 0 0">✨ Uložit vzpomínku do osobního atlasu</h2>
          </div>
          <button type="button" class="button small ghost" id="btn-close-save-memory-x" aria-label="Zavřít uložení vzpomínky">✕</button>
        </div>

        <p class="small-note" style="margin:0">
          Vyber si ilustrovaný symbol a případně připiš krátkou poznámku. Vzpomínka se ukládá <strong>výhradně soukromě v tvém zařízení</strong> jako čistý text (nejde o GPS ověřenou památku ani o veřejné nahrávání fotografií).
        </p>

        <div class="edit-walk-modal-body">
          <div class="planner-box">
            <span class="eyebrow">1. Vyber symbol objevu:</span>
            <div class="memory-symbols-grid" id="memory-symbols-grid" role="radiogroup" aria-label="Výběr symbolu vzpomínky" style="margin-top:8px">
              ${PERSONAL_MEMORY_SYMBOLS.map((sym, i) => `
                <button type="button" class="memory-symbol-btn ${i === 0 ? 'selected' : ''}" data-memory-symbol="${e(sym.id)}" role="radio" aria-checked="${i === 0 ? 'true' : 'false'}">
                  <span class="memory-symbol-icon">${sym.icon}</span>
                  <span class="memory-symbol-title">${e(sym.title)}</span>
                </button>
              `).join('')}
            </div>
          </div>

          <div class="planner-box">
            <label for="memory-note-input" class="eyebrow" style="display:block;margin-bottom:6px">2. Krátká soukromá poznámka (volitelné, čistý text):</label>
            <textarea
              id="memory-note-input"
              class="memory-note-textarea"
              rows="3"
              maxlength="240"
              placeholder="Např. Starý dub u rozcestí s lavičkou ve stínu…"
            ></textarea>
            <small class="small-note" style="display:block;margin-top:4px">
              🔒 Soukromé v zařízení · Žádné nahrávání fotografií · Vykresleno bezpečně jako prostý text.
            </small>
          </div>
        </div>

        <div class="edit-walk-modal-footer">
          <button type="button" class="button ghost" id="btn-cancel-save-memory">✕ Zrušit</button>
          <button type="button" class="button accent-action-btn" id="btn-confirm-save-memory">✨ Uložit vzpomínku</button>
        </div>
      </div>
    </div>

    <div id="session-summary-container"></div>
  `;

  const $ = id => root.querySelector(`#${id}`);
  const status = text => {
    if (!disposed && $('walk-status')) {
      $('walk-status').textContent = text;
    }
  };
  const placeMarkersById = new Map();
  const prefetchedPhotoPlaceIds = new Set();
  const prefetchedVerifiedPlaceIds = new Set();
  let lastTrailRenderKey = '';
  let lastMarkerInteractedAt = 0;
  let lastRenderedLegendKey = '';
  let lastRenderedPlacesKey = '';

  function getMapPixelSize() {
    const mapEl = $('walk-map');
    const w = mapEl?.clientWidth || map?.getCanvas?.()?.clientWidth || 390;
    const h = mapEl?.clientHeight || map?.getCanvas?.()?.clientHeight || 600;
    return { x: w, y: h };
  }

  function projectLatLngToContainerPoint(lat, lng) {
    if (!map || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return { x: 0, y: 0 };
    if (typeof map.project === 'function') {
      try {
        const pt = map.project([Number(lng), Number(lat)]);
        return { x: Number.isFinite(Number(pt?.x)) ? Number(pt.x) : 0, y: Number.isFinite(Number(pt?.y)) ? Number(pt.y) : 0 };
      } catch {
        return { x: 0, y: 0 };
      }
    }
    return { x: 0, y: 0 };
  }

  function setMapView(lat, lng, zoom = null, animate = false) {
    if (!map || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;
    const rawZoom = zoom != null && Number.isFinite(Number(zoom))
      ? Number(zoom)
      : (typeof map.getZoom === 'function' ? Number(map.getZoom()) : 15.5);
    const targetZoom = Number.isFinite(rawZoom) ? Math.max(3, Math.min(19, rawZoom)) : 15.5;
    const centerLngLat = [Number(lng), Number(lat)];
    try {
      if (animate && typeof map.easeTo === 'function') {
        map.easeTo({ center: centerLngLat, zoom: targetZoom, duration: 420 });
      } else if (typeof map.jumpTo === 'function') {
        map.jumpTo({ center: centerLngLat, zoom: targetZoom });
      } else if (typeof map.setCenter === 'function') {
        map.setCenter(centerLngLat);
        if (typeof map.setZoom === 'function') map.setZoom(targetZoom);
      }
    } catch {}
  }

  function panMapTo(lat, lng, animate = false) {
    if (!map || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;
    const centerLngLat = [Number(lng), Number(lat)];
    try {
      if (animate && typeof map.easeTo === 'function') {
        map.easeTo({ center: centerLngLat, duration: 350 });
      } else if (typeof map.jumpTo === 'function') {
        map.jumpTo({ center: centerLngLat });
      } else if (typeof map.panTo === 'function') {
        map.panTo(centerLngLat, { duration: 0 });
      }
    } catch {}
  }

  function resizeMap() {
    if (!map) return;
    try {
      const mapEl = $('walk-map');
      if (mapEl && (mapEl.clientWidth <= 0 || mapEl.clientHeight <= 0)) return;
      if (map._renderTaskQueue && map._renderTaskQueue._currentlyRunning) return;
      if (typeof map.resize === 'function') {
        map.resize();
      }
    } catch {}
  }

  function isPointInExpandedMapBounds(lat, lng, padRatio = 0.35) {
    if (!map || typeof map.getBounds !== 'function') return false;
    try {
      const b = map.getBounds();
      if (!b) return false;
      const south = typeof b.getSouth === 'function' ? b.getSouth() : b._sw?.lat;
      const north = typeof b.getNorth === 'function' ? b.getNorth() : b._ne?.lat;
      const west = typeof b.getWest === 'function' ? b.getWest() : b._sw?.lng;
      const east = typeof b.getEast === 'function' ? b.getEast() : b._ne?.lng;
      if (![south, north, west, east].every(Number.isFinite)) return false;
      const latPad = Math.max(0.005, (north - south) * padRatio);
      const lngPad = Math.max(0.005, (east - west) * padRatio);
      return (
        lat >= south - latPad &&
        lat <= north + latPad &&
        lng >= west - lngPad &&
        lng <= east + lngPad
      );
    } catch {
      return false;
    }
  }

  function fitMapToLatLngPoints(points = [], padding = 40, maxZoom = 16) {
    if (!map || typeof map.fitBounds !== 'function' || !Array.isArray(points)) return;
    const lngLats = points.map(toLngLat).filter(Boolean);
    if (lngLats.length < 2) return;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const [lng, lat] of lngLats) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    if (!Number.isFinite(minLng) || !Number.isFinite(maxLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLat)) return;
    try {
      map.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        { padding: Number.isFinite(padding) ? padding : 40, maxZoom: Number.isFinite(maxZoom) ? maxZoom : 16, duration: 450 }
      );
    } catch {}
  }

  function canPersistRealState(fix = null) {
    if (demo || simSandboxActive || fix?.simulated) return false;
    return true;
  }

  function saveAppState() {
    if (!canPersistRealState()) return true;
    stateObj.plannedRoute = plannedRoute;
    stateObj.confirmedStopIds = [...confirmedStopIds];
    stateObj.walkSegments = progress.walkSegments;
    stateObj.revealedFeatures = progress.revealedFeatures;
    stateObj.personalMemories = personalMemories;
    try {
      stateObj = saveState(stateObj);
      storageError = '';
      return true;
    } catch (err) {
      storageError = err.message;
      status('Uložení se nezdařilo: ' + err.message);
      return false;
    }
  }

  /**
   * Bod 25: Sledování hráče s vycentrováním do viditelné části mapy nad spodním panelem.
   * Respektuje uživatelem zvolené přiblížení (zoom) a nikdy automaticky neoddaluje na celou trasu.
   */
  /**
   * Bod 25 & Verze v2.2 (Bod 2): Sledování hráče s vycentrováním do viditelné části mapy nad spodním panelem.
   * Ve 3D režimu posune Avatara do spodní části displeje (top: 44%), takže před sebou vidí dlouhý kus cesty.
   */
  function getBottomSheetOverlapPx() {
    if (!map || zenMode || sheetCollapsed) return 0;
    const mapRect = $('walk-map')?.getBoundingClientRect?.();
    const sheetRect = $('walk-bottom-sheet')?.getBoundingClientRect?.();
    if (!mapRect || !sheetRect || !Number.isFinite(mapRect.height) || mapRect.height < 120) return 0;
    const overlap = Math.max(0, mapRect.bottom - sheetRect.top);
    const raw = overlap > 0 ? Math.min(mapRect.height * 0.4, overlap + 24) : Math.round(mapRect.height * 0.12);
    return Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
  }

  let cachedCameraPadding = null;
  let cachedCameraPaddingAt = 0;

  function getMapCameraPadding() {
    if (!map) return { top: 0, bottom: 0, left: 0, right: 0 };
    const now = Date.now();
    if (cachedCameraPadding && (now - cachedCameraPaddingAt) < 400) {
      return cachedCameraPadding;
    }
    const mapEl = $('walk-map');
    const h = mapEl?.clientHeight || map?.transform?.height || 0;
    const w = mapEl?.clientWidth || map?.transform?.width || 0;
    if (!Number.isFinite(h) || !Number.isFinite(w) || h < 140 || w < 100) {
      return { top: 0, bottom: 0, left: 0, right: 0 };
    }
    const maxBottom = Math.max(0, Math.floor(h * 0.35));
    const bottom = zenMode ? 0 : Math.min(140, maxBottom, Math.round(getBottomSheetOverlapPx() * 0.5));
    cachedCameraPadding = {
      top: Math.min(20, Math.floor(h * 0.1)),
      bottom: Number.isFinite(bottom) ? Math.max(0, bottom) : 0,
      left: 0,
      right: 0,
    };
    cachedCameraPaddingAt = now;
    return cachedCameraPadding;
  }

  let userZoomLocked = false;
  let lastUserZoomAt = 0;
  let lastPlacesRenderPlayerPos = null;
  let lastMoveendCenterPos = null;
  let lastMoveendZoomVal = null;

  function resolveForwardGtaBearingDeg(refPos = null) {
    if (Number.isFinite(currentWalkHeadingDeg)) {
      return ((Number(currentWalkHeadingDeg) % 360) + 360) % 360;
    }
    if (fakeGpsSim && fakeGpsSim.isOpen && fakeGpsSim.mode !== 'idle' && Number.isFinite(Number(fakeGpsSim.heading))) {
      return ((Number(fakeGpsSim.heading) % 360) + 360) % 360;
    }
    if (Number.isFinite(lastGpsCourseHeading)) {
      return ((Number(lastGpsCourseHeading) % 360) + 360) % 360;
    }
    const pos = refPos && Number.isFinite(Number(refPos.lat)) && Number.isFinite(Number(refPos.lng))
      ? { lat: Number(refPos.lat), lng: Number(refPos.lng) }
      : getAvatarReferencePosition();
    if (pos && Array.isArray(plannedRouteCoords) && plannedRouteCoords.length >= 2) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < plannedRouteCoords.length; i++) {
        const pt = plannedRouteCoords[i];
        const cLat = Array.isArray(pt) ? Number(pt[0]) : Number(pt?.lat);
        const cLng = Array.isArray(pt) ? Number(pt[1]) : Number(pt?.lng);
        if (!Number.isFinite(cLat) || !Number.isFinite(cLng)) continue;
        const d = haversineMeters(pos, { lat: cLat, lng: cLng }) ?? Infinity;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      const startNode = plannedRouteCoords[bestIdx];
      const sLat = Array.isArray(startNode) ? Number(startNode[0]) : Number(startNode?.lat);
      const sLng = Array.isArray(startNode) ? Number(startNode[1]) : Number(startNode?.lng);
      for (let j = bestIdx + 1; j < plannedRouteCoords.length; j++) {
        const nextNode = plannedRouteCoords[j];
        const nLat = Array.isArray(nextNode) ? Number(nextNode[0]) : Number(nextNode?.lat);
        const nLng = Array.isArray(nextNode) ? Number(nextNode[1]) : Number(nextNode?.lng);
        if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) continue;
        const stepDist = haversineMeters({ lat: sLat, lng: sLng }, { lat: nLat, lng: nLng }) ?? 0;
        if (stepDist >= 8 || j === plannedRouteCoords.length - 1) {
          if (stepDist >= 1.0) {
            return calculateBearing({ lat: sLat, lng: sLng }, { lat: nLat, lng: nLng });
          }
        }
      }
    }
    if (currentTargetPlace && Number.isFinite(targetBearing)) {
      return ((Number(targetBearing) % 360) + 360) % 360;
    }
    if (Number.isFinite(currentDeviceHeading)) {
      return ((Number(currentDeviceHeading) % 360) + 360) % 360;
    }
    return map && typeof map.getBearing === 'function' ? ((Number(map.getBearing()) || 0) + 360) % 360 : 0;
  }

  function centerMapOnPlayer(pos = lastFix || telemetry.lastKnownPosition, animate = false) {
    if (!follow || isUserTouchingMap) return;
    if (!map || !pos || !Number.isFinite(Number(pos.lat)) || !Number.isFinite(Number(pos.lng))) return;
    const padding = getMapCameraPadding();
    const opts = {
      center: [Number(pos.lng), Number(pos.lat)],
      padding,
    };
    if (is3dMode || is3DMode) {
      opts.pitch = DEFAULT_3D_PITCH;
    }
    if (followHeadingMode) {
      const forwardBrg = resolveForwardGtaBearingDeg(pos);
      if (Number.isFinite(forwardBrg)) {
        opts.bearing = forwardBrg;
        camBearing = forwardBrg;
      }
    }
    try {
      if (animate && typeof map.easeTo === 'function') {
        map.easeTo({ ...opts, duration: 350 });
      } else if (typeof map.jumpTo === 'function') {
        map.jumpTo(opts);
      } else if (typeof map.setCenter === 'function') {
        map.setCenter(opts.center);
      }
      syncTurnPillCompassBearing();
    } catch {}
  }

  function getAvatarReferencePosition() {
    if (lastAcceptedFix && Number.isFinite(lastAcceptedFix.lat) && Number.isFinite(lastAcceptedFix.lng)) return normalizePointLatLng(lastAcceptedFix);
    if (lastFix && Number.isFinite(lastFix.lat) && Number.isFinite(lastFix.lng)) return normalizePointLatLng(lastFix);
    if (visualPlayerPos && Number.isFinite(visualPlayerPos.lat) && Number.isFinite(visualPlayerPos.lng)) return normalizePointLatLng(visualPlayerPos);
    if (telemetry?.lastKnownPosition && Number.isFinite(telemetry.lastKnownPosition.lat) && Number.isFinite(telemetry.lastKnownPosition.lng)) {
      return normalizePointLatLng(telemetry.lastKnownPosition);
    }
    const markerPos = typeof player?.getLatLng === 'function' ? player.getLatLng() : null;
    if (markerPos && Number.isFinite(markerPos.lat) && Number.isFinite(markerPos.lng)) return normalizePointLatLng(markerPos);
    return getRouteOriginPoint();
  }

  function updateRecenterButtonVisibility() {
    const recenterBtn = $('btn-recenter-avatar');
    const returnBtn = $('btn-return-to-gps');
    let isFarFromAvatar = false;
    if (map && typeof map.getCenter === 'function') {
      const c = map.getCenter();
      const avatarPos = getAvatarReferencePosition();
      if (c && avatarPos && Number.isFinite(c.lat) && Number.isFinite(c.lng) && Number.isFinite(avatarPos.lat) && Number.isFinite(avatarPos.lng)) {
        const distM = haversineMeters({ lat: c.lat, lng: c.lng }, { lat: avatarPos.lat, lng: avatarPos.lng });
        if (Number.isFinite(distM) && distM > 30) {
          isFarFromAvatar = true;
        }
      }
    }
    const shouldShowRecenter = !follow || isFarFromAvatar;
    if (recenterBtn) {
      recenterBtn.hidden = !shouldShowRecenter;
    }
    if (returnBtn) {
      returnBtn.hidden = true;
    }
    const zenBtn = $('zen-follow-btn');
    const zenLabel = $('zen-follow-label');
    if (zenBtn) {
      zenBtn.classList.toggle('is-following', Boolean(follow && !isFarFromAvatar));
      if (zenLabel) {
        zenLabel.textContent = (follow && !isFarFromAvatar) ? 'Sleduji polohu' : '◎ Vycentrovat';
      }
    }
  }

  function updateFollowUi() {
    updateRecenterButtonVisibility();
    const recenterMapBtn = $('btn-recenter-map');
    if (recenterMapBtn) {
      recenterMapBtn.classList.toggle('active', Boolean(follow));
      recenterMapBtn.classList.toggle('is-heading-active', Boolean(follow && followHeadingMode));
      recenterMapBtn.setAttribute('aria-pressed', String(Boolean(follow)));
      recenterMapBtn.textContent = (follow && followHeadingMode) ? '🧭' : '🎯';
      recenterMapBtn.title = !follow
        ? 'Vycentrovat mapu na postavičku'
        : followHeadingMode
          ? 'Sledování směru zapnuto — kliknutím vypneš otáčení mapy'
          : 'Mapa sleduje postavičku — druhým kliknutím zapneš otáčení podle kompasu';
    }
  }

  // DÁVKA 1 (Bod 2.2): Úplná izolace Simulátoru od skutečných dat v odděleném paměťovém prostoru
  let realSnapshotBeforeSim = null;

  function enterSimulatorSandbox() {
    if (simSandboxActive) return;
    // Před vstupem do simulace uložíme případný rozpracovaný reálný stav a vytvoříme nepropustný snímek
    if (watch !== null) {
      try { navigator.geolocation?.clearWatch?.(watch); } catch {}
      watch = null;
    }
    if (gpsLocatingTaskId !== null) {
      endMapTask(gpsLocatingTaskId);
      gpsLocatingTaskId = null;
    }
    const freshReal = loadState();
    realSnapshotBeforeSim = JSON.parse(JSON.stringify(freshReal));

    simSandboxActive = true;
    // Pracovní paměť simulace je hluboká kopie oddělená od localStorage
    stateObj = JSON.parse(JSON.stringify(freshReal));
    progress = {
      version: 1,
      cells: [...(stateObj.cells || [])],
      meters: Number(stateObj.meters) || 0,
      discoveries: [...(stateObj.discoveries || [])],
      walkSegments: Array.isArray(stateObj.walkSegments) ? stateObj.walkSegments.map(s => [...s]) : [],
      revealedFeatures: Array.isArray(stateObj.revealedFeatures) ? [...stateObj.revealedFeatures] : [],
    };
    confirmedStopIds = new Set();
    nearbyRecordedIds = new Set();
    personalMemories = Array.isArray(stateObj.personalMemories) ? [...stateObj.personalMemories] : [];
    pendingPlaceStamps = {};
    pendingStopSamples = {};
    memoryTrail = [];
    lastAcceptedFix = null;
    anchor = null;
    telemetry = createTelemetryState(Date.now());
    currentExpedition = null;
    walkState = 'idle';
    active = false;
    starting = false;

    keepAliveCtrl.start('Czekpoint Simulátor aktivní');
    const banner = $('walk-sandbox-banner');
    if (banner) banner.hidden = false;
    updateMapActionBar();
    stats();
    status('🧪 Simulátor zapnut v izolovaném paměťovém prostoru — tvůj skutečný pas, body, buňky mlhy ani historie se nemění.');
  }

  function exitSimulatorSandbox() {
    if (!simSandboxActive) return;
    simSandboxActive = false;
    active = false;
    starting = false;
    anchor = null;
    lastFix = null;
    lastAcceptedFix = null;
    pendingPlaceStamps = {};
    pendingStopSamples = {};
    memoryTrail = [];
    activeLocalReveals = [];
    nearbyRecordedIds = new Set();
    telemetry = createTelemetryState(Date.now());
    const banner = $('walk-sandbox-banner');
    if (banner) banner.hidden = true;
    const accBanner = $('walk-accuracy-banner');
    if (accBanner) accBanner.hidden = true;

    try {
      stateObj = realSnapshotBeforeSim ? JSON.parse(JSON.stringify(realSnapshotBeforeSim)) : loadState();
      realSnapshotBeforeSim = null;
      progress = {
        version: 1,
        cells: [...(stateObj.cells || [])],
        meters: Number(stateObj.meters) || 0,
        discoveries: [...(stateObj.discoveries || [])],
        walkSegments: Array.isArray(stateObj.walkSegments) ? stateObj.walkSegments.map(s => [...s]) : [],
        revealedFeatures: Array.isArray(stateObj.revealedFeatures) ? [...stateObj.revealedFeatures] : [],
      };
      personalMemories = Array.isArray(stateObj.personalMemories) ? [...stateObj.personalMemories] : [];
      currentExpedition = stateObj.activeExpedition;
      walkState = currentExpedition && currentExpedition.state !== 'ended' ? 'paused' : 'idle';
      plannedRoute = stateObj.plannedRoute || plannedRoute;
      confirmedStopIds = new Set(Array.isArray(stateObj.confirmedStopIds) ? stateObj.confirmedStopIds : []);
    } catch (err) {
      storageError = err.message;
    }

    if (map && player && accuracyRing) {
      const restPos = lastFix || plannedRoute?.origin || ROZMITAL_CENTER;
      player.setLatLng([restPos.lat, restPos.lng]);
      setPlayerMarkerVisible(true);
      updatePlayerAvatarIcon(Boolean(active || demo));
      accuracyRing.setRadius(0);
    }
    plannedRouteRenderKey = null;
    updateMapActionBar();
    renderPersonalMemoriesUi();
    renderPlaces();
    scheduleFog(50, true);
    renderTrail();
    stats();
    renderQuestHud(plannedRoute.origin);
    status('Simulátor ukončen. Obnoven tvůj skutečný nedotčený pas a mapa.');
  }

  function setPlayerMarkerVisible(visible) {
    if (!player) return;
    if (typeof player.setOpacity === 'function') {
      player.setOpacity(visible ? 1 : 0);
    } else if (typeof player.getElement === 'function' && player.getElement()) {
      player.getElement().style.opacity = visible ? '1' : '0';
    }
  }

  function updatePlayerAvatarIcon(isWalking = Boolean(active || demo)) {
    if (!player) return;
    const avatarId = stateObj.profile?.avatarId || 'liska';
    const currentMapBearingDeg = map && typeof map.getBearing === 'function' ? Number(map.getBearing()) || 0 : 0;
    const desiredWorldBearing = (currentTargetPlace && Number.isFinite(targetBearing))
      ? targetBearing
      : resolveForwardGtaBearingDeg();
    const screenRelativeAngleDeg = computeScreenRelativeAngleDeg(
      Number.isFinite(desiredWorldBearing) ? desiredWorldBearing : 0,
      currentMapBearingDeg
    );
    const el = typeof player.getElement === 'function' ? player.getElement() : null;
    if (el) {
      const wrap = el.querySelector('.player-avatar-marker');
      const pointer = el.querySelector('.avatar-direction-pointer');
      if (wrap && wrap.dataset.avatarId === avatarId) {
        wrap.classList.toggle('is-walking', Boolean(isWalking));
        wrap.classList.toggle('is-3d-avatar', Boolean(is3dMode || is3DMode));
        if (pointer) {
          const showArrow = appSettings.orbitalArrow !== false;
          pointer.style.display = showArrow ? '' : 'none';
          pointer.style.transform = `rotate(${Math.round(screenRelativeAngleDeg)}deg)`;
          pointer.dataset.screenAngle = String(Math.round(screenRelativeAngleDeg));
          pointer.dataset.targetBearing = String(Math.round(Number.isFinite(desiredWorldBearing) ? desiredWorldBearing : 0));
        }
        return;
      }
      el.innerHTML = renderPlayerAvatarMarkerHtml({
        avatarId,
        bearingDeg: screenRelativeAngleDeg,
        isWalking,
        is3D: Boolean(is3dMode || is3DMode),
        orbitalArrow: appSettings.orbitalArrow !== false,
      });
      const newPointer = el.querySelector('.avatar-direction-pointer');
      if (newPointer) {
        newPointer.dataset.screenAngle = String(Math.round(screenRelativeAngleDeg));
        newPointer.dataset.targetBearing = String(Math.round(Number.isFinite(desiredWorldBearing) ? desiredWorldBearing : 0));
      }
    }
  }

  let camLng = null;
  let camLat = null;
  let camBearing = 0;
  let currentWalkHeadingDeg = null;
  let renderedPlayerPos = null;

  /**
   * Plynulý klouzavý posun postavičky a GTA-style kamery (60 FPS lineární interpolace):
   * - Přichytí pozici k chodníku/stezce (snapPointToPedestrianPath, tolerance ±16 m).
   * - Postavička neposkakuje po skocích, ale plynule jede z aktuální vykreslené pozice do cílového bodu.
   * - Při zapnutém followHeadingMode („🧭“) otáčí mapu (ve 2D i 2.5D) tak, že směr chůze / budoucí trasy míří vždy nahoru (GTA pohled).
   */
  function smoothMovePlayerTo(rawTargetLat, rawTargetLng, durationMs = 950) {
    if (!map || !player || !Number.isFinite(rawTargetLat) || !Number.isFinite(rawTargetLng)) return;
    if (playerLerpRafId) {
      cancelAnimationFrame(playerLerpRafId);
      playerLerpRafId = null;
    }

    const snappedPt = snapPointToPedestrianPath(
      { lat: rawTargetLat, lng: rawTargetLng },
      plannedRouteCoords,
      16
    );
    const targetLat = snappedPt && Number.isFinite(snappedPt.lat) ? snappedPt.lat : rawTargetLat;
    const targetLng = snappedPt && Number.isFinite(snappedPt.lng) ? snappedPt.lng : rawTargetLng;

    setPlayerMarkerVisible(true);

    const markerLatLng = typeof player.getLatLng === 'function' ? player.getLatLng() : null;
    const startLat = renderedPlayerPos && Number.isFinite(renderedPlayerPos.lat)
      ? renderedPlayerPos.lat
      : (markerLatLng && Number.isFinite(markerLatLng.lat) ? markerLatLng.lat : targetLat);
    const startLng = renderedPlayerPos && Number.isFinite(renderedPlayerPos.lng)
      ? renderedPlayerPos.lng
      : (markerLatLng && Number.isFinite(markerLatLng.lng) ? markerLatLng.lng : targetLng);

    const distM = haversineMeters({ lat: startLat, lng: startLng }, { lat: targetLat, lng: targetLng }) ?? 0;

    if (distM >= 0.35 && distM <= 300) {
      currentWalkHeadingDeg = calculateBearing({ lat: startLat, lng: startLng }, { lat: targetLat, lng: targetLng });
    }

    visualPlayerPos = { lat: targetLat, lng: targetLng };
    updatePlayerAvatarIcon(Boolean(active || demo || simSandboxActive));

    const startBearing = typeof map.getBearing === 'function' ? (Number(map.getBearing()) || 0) : (Number(camBearing) || 0);
    const targetCamHeading = followHeadingMode
      ? resolveForwardGtaBearingDeg({ lat: targetLat, lng: targetLng })
      : startBearing;
    const bearingDelta = ((targetCamHeading - startBearing + 540) % 360) - 180;

    const shouldGlide =
      durationMs > 0 &&
      distM >= 0.12 &&
      distM <= 220 &&
      typeof requestAnimationFrame === 'function';

    if (shouldGlide) {
      const animDuration = Math.max(180, Math.min(1200, Number(durationMs) || 920));
      const animStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();

      const stepFrame = (nowPerf) => {
        const currentNow = Number.isFinite(nowPerf)
          ? nowPerf
          : (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const elapsed = Math.max(0, currentNow - animStartMs);
        const t = Math.min(1, elapsed / animDuration);

        const curLat = startLat + (targetLat - startLat) * t;
        const curLng = startLng + (targetLng - startLng) * t;
        renderedPlayerPos = { lat: curLat, lng: curLng };

        player.setLatLng([curLat, curLng]);
        accuracyRing?.setLatLng([curLat, curLng]);

        if (follow && !isUserTouchingMap && map) {
          const jumpOpts = {
            center: [curLng, curLat],
            padding: getMapCameraPadding(),
          };
          if (is3dMode || is3DMode) {
            jumpOpts.pitch = DEFAULT_3D_PITCH;
          }
          if (followHeadingMode) {
            const brgProgress = Math.min(1, t * 1.35);
            camBearing = (startBearing + bearingDelta * brgProgress + 360) % 360;
            jumpOpts.bearing = camBearing;
          }
          camLng = curLng;
          camLat = curLat;
          try {
            map.jumpTo(jumpOpts);
          } catch {}
          updatePlayerAvatarIcon(Boolean(active || demo || simSandboxActive));
          syncTurnPillCompassBearing();
        }

        if (t < 1) {
          playerLerpRafId = requestAnimationFrame(stepFrame);
        } else {
          playerLerpRafId = null;
        }
      };

      playerLerpRafId = requestAnimationFrame(stepFrame);
    } else {
      renderedPlayerPos = { lat: targetLat, lng: targetLng };
      player.setLatLng([targetLat, targetLng]);
      accuracyRing?.setLatLng([targetLat, targetLng]);

      if (follow && !isUserTouchingMap && map) {
        const jumpOpts = {
          center: [targetLng, targetLat],
          padding: getMapCameraPadding(),
        };
        if (is3dMode || is3DMode) {
          jumpOpts.pitch = DEFAULT_3D_PITCH;
        }
        if (followHeadingMode) {
          camBearing = (startBearing + bearingDelta + 360) % 360;
          jumpOpts.bearing = camBearing;
        }
        camLng = targetLng;
        camLat = targetLat;
        try {
          map.jumpTo(jumpOpts);
        } catch {}
        updatePlayerAvatarIcon(Boolean(active || demo || simSandboxActive));
        syncTurnPillCompassBearing();
      }
    }

    if (!follow) {
      updateRecenterButtonVisibility();
    }
    renderTrail();

    const nowMs = Date.now();
    if (distM >= 8.0 || (nowMs - lastFogUpdateAt) >= 900) {
      drawFog();
    }
  }

  function metersToPx(lat, meters) {
    if (!map) return 30;
    const p1 = projectLatLngToContainerPoint(lat, 13.8644);
    const p2 = projectLatLngToContainerPoint(lat + (meters / 111320), 13.8644);
    return Math.max(8, Math.hypot(p2.x - p1.x, p2.y - p1.y));
  }

  /**
   * Vykreslí geograficky ukotvenou texturu mlhy (MapLibre raster vrstva `czekpoint-fog-layer`).
   * Nikdy nevolá map.removeLayer ani map.removeSource!
   * Aktualizuje pouze offscreen canvas a volá source.updateImage({ url: canvas.toDataURL(), coordinates: fogBounds })
   * nejvýše jednou za 600 ms (throttle) a pouze tehdy, když se hráč pohnul o >= 3 m nebo se změnil fogMode.
   */
  function drawFog(force = false) {
    if (!map || disposed) return;
    if (typeof document === 'undefined') return;

    const nowMs = Date.now();

    // Verze v2.2 (Bod 1.2): Během aktivní animace pohybu nebo dotyku uživatele spouštět drawFog odloženě
    if ((playerLerpRafId !== null || isUserTouchingMap) && !force && (nowMs - lastFogUpdateAt < 1200)) {
      scheduleFog(isUserTouchingMap ? 350 : 1200);
      return;
    }

    const curCenter = (typeof map.getCenter === 'function' ? map.getCenter() : null) || lastFix || getRouteOriginPoint();
    let viewportBounds = null;
    if (map && typeof map.getBounds === 'function') {
      try {
        const b = map.getBounds();
        if (b) {
          let south = typeof b.getSouth === 'function' ? b.getSouth() : b._sw?.lat;
          let north = typeof b.getNorth === 'function' ? b.getNorth() : b._ne?.lat;
          let west = typeof b.getWest === 'function' ? b.getWest() : b._sw?.lng;
          let east = typeof b.getEast === 'function' ? b.getEast() : b._ne?.lng;
          // KRITICKÁ OPRAVA 3D: V nakloněném 3D pohledu (pitch 58°) sahá map.getBounds() až k horizontu (15–30 km daleko),
          // což by při každém pootočení/naklonění kamery nafouklo texturu mlhy a vyvolalo synchronní 1024×1024 toDataURL()!
          // Omezíme proto viewportBounds kolem středu pohledu na rozumný lokální poloměr (~1.6 km).
          const curPitch = typeof map.getPitch === 'function' ? Number(map.getPitch()) || 0 : 0;
          if ((is3dMode || is3DMode || curPitch > 20) && curCenter && Number.isFinite(curCenter.lat) && Number.isFinite(curCenter.lng)) {
            const maxHalfLat = 0.014;
            const maxHalfLng = 0.020;
            south = Math.max(Number(south), curCenter.lat - maxHalfLat);
            north = Math.min(Number(north), curCenter.lat + maxHalfLat);
            west = Math.max(Number(west), curCenter.lng - maxHalfLng);
            east = Math.min(Number(east), curCenter.lng + maxHalfLng);
          }
          viewportBounds = { south, north, west, east };
        }
      } catch {}
    }

    const boundsMissing = !fogGeographicBounds || !Array.isArray(fogGeographicBounds.coordinates);
    const centerOutOfSafe = !boundsMissing && !isPointInsideFogSafeBounds(curCenter.lat, curCenter.lng, fogGeographicBounds, 0.65);
    const viewportExceedsFog = !boundsMissing && viewportBounds && (
      Number(viewportBounds.south) < Number(fogGeographicBounds.south) ||
      Number(viewportBounds.north) > Number(fogGeographicBounds.north) ||
      Number(viewportBounds.west) < Number(fogGeographicBounds.west) ||
      Number(viewportBounds.east) > Number(fogGeographicBounds.east)
    );
    const outOfSafeBounds = boundsMissing || centerOutOfSafe || viewportExceedsFog;

    if (force || outOfSafeBounds) {
      fogGeographicBounds = computeFogGeographicBounds(curCenter, {
        walkSegments: progress.walkSegments,
        cells: progress.cells,
        viewportBounds,
      });
    }

    const activePlayerPos = (active || demo || simSandboxActive) ? lastFix : null;
    const revealCenterPos = activePlayerPos || visualPlayerPos || lastFix || getRouteOriginPoint();
    const fogStateKey = `${fogMode}|${is3DMode ? '3d' : '2d'}|${fogGeographicBounds?.coordinates?.join(';')}|${progress.cells.length}|${progress.walkSegments.length}|${revealCenterPos ? Math.round(revealCenterPos.lat * 2000) + ',' + Math.round(revealCenterPos.lng * 2000) : 'none'}`;
    if (fogStateKey === lastFogStateKey && force !== true) {
      return;
    }

    const movedDistM = (activePlayerPos && lastFogPlayerPos)
      ? (haversineMeters(lastFogPlayerPos, activePlayerPos) ?? Infinity)
      : (activePlayerPos && !lastFogPlayerPos ? Infinity : 0);

    const modeChanged = fogMode !== lastFogRenderedMode;
    const cellsChanged = progress.cells.length !== lastFogCellsCount;
    const playerMoved6m = movedDistM >= 6;

    if (!force && !modeChanged && !outOfSafeBounds && !playerMoved6m && !cellsChanged && lastFogRenderedMode !== null) {
      return;
    }

    if (!force && !modeChanged && (nowMs - lastFogUpdateAt) < 800 && lastFogRenderedMode !== null) {
      scheduleFog(Math.max(50, 800 - (nowMs - lastFogUpdateAt)));
      return;
    }

    // Vykreslovací plátno pevně 512 × 512 px pro bleskové překreslování mlhy na mobilu
    if (!fogTextureCanvas) {
      fogTextureCanvas = document.createElement('canvas');
      fogTextureCanvas.width = 512;
      fogTextureCanvas.height = 512;
    }
    if (fogTextureCanvas.width !== 512 || fogTextureCanvas.height !== 512) {
      fogTextureCanvas.width = 512;
      fogTextureCanvas.height = 512;
    }

    if (fogMode === 'none') {
      lastFogStateKey = fogStateKey;
      lastFogUpdateAt = nowMs;
      lastFogRenderedMode = fogMode;
      lastFogCellsCount = progress.cells.length;
      if (activePlayerPos && Number.isFinite(activePlayerPos.lat) && Number.isFinite(activePlayerPos.lng)) {
        lastFogPlayerPos = { lat: activePlayerPos.lat, lng: activePlayerPos.lng };
      }
      try {
        if (map.getLayer('czekpoint-fog-layer')) {
          map.setLayoutProperty('czekpoint-fog-layer', 'visibility', 'none');
          map.setPaintProperty('czekpoint-fog-layer', 'raster-opacity', 0);
        }
      } catch {}
      return;
    }

    const fogBounds = fogGeographicBounds.coordinates;
    const effectiveRevealRadiusM = activePlayerPos
      ? FOG_REVEAL_RADIUS_M
      : Math.max(FOG_REVEAL_RADIUS_M, 280);
    const result = renderFogTextureToCanvas(fogTextureCanvas, {
      fogMode,
      fogBounds: fogGeographicBounds,
      walkSegments: progress.walkSegments,
      cells: progress.cells,
      revealedFeatures: progress.revealedFeatures,
      activeLocalReveals,
      lastFix: revealCenterPos,
      revealRadiusM: effectiveRevealRadiusM,
      width: 512,
      height: 512,
    });

    lastFogStateKey = fogStateKey;
    lastFogUpdateAt = nowMs;
    lastFogRenderedMode = fogMode;
    lastFogCellsCount = progress.cells.length;
    if (activePlayerPos && Number.isFinite(activePlayerPos.lat) && Number.isFinite(activePlayerPos.lng)) {
      lastFogPlayerPos = { lat: activePlayerPos.lat, lng: activePlayerPos.lng };
    }

    try {
      if (map.getLayer('czekpoint-fog-layer')) {
        map.setLayoutProperty('czekpoint-fog-layer', 'visibility', fogMode === 'none' ? 'none' : 'visible');
        const targetFogOpacity = fogMode === 'full' ? 0.94 : (fogMode === 'none' ? 0 : 0.82);
        map.setPaintProperty('czekpoint-fog-layer', 'raster-opacity', targetFogOpacity);
      }
      const source = map.getSource('czekpoint-fog-source');
      const canvasUrl = result?.dataUrl || (typeof fogTextureCanvas.toDataURL === 'function' ? fogTextureCanvas.toDataURL() : '');
      if (source && canvasUrl && typeof source.updateImage === 'function') {
        source.updateImage({
          url: canvasUrl,
          coordinates: fogBounds,
        });
      }
    } catch {}
  }
  const updateFogCanvas = drawFog;

  function scheduleFog(delayMs = 600, force = false) {
    if (disposed) return;
    if (fogRenderTimer) clearTimeout(fogRenderTimer);
    fogRenderTimer = setTimeout(() => {
      fogRenderTimer = null;
      drawFog(force);
    }, delayMs);
  }

  function clearFootprintMarkers() {
    for (const m of footprintMarkers) {
      try { m.remove(); } catch {}
    }
    footprintMarkers = [];
    try {
      const fpSrc = map && typeof map.getSource === 'function' ? map.getSource('footprints-source') : null;
      if (fpSrc && typeof fpSrc.setData === 'function') {
        fpSrc.setData({ type: 'FeatureCollection', features: [] });
      }
    } catch {}
  }

  /**
   * Generování stop každé 2.2 metru přímo za patami Avatara (Bod 4):
   * - Prochází úseky podél prošlé trasy walkSegments až k aktuální pozici Avatara.
   * - První stopa začíná ~2 metry za patami Avatara.
   * - Střídá levou a pravou botu (isLeft = stepIndex % 2 === 0) s bočním odsazením ±0.4 m.
   * - Ukládá směr chůze bearingDeg a vrací posledních 60 stop.
   */
  function computeDenseTrailFootprints(walkSegments, playerPos, maxSteps = 60) {
    if (!Array.isArray(walkSegments) || walkSegments.length === 0) return [];

    const segments = [];
    for (const seg of walkSegments) {
      if (!Array.isArray(seg) || seg.length < 2) continue;
      const pts = seg.map(p => (Array.isArray(p) ? { lat: Number(p[0]), lng: Number(p[1]) } : { lat: Number(p.lat), lng: Number(p.lng) })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (pts.length >= 2) segments.push(pts);
    }

    if (segments.length === 0) return [];

    // Pokud máme aktuální pozici Avatara, napojíme ji na konec posledního segmentu
    if (playerPos && Number.isFinite(playerPos.lat) && Number.isFinite(playerPos.lng)) {
      const lastSeg = segments[segments.length - 1];
      const lastPt = lastSeg[lastSeg.length - 1];
      const gapM = haversineMeters(lastPt, playerPos) ?? 0;
      if (gapM >= 0.8 && gapM <= 60) {
        lastSeg.push({ lat: playerPos.lat, lng: playerPos.lng });
      }
    }

    const footprints = [];
    let stepIndex = 0;

    for (let sIdx = 0; sIdx < segments.length; sIdx++) {
      const seg = segments[sIdx];
      let segLen = 0;
      const legDistances = [];
      for (let i = 0; i < seg.length - 1; i++) {
        const d = haversineMeters(seg[i], seg[i + 1]) ?? 0;
        legDistances.push(d);
        segLen += d;
      }
      if (segLen < 2.2) continue;

      // Pro poslední segment skončíme ~2.0 metry před koncem (přímo za patami Avatara)
      const endOffset = (sIdx === segments.length - 1) ? 2.0 : 0;
      const maxDistance = segLen - endOffset;

      let targetDist = 2.0;
      let currentDist = 0;
      let legIdx = 0;

      while (targetDist <= maxDistance && legIdx < seg.length - 1) {
        while (legIdx < seg.length - 1 && currentDist + legDistances[legIdx] < targetDist) {
          currentDist += legDistances[legIdx];
          legIdx++;
        }
        if (legIdx >= seg.length - 1) break;

        const legLenM = legDistances[legIdx];
        if (legLenM < 0.1) {
          legIdx++;
          continue;
        }

        const legDist = targetDist - currentDist;
        const t = Math.max(0, Math.min(1, legDist / legLenM));
        const p1 = seg[legIdx];
        const p2 = seg[legIdx + 1];

        const interpLat = p1.lat + (p2.lat - p1.lat) * t;
        const interpLng = p1.lng + (p2.lng - p1.lng) * t;
        const bearingDeg = calculateBearing(p1, p2);

        const isLeft = (stepIndex % 2 === 0);
        const perpAngleDeg = (bearingDeg + (isLeft ? -90 : 90) + 360) % 360;
        const offsetPt = moveCoordinates({ lat: interpLat, lng: interpLng }, 0.4, perpAngleDeg);

        footprints.push({
          lat: offsetPt.lat,
          lng: offsetPt.lng,
          bearingDeg: Math.round(bearingDeg),
          side: isLeft ? 'L' : 'R',
          stepIndex,
        });

        stepIndex++;
        targetDist += 2.2; // Rozestup 2.2 metru
      }
    }

    // Posledních maxSteps stop (až 60 kroků) přímo za Avatarem se stárnoucí průhledností
    const recent = footprints.slice(-maxSteps);
    const totalRecent = recent.length;
    for (let i = 0; i < totalRecent; i++) {
      const ageRatio = totalRecent <= 1 ? 1 : i / (totalRecent - 1);
      recent[i].opacity = Number((0.35 + 0.60 * ageRatio).toFixed(2));
    }
    return recent;
  }

  /**
   * Vykreslí prošlou trasu (`walkSegments` jako GeoJSON vrstvu) a střídavé levé/pravé otisky podrážky pohorky
   * (`.footprint-marker`, 26 × 26 px) s rotationAlignment: 'map' a pitchAlignment: 'map' (Bod 4).
   */
  function renderTrail() {
    if (!map) return;

    // 1. Aktualizujeme GeoJSON zdroj prošlých segmentů v MapLibre
    try {
      const walkedSrc = typeof map.getSource === 'function' ? map.getSource('walked-segments-source') : null;
      if (walkedSrc && typeof walkedSrc.setData === 'function') {
        walkedSrc.setData(buildWalkSegmentsGeoJson(progress.walkSegments));
      }
    } catch {}

    if (appSettings.footprints === false) {
      clearFootprintMarkers();
      lastTrailRenderKey = 'disabled';
      if ($('trail-info')) {
        $('trail-info').textContent = 'Stopy pohorek jsou vypnuté v nastavení.';
      }
      return;
    }

    const avatarPos = visualPlayerPos || lastFix || getRouteOriginPoint();
    const footprints = computeDenseTrailFootprints(progress.walkSegments, avatarPos, 45);
    const totalCount = footprints.length;

    if ($('trail-info')) {
      $('trail-info').textContent = `Stopy pohorek na prošlé cestě: ${totalCount} kroků · Potvrzení zastávky: pod ${STOP_CONFIRM_RADIUS_M} m (opakované měření)`;
    }

    const lastFp = totalCount > 0 ? footprints[totalCount - 1] : null;
    const trailKey = `${totalCount}|${lastFp ? `${lastFp.lat.toFixed(5)},${lastFp.lng.toFixed(5)}` : '0'}`;
    if (trailKey === lastTrailRenderKey) return;
    lastTrailRenderKey = trailKey;

    ensureCustomMapSourcesAndLayers();
    try {
      const fpSrc = typeof map.getSource === 'function' ? map.getSource('footprints-source') : null;
      if (fpSrc && typeof fpSrc.setData === 'function') {
        fpSrc.setData({
          type: 'FeatureCollection',
          features: footprints.map(fp => ({
            type: 'Feature',
            properties: {
              side: fp.side,
              bearingDeg: fp.bearingDeg,
              opacity: fp.opacity,
            },
            geometry: {
              type: 'Point',
              coordinates: [fp.lng, fp.lat],
            },
          })),
        });
      }
    } catch {}
  }

  function getAllAvailablePlaces() {
    const mapById = new Map();
    for (const p of catalogue) mapById.set(p.id, p);
    for (const p of nearby) {
      if (!mapById.has(p.id)) {
        const acc = resolveAccessibleStopLocation(p);
        mapById.set(p.id, acc ? { ...p, lat: acc.lat, lng: acc.lng, isShoreAccess: acc.isShoreAccess } : p);
      }
    }
    if (Array.isArray(plannedRoute.embeddedStops)) {
      for (const p of plannedRoute.embeddedStops) {
        if (p && p.id && !mapById.has(p.id)) {
          const normP = normalizePointLatLng(p);
          if (!normP) continue;
          const acc = resolveAccessibleStopLocation({ ...p, lat: normP.lat, lng: normP.lng });
          mapById.set(p.id, {
            id: p.id,
            title: p.title || p.label || p.id,
            lat: acc ? acc.lat : normP.lat,
            lng: acc ? acc.lng : normP.lng,
            kind: p.kind || 'forest',
            category: p.category || 'nature',
            pointKind: 'place',
            collectible: true,
            url: `#/katalog`,
          });
        }
      }
    }
    return [...mapById.values()];
  }

  function getPlannedPlaces(idsOverride = null) {
    const all = getAllAvailablePlaces();
    const ids = idsOverride || plannedRoute.selectedPlaceIds || [];
    return ids.map(id => all.find(p => p.id === id)).filter(Boolean);
  }

  // Bod 7: Jasné oddělení „navštíveno během této výpravy“ vs. „objeveno dříve v pasu“
  function isStopVisitedInSession(p) {
    if (!p) return false;
    return confirmedStopIds.has(p.id);
  }

  function hasLifetimeStamp(p) {
    if (!p) return false;
    return (
      progress.discoveries.includes(p.id) ||
      progress.discoveries.includes(`catalog:${p.id}`)
    );
  }

  function isStopVisited(p) {
    return isStopVisitedInSession(p);
  }

  function clearHikingBlazeMarkers() {
    for (const m of hikingBlazeMarkers) {
      try { m.remove(); } catch {}
    }
    hikingBlazeMarkers = [];
  }

  /**
   * Vrstva turistických tras KČT používá výhradně přesnou rastrovou vrstvu waymarked-hiking-layer,
   * která 100% sedí na skutečných cestách v mapě (žádné umělé vzdušné čáry mimo cesty z PILOT_HIKING_TRAILS).
   */
  async function loadAndRenderHikingTrails() {
    if (!map) return;
    loadedHikingTrails = [];
    renderHikingTrailsOnMap();
    renderHikingTrailsLegend();
  }

  function renderHikingTrailsOnMap() {
    if (!map) return;
    clearHikingBlazeMarkers();
    try {
      if (map.getLayer('waymarked-hiking-layer')) {
        map.setLayoutProperty('waymarked-hiking-layer', 'visibility', showHikingTrails ? 'visible' : 'none');
      }
    } catch {}
  }

  function renderHikingTrailsLegend() {
    const listEl = $('hiking-trails-list');
    if (!listEl) return;
    if (!loadedHikingTrails.length) {
      listEl.innerHTML = '<p class="small-note">Žádné turistické trasy v této oblasti nejsou načtené.</p>';
      return;
    }
    listEl.innerHTML = loadedHikingTrails.map(trail => {
      const parsed = trail.parsedSymbol || parseOsmcSymbol(trail.osmcSymbol, trail.colour);
      const badgeSvg = renderOsmcBadgeSvg(trail.osmcSymbol, trail.colour, { size: 16 });
      return `
        <button type="button" class="hiking-trail-chip" data-trail-id="${e(trail.id)}" title="Ukázat trasu na mapě">
          ${badgeSvg}
          <span class="hiking-trail-chip-name">${e(trail.name)}</span>
          <span class="hiking-trail-chip-meta">${e(trail.distance || parsed.labelCz)}</span>
        </button>
      `;
    }).join('');
  }

  let currentDeviceHeading = null;
  let targetBearing = 0;

  function updateHeadingModeBannerUi() {
    updateFollowUi();
    const banner = $('heading-mode-banner');
    if (!banner) return;
    if (!followHeadingMode) {
      banner.hidden = true;
      banner.textContent = '';
      banner.className = 'heading-mode-banner';
      return;
    }

    if (compassSensorState === 'active') {
      banner.hidden = false;
      banner.className = 'heading-mode-banner is-compass-active';
      banner.textContent = '🧭 Sledování směru podle kompasu telefonu (směr před tebou je nahoře)';
    } else if (compassSensorState === 'denied') {
      banner.hidden = false;
      banner.className = 'heading-mode-banner is-compass-fallback';
      banner.textContent = lastGpsCourseHeading != null
        ? '🧭 Směr podle chůze (GPS) — telefon neposkytuje kompas'
        : '⚠️ Přístup ke kompasu zamítnut — sleduji polohu GPS (při chůzi ≥ 1,0 m/s se použije směr z GPS)';
    } else if (compassSensorState === 'unavailable') {
      banner.hidden = false;
      banner.className = 'heading-mode-banner is-compass-fallback';
      banner.textContent = '🧭 Směr podle chůze (GPS) — telefon neposkytuje kompas';
    } else {
      banner.hidden = false;
      banner.className = 'heading-mode-banner';
      banner.textContent = '🧭 Sledovat směr aktivní — ověřuji kompas zařízení…';
    }
  }

  function updateOffscreenTargetIndicator() {
    const ind = $('offscreen-target-indicator');
    if (!ind) return;
    if (!map || !currentTargetPlace || !Number.isFinite(currentTargetDist)) {
      ind.hidden = true;
      return;
    }

    const pxSize = getMapPixelSize();
    const width = Math.max(200, pxSize.x || 390);
    const height = Math.max(200, pxSize.y || 600);
    const pt = projectLatLngToContainerPoint(currentTargetPlace.lat, currentTargetPlace.lng);

    const isInsideScreen =
      pt.x >= 32 &&
      pt.x <= width - 32 &&
      pt.y >= 52 &&
      pt.y <= height - 64;

    const currentMapBearingDeg = typeof map.getBearing === 'function' ? Number(map.getBearing()) || 0 : 0;
    const screenRelativeAngleDeg = computeScreenRelativeAngleDeg(targetBearing, currentMapBearingDeg);

    if (isInsideScreen) {
      ind.hidden = true;
      ind.dataset.screenAngle = String(Math.round(screenRelativeAngleDeg));
      return;
    }

    const placement = computeOffscreenIndicatorPlacement(screenRelativeAngleDeg, { width, height }, 46);
    const distLabel = formatDistanceLabel(currentTargetDist);
    ind.hidden = false;
    ind.style.left = `${placement.x}px`;
    ind.style.top = `${placement.y}px`;
    ind.dataset.screenAngle = String(placement.angleDeg);
    ind.innerHTML = `
      <span class="offscreen-target-arrow" style="transform: rotate(${placement.angleDeg}deg)" aria-hidden="true">▲</span>
      <span class="offscreen-target-text">
        <strong>${e(distLabel)}</strong> · ${e(currentTargetPlace.title)}
      </span>
    `;
  }

  function syncTurnPillCompassBearing() {
    const mapBrg = map && typeof map.getBearing === 'function' ? Number(map.getBearing()) || 0 : (Number(camBearing) || 0);
    const activeBrg = (is3dMode || is3DMode)
      ? (Number.isFinite(mapBrg) && mapBrg !== 0 ? mapBrg : (Number(currentDeviceHeading) || Number(currentWalkHeadingDeg) || 0))
      : mapBrg;
    const rotorEl = $('turn-pill-compass-rotor');
    const pillCompassEl = $('turn-pill-compass');
    if (rotorEl) {
      rotorEl.style.transition = 'transform 0.22s ease-out';
      rotorEl.style.transform = `rotate(${(-activeBrg).toFixed(1)}deg)`;
      rotorEl.dataset.bearing = String(Math.round(activeBrg));
    }
    if (pillCompassEl) {
      pillCompassEl.classList.toggle('is-25d-active', Boolean(is3dMode || is3DMode));
      pillCompassEl.title = `Orientace mapy (${Math.round(((activeBrg % 360) + 360) % 360)}°) — kliknutím vycentruješ`;
    }
  }

  function updateDirectionalIndicators() {
    const currentMapBearingDeg = map && typeof map.getBearing === 'function' ? Number(map.getBearing()) || 0 : 0;
    const screenRelativeAngleDeg = computeScreenRelativeAngleDeg(targetBearing, currentMapBearingDeg);

    updatePlayerAvatarIcon(Boolean(active || demo));
    updateOffscreenTargetIndicator();
    syncTurnPillCompassBearing();

    const dial = $('compass-dial');
    const targetArrow = $('compass-target-arrow');
    if (currentDeviceHeading == null || is3dMode || is3DMode) {
      if (dial) {
        dial.style.transition = 'transform 0.2s ease-out';
        dial.style.transform = `rotate(${(-currentMapBearingDeg).toFixed(1)}deg)`;
      }
      if (targetArrow) {
        targetArrow.style.transition = 'transform 0.2s ease-out';
        targetArrow.style.transform = `rotate(${screenRelativeAngleDeg.toFixed(1)}deg)`;
      }
    }
  }

  function applyHeadingToMapCamera(rawHeadingDeg, source = 'compass') {
    if (!followHeadingMode || !follow || isUserTouchingMap || !map || disposed) return;
    if ((typeof map.isMoving === 'function' && map.isMoving()) || (typeof map.isEasing === 'function' && map.isEasing())) {
      return;
    }
    const nowMs = Date.now();
    if (nowMs - lastCameraEaseAt < 250) return;
    const stab = headingFollowStabilizer.update(rawHeadingDeg, nowMs);
    if (!stab.updated) return;

    lastCameraEaseAt = nowMs;
    try {
      map.easeTo({
        bearing: stab.smoothedHeading,
        duration: source === 'gps_course' ? 280 : 220,
        easing: t => t,
      });
    } catch {}
  }

  function updateCompassRotation(heading, isGenuineSensor = false) {
    if (!Number.isFinite(Number(heading))) return;
    const normHeading = ((Number(heading) % 360) + 360) % 360;
    if (isGenuineSensor) {
      lastAbsoluteCompassAt = Date.now();
      if (compassSensorState !== 'active') {
        compassSensorState = 'active';
        updateHeadingModeBannerUi();
      }
    }

    currentDeviceHeading = normHeading;
    const stab = compassStabilizer.update(normHeading, Date.now());
    currentDeviceHeading = stab.smoothedHeading;
    const dial = $('compass-dial');
    const targetArrow = $('compass-target-arrow');
    if (dial && stab.updated) {
      dial.style.transition = 'transform 0.25s ease-out';
      dial.style.transform = `rotate(${(-stab.continuousAngle).toFixed(1)}deg)`;
    }
    if (targetArrow && stab.updated) {
      targetArrow.style.transition = 'transform 0.25s ease-out';
      targetArrow.style.transform = `rotate(${(targetBearing - stab.continuousAngle).toFixed(1)}deg)`;
    }

    if (followHeadingMode && follow) {
      applyHeadingToMapCamera(normHeading, 'compass');
    }
    updatePlayerAvatarIcon(Boolean(active || demo));
    updateOffscreenTargetIndicator();
    syncTurnPillCompassBearing();
  }

  function handleDeviceOrientation(event) {
    if (disposed) return;
    // DÁVKA 3 (Bod 3.1) & DÁVKA 1 v2.2.1: Skutečný kompas se započtením úhlu orientace obrazovky
    const rawHeading = extractAbsoluteCompassHeadingDeg(event);
    if (rawHeading != null && Number.isFinite(rawHeading)) {
      const screenAngle = typeof window !== 'undefined'
        ? (Number(window.screen?.orientation?.angle) || Number(window.orientation) || 0)
        : 0;
      const heading = (((rawHeading + screenAngle) % 360) + 360) % 360;
      updateCompassRotation(heading, true);
    }
  }

  function unbindOrientationListeners() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('deviceorientationabsolute', handleDeviceOrientation, true);
    window.removeEventListener('deviceorientation', handleDeviceOrientation, true);
    orientationListenersBound = false;
  }

  function bindOrientationListeners() {
    if (typeof window === 'undefined' || disposed) return;
    unbindOrientationListeners();
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', handleDeviceOrientation, { capture: true });
    } else {
      window.addEventListener('deviceorientation', handleDeviceOrientation, { capture: true });
    }
    orientationListenersBound = true;
  }

  bindOrientationListeners();

  async function setFollowHeadingMode(enable) {
    if (disposed) return;
    const nextState = Boolean(enable);
    if (compassCheckTimer) {
      clearTimeout(compassCheckTimer);
      compassCheckTimer = null;
    }

    if (!nextState) {
      followHeadingMode = false;
      updateHeadingModeBannerUi();
      if (map) {
        try {
          map.easeTo({ bearing: 0, duration: 450 });
        } catch {}
      }
      updateDirectionalIndicators();
      status('⬆️ Režim Sledovat směr vypnut — mapa vrácena severem nahoru.');
      return;
    }

    followHeadingMode = true;
    follow = true;
    updateFollowUi();
    updateHeadingModeBannerUi();
    headingFollowStabilizer.reset();

    // Vycentrujeme mapu na Avatara a okamžitě natočíme mapu ve směru trasy / chůze (GTA pohled: směr vpřed je nahoře)
    const activePos = visualPlayerPos || lastFix || telemetry.lastKnownPosition || getRouteOriginPoint();
    if (map && player && activePos && Number.isFinite(activePos.lat) && Number.isFinite(activePos.lng)) {
      if (player.getOpacity() === 0) {
        player.setLatLng([activePos.lat, activePos.lng]);
        setPlayerMarkerVisible(true);
      }
      centerMapOnPlayer(activePos, true);
      updateDirectionalIndicators();
    }

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm !== 'granted') {
          compassSensorState = 'denied';
          updateHeadingModeBannerUi();
          status('🧭 GTA orientace zapnuta — směr chůze a trasy je vždy nahoře.');
          return;
        }
      } catch {
        compassSensorState = 'denied';
        updateHeadingModeBannerUi();
        status('🧭 GTA orientace zapnuta — směr chůze a trasy je vždy nahoře.');
        return;
      }
    }

    bindOrientationListeners();

    if (lastAbsoluteCompassAt > 0 && Date.now() - lastAbsoluteCompassAt < 5000) {
      compassSensorState = 'active';
      updateHeadingModeBannerUi();
      const forwardBrg = resolveForwardGtaBearingDeg(activePos);
      if (Number.isFinite(forwardBrg)) {
        applyHeadingToMapCamera(forwardBrg, 'compass');
      }
      status('🧭 GTA orientace zapnuta — mapa se otáčí kolem postavičky tak, že směr chůze je vždy nahoře.');
      return;
    }

    compassSensorState = 'unknown';
    updateHeadingModeBannerUi();

    compassCheckTimer = setTimeout(() => {
      compassCheckTimer = null;
      if (disposed || !followHeadingMode) return;
      if (lastAbsoluteCompassAt === 0 || Date.now() - lastAbsoluteCompassAt > 3000) {
        compassSensorState = 'unavailable';
        updateHeadingModeBannerUi();
        const forwardBrg = resolveForwardGtaBearingDeg(activePos);
        if (Number.isFinite(forwardBrg) && follow) {
          applyHeadingToMapCamera(forwardBrg, 'gps_course');
        }
        status('🧭 GTA orientace zapnuta — mapa se otáčí kolem postavičky tak, že směr kudy máš jít je vždy nahoře.');
      }
    }, 450);
  }

  function getCompanionSpeedKmH() {
    // ZADÁNÍ #09 (Bod 1): Výchozí tempo je pohodových 4,0 km/h.
    // Po 10 minutách chůze (>= 600 s) se čas do cíle sám zpřesní podle toho, jak rychle uživatel reálně jde.
    if (
      telemetry &&
      Number(telemetry.activeMovingSeconds) >= 600 &&
      Number.isFinite(telemetry.averageMovingSpeedKmh) &&
      telemetry.averageMovingSpeedKmh >= 1.8 &&
      telemetry.averageMovingSpeedKmh <= 8.0
    ) {
      return telemetry.averageMovingSpeedKmh;
    }
    return 4.0;
  }

  function formatDurationCz(minutes) {
    const mins = Math.max(1, Math.round(Number(minutes) || 0));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h <= 0) return `~${m} min`;
    if (m === 0) return `~${h} hod`;
    return `~${h} hod ${m} min`;
  }

  function formatStopsCountCz(count) {
    const n = Number(count) || 0;
    if (n === 1) return '1 zastávka';
    if (n >= 2 && n <= 4) return `${n} zastávky`;
    return `${n} zastávek`;
  }

  function getCategoryIconForPlace(p) {
    if (!p) return '📍';
    if (p.category === 'castles' || p.kind === 'culture' || p.kind === 'castle' || p.kind === 'heritage') return '🏰';
    if (p.category === 'views' || p.kind === 'view' || p.kind === 'peak') return '🔭';
    if (p.category === 'water' || p.kind === 'water' || p.kind === 'spring') return '💧';
    if (p.category === 'nature' || p.kind === 'forest' || p.kind === 'nature') return '🌲';
    return '📍';
  }

  function renderPhase1AndPhase4Ui(origin = lastFix) {
    if ($('turn-nav-pill')) {
      $('turn-nav-pill').hidden = false;
    }
    const itineraryStrip = $('top-route-itinerary-strip');
    if (!itineraryStrip) return;
    const plannedPlaces = getPlannedPlaces();
    const currentOrigin = getRouteOriginPoint();
    const isLoop = plannedRoute.routeType === 'loop' && plannedPlaces.length >= 1;
    const startLabel = plannedRoute.origin?.label
      ? plannedRoute.origin.label.split('—')[0].trim()
      : 'Start (Moje poloha)';
    if (plannedPlaces.length === 0) {
      itineraryStrip.innerHTML = `
        <span class="itinerary-empty">Žádné vybrané zastávky — klikni na místo v mapě nebo v seznamu níže.</span>
      `;
    } else {
      let firstUnvisitedFound = false;
      let prevPt = currentOrigin;
      const stopPillsHtml = plannedPlaces.map((p, idx) => {
        const visited = isStopVisited(p);
        const isNext = !visited && !firstUnvisitedFound;
        if (isNext) firstUnvisitedFound = true;
        const legM = prevPt ? haversineMeters(prevPt, p) : null;
        prevPt = p;
        const legStr = legM != null ? formatDistanceLabel(legM) : '';
        const catIcon = getCategoryIconForPlace(p);
        const stateBadge = visited ? '✓ ' : (isNext ? '🎯 ' : '');
        const stateCls = visited ? 'is-visited' : (isNext ? 'is-next' : '');
        return `
          <span class="itinerary-arrow" aria-hidden="true">→</span>
          <div class="itinerary-stop-pill ${stateCls}" data-itinerary-stop-id="${e(p.id)}" title="Klikni pro zobrazení místa na mapě a detailu">
            <button type="button" class="itinerary-stop-main" data-itinerary-focus="${e(p.id)}">
              <span class="itinerary-stop-num">${idx + 1}.</span>
              <span class="itinerary-stop-icon">${catIcon}</span>
              <span class="itinerary-stop-title">${stateBadge}${e(p.title)}</span>
              ${legStr ? `<small class="itinerary-stop-dist">(${e(legStr)})</small>` : ''}
            </button>
            <button type="button" class="itinerary-stop-remove" data-itinerary-remove="${idx}" title="Vynechat tuto zastávku z trasy" aria-label="Vynechat zastávku ${e(p.title)}">×</button>
          </div>
        `;
      }).join('');

      const endLabel = isLoop
        ? `<span class="itinerary-arrow" aria-hidden="true">→</span><span class="itinerary-end-pill loop" title="Trasa se vrací jinou cestou zpět na start">🔄 Okruh zpět (${e(startLabel)})</span>`
        : `<span class="itinerary-arrow" aria-hidden="true">→</span><span class="itinerary-end-pill oneway">🏁 Cíl v poslední zastávce</span>`;

      itineraryStrip.innerHTML = `
        <button type="button" class="itinerary-start-pill" data-itinerary-start="1" title="Vycentrovat mapu na start výpravy">
          🚩 Start: <strong>${e(startLabel)}</strong>
        </button>
        ${stopPillsHtml}
        ${endLabel}
      `;
    }
    updateTurnNavPill(origin);
  }

  function renderCompass(origin) {
    if (!origin) return;
    const plannedPlaces = getPlannedPlaces();

    let targetPlace = null;
    let targetDist = Infinity;
    let targetIndex = 0;

    if (plannedPlaces.length > 0) {
      for (let i = 0; i < plannedPlaces.length; i++) {
        const p = plannedPlaces[i];
        if (!isStopVisited(p)) {
          targetPlace = p;
          targetDist = haversineMeters(origin, p) ?? Infinity;
          targetIndex = i + 1;
          break;
        }
      }
    }

    if (!targetPlace) {
      for (const p of catalogue) {
        if (!p.collectible || isStopVisited(p)) continue;
        const d = haversineMeters(origin, p) ?? Infinity;
        if (d < targetDist) {
          targetDist = d;
          targetPlace = p;
        }
      }
    }

    if (targetPlace && Number.isFinite(targetDist)) {
      currentTargetPlace = targetPlace;
      currentTargetDist = targetDist;
      const computedBrg = computeGeodesicBearingDeg(origin, targetPlace);
      targetBearing = computedBrg != null ? computedBrg : 0;

      const directions = [
        { name: 'sever', arrow: '↑' },
        { name: 'severovýchod', arrow: '↗' },
        { name: 'východ', arrow: '→' },
        { name: 'jihovýchod', arrow: '↘' },
        { name: 'jih', arrow: '↓' },
        { name: 'jihozápad', arrow: '↙' },
        { name: 'západ', arrow: '←' },
        { name: 'severozápad', arrow: '↖' },
      ];
      const dir = directions[Math.round(targetBearing / 45) % 8];
      const prefix = plannedPlaces.length > 0
        ? `Další cíl: ${targetIndex} z ${plannedPlaces.length}`
        : 'Nejbližší místo';

      const widget = $('active-compass-widget');
      if (widget) widget.title = `${prefix}: ${Math.round(targetDist)} m vzdušně · ${dir.name} (${dir.arrow}) · ${targetPlace.title}`;
      if ($('compass-dist-badge')) {
        $('compass-dist-badge').textContent = formatDistanceLabel(targetDist);
      }

      if (currentDeviceHeading != null && compassSensorState === 'active') {
        updateCompassRotation(currentDeviceHeading, false);
      } else {
        updateDirectionalIndicators();
      }
    } else {
      currentTargetPlace = null;
      currentTargetDist = Infinity;
      const widget = $('active-compass-widget');
      if (widget) {
        widget.title = plannedPlaces.length === 0 ? 'Volná chůze · Odkrývání mapy' : 'Všechny zastávky navštíveny! Výborně.';
      }
      if ($('compass-dist-badge')) {
        $('compass-dist-badge').textContent = plannedPlaces.length === 0 ? 'Volná chůze' : 'Hotovo ✓';
      }
      updateDirectionalIndicators();
    }
    updateTurnNavPill(origin);
  }

  let lastPocketSpokenMeters = 0;
  let lastPocketSpokenAt = 0;

  /**
   * ZADÁNÍ #08 (Bod 5) & ZADÁNÍ #10: Hlasová navigace v češtině (Web Speech API, cs-CZ) + zvukový signál rohu
   * fungující spolehlivě i při zhasnutém displeji / v kapse.
   */
  function speakCzechNav(text, stepKey = '', direction = 'straight') {
    if (!voiceNavEnabled || !text) return;
    if (stepKey && stepKey === lastSpokenNavStepKey) return;
    if (stepKey) lastSpokenNavStepKey = stepKey;

    if (typeof window !== 'undefined') {
      const entry = { text: String(text), stepKey: String(stepKey || ''), direction, ts: Date.now() };
      window.__lastSpokenNav = entry;
      window.__spokenNavHistory = [...(Array.isArray(window.__spokenNavHistory) ? window.__spokenNavHistory.slice(-19) : []), entry];
    }

    if (stateObj.soundEnabled !== false) {
      playTurnAudioCue(direction);
    }

    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
        try {
          window.speechSynthesis.resume?.();
        } catch {}
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.cancel();
        }
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'cs-CZ';
        utter.rate = 1.0;
        utter.volume = 1.0;
        try {
          const voices = window.speechSynthesis.getVoices?.() || [];
          const czVoice = voices.find(v => v.lang && (v.lang.startsWith('cs') || v.lang.startsWith('sk')));
          if (czVoice) utter.voice = czVoice;
        } catch {}
        window.speechSynthesis.speak(utter);
      }
    } catch {}
  }

  /**
   * ZADÁNÍ #08 (Bod 5): Aktualizuje kompaktní pilulku odbočovací navigace (.turn-nav-pill) vedle kompasu
   * a hlásí každý roh domu v předstihu i přímo u rohu a z kapsy při zhasnutém displeji.
   */
  function updateTurnNavPill(origin = lastFix) {
    const pillEl = $('turn-nav-pill');
    const iconEl = $('turn-nav-icon');
    const textEl = $('turn-nav-text');
    if (pillEl) pillEl.hidden = false;
    syncTurnPillCompassBearing();

    const plannedPlaces = getPlannedPlaces();
    const unvisitedPlaces = plannedPlaces.filter(p => !isStopVisited(p));
    const currentPos = origin || lastFix || telemetry.lastKnownPosition || plannedRoute.origin;
    const gainedM = currentExpedition ? Math.max(0, progress.meters - (currentExpedition.startMeters || 0)) : (progress.meters || 0);

    if (!currentPos || (unvisitedPlaces.length === 0 && plannedPlaces.length === 0)) {
      if (iconEl) iconEl.textContent = '🧭';
      if (textEl) textEl.textContent = `Volný průzkum · ${formatMetersCz(gainedM)}`;
      return;
    }

    const instr = computeActiveTurnInstruction(
      lastRoutedGeometry,
      currentPos,
      plannedPlaces,
      confirmedStopIds
    );
    const nextStop = unvisitedPlaces[0] || plannedPlaces[plannedPlaces.length - 1];
    const directDistM = nextStop ? haversineMeters(currentPos, nextStop) : null;
    const distLabel = instr.distanceToTurnM != null
      ? `${Math.round(instr.distanceToTurnM)} m`
      : (directDistM != null ? formatDistanceLabel(directDistM) : '');
    const arrowChar = instr.icon || '↱';
    const nextTitle = nextStop?.title || 'Cíl trasy';
    if (iconEl) iconEl.textContent = arrowChar;
    if (textEl) {
      const cleanTurnText = String(instr.text || 'Pokračuj po cestě')
        .replace(/^[↑↗→↘↓↙←↖↱↰⬆⬇⬅➡🧭🎯🏁]+\s*/u, '')
        .trim();
      if (cleanTurnText.includes('→')) {
        textEl.textContent = cleanTurnText;
      } else {
        const hasDist = distLabel && cleanTurnText.includes(distLabel);
        textEl.textContent = `${distLabel && !hasDist ? `${distLabel} · ` : ''}${cleanTurnText} → ${nextTitle}`;
      }
    }

    if ($('pocket-mode-overlay') && !$('pocket-mode-overlay').hidden && $('pocket-mode-stats')) {
      $('pocket-mode-stats').textContent = instr.text || 'GPS zaznamenává trasu na pozadí';
    }

    // Aktualizace MediaSession pro zobrazení navigace na zamčené obrazovce telefonu
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator && navigator.mediaSession?.metadata) {
      try {
        if (instr.text) navigator.mediaSession.metadata.title = instr.text;
        if (instr.distanceToTurnM != null) {
          navigator.mediaSession.metadata.album = `Czekpoint · ${Math.round(instr.distanceToTurnM)} m`;
        }
      } catch {}
    }

    // Pokud hráč seběhl z trasy (potvrzené vybočení > 45 m), automaticky přepočítáme pěší trasu
    // z jeho nového místa přímo k dalšímu nadcházejícímu cíli v pořadí (nikdy zpět na náměstí!)
    if (instr.isOffRoute && (active || demo || simSandboxActive) && (Date.now() - lastOffRouteRecalcAt > 7000)) {
      lastOffRouteRecalcAt = Date.now();
      plannedRouteRenderKey = null;
      renderPlannedRouteOnMap(true, { offRoute: true });
      if (voiceNavEnabled) {
        speakCzechNav('Pozor, vybočili jste z trasy. Přepočítávám cestu.', `offroute_${Math.floor(Date.now() / 15000)}`, 'right');
      }
    }

    const isHiddenOrPocket = (typeof document !== 'undefined' && document.hidden === true) || ($('pocket-mode-overlay') && !$('pocket-mode-overlay').hidden);

    if (voiceNavEnabled && (active || demo || simSandboxActive)) {
      if (instr.voiceText && instr.distanceToTurnM != null && instr.distanceToTurnM <= 70) {
        // Hlášení odbočky u křižovatky
        speakCzechNav(instr.voiceText, instr.stepKey, instr.turnDirection || 'straight');
      } else if (isHiddenOrPocket) {
        // V kapse nebo při zhasnutém displeji: pravidelné hlasové vedení každých ~40 m nebo každých 30 s
        const walkedM = Number(progress?.meters) || 0;
        const now = Date.now();
        const distSinceLastSpoken = Math.abs(walkedM - lastPocketSpokenMeters);
        const timeSinceLastSpoken = now - lastPocketSpokenAt;
        if ((distSinceLastSpoken >= 40 || (timeSinceLastSpoken >= 30000 && distSinceLastSpoken >= 15)) && instr.text) {
          lastPocketSpokenMeters = walkedM;
          lastPocketSpokenAt = now;
          const speechMsg = instr.voiceText || instr.text;
          speakCzechNav(speechMsg, `pocket_update_${Math.floor(walkedM / 40)}_${Math.floor(now / 30000)}`, instr.turnDirection || 'straight');
        }
      }
    }
  }

  /**
   * Bod 28: Aktualizuje hlavní trojici ukazatelů (ušlá vzdálenost, čas chůze, vzdálenost k další zastávce)
   * a rozbalovací přehled turistických údajů ze společné pěší trasy.
   */
  function renderTouristStatsHud(origin = lastFix) {
    const now = Date.now();
    // Kritické pravidlo DÁVKY 1 (Bod 2.1 & 2.3): Dokud se čeká na GPS ('locating') nebo je pauza ('paused'), nepřičítá se aktivní čas chůze!
    const isWalkingNow = Boolean(
      walkState === 'running' &&
      (active || demo || simSandboxActive) &&
      (!currentExpedition || currentExpedition.state === 'active')
    );
    telemetry = updateTelemetryTimers(telemetry, now, isWalkingNow);

    const gainedM = currentExpedition ? Math.max(0, progress.meters - currentExpedition.startMeters) : progress.meters;
    const plannedPlaces = getPlannedPlaces();
    const isLoop = plannedRoute.routeType === 'loop' && plannedPlaces.length >= 2;
    const currentPos = origin || lastFix || telemetry.lastKnownPosition || plannedRoute.origin || { lat: 49.6014, lng: 13.8644 };

    const rem = computeRemainingFromSharedRoute({
      sharedRoute: lastRoutedGeometry,
      currentPos,
      plannedPlaces,
      confirmedStopIds,
      companionMode: stateObj.companionMode || 'solo',
      returnToOrigin: isLoop,
      origin: plannedRoute.origin,
    });

    const summary = computeTouristStatsSummary({
      telemetry,
      walkedMeters: gainedM,
      nextStopDistanceM: rem.nextStopDistanceM,
      nextStopTitle: rem.nextStop?.title || null,
      remainingRouteDistanceM: rem.remainingDistanceM,
      remainingRouteMinutes: rem.remainingMinutes,
      isRouteValid: rem.isRouteValid,
      now,
    });

    if ($('hud-walked-dist')) {
      $('hud-walked-dist').textContent = formatMetersCz(summary.walkedMeters);
    }
    if ($('hud-walk-time')) {
      $('hud-walk-time').textContent = summary.activeWalkFormatted;
    }
    if ($('hud-next-stop')) {
      if (rem.nextStop) {
        const distPart = rem.nextStopDistanceM != null ? formatMetersCz(rem.nextStopDistanceM) : '—';
        $('hud-next-stop').textContent = `${distPart} · ${rem.nextStop.title}`;
      } else if (plannedPlaces.length > 0) {
        $('hud-next-stop').textContent = 'V cíli ✓';
      } else {
        $('hud-next-stop').textContent = 'Volná chůze';
      }
    }

    if ($('stat-current-speed')) $('stat-current-speed').textContent = summary.currentSpeedFormatted;
    if ($('stat-avg-speed')) $('stat-avg-speed').textContent = summary.avgWalkSpeedFormatted;
    if ($('stat-total-time')) $('stat-total-time').textContent = `${summary.activeWalkFormatted} / ${summary.totalElapsedFormatted}`;
    if ($('stat-altitude')) $('stat-altitude').textContent = summary.altitudeLabel;
    if ($('stat-altitude-source')) $('stat-altitude-source').textContent = summary.altitudeSourceLabel;
    if ($('stat-elevation')) $('stat-elevation').textContent = summary.elevationFormatted;
    if ($('stat-remaining')) $('stat-remaining').textContent = summary.remainingFormatted;
    if ($('stat-remaining-note')) {
      $('stat-remaining-note').textContent = rem.isRouteValid
        ? 'Vypočteno ze společné pěší trasy'
        : plannedPlaces.length === 0
        ? 'Žádná naplánovaná trasa'
        : 'Pěší trasa není k dispozici';
    }
  }

  /**
   * Bod 29: Načte a vykreslí stručné počasí pro následujících 60 minut (1 věta + rozbalovací podrobnosti).
   */
  async function refreshWeatherStrip(posOverride = null) {
    const queryPos = posOverride || lastFix || plannedRoute.origin || { lat: 49.6018, lng: 13.8635 };
    const locLabel = plannedRoute.origin?.label || 'Rožmitál pod Třemšínem a okolí';
    try {
      const w = await getWeatherForNext60Min({
        pos: queryPos,
        locationLabel: locLabel,
      });
      if (disposed || !w) return;
      weatherData = w;
      renderWeatherStripUi();
    } catch {}
  }

  function renderWeatherStripUi() {
    const sentenceEl = $('weather-sentence');
    const gridEl = $('weather-detail-grid');
    if (!sentenceEl) return;

    if (!weatherData) {
      sentenceEl.textContent = '🌤️ Předpověď počasí na příštích 60 minut není v tuto chvíli dostupná.';
      return;
    }

    const offlineBadge = weatherData.isOffline
      ? ` · ⚠️ Offline (předpověď stará ${weatherData.ageMinutes} min)`
      : weatherData.ageMinutes > 0
      ? ` · aktualizováno před ${weatherData.ageMinutes} min`
      : ' · právě aktualizováno';

    sentenceEl.innerHTML = `${weatherData.icon} <strong>Počasí (60 min):</strong> ${e(weatherData.sentence)} <span class="weather-age-note">${e(offlineBadge)}</span>`;

    if (gridEl) {
      const updatedTime = new Date(weatherData.fetchedAtMs).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
      const tempStr = weatherData.temperatureC != null ? `${weatherData.temperatureC.toFixed(1).replace('.', ',')} °C` : '—';
      const appTempStr = weatherData.apparentTemperatureC != null ? `${weatherData.apparentTemperatureC.toFixed(1).replace('.', ',')} °C` : '—';
      const precipStr = `${(weatherData.precipNext60Mm || 0).toFixed(1).replace('.', ',')} mm (${weatherData.resolutionLabel || 'odhad na 60 min'})`;
      const windStr = weatherData.windSpeedKmH != null ? `${weatherData.windSpeedKmH} km/h` : '—';

      gridEl.innerHTML = `
        <div class="wd-cell"><span>Teplota / Pocitová</span><strong>${e(tempStr)} / ${e(appTempStr)}</strong></div>
        <div class="wd-cell"><span>Srážky (příštích 60 min)</span><strong>${e(precipStr)}</strong></div>
        <div class="wd-cell"><span>Rychlost větru</span><strong>${e(windStr)}</strong></div>
        <div class="wd-cell"><span>Oblast a aktualizace</span><strong>${e(weatherData.locationLabel)} (${e(updatedTime)}${weatherData.isOffline ? `, stáří ${weatherData.ageMinutes} min` : ''})</strong></div>
        <div class="wd-attribution">Zdroj dat počasí: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (licence CC BY 4.0) · Dotazy omezeny na max. 1× za 15 min se zaokrouhlenou polohou.</div>
      `;
    }
  }

  /**
   * Přepočítá zbývající trasu ze společné pěší trasy (`lastRoutedGeometry`) a aktualizuje plovoucí Quest HUD.
   * Nikdy nemaže již ušlou vzdálenost ani potvrzené zastávky (Bod 19, 26 & 28).
   */
  function renderQuestHud(origin) {
    renderPhase1AndPhase4Ui(origin);
    updatePlayerLead(origin || lastFix);
  }
  function renderQuestHudLegacyUnused(origin) {
    const hudPanel = $('quest-hud-panel');
    if (!hudPanel) return;

    const plannedPlaces = getPlannedPlaces();
    if (plannedPlaces.length === 0) {
      hudPanel.hidden = true;
      updatePlayerLead(origin || lastFix);
      return;
    }
    hudPanel.hidden = false;

    const currentPos = origin || lastFix || telemetry.lastKnownPosition || plannedRoute.origin || { lat: 49.6014, lng: 13.8644 };
    const isLoop = plannedRoute.routeType === 'loop' && plannedPlaces.length >= 2;
    const rem = computeRemainingFromSharedRoute({
      sharedRoute: lastRoutedGeometry,
      currentPos,
      plannedPlaces,
      confirmedStopIds,
      companionMode: 'solo',
      returnToOrigin: isLoop,
      origin: plannedRoute.origin,
    });

    const visitedCount = plannedPlaces.filter(p => isStopVisited(p)).length;
    if ($('qhud-progress')) $('qhud-progress').textContent = `${visitedCount}/${plannedPlaces.length}`;
    if ($('qhud-compact-pill-label')) {
      $('qhud-compact-pill-label').textContent = `📊 Trasa (${visitedCount}/${plannedPlaces.length})`;
    }

    const totalDistM = Number(rem.remainingDistanceM ?? plannedRoute.metrics?.distanceM ?? 0);
    const speedKmH = getCompanionSpeedKmH();
    const totalTimeMin = totalDistM > 0 ? Math.max(1, Math.round((totalDistM / 1000) / speedKmH * 60)) : 0;
    if ($('qhud-total-dist')) $('qhud-total-dist').textContent = totalDistM > 0 ? formatDistanceLabel(totalDistM) : '0 m';
    if ($('qhud-total-time')) $('qhud-total-time').textContent = `~${totalTimeMin} min`;
    if ($('qhud-eta-clock')) {
      const etaDate = new Date(Date.now() + totalTimeMin * 60000);
      $('qhud-eta-clock').textContent = etaDate.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
    }

    const stopsListEl = $('qhud-stops-list');
    if (stopsListEl) {
      const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      stopsListEl.innerHTML = plannedPlaces.map((p, idx) => {
        const done = isStopVisited(p);
        const isNext = rem.nextStop && String(rem.nextStop.id) === String(p.id);
        const distM = currentPos ? Math.round(haversineMeters(currentPos, p)) : null;
        return `<li class="qhud-stop-row ${done ? 'is-visited' : ''} ${isNext ? 'is-next' : ''}" data-stop-id="${esc(p.id)}">
          <button type="button" class="qhud-stop-focus-btn" data-focus-stop-id="${esc(p.id)}">
            <span class="qhud-stop-badge">${done ? '✓' : idx + 1}</span>
            <span class="qhud-stop-title">${esc(p.title || 'Místo')}</span>
            <span class="qhud-stop-dist">${distM != null ? formatDistanceLabel(distM) : ''}</span>
          </button>
          <button type="button" class="qhud-stop-remove-btn" data-remove-stop-id="${esc(p.id)}" title="Odebrat z trasy" aria-label="Odebrat z trasy">✕</button>
        </li>`;
      }).join('');

      stopsListEl.querySelectorAll('[data-focus-stop-id]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const stopId = btn.getAttribute('data-focus-stop-id');
          const target = plannedPlaces.find(item => String(item.id) === String(stopId));
          if (target && map) {
            follow = false;
            map.easeTo({ center: [target.lng, target.lat], zoom: Math.max(map.getZoom(), 16), duration: 450 });
          }
        });
      });

      stopsListEl.querySelectorAll('[data-remove-stop-id]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const stopId = btn.getAttribute('data-remove-stop-id');
          if (stopId) togglePlaceInRoute(stopId);
        });
      });
    }

    if (plannedPlaces.length === 0) {
      if ($('qhud-next-name')) $('qhud-next-name').textContent = 'Volná chůze · Odkrývání mapy';
      if ($('qhud-next-eta')) $('qhud-next-eta').textContent = 'Bez pevného cíle';
    } else if (rem.nextStop) {
      const distStr = rem.nextStopDistanceM != null ? formatDistanceLabel(rem.nextStopDistanceM) : '—';
      const nextTimeMin = rem.nextStopDistanceM != null
        ? Math.max(1, Math.round((rem.nextStopDistanceM / 1000) / speedKmH * 60))
        : null;
      if ($('qhud-next-name')) $('qhud-next-name').textContent = rem.nextStop.title;
      if ($('qhud-next-eta')) $('qhud-next-eta').textContent = nextTimeMin != null ? `za ${distStr} · ~${nextTimeMin} min` : `za ${distStr}`;
    } else {
      if ($('qhud-next-name')) $('qhud-next-name').textContent = 'Všechny zastávky potvrzeny! 🎉';
      if ($('qhud-next-eta')) $('qhud-next-eta').textContent = 'Trasa splněna!';
    }

    updatePlayerLead(origin || lastFix);
    updateTurnNavPill(origin || lastFix);
    renderPhase1AndPhase4Ui(origin || lastFix);
  }

  /**
   * ZADÁNÍ #08 (Bod 2): Odstraněna přímá čárkovaná čára z hráče do cíle.
   * Směr ukazuje zlatá orbitální šipka (.avatar-direction-pointer) kolem Avatara.
   */
  function updatePlayerLead(pos) {
    if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return;
    renderCompass(pos);
    updatePlayerAvatarIcon(Boolean(active || demo));
  }

  function clearRouteOverlayMarkers() {
    for (const m of routeOverlayMarkers) {
      try { m.remove(); } catch {}
    }
    routeOverlayMarkers = [];
  }

  /**
   * KRITICKÁ OPRAVA 2 (Hotfix v2.0.2): Start trasy VŽDY z aktuální polohy postavičky.
   */
  function getRouteOriginPoint() {
    // Pokud uživatel v této relaci ručně nezvolil jiné město přes Lupu a existuje lastFix, vždy vracíme polohu hráče
    if (!userExplicitlyPickedOrigin) {
      if (lastFix && Number.isFinite(lastFix.lat)) return normalizePointLatLng(lastFix);
      if (lastAcceptedFix && Number.isFinite(lastAcceptedFix.lat)) return normalizePointLatLng(lastAcceptedFix);
      if (visualPlayerPos && Number.isFinite(visualPlayerPos.lat)) return normalizePointLatLng(visualPlayerPos);
    }
    if (lastAcceptedFix && Number.isFinite(lastAcceptedFix.lat)) return normalizePointLatLng(lastAcceptedFix);
    if (lastFix && Number.isFinite(lastFix.lat)) return normalizePointLatLng(lastFix);
    if (visualPlayerPos && Number.isFinite(visualPlayerPos.lat)) return normalizePointLatLng(visualPlayerPos);
    if (plannedRoute?.origin && Number.isFinite(plannedRoute.origin.lat)) return normalizePointLatLng(plannedRoute.origin);
    if (map && typeof map.getCenter === 'function') {
      const c = map.getCenter();
      if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
        return normalizePointLatLng({ lat: c.lat, lng: c.lng });
      }
    }
    return { lat: 49.6022, lng: 13.8636 };
  }

  function getExpeditionStartPoint() {
    if (expeditionStartPoint && Number.isFinite(expeditionStartPoint.lat)) {
      const norm = normalizePointLatLng(expeditionStartPoint);
      return { ...expeditionStartPoint, lat: norm.lat, lng: norm.lng };
    }
    if (lockedExpeditionOrigin && Number.isFinite(lockedExpeditionOrigin.lat)) {
      const norm = normalizePointLatLng(lockedExpeditionOrigin);
      return { ...lockedExpeditionOrigin, lat: norm.lat, lng: norm.lng };
    }
    if (plannedRoute?.origin && Number.isFinite(plannedRoute.origin.lat)) {
      const norm = normalizePointLatLng(plannedRoute.origin);
      return { ...plannedRoute.origin, lat: norm.lat, lng: norm.lng };
    }
    return getRouteOriginPoint();
  }

  function getRouteGeometryKey(waypoints) {
    return waypoints
      .map(w => {
        const norm = normalizePointLatLng(w);
        return norm ? `${Number(norm.lat).toFixed(5)},${Number(norm.lng).toFixed(5)}` : '0,0';
      })
      .join('|');
  }

  async function getCachedWalkingGeometry(waypoints, key) {
    if (routeGeometryCache.has(key)) return routeGeometryCache.get(key);
    const routeTaskId = beginMapTask('⏳ Počítám trasu…');
    const pending = fetchWalkingGeometry(waypoints)
      .then(res => {
        if (!res?.coordinates || res.coordinates.length < 2) routeGeometryCache.delete(key);
        return res;
      })
      .catch(() => { routeGeometryCache.delete(key); return null; })
      .finally(() => {
        endMapTask(routeTaskId);
      });
    routeGeometryCache.set(key, pending);
    return pending;
  }

  function applyPlannedRouteGeoJsonToMap(coords, isFallbackGeom = false) {
    if (!map) return;
    ensureCustomMapSourcesAndLayers();
    try {
      const showLine = appSettings.gameMode !== 'explorer' && Array.isArray(coords) && coords.length >= 2;
      const geojson = buildPlannedRouteGeoJson(showLine ? coords : [], isFallbackGeom);
      const routeSrc = typeof map.getSource === 'function' ? map.getSource('planned-route-source') : null;
      if (routeSrc && typeof routeSrc.setData === 'function') {
        routeSrc.setData(geojson);
      }
      const vis = showLine ? 'visible' : 'none';
      if (typeof map.setLayoutProperty === 'function') {
        if (map.getLayer('planned-route-casing')) {
          map.setLayoutProperty('planned-route-casing', 'visibility', vis);
        }
        if (map.getLayer('planned-route-line')) {
          map.setLayoutProperty('planned-route-line', 'visibility', vis);
        }
        if (map.getLayer('planned-route-fallback-line')) {
          map.setLayoutProperty('planned-route-fallback-line', 'visibility', vis);
        }
      }
      if (typeof map.moveLayer === 'function' && map.getLayer('czekpoint-fog-layer')) {
        if (map.getLayer('planned-route-casing')) map.moveLayer('planned-route-casing');
        if (map.getLayer('planned-route-line')) map.moveLayer('planned-route-line');
        if (map.getLayer('planned-route-fallback-line')) map.moveLayer('planned-route-fallback-line');
      }
    } catch {}
  }

  /**
   * Vykreslí společnou naplánovanou pěší trasu na mapě MapLibre GL JS jako GeoJSON vrstvu
   * a předá ji simulátoru i výpočtu zbývající vzdálenosti.
   */
  async function renderPlannedRouteOnMap(force = false, opts = {}) {
    if (!map) return;
    ensureCustomMapSourcesAndLayers();

    const plannedPlaces = getPlannedPlaces();
    // KRITICKÁ OPRAVA VÝKONU: Během chůze se startovní bod trasy (currentOrigin) pro výpočet OSRM geometrie
    // nesmí měnit s každým metrem chůze (lastFix), jinak se při každém kroku zneplatní geomKey a spustí
    // síťová bouře OSRM + Open-Meteo + přestavba GeoJSON vrstev!
    const stableStartOrigin = lockedExpeditionOrigin
      ? normalizePointLatLng(lockedExpeditionOrigin)
      : (plannedRoute.origin ? normalizePointLatLng(plannedRoute.origin) : getRouteOriginPoint());
    const currentOrigin = (opts?.offRoute && lastFix && Number.isFinite(lastFix.lat))
      ? normalizePointLatLng(lastFix)
      : (stableStartOrigin || ((lastFix && Number.isFinite(lastFix.lat) && !userExplicitlyPickedOrigin) ? normalizePointLatLng(lastFix) : getRouteOriginPoint()));
    const unvisitedPlaces = plannedPlaces.filter(p => !isStopVisited(p));
    const isLoop = plannedRoute.routeType === 'loop' && plannedPlaces.length >= 2;
    const loopReturnOrigin = lockedExpeditionOrigin
      ? normalizePointLatLng(lockedExpeditionOrigin)
      : getRouteOriginPoint();

    const activeStopsForRoute = unvisitedPlaces.length > 0 ? unvisitedPlaces : plannedPlaces;
    const allWaypoints = isLoop
      ? [currentOrigin, ...activeStopsForRoute, loopReturnOrigin]
      : [currentOrigin, ...activeStopsForRoute];

    const geomKey = getRouteGeometryKey(allWaypoints);
    const renderKey = `${geomKey}|r${plannedRoute.radiusKm || 10}|l${isLoop ? 1 : 0}|gm${appSettings.gameMode || 'gamified'}`;
    if (!force && renderKey === plannedRouteRenderKey) return;
    plannedRouteRenderKey = renderKey;
    const token = ++plannedRouteRenderToken;

    let coords = null;
    let isFallbackGeom = true;
    if (plannedPlaces.length > 0) {
      let geomResult = null;
      const calcTaskId = beginMapTask('⏳ Počítám trasu…');
      try {
        geomResult = await getCachedWalkingGeometry(allWaypoints, geomKey);
        if (token !== plannedRouteRenderToken || disposed) return;
        if (!geomResult || !geomResult.coordinates || geomResult.coordinates.length < 2) {
          geomResult = buildLocalRoutedGeometry(allWaypoints, { isFallback: true });
        }
      } finally {
        endMapTask(calcTaskId);
      }
      if (token !== plannedRouteRenderToken || disposed) return;
      lastRoutedGeometry = geomResult;
      fakeGpsSim?.setSharedWalkingRoute(lastRoutedGeometry);
      coords = geomResult?.coordinates;
      isFallbackGeom = Boolean(!geomResult || geomResult.isFallback || geomResult.routeStatus === 'fallback_direct');
      if (!coords || coords.length < 2) {
        coords = allWaypoints
          .map(normalizePointLatLng)
          .filter(Boolean)
          .map(p => [p.lat, p.lng]);
      }

      const myEleToken = ++elevationProfileToken;
      fetchRouteElevationProfile(coords, { signal: aborter.signal })
        .then(eleProfile => {
          if (disposed || myEleToken !== elevationProfileToken) return;
          currentElevationProfile = eleProfile;
          renderPlannerBasketAndXray();
        })
        .catch(() => {});

      renderPlannerBasketAndXray();
      renderQuestHud(currentOrigin);
    } else {
      lastRoutedGeometry = null;
      currentElevationProfile = null;
      fakeGpsSim?.setSharedWalkingRoute(null);
      renderPlannerBasketAndXray();
      renderTouristStatsHud(currentOrigin);
      renderPhase1AndPhase4Ui(currentOrigin);
    }

    clearRouteOverlayMarkers();
    plannedRouteCoords = coords;

    // 1. Kružnice okruhu hledání jako GeoJSON polygon v MapLibre
    const radiusM = (plannedRoute.radiusKm || 10) * 1000;
    radiusCircle = { center: currentOrigin, radiusM };
    try {
      const radSrc = typeof map.getSource === 'function' ? map.getSource('radius-circle-source') : null;
      if (radSrc && typeof radSrc.setData === 'function') {
        radSrc.setData(createGeoJsonCirclePolygon(currentOrigin, radiusM));
      }
    } catch {}

    // 2. Plánovaná trasa výpravy jako GeoJSON v MapLibre (vždy nad mlhou)
    applyPlannedRouteGeoJsonToMap(coords, isFallbackGeom);

    updatePlayerLead(lastFix || currentOrigin);
    if (!coords || !maplibregl) return;

    if (appSettings.gameMode !== 'explorer') {
      // 3. Zvýraznění detekovaných rohů ulic a odboček podél trasy (anchor: 'center', omezeno max na 6 bodů pro výkon na telefonech)
      if (!is3dMode && !is3DMode && lastRoutedGeometry && Array.isArray(lastRoutedGeometry.steps)) {
        const turnSteps = lastRoutedGeometry.steps.filter(s => s && s.maneuverType === 'turn' && normalizePointLatLng(s));
        const turnStride = Math.max(1, Math.ceil(turnSteps.length / 6));
        for (let ti = 0; ti < turnSteps.length && routeOverlayMarkers.length < 6; ti += turnStride) {
          const step = turnSteps[ti];
          const normStep = normalizePointLatLng(step);
          if (normStep) {
            const dotEl = document.createElement('div');
            dotEl.className = 'route-corner-dot-marker';
            dotEl.style.width = '8px';
            dotEl.style.height = '8px';
            dotEl.style.pointerEvents = 'none';
            dotEl.innerHTML = `<span class="route-corner-dot" title="${e(step.actionLabel || 'Roh')}"></span>`;
            const m = new maplibregl.Marker({ element: dotEl, anchor: 'center' })
              .setLngLat([normStep.lng, normStep.lat])
              .addTo(map);
            routeOverlayMarkers.push(m);
          }
        }
      }

      // 4. Směrové šipky podél plánované trasy (anchor: 'center', max 5 šipek kvůli přehlednosti a výkonu na telefonech)
      const arrowStride = Math.max(1, Math.ceil((coords.length - 1) / 5));
      for (let i = 0; i < coords.length - 1; i += arrowStride) {
        const p1 = normalizePointLatLng(coords[i]);
        const p2 = normalizePointLatLng(coords[i + 1]);
        if (!p1 || !p2) continue;
        const angle = (Math.atan2(p2.lng - p1.lng, p2.lat - p1.lat) * 180 / Math.PI + 360) % 360;
        const midLat = (p1.lat + p2.lat) / 2;
        const midLng = (p1.lng + p2.lng) / 2;
        const arrEl = document.createElement('div');
        arrEl.className = 'route-dir-marker';
        arrEl.style.width = '16px';
        arrEl.style.height = '16px';
        arrEl.style.pointerEvents = 'none';
        arrEl.innerHTML = `<span class="route-dir-arrow" style="transform:rotate(${angle}deg)">➤</span>`;
        const m = new maplibregl.Marker({ element: arrEl, anchor: 'center' })
          .setLngLat([midLng, midLat])
          .addTo(map);
        routeOverlayMarkers.push(m);
      }
    }
  }

  function ensureStopSavedInEmbeddedStops(placeObj) {
    if (!placeObj || !placeObj.id) return null;
    const norm = normalizePointLatLng(placeObj);
    if (!norm) return null;
    const normalizedStop = {
      id: placeObj.id,
      title: placeObj.title || placeObj.label || placeObj.id,
      lat: norm.lat,
      lng: norm.lng,
      kind: placeObj.kind || 'nature',
      category: placeObj.category || 'nature',
    };
    if (!Array.isArray(plannedRoute.embeddedStops)) {
      plannedRoute.embeddedStops = [];
    }
    const existingIdx = plannedRoute.embeddedStops.findIndex(item => item && item.id === normalizedStop.id);
    if (existingIdx >= 0) {
      plannedRoute.embeddedStops[existingIdx] = normalizedStop;
    } else {
      plannedRoute.embeddedStops.push(normalizedStop);
    }
    return normalizedStop;
  }

  /**
   * Přepočítá zbývající trasu po úpravě zastávek (odebrání, nahrazení, posun pořadí)
   * bez smazání ušlé vzdálenosti a získaných návštěv (Bod 19 & 27).
   */
  async function recalculateRemainingRoute(reasonMsg = '') {
    plannedRouteRenderKey = null;
    saveAppState();
    renderPlannerBasketAndXray();
    renderPlaces();
    renderQuestHud(getRouteOriginPoint());
    renderPhase1AndPhase4Ui(getRouteOriginPoint());
    if (reasonMsg) status(reasonMsg);
    await renderPlannedRouteOnMap(true);
  }

  async function addStopToRoute(placeOrId, opts = {}) {
    const placeObj = typeof placeOrId === 'object' && placeOrId !== null
      ? placeOrId
      : getAllAvailablePlaces().find(item => item.id === placeOrId);
    if (!placeObj || !placeObj.id) return false;
    const normStop = ensureStopSavedInEmbeddedStops(placeObj);
    if (!normStop) return false;

    const currentPlaces = getPlannedPlaces();
    if (opts.setAsEnd) {
      plannedRoute.routeType = 'oneway';
      phase1EndMode = 'custom';
      const others = currentPlaces.filter(item => item.id !== normStop.id);
      const orderedOthers = others.length >= 2
        ? optimizeRouteOrder(getRouteOriginPoint(), others, {
            returnToOrigin: false,
            visitedStopIds: confirmedStopIds,
            currentPosition: getRouteOriginPoint(),
          })
        : others;
      plannedRoute.selectedPlaceIds = [...orderedOthers.map(item => item.id), normStop.id];
    } else if (opts.append) {
      const ids = (plannedRoute.selectedPlaceIds || []).filter(id => id !== normStop.id);
      if (ids.length >= 10) {
        status('Plán výpravy může obsahovat nejvýše 10 zastávek.');
        return false;
      }
      plannedRoute.selectedPlaceIds = [...ids, normStop.id];
    } else {
      const isLoop = plannedRoute.routeType === 'loop';
      const inserted = insertStopAtBestPosition(getRouteOriginPoint(), currentPlaces, normStop, {
        returnToOrigin: isLoop,
        visitedStopIds: confirmedStopIds,
        currentPosition: getRouteOriginPoint(),
      });
      plannedRoute.selectedPlaceIds = inserted.map(item => item.id);
    }

    lastRoutedGeometry = null;
    plannedRouteRenderKey = null;
    await recalculateRemainingRoute(
      opts.reasonMsg || (opts.setAsEnd ? `🏁 Nový konec trasy nastaven na: ${normStop.title}.` : `➕ Zastávka „${normStop.title}“ přidána do trasy.`)
    );
    return true;
  }

  async function togglePlaceInRoute(placeOrId) {
    const placeId = typeof placeOrId === 'object' && placeOrId !== null ? placeOrId.id : placeOrId;
    if (!placeId) return false;
    const ids = plannedRoute.selectedPlaceIds || [];
    if (ids.includes(placeId)) {
      plannedRoute.selectedPlaceIds = ids.filter(id => id !== placeId);
      lastRoutedGeometry = null;
      plannedRouteRenderKey = null;
      await recalculateRemainingRoute('Zastávka odebrána z plánu. Zbývající trasa přepočítána.');
      return false;
    }
    return addStopToRoute(placeOrId, {
      reasonMsg: 'Zastávka přidána do plánu. Zbývající trasa přepočítána.',
    });
  }

  function renderReplaceStopPicker() {
    const pickerEl = $('stop-replace-picker');
    if (!pickerEl) return;
    if (replacingStopIndex == null || replacingStopIndex < 0 || replacingStopIndex >= (plannedRoute.selectedPlaceIds || []).length) {
      pickerEl.hidden = true;
      pickerEl.innerHTML = '';
      return;
    }

    const currentId = plannedRoute.selectedPlaceIds[replacingStopIndex];
    const currentPlace = getAllAvailablePlaces().find(p => p.id === currentId);
    const candidates = getAllAvailablePlaces()
      .filter(p => p.id !== currentId && !(plannedRoute.selectedPlaceIds || []).includes(p.id))
      .slice(0, 12);

    pickerEl.hidden = false;
    pickerEl.innerHTML = `
      <div class="replace-picker-head">
        <strong>⇄ Nahradit zastávku #${replacingStopIndex + 1} (${e(currentPlace?.title || currentId)}) za:</strong>
        <button type="button" class="button small ghost" id="btn-cancel-replace-stop">Zrušit</button>
      </div>
      <div class="replace-picker-grid">
        ${candidates.map(c => `
          <button type="button" class="replace-candidate-btn" data-replace-with-id="${e(c.id)}">
            <span>${e(c.title)}</span>
            <small>Vybrat ⇄</small>
          </button>
        `).join('')}
      </div>
    `;
  }

  let lastBasketRenderSig = '';

  function renderPlannerBasketAndXray() {
    const plannedPlaces = getPlannedPlaces();
    lastBasketRenderSig = `${confirmedStopIds.size}|${(plannedRoute.selectedPlaceIds || []).join(',')}|${currentElevationProfile ? currentElevationProfile.gainM : 'none'}`;
    if ($('basket-count')) $('basket-count').textContent = String(plannedPlaces.length);
    if ($('drawer-tab-route-count')) {
      $('drawer-tab-route-count').textContent = String(plannedPlaces.length + (Array.isArray(personalMemories) ? personalMemories.length : 0));
    }

    const nextUnvisited = plannedPlaces.find(p => !isStopVisited(p));
    const currentPos = lastFix || telemetry.lastKnownPosition || plannedRoute.origin || { lat: 49.6014, lng: 13.8644 };

    const basketListEl = $('planner-basket-list');
    if (basketListEl) {
      if (plannedPlaces.length === 0) {
        basketListEl.innerHTML = `
          <div class="empty-stops-hint">
            <p class="small-note" style="margin:0">Zatím nemáš vybrané žádné zastávky.</p>
          </div>
        `;
      } else {
        basketListEl.innerHTML = plannedPlaces.map((p, idx) => {
          const visitedToday = isStopVisitedInSession(p);
          const nearbyToday = !visitedToday && nearbyRecordedIds.has(p.id);
          const hasEarlierStamp = !visitedToday && hasLifetimeStamp(p);
          const isNext = nextUnvisited && nextUnvisited.id === p.id;
          const distM = haversineMeters(currentPos, p);
          const distLabel = formatDistanceLabel(distM);
          // DÁVKA 2 (Bod 2.1): Pravdivá terminologie záznamu podle GPS
          const stateBadge = visitedToday
            ? `<span class="stop-state-badge confirmed" title="${e(VISIT_RECORD_TYPES.gps_stop.explanation)}">📍 Potvrzeno podle GPS (≤ ${STOP_CONFIRM_RADIUS_M} m)</span>`
            : nearbyToday
            ? `<span class="stop-state-badge confirmed" title="${e(VISIT_RECORD_TYPES.gps_nearby.explanation)}">📍 Zaznamenáno poblíž (dle GPS)</span>`
            : isNext
            ? `<span class="stop-state-badge next-target">🎯 Další cíl (${distLabel})${hasEarlierStamp ? ' · 📍 Potvrzeno podle GPS dříve' : ''}</span>`
            : `<span class="stop-state-badge pending">Čeká (${distLabel})${hasEarlierStamp ? ' · 📍 Potvrzeno podle GPS dříve' : ''}</span>`;

          return `
            <div class="basket-item ${visitedToday ? 'is-visited' : ''} ${isNext ? 'is-next-target' : ''}" data-stop-index="${idx}" data-stop-id="${e(p.id)}">
              <div class="basket-item-main" data-focus-stop-id="${e(p.id)}" style="cursor:pointer" title="Zobrazit detail v mapě">
                <span class="basket-index">${idx + 1}.</span>
                <div class="basket-title-wrap">
                  <strong class="basket-title">${e(p.title)}</strong>
                  ${stateBadge}
                </div>
              </div>
              <div class="basket-item-controls" role="group" aria-label="Úprava zastávky ${e(p.title)}">
                <button type="button" class="button small ghost stop-ctrl-btn" data-stop-action="up" data-stop-index="${idx}" ${idx === 0 ? 'disabled' : ''} title="Posunout zastávku nahoru">↑ Nahoru</button>
                <button type="button" class="button small ghost stop-ctrl-btn" data-stop-action="down" data-stop-index="${idx}" ${idx === plannedPlaces.length - 1 ? 'disabled' : ''} title="Posunout zastávku dolů">↓ Dolů</button>
                <button type="button" class="button small ghost stop-ctrl-btn" data-stop-action="replace" data-stop-index="${idx}" title="Nahradit tuto zastávku jiným místem">⇄ Nahradit</button>
                <button type="button" class="button small ghost danger stop-ctrl-btn" data-stop-action="remove" data-stop-index="${idx}" title="Odebrat zastávku z trasy">✕ Odebrat</button>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    renderReplaceStopPicker();
    renderPersonalMemoriesUi();
    renderMindfulnessPromptUi();

    if ($('btn-optimize-route')) {
      $('btn-optimize-route').disabled = plannedPlaces.length < 2;
    }

    const xrayCardEl = $('route-xray-card');
    if (!xrayCardEl) return;

    const gainedM = currentExpedition ? Math.max(0, progress.meters - currentExpedition.startMeters) : progress.meters;

    if (plannedPlaces.length === 0) {
      xrayCardEl.innerHTML = `
        <div class="xray-header">
          <strong>🧭 Přehled trasy (volná chůze bez pevných zastávek)</strong>
        </div>
        <div class="xray-stats-grid">
          <div class="xray-stat">
            <strong id="xray-walked-dist">${formatMetersCz(gainedM)}</strong>
            <span>Ušlá vzdálenost</span>
          </div>
        </div>
      `;
      return;
    }

    const isLoop = plannedRoute.routeType === 'loop' && plannedPlaces.length >= 2;
    const isFallbackRoute = Boolean(!lastRoutedGeometry || lastRoutedGeometry.isFallback || lastRoutedGeometry.routeStatus === 'fallback_direct');
    const routedM = !isFallbackRoute && lastRoutedGeometry ? lastRoutedGeometry.distanceM : null;
    const unvisitedPlaces = plannedPlaces.filter(p => !isStopVisited(p));
    const totalAnalysis = analyzePlannedRoute(getRouteOriginPoint(), plannedPlaces, 'solo', {
      returnToOrigin: isLoop,
      routedDistanceM: routedM,
      isFallback: isFallbackRoute,
      hasRoadClassData: Boolean(lastRoutedGeometry?.hasRoadClassData),
      roadTypeSummary: lastRoutedGeometry?.roadTypeSummary || 'Údaje o typu cesty nejsou k dispozici',
    });
    const remShared = computeRemainingFromSharedRoute({
      sharedRoute: lastRoutedGeometry,
      currentPos,
      plannedPlaces,
      confirmedStopIds,
      companionMode: 'solo',
      returnToOrigin: isLoop,
      origin: getRouteOriginPoint(),
    });

    const remDistM = remShared.isRouteValid && remShared.remainingDistanceM != null
      ? remShared.remainingDistanceM
      : totalAnalysis.estimatedWalkDistanceM;
    const remMin = remShared.isRouteValid && remShared.remainingMinutes != null
      ? remShared.remainingMinutes
      : totalAnalysis.estimatedMinutes;

    const totalDistM = Math.max(1, totalAnalysis.estimatedWalkDistanceM || remDistM || 1000);
    const playerProgressRatio = (active || demo)
      ? Math.max(0, Math.min(1, 1 - (remDistM / totalDistM)))
      : 0;
    const elevationHtml = currentElevationProfile
      ? renderElevationProfileCardHtml(currentElevationProfile, plannedPlaces, playerProgressRatio)
      : '';

    const routeStatusLabel = lastRoutedGeometry?.routeStatusLabel || totalAnalysis.routeStatusLabel;
    const roadTypeSummary = lastRoutedGeometry?.roadTypeSummary || totalAnalysis.roadTypeSummary || 'Údaje o typu cesty nejsou k dispozici';

    xrayCardEl.innerHTML = `
      <div class="xray-header">
        <strong>🧭 Přehled trasy (${unvisitedPlaces.length} zbývajících z ${plannedPlaces.length} zastávek${isLoop ? ' · okruh' : ''})</strong>
      </div>
      <div class="xray-route-status-banner ${isFallbackRoute ? 'is-fallback' : 'is-routed'}" id="xray-route-status-banner">
        <strong>${e(routeStatusLabel)}</strong>
        <small style="display:block;margin-top:2px">${e(roadTypeSummary)} · GPS měří přiblížení v terénu (≤ ${STOP_CONFIRM_RADIUS_M} m, opakované vzorky).</small>
      </div>
      <div class="xray-stats-grid">
        <div class="xray-stat">
          <strong id="xray-remaining-dist">${formatDistanceLabel(remDistM)}</strong>
          <span>Zbývá ujít (~${remMin} min)</span>
        </div>
        <div class="xray-stat">
          <strong id="xray-walked-dist">${formatMetersCz(gainedM)}</strong>
          <span>Již ušlá vzdálenost (zachována)</span>
        </div>
      </div>
      ${elevationHtml}
    `;
  }

  /**
   * Vykreslí místa v okolí a mapové značky (Bod 1, 7, 18, 23 & 26).
   */
  function renderPlaces(options = {}) {
    const skipListRebuild = Boolean(options?.skipListRebuild);
    if ($('nearby-origin')) {
      $('nearby-origin').textContent = demo
        ? 'Vzdálenosti od simulovaného bodu.'
        : lastFix && follow
        ? 'Vzdálenosti od tvé aktuální polohy.'
        : map && !follow
        ? 'Zobrazená část mapy ČR (posunem načteš další místa).'
        : lastFix
        ? 'Vzdálenosti od poslední přijaté polohy.'
        : map
        ? 'Vzdálenosti od středu mapy.'
        : 'Poloha není určena.';
    }
    const all = getAllAvailablePlaces();
    const origin = lastFix || telemetry.lastKnownPosition || map?.getCenter();
    const normalized = origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)
      ? { lat: origin.lat, lng: origin.lng }
      : null;
    renderCompass(normalized);

    const mapCenter = map ? map.getCenter() : null;
    const viewCenter = (!follow && mapCenter)
      ? mapCenter
      : (normalized || plannedRoute.origin || { lat: 49.6014, lng: 13.8644 });

    const plannedPlaces = getPlannedPlaces();
    const plannedPlaceIds = new Set(plannedRoute.selectedPlaceIds || []);

    // 1. Mapové značky:
    //    Zobrazíme všechny body, které leží ve viditelném výřezu mapy, jsou v naplánované trase,
    //    nebo jsou do 9 km od uživatele (pokud je poloha známá).
    const activeVisualCat = plannedRoute.visualCategoryFilter || 'all';
    const mapPlaces = all.filter(p => {
      // Skryjeme body typu 'route-start' ("Start trasy: ..."), aby na mapě nepřekrývaly 2.5D ikony míst
      if (p.pointKind === 'route-start') return false;
      if (plannedPlaceIds.has(p.id)) return true;
      if (
        plannedRoute.categories.length > 0 &&
        p.category &&
        !plannedRoute.categories.includes(p.category)
      ) {
        return false;
      }
      if (activeVisualCat !== 'all') {
        const vCat = resolvePlaceVisualCategory(p);
        if (vCat.key !== activeVisualCat) return false;
      }
      if (map && isPointInExpandedMapBounds(p.lat, p.lng, 0.42)) return true;
      if (normalized && (haversineMeters(normalized, p) ?? Infinity) < 9500) return true;
      return false;
    });

    // 2. Seznam míst pod mapou (#walk-places):
    //    Striktně seřazený vzestupně podle vzdálenosti (distanceM od nejbližšího po nejvzdálenější)
    const refOrigin = normalized || plannedRoute.origin || viewCenter;
    const allWithDistance = all
      .map(p => {
        const distM = haversineMeters(refOrigin, p) ?? Infinity;
        const visualCat = resolvePlaceVisualCategory(p);
        return {
          ...p,
          visualCat,
          distanceM: distM,
          distanceFromUser: distM,
          distanceFromView: haversineMeters(viewCenter, p) ?? Infinity,
        };
      })
      .filter(p => {
        if (plannedPlaceIds.has(p.id)) return true;
        if (
          plannedRoute.categories.length > 0 &&
          p.category &&
          !plannedRoute.categories.includes(p.category)
        ) {
          return false;
        }
        if (map && isPointInExpandedMapBounds(p.lat, p.lng, 0.42)) return true;
        if (p.distanceM <= 30000) return true;
        return false;
      })
      .sort((a, b) => a.distanceM - b.distanceM);

    const sidebarList = activeVisualCat === 'all'
      ? allWithDistance
      : allWithDistance.filter(p => plannedPlaceIds.has(p.id) || p.visualCat?.key === activeVisualCat);

    const formatBigDist = (m) => {
      if (!Number.isFinite(m)) return '—';
      if (m < 1000) return `${Math.round(m)} m`;
      return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
    };

    if (!skipListRebuild && $('poi-category-legend')) {
      const catCounts = { all: allWithDistance.length, castles: 0, sacral: 0, views: 0, water: 0, nature: 0 };
      for (const item of allWithDistance) {
        const k = item.visualCat?.key || 'nature';
        if (catCounts[k] !== undefined) catCounts[k] += 1;
      }
      const legendKey = `${activeVisualCat}|${catCounts.all}|${catCounts.castles}|${catCounts.sacral}|${catCounts.views}|${catCounts.water}|${catCounts.nature}`;
      if (lastRenderedLegendKey !== legendKey) {
        lastRenderedLegendKey = legendKey;
        const legendOrder = ['castles', 'sacral', 'views', 'water', 'nature'];
        const allActive = activeVisualCat === 'all';
        const chipsHtml = [
          `<button type="button" class="poi-legend-chip ${allActive ? 'active' : ''}" data-visual-cat-filter="all" aria-pressed="${allActive ? 'true' : 'false'}">
            <span class="poi-legend-all-dot">✦</span>
            <span class="poi-legend-label">Všechny kategorie</span>
            <span class="poi-legend-count">${catCounts.all}</span>
          </button>`,
          ...legendOrder.map(key => {
            const catDef = POI_VISUAL_CATEGORIES[key];
            const isAct = activeVisualCat === key;
            const glyphSvg = renderCategoryMarkerGlyph(key === 'sacral' ? 'sacral' : catDef.kind, 'default');
            return `<button type="button" class="poi-legend-chip cat-${e(key)} ${isAct ? 'active' : ''}" data-visual-cat-filter="${e(key)}" aria-pressed="${isAct ? 'true' : 'false'}" title="${e(`${catDef.label} (tvar: ${catDef.shapeLabel})`)}">
              <span class="czekpoint-marker-badge legend-mini-badge cat-${e(key)} shape-${e(catDef.shape)}" data-kind="${e(catDef.kind)}" data-visual-cat="${e(key)}" data-shape="${e(catDef.shape)}">
                <span class="czekpoint-marker-glyph kind-${e(catDef.kind)}">${glyphSvg}</span>
              </span>
              <span class="poi-legend-label">${e(catDef.shortLabel)}</span>
              <span class="poi-legend-count">${catCounts[key] || 0}</span>
            </button>`;
          }),
        ].join('');
        $('poi-category-legend').innerHTML = chipsHtml;
      }
    }

    if ($('nearby-places-count-badge')) {
      $('nearby-places-count-badge').textContent = `${sidebarList.length} míst v okolí`;
    }
    if ($('drawer-tab-places-count')) {
      $('drawer-tab-places-count').textContent = String(sidebarList.length);
    }

    if (!skipListRebuild && $('walk-places')) {
      const placesSignature = `${activeVisualCat}|${plannedRoute.selectedPlaceIds?.join(',')}|${confirmedStopIds.size}|${sidebarList.slice(0, 40).map(p => `${p.id}:${plannedPlaceIds.has(p.id) ? 1 : 0}:${isStopVisitedInSession(p) ? 1 : 0}:${Math.round(p.distanceM || 0)}`).join(';')}`;
      if (lastRenderedPlacesKey !== placesSignature) {
        lastRenderedPlacesKey = placesSignature;
        const extPhotosOn = appSettings.showExternalPhotos !== false;
        $('walk-places').innerHTML = sidebarList.slice(0, 40).map(p => {
        const visitedToday = isStopVisitedInSession(p);
        const nearbyToday = !visitedToday && nearbyRecordedIds.has(p.id);
        const earlierStamp = !visitedToday && hasLifetimeStamp(p);
        const isRouteStart = p.pointKind === 'route-start';
        const isPlanned = plannedPlaceIds.has(p.id);
        const bigDistStr = formatBigDist(p.distanceM);
        const visualCat = p.visualCat || resolvePlaceVisualCategory(p);
        const glyphKey = visualCat.key === 'sacral' ? 'sacral' : visualCat.kind;
        const miniGlyph = renderCategoryMarkerGlyph(glyphKey, 'default');
        const photoInfo = getPlacePhotoSync(p, { showExternalPhotos: extPhotosOn });
        const photoSourceNote = photoInfo.isRealPhoto
          ? `📸 ${formatPhotoSourceLabel(photoInfo)}`
          : '🎨 Vektorová ilustrace kategorie';
        const statusText = visitedToday
          ? '📍 Potvrzeno podle GPS (opakované vzorky v dosahu)'
          : nearbyToday
          ? '📍 Zaznamenáno poblíž (dle GPS)'
          : earlierStamp
          ? '📍 Potvrzeno podle GPS (z dřívější výpravy)'
          : isRouteStart
          ? '🥾 Začátek trasy'
          : `📍 ${visualCat.label}`;

        return `<div class="nearby-place cat-card-${e(visualCat.key)}" data-distance-m="${Math.round(p.distanceM || 0)}" data-visual-cat="${e(visualCat.key)}" data-shape="${e(visualCat.shape)}" style="display:flex;gap:12px;align-items:center">
          <img
            class="place-card-thumb"
            data-place-img-id="${e(p.id)}"
            src="${e(photoInfo.photoUrl)}"
            alt="${e(p.title)}"
            width="88"
            height="72"
            loading="lazy"
          />
          <div style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
              <strong style="font-size:1.02rem">${e(p.title)}</strong>
              <span class="place-distance-big">${e(bigDistStr)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:4px 0 2px">
              <span class="place-cat-pill cat-${e(visualCat.key)}" data-shape="${e(visualCat.shape)}">
                <span class="czekpoint-marker-badge legend-mini-badge cat-${e(visualCat.key)} shape-${e(visualCat.shape)}" data-kind="${e(visualCat.kind)}" data-visual-cat="${e(visualCat.key)}" data-shape="${e(visualCat.shape)}">
                  <span class="czekpoint-marker-glyph kind-${e(visualCat.kind)}">${miniGlyph}</span>
                </span>
                <span>${e(visualCat.shortLabel)} · ${e(visualCat.shapeLabel)}</span>
              </span>
              <span style="font-size:0.82rem;color:#355245">${e(statusText)}</span>
            </div>
            <small class="small-note" data-place-photo-note-id="${e(p.id)}" style="display:block;font-size:0.74rem">${e(photoSourceNote)}</small>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">
              <button type="button" class="button small ${isPlanned ? 'ghost' : 'lime'} toggle-plan-place-btn" data-place-id="${e(p.id)}">
                ${isPlanned ? '✓ V trase (odebrat)' : '+ Přidat do trasy'}
              </button>
              <button type="button" class="button ghost small open-map-detail-btn" data-place-id="${e(p.id)}">
                🔍 Ukázat v mapě
              </button>
            </div>
          </div>
        </div>`;
      }).join('') || '<p class="small-note">V této části mapy zatím nejsou žádná místa pro zvolený filtr. Zkus přepnout kategorii na „Všechny kategorie“ nebo posuň mapu.</p>';
      }
    }

    if (!map || !maplibregl) return;

    const nextUnvisitedStop = plannedPlaces.find(p => !isStopVisited(p));

    // Přidáme také vlastní soukromé vzpomínky uživatele jako odlišené značky v mapě
    const memoryMapItems = personalMemories
      .filter(m => m && Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng)))
      .map(m => ({
        id: m.id,
        title: `${m.symbolTitle}${m.note ? ` — ${m.note}` : ''}`,
        lat: Number(m.lat),
        lng: Number(m.lng),
        kind: 'memory',
        category: 'memory',
        isUserMemory: true,
        memoryObj: m,
      }));

    // Při nižším přiblížení mapy, na mobilním displeji nebo ve 3D režimu zobrazíme optimální a prostorově
    // odstupňovanou sadu bodů (decluttering), aby se ikony na malém displeji nepřekrývaly v jeden shluk
    // a na slabých telefonech neběžely desítky zbytečných DOM projekcí.
    const curZoom = (map && typeof map.getZoom === 'function') ? map.getZoom() : 15;
    $('walk-map-wrap')?.classList.toggle('zoom-compact-labels', curZoom < 14.8);
    let displayMapPlaces = mapPlaces;
    {
      const maxNormalPlaces = 45;
      const minSepMeters = 5;

      const mustHave = [];
      const others = [];
      for (const p of mapPlaces) {
        if (
          plannedPlaceIds.has(p.id) ||
          (selectedDetailPlace && selectedDetailPlace.id === p.id)
        ) {
          mustHave.push(p);
        } else {
          others.push(p);
        }
      }
      others.sort((a, b) => (a.distanceM || 9999) - (b.distanceM || 9999));

      const accepted = [...mustHave];
      const maxOthers = Math.max(0, maxNormalPlaces - mustHave.length);
      for (const cand of others) {
        if (accepted.length - mustHave.length >= maxOthers) break;
        if (minSepMeters > 0) {
          let tooClose = false;
          for (const ex of accepted) {
            const dM = haversineMeters(cand, ex);
            if (dM !== null && dM < minSepMeters) {
              tooClose = true;
              break;
            }
          }
          if (tooClose) continue;
        }
        accepted.push(cand);
      }
      displayMapPlaces = accepted;
    }

    const activeMapPlaceIds = new Set();
    for (const p of displayMapPlaces) {
      activeMapPlaceIds.add(p.id);
    }
    for (const m of memoryMapItems) {
      activeMapPlaceIds.add(m.id);
    }
    // Aktivní zastávky v plannedRoute.selectedPlaceIds ponecháme vždy
    for (const id of plannedPlaceIds) {
      activeMapPlaceIds.add(id);
    }

    // DÁVKA 2 (P1 Bod 7.2): Odstraníme z placeMarkersById a z mapy všechny neaktivní značky,
    // které již nejsou v aktuálním displayMapPlaces (ponecháme aktivní zastávky v trase a vzpomínky)
    for (const [existingId, entry] of placeMarkersById.entries()) {
      if (!activeMapPlaceIds.has(existingId)) {
        try { entry.marker?.remove?.(); } catch {}
        placeMarkersById.delete(existingId);
      }
    }

    // Vykreslíme vlastní soukromé vzpomínky uživatele na mapě (anchor: 'center')
    for (const mItem of memoryMapItems) {
      const m = mItem.memoryObj;
      const symIcon = m.symbolIcon || '✨';
      const stateSig = `mem|${mItem.lat},${mItem.lng}|${symIcon}|${m.note || ''}`;
      const iconHtml = `
        <span class="czekpoint-marker-badge tier-user-memory" data-kind="user-memory" title="${e(`✨ Vlastnoruční vzpomínka uživatele: ${m.symbolTitle}`)}">
          <span class="czekpoint-marker-glyph kind-memory" style="font-size:18px;line-height:1">${e(symIcon)}</span>
        </span>
      `;
      const existing = placeMarkersById.get(mItem.id);
      if (existing) {
        existing.place = mItem;
        if (existing.lat !== mItem.lat || existing.lng !== mItem.lng) {
          existing.marker.setLngLat([mItem.lng, mItem.lat]);
          existing.lat = mItem.lat;
          existing.lng = mItem.lng;
        }
        if (existing.stateSig !== stateSig && existing.element) {
          existing.element.innerHTML = iconHtml;
          existing.stateSig = stateSig;
          existing.iconStateKey = stateSig;
        }
      } else {
        const el = document.createElement('div');
        el.className = 'czekpoint-marker-anchor user-memory-anchor';
        el.style.width = '64px';
        el.style.height = '64px';
        el.title = `✨ Vlastnoruční vzpomínka: ${m.symbolTitle}`;
        el.innerHTML = iconHtml;
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([mItem.lng, mItem.lat])
          .addTo(map);
        const entry = {
          marker,
          element: el,
          place: mItem,
          lat: mItem.lat,
          lng: mItem.lng,
          stateSig,
          iconStateKey: stateSig,
        };
        placeMarkersById.set(mItem.id, entry);
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          lastMarkerInteractedAt = Date.now();
          openPlaceDetail(entry.place || mItem);
        });
      }
    }

    // Vykreslíme velké přehledné špendlíky míst (anchor: 'bottom') s čitelným názvem a vzdáleností
    const playerRefPos = normalized || lastFix || telemetry.lastKnownPosition || getRouteOriginPoint();
    for (const p of displayMapPlaces) {
      const visited = isStopVisitedInSession(p);
      const isDiscovered = Boolean(visited || hasLifetimeStamp(p) || confirmedStopIds.has(p.id));
      const isRouteStart = p.pointKind === 'route-start';
      const isPlanned = plannedPlaceIds.has(p.id);
      const isNextTarget = nextUnvisitedStop && nextUnvisitedStop.id === p.id;
      const isJustConfirmed = justConfirmedStopId === p.id || justDiscoveredFlipIds.has(p.id);
      const isSelected = Boolean(selectedDetailPlace && selectedDetailPlace.id === p.id);
      const isFirstAppear = !appearedPlaceIds.has(p.id);
      if (isFirstAppear) appearedPlaceIds.add(p.id);

      const distFromPlayerM = playerRefPos ? (haversineMeters(playerRefPos, p) ?? Infinity) : Infinity;
      const isMysterySilhouette = Boolean(appSettings.gameMode === 'explorer' && !isDiscovered && !isPlanned && !isRouteStart && distFromPlayerM > 35);

      const visualCat = resolvePlaceVisualCategory(p);
      const categoryKey = isRouteStart ? 'route-start' : (p.kind || visualCat.kind || 'forest');
      const glyphKindKey = visualCat.key === 'sacral' ? 'sacral' : categoryKey;
      const tierClass = visited
        ? 'tier-visited'
        : isNextTarget
        ? 'tier-next-target'
        : isPlanned
        ? 'tier-planned'
        : 'tier-default';

      const animClass = [
        isJustConfirmed ? 'is-just-confirmed just-discovered-flip' : '',
        isNextTarget ? 'is-next-target' : '',
        isSelected ? 'is-selected' : '',
      ].filter(Boolean).join(' ');

      const stopOrderIdx = plannedPlaces.findIndex(item => item.id === p.id);
      const orderBadgeHtml = stopOrderIdx >= 0
        ? `<span class="czekpoint-marker-order">${stopOrderIdx + 1}</span>`
        : '';

      const glyphHtml = renderCategoryMarkerGlyph(glyphKindKey, visited ? 'visited' : 'default');
      const distShortLabel = formatBigDist(distFromPlayerM);
      const rawTitle = String(p.title || visualCat.shortLabel || visualCat.label || 'Místo');
      const shortTitle = rawTitle.length > 22 ? `${rawTitle.slice(0, 20)}…` : rawTitle;

      let iconHtml = '';
      if (isMysterySilhouette) {
        const mysteryPillLabel = Number.isFinite(distFromPlayerM)
          ? `❓ ${visualCat.shortLabel} · ${distShortLabel}`
          : `❓ ${visualCat.shortLabel}`;
        iconHtml = `
          <div class="place-marker-wrap is-mystery-silhouette ${tierClass} ${animClass}">
            <div class="place-marker-inner">
              <span class="czekpoint-marker-badge mystery-medallion cat-${e(visualCat.key)} ${tierClass} ${animClass}" data-kind="${e(categoryKey)}" data-visual-cat="${e(visualCat.key)}" title="${e(`❓ ${visualCat.label} · ${distShortLabel}`)}">
                <span class="czekpoint-marker-glyph kind-${e(categoryKey)} visual-cat-${e(visualCat.key)}">${glyphHtml}</span>
                <span class="mystery-corner-q" aria-hidden="true">?</span>
                ${orderBadgeHtml}
              </span>
              <span class="totem-title-pill is-mystery-pill">${e(mysteryPillLabel)}</span>
            </div>
          </div>
        `;
      } else {
        const pillLabel = Number.isFinite(distFromPlayerM)
          ? `${shortTitle} · ${distShortLabel}`
          : shortTitle;
        iconHtml = `
          <div class="place-marker-wrap is-revealed-totem ${tierClass} ${animClass}">
            <div class="place-marker-inner">
              <span class="czekpoint-marker-badge cat-${e(visualCat.key)} ${tierClass} ${animClass}" data-kind="${e(categoryKey)}" data-visual-cat="${e(visualCat.key)}" title="${e(`${rawTitle} — ${visualCat.label} (${distShortLabel})`)}">
                <span class="czekpoint-marker-glyph kind-${e(categoryKey)} visual-cat-${e(visualCat.key)}">${glyphHtml}</span>
                ${orderBadgeHtml}
              </span>
              <span class="totem-title-pill">${e(pillLabel)}</span>
            </div>
          </div>
        `;
      }

      const stateSig = `${p.lat},${p.lng}|${visualCat.key}|${tierClass}|${animClass}|${stopOrderIdx}|${isMysterySilhouette ? 'mys' : 'rev'}|${Math.round((distFromPlayerM || 0) / 10)}`;

      const existing = placeMarkersById.get(p.id);
      if (existing) {
        existing.place = p;
        if (existing.lat !== p.lat || existing.lng !== p.lng) {
          existing.marker.setLngLat([p.lng, p.lat]);
          existing.lat = p.lat;
          existing.lng = p.lng;
        }
        if (existing.stateSig !== stateSig && existing.element) {
          existing.element.classList.toggle('is-mystery-silhouette', isMysterySilhouette);
          existing.element.classList.toggle('just-discovered-flip', Boolean(isJustConfirmed));
          existing.element.title = isMysterySilhouette ? `❓ ${visualCat.label} · ${distShortLabel}` : `${rawTitle} · ${distShortLabel}`;
          existing.element.innerHTML = iconHtml;
          existing.stateSig = stateSig;
          existing.iconStateKey = stateSig;
        }
      } else {
        const el = document.createElement('div');
        el.className = `czekpoint-marker-anchor ${isMysterySilhouette ? 'is-mystery-silhouette' : ''} ${isJustConfirmed ? 'just-discovered-flip' : ''}`.trim();
        el.style.width = '60px';
        el.style.height = '60px';
        el.title = isMysterySilhouette ? `❓ ${visualCat.label} · ${distShortLabel}` : `${rawTitle} · ${distShortLabel}`;
        el.innerHTML = iconHtml;

        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([p.lng, p.lat])
          .addTo(map);

        const entry = {
          marker,
          element: el,
          place: p,
          lat: p.lat,
          lng: p.lng,
          stateSig,
          iconStateKey: stateSig,
        };
        placeMarkersById.set(p.id, entry);

        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          lastMarkerInteractedAt = Date.now();
          const currentPlace = entry.place || p;
          if (pickingCustomEndOnMap) {
            pickingCustomEndOnMap = false;
            phase1EndMode = 'custom';
            plannedRoute.routeType = 'oneway';
            const others = getPlannedPlaces().filter(item => item.id !== currentPlace.id);
            const orderedOthers = others.length >= 2
              ? optimizeRouteOrder(getRouteOriginPoint(), others, {
                  returnToOrigin: false,
                  visitedStopIds: confirmedStopIds,
                  currentPosition: (active || demo) && lastFix ? lastFix : null,
                })
              : others;
            plannedRoute.selectedPlaceIds = [...orderedOthers.map(item => item.id), currentPlace.id];
            recalculateRemainingRoute(`🏁 Nový konec trasy nastaven na: ${currentPlace.title}.`);
            playStampChord(stateObj.soundEnabled);
            return;
          }
          openPlaceDetail(currentPlace);
        });
      }
    }

    if (!options?.skipListRebuild || !plannedRouteRenderKey) {
      renderPlannedRouteOnMap();
    }

    // Asynchronně načteme fotky pouze pro karty pod mapou a detail místa (BEZ opakovaného volání renderPlaces!)
    if (appSettings.showExternalPhotos !== false) {
      const syncCardThumbForPlace = (placeItem) => {
        if (disposed || !placeItem || !placeItem.id || typeof document === 'undefined') return;
        const cached = getCachedPlacePhoto(placeItem);
        if (!cached || !cached.photoUrl) return;
        const container = $('walk-places');
        if (container) {
          const imgs = container.querySelectorAll('img.place-card-thumb[data-place-img-id]');
          for (const img of imgs) {
            if (img.getAttribute('data-place-img-id') === String(placeItem.id)) {
              if (img.getAttribute('src') !== cached.photoUrl) {
                img.setAttribute('src', cached.photoUrl);
              }
              break;
            }
          }
          const notes = container.querySelectorAll('small[data-place-photo-note-id]');
          for (const note of notes) {
            if (note.getAttribute('data-place-photo-note-id') === String(placeItem.id)) {
              note.textContent = `📸 ${formatPhotoSourceLabel(cached)}`;
              break;
            }
          }
        }
        if (selectedDetailPlace && selectedDetailPlace.id === placeItem.id && !$('place-detail-sheet')?.hidden) {
          const imgEl = $('pds-photo-img');
          const badgeEl = $('pds-photo-badge');
          if (imgEl && imgEl.getAttribute('src') !== cached.photoUrl) {
            imgEl.src = cached.photoUrl;
          }
          if (badgeEl) {
            badgeEl.textContent = `📸 Fotka · ${formatPhotoSourceLabel(cached)}`;
            badgeEl.className = 'pds-photo-source-badge is-verified';
          }
        }
      };

      const unprefetchedSidebar = [...plannedPlaces, ...sidebarList.slice(0, 10)].filter(p => p && p.id && !prefetchedPhotoPlaceIds.has(p.id));
      if (unprefetchedSidebar.length > 0) {
        for (const p of unprefetchedSidebar) prefetchedPhotoPlaceIds.add(p.id);
        prefetchPlacePhotos(unprefetchedSidebar, {
          signal: aborter.signal,
          maxCount: 10,
          showExternalPhotos: true,
          onUpdated: (updatedPlace) => {
            if (disposed) return;
            if (updatedPlace && updatedPlace.id) {
              syncCardThumbForPlace(updatedPlace);
            } else {
              for (const item of unprefetchedSidebar) syncCardThumbForPlace(item);
            }
          },
        });
      }

      const unprefetchedMap = [...plannedPlaces, ...sidebarList.slice(0, 10)].filter(p => p && p.id && !prefetchedVerifiedPlaceIds.has(p.id));
      if (unprefetchedMap.length > 0) {
        for (const p of unprefetchedMap) prefetchedVerifiedPlaceIds.add(p.id);
        prefetchVerifiedPhotosForPlaces(unprefetchedMap, {
          signal: aborter.signal,
          maxCount: 10,
          onBatchUpdated: () => {
            if (disposed) return;
            for (const item of unprefetchedMap) syncCardThumbForPlace(item);
            renderNextCheckpointHero(lastFix || telemetry.lastKnownPosition);
          },
        });
      }
    }
  }

  function closeCompetingMapOverlays(keepKey = '') {
    if (keepKey !== 'style') {
      const pop = $('map-style-popover');
      const btn = $('btn-top-pill-style');
      if (pop && !pop.hidden) pop.hidden = true;
      if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        btn.classList.remove('is-open');
      }
    }
    if (keepKey !== 'search') {
      const searchOverlay = $('map-search-overlay');
      if (searchOverlay && !searchOverlay.hidden) {
        searchOverlay.hidden = true;
      }
      if ($('map-lupa-search-results')) $('map-lupa-search-results').hidden = true;
      $('walk-search-toggle')?.classList.remove('active');
      $('walk-map-wrap')?.classList.remove('has-search-open');
    }
    if (keepKey !== 'route-detail') {
      const hudPanel = $('quest-hud-panel');
      if (hudPanel && !hudPanel.classList.contains('collapsed')) {
        hudPanel.classList.add('collapsed');
        $('quest-hud-toggle-btn')?.setAttribute('aria-expanded', 'false');
        if ($('qhud-toggle-icon')) $('qhud-toggle-icon').textContent = '▼ Detail';
      }
    }
    if (keepKey !== 'place-detail') {
      if ($('place-detail-sheet') && !$('place-detail-sheet').hidden) {
        selectedDetailPlace = null;
        $('place-detail-sheet').hidden = true;
      }
    }
    if (keepKey !== 'drawer') {
      const sheetEl = $('walk-bottom-sheet');
      if (sheetEl && !sheetEl.hidden) {
        sheetEl.hidden = true;
        sheetEl.classList.remove('is-drawer-open');
      }
    }
    if (keepKey !== 'sim' && (keepKey === 'place-detail' || keepKey === 'drawer' || keepKey === 'search')) {
      const zone = $('simulator-test-zone');
      if (zone && !zone.hidden) {
        zone.hidden = true;
        if (fakeGpsSim && fakeGpsSim.isOpen) {
          fakeGpsSim.isOpen = false;
        }
      }
    }
  }

  function openPlaceDetail(p) {
    if (!p) return;
    closeCompetingMapOverlays('place-detail');
    selectedDetailPlace = p;
    const sheet = $('place-detail-sheet');
    if (!sheet) return;

    // DÁVKA 2 (Bod 1.1 & 2.1): Pokud uživatel klikl na vlastní soukromou vzpomínku v mapě, jasně ji odlišíme od GPS památky
    if (p.isUserMemory && p.memoryObj) {
      const mem = p.memoryObj;
      sheet.hidden = false;
      sheet.innerHTML = `
        <div class="pds-card phase3-bubble-card">
          <div class="pds-header" style="display:flex;gap:12px;align-items:center">
            <div class="pds-memory-icon-box" style="width:56px;height:56px;border-radius:12px;background:#f4efe1;display:flex;align-items:center;justify-content:center;font-size:28px">
              ${e(mem.symbolIcon || '✨')}
            </div>
            <div class="pds-title-wrap" style="flex:1;min-width:0">
              <span class="pds-kind-badge">✨ Vlastnoruční vzpomínka uživatele</span>
              <h3 class="pds-title">${e(mem.symbolTitle || 'Vlastní vzpomínka')}</h3>
              <span class="pds-photo-source-badge is-bitmap">🔒 Soukromá poznámka v zařízení (nikoliv GPS ověřená památka)</span>
            </div>
            <button type="button" class="button small ghost pds-close-btn" id="btn-close-place-detail" aria-label="Zavřít bublinu">✕</button>
          </div>
          <p class="pds-memory-note" id="pds-memory-note-text" style="margin:8px 0 4px;font-size:0.95rem"></p>
        </div>
      `;
      const noteEl = $('pds-memory-note-text');
      if (noteEl) {
        noteEl.textContent = mem.note ? mem.note : 'Bez textové poznámky.';
      }
      $('btn-close-place-detail')?.addEventListener('click', closePlaceDetail);
      return;
    }

    const visited = isStopVisitedInSession(p);
    const nearbyVisited = !visited && nearbyRecordedIds.has(p.id);
    const earlierStamp = !visited && hasLifetimeStamp(p);
    const isDiscovered = Boolean(visited || (Array.isArray(stateObj.discoveries) && stateObj.discoveries.includes(p.id)) || confirmedStopIds.has(p.id));
    const isPlanned = (plannedRoute.selectedPlaceIds || []).includes(p.id);
    const curPos = lastFix || telemetry.lastKnownPosition || getRouteOriginPoint();
    const distM = curPos ? haversineMeters(curPos, p) : null;
    const distStr = formatDistanceLabel(distM);
    const speedKmH = getCompanionSpeedKmH();
    const mins = distM != null ? Math.max(1, Math.round((distM / 1000) / speedKmH * 60)) : null;

    const visualCat = resolvePlaceVisualCategory(p);
    const categoryLabel = visualCat?.shortLabel || (p.kind === 'water' ? 'Voda a klid' : p.kind === 'view' ? 'Vyhlídka' : p.kind === 'culture' ? 'Památka' : 'Příroda');
    const kindLabel = p.kind === 'water' ? '💧 Voda a klid' : p.kind === 'view' ? '⛰️ Vyhlídka' : p.kind === 'culture' ? '🏰 Památka' : '🌲 Příroda';

    const isMysteryGameMode = appSettings.gameMode === 'explorer' || appSettings.gameMode === 'gamified';
    const isUnexploredMystery = Boolean(!isDiscovered && p.pointKind !== 'route-start' && isMysteryGameMode && (distM == null || distM > 35));

    if (isUnexploredMystery) {
      const distRoundM = distM != null ? Math.round(distM) : '—';
      sheet.hidden = false;
      sheet.innerHTML = `
        <div class="pds-card phase3-bubble-card is-mystery-card">
          <div class="pds-header" style="display:flex;gap:12px;align-items:center">
            <div class="pds-mystery-icon-box">❓</div>
            <div class="pds-title-wrap" style="flex:1;min-width:0">
              <span class="pds-kind-badge">🌫️ Neprozkoumaná silueta</span>
              <h3 class="pds-title">❓ Tajemné místo v mlze (${e(categoryLabel)} · ${e(String(distRoundM))} m od tebe)</h3>
              <span class="pds-photo-source-badge is-bitmap">Přibliž se na ≤ 25 m a odhal skutečnou podobu místa i razítko (+30 b.)!</span>
            </div>
            <button type="button" class="button small ghost pds-close-btn" id="btn-close-place-detail" aria-label="Zavřít bublinu">✕</button>
          </div>
          <div class="pds-actions phase3-bubble-actions" style="margin-top:10px">
            <button type="button" class="button primary pds-action-btn guide-thread-btn" id="btn-p3-guide-thread" data-place-id="${e(p.id)}">
              🧭 VYDAT SE SEM (Natáhnout vodicí nit)
            </button>
            ${isPlanned ? `
              <button type="button" class="button danger phase3-action-btn" id="btn-p3-skip-stop" data-place-id="${e(p.id)}">
                ✕ Zrušit vodicí nit
              </button>
            ` : ''}
          </div>
        </div>
      `;
      $('btn-close-place-detail')?.addEventListener('click', closePlaceDetail);
      $('btn-p3-guide-thread')?.addEventListener('click', async () => {
        closePlaceDetail();
        playStampChord(stateObj.soundEnabled);
        await addStopToRoute(p, {
          setAsEnd: true,
          reasonMsg: `🧭 Zlatá vodicí nit natažena k tajemnému místu (${distRoundM} m).`,
        });
        updateTurnNavPill(lastFix || getRouteOriginPoint());
      });
      $('btn-p3-skip-stop')?.addEventListener('click', async () => {
        plannedRoute.selectedPlaceIds = (plannedRoute.selectedPlaceIds || []).filter(id => id !== p.id);
        lastRoutedGeometry = null;
        plannedRouteRenderKey = null;
        closePlaceDetail();
        playTick(stateObj.soundEnabled);
        await recalculateRemainingRoute('Vodicí nit k místu byla zrušena.');
      });
      return;
    }

    // DÁVKA 2 (Bod 2.1): Pravdivá terminologie a vysvětlení, že GPS měří přiblížení v terénu
    const statusBadge = visited
      ? `<span class="pds-stamp-badge visited" title="${e(VISIT_RECORD_TYPES.gps_stop.explanation)}">📍 Potvrzeno podle GPS (opakované vzorky ≤ ${STOP_CONFIRM_RADIUS_M} m)</span>`
      : nearbyVisited
      ? `<span class="pds-stamp-badge visited" title="${e(VISIT_RECORD_TYPES.gps_nearby.explanation)}">📍 Zaznamenáno poblíž (dle GPS)</span>`
      : earlierStamp
      ? `<span class="pds-stamp-badge lifetime" title="${e(VISIT_RECORD_TYPES.gps_stop.explanation)}">📍 Potvrzeno podle GPS (z dřívější výpravy)</span>`
      : `<span class="pds-stamp-badge pending">📍 ${distStr}${mins != null ? ` · ~${mins} min` : ''} (GPS měří přiblížení v terénu)</span>`;

    const extPhotosOn = appSettings.showExternalPhotos !== false;
    const placePhoto = getPlacePhotoSync(p, { showExternalPhotos: extPhotosOn });
    const imgSrc = placePhoto.photoUrl;
    const badgeHtml = placePhoto.isRealPhoto
      ? `<span class="pds-photo-source-badge is-verified" id="pds-photo-badge">📸 Fotka · ${e(formatPhotoSourceLabel(placePhoto))}</span>`
      : `<span class="pds-photo-source-badge is-bitmap" id="pds-photo-badge">🎨 Vektorová ilustrace kategorie</span>`;

    const actionsHtml = isPlanned
      ? `
        <div class="pds-actions phase3-bubble-actions">
          <button type="button" class="button danger phase3-action-btn" id="btn-p3-skip-stop" data-place-id="${e(p.id)}">
            ✕ Vynechat tuto zastávku
          </button>
        </div>
      `
      : `
        <div class="pds-actions phase3-bubble-actions">
          <button type="button" class="button primary pds-action-btn guide-thread-btn" id="btn-p3-guide-thread" data-place-id="${e(p.id)}">
            🧭 VYDAT SE SEM (Natáhnout vodicí nit)
          </button>
          <button type="button" class="button lime phase3-action-btn" id="btn-p3-insert-stop" data-place-id="${e(p.id)}">
            + Přidat do trasy
          </button>
          <button type="button" class="button ghost phase3-action-btn" id="btn-p3-set-end" data-place-id="${e(p.id)}">
            🏁 Nastavit jako konečný cíl
          </button>
        </div>
      `;

    sheet.hidden = false;
    sheet.innerHTML = `
      <div class="pds-card phase3-bubble-card">
        <div class="pds-header" style="display:flex;gap:12px;align-items:center">
          <img
            id="pds-photo-img"
            class="pds-thumb"
            src="${e(imgSrc)}"
            alt="${e(p.title)}"
            width="88"
            height="72"
            loading="lazy"
          />
          <div class="pds-title-wrap" style="flex:1;min-width:0">
            <span class="pds-kind-badge">${e(kindLabel)}</span>
            <h3 class="pds-title">${e(p.title)}</h3>
            ${badgeHtml}
          </div>
          <button type="button" class="button small ghost pds-close-btn" id="btn-close-place-detail" aria-label="Zavřít bublinu">✕</button>
        </div>
        <div class="pds-meta-row">
          ${statusBadge}
        </div>
        ${actionsHtml}
      </div>
    `;

    if (extPhotosOn && !placePhoto.isRealPhoto) {
      resolvePlacePhoto(p, { signal: aborter.signal, showExternalPhotos: true }).then(res => {
        if (disposed || !selectedDetailPlace || selectedDetailPlace.id !== p.id) return;
        if (res && res.isRealPhoto && res.photoUrl && appSettings.showExternalPhotos !== false) {
          const imgEl = $('pds-photo-img');
          const badgeEl = $('pds-photo-badge');
          if (imgEl) imgEl.src = res.photoUrl;
          if (badgeEl) {
            badgeEl.textContent = `📸 Fotka · ${formatPhotoSourceLabel(res)}`;
            badgeEl.className = 'pds-photo-source-badge is-verified';
          }
          const container = $('walk-places');
          if (container) {
            const cardImgs = container.querySelectorAll('img.place-card-thumb[data-place-img-id]');
            for (const cImg of cardImgs) {
              if (cImg.getAttribute('data-place-img-id') === String(p.id)) {
                cImg.setAttribute('src', res.photoUrl);
                break;
              }
            }
          }
        }
      }).catch(() => {});
    }

    $('btn-close-place-detail')?.addEventListener('click', closePlaceDetail);

    $('btn-p3-guide-thread')?.addEventListener('click', async () => {
      closePlaceDetail();
      playStampChord(stateObj.soundEnabled);
      await addStopToRoute(p, {
        setAsEnd: true,
        reasonMsg: `🧭 Zlatá vodicí nit natažena k: ${p.title}.`,
      });
      updateTurnNavPill(lastFix || getRouteOriginPoint());
    });

    // 1. Bod UŽ JE v trase -> [ ✕ Vynechat tuto zastávku ]
    $('btn-p3-skip-stop')?.addEventListener('click', async () => {
      const remainingPlaces = getPlannedPlaces().filter(item => item.id !== p.id);
      const isLoop = plannedRoute.routeType === 'loop' && remainingPlaces.length >= 2;
      const ordered = remainingPlaces.length >= 2
        ? optimizeRouteOrder(getRouteOriginPoint(), remainingPlaces, {
            returnToOrigin: isLoop,
            visitedStopIds: confirmedStopIds,
            currentPosition: getRouteOriginPoint(),
          })
        : remainingPlaces;
      plannedRoute.selectedPlaceIds = ordered.map(item => item.id);
      lastRoutedGeometry = null;
      plannedRouteRenderKey = null;
      closePlaceDetail();
      playTick(stateObj.soundEnabled);
      await recalculateRemainingRoute(`Zastávka „${p.title}“ vynechána. Trasa a čas do cíle byly zkráceny.`);
    });

    // 2A. Bod NENÍ v trase -> [ ➕ Přidat jako zastávku po cestě ]
    $('btn-p3-insert-stop')?.addEventListener('click', async () => {
      closePlaceDetail();
      playStampChord(stateObj.soundEnabled);
      await addStopToRoute(p, {
        reasonMsg: `➕ Zastávka „${p.title}“ vložena na nejvhodnější místo po cestě.`,
      });
    });

    // 2B. Bod NENÍ v trase -> [ 🏁 Nastavit jako nový konec trasy ]
    $('btn-p3-set-end')?.addEventListener('click', async () => {
      closePlaceDetail();
      playStampChord(stateObj.soundEnabled);
      await addStopToRoute(p, {
        setAsEnd: true,
        reasonMsg: `🏁 Nový konec trasy nastaven na: ${p.title}.`,
      });
    });
  }

  function closePlaceDetail() {
    selectedDetailPlace = null;
    const sheet = $('place-detail-sheet');
    if (sheet) sheet.hidden = true;
  }

  function renderNextCheckpointHero() {}

  function applyGameMode(mode, opts = {}) {
    if (!['explorer', 'gamified', 'casual'].includes(mode)) mode = 'gamified';
    appSettings.gameMode = mode;
    stateObj.gameMode = mode;
    if (mode === 'explorer') {
      fogMode = 'full';
      showHikingTrails = appSettings.kctTrails !== false;
      showContourLayer = false;
    } else if (mode === 'casual') {
      fogMode = 'none';
      showHikingTrails = appSettings.kctTrails !== false;
      showContourLayer = appSettings.contours !== false;
    } else {
      fogMode = appSettings.fogParchment === false ? 'none' : 'explore';
      showHikingTrails = appSettings.kctTrails !== false;
      showContourLayer = appSettings.contours !== false;
    }
    root.querySelectorAll('[data-p1-gamemode]').forEach(btn => {
      const isAct = btn.dataset.p1Gamemode === mode;
      btn.classList.toggle('active', isAct);
      btn.setAttribute('aria-pressed', String(isAct));
    });
    root.querySelectorAll('[data-modal-game-mode]').forEach(btn => {
      const isAct = btn.dataset.modalGameMode === mode;
      btn.classList.toggle('active', isAct);
      btn.setAttribute('aria-pressed', String(isAct));
    });
    const topStyleBtn = $('btn-top-pill-style');
    if (topStyleBtn) {
      topStyleBtn.textContent = mode === 'explorer' ? '🧭 Styl ▾' : mode === 'casual' ? '🗺️ Styl ▾' : '📜 Styl ▾';
    }
    stateObj.appSettings = { ...appSettings };
    saveAppState();
    updateFogToggleLabel();
    drawFog(true);
    syncHikingTrailsLayerState();
    setContourLayer(showContourLayer);
    plannedRouteRenderKey = null;
    renderPlannedRouteOnMap(true);
    renderPlaces({ skipListRebuild: true });
    renderAppSettingsModalUi();
    if (!opts.silent) {
      playStampChord(stateObj.soundEnabled);
      status(`Herní styl přepnut: ${mode === 'explorer' ? '🧭 Objevování' : mode === 'casual' ? '🗺️ Turistická mapa' : '📜 Výprava s pergamenem'}.`);
    }
  }

  const SETTINGS_ITEMS = [
    { key: 'showExternalPhotos', icon: '🖼️', title: '🖼️ Zobrazovat externí fotografie míst (Wikipedie)', desc: 'Zobrazovat externí fotografie z Wikipedie/Wikimedia Commons se zdrojem a licencí (při vypnutí se používají jen čisté vektorové ilustrace)' },
    { key: 'mindfulnessPrompts', icon: '🍃', title: 'Volitelné výzvy všímavosti na cestě', desc: 'Jemné pozorovací tipy k zastavení v terénu (lze kdykoliv jedním klepnutím přeskočit nebo zde trvale vypnout)' },
    { key: 'fogParchment', icon: '📜', title: 'Tajemný pergamen (odkrývání mlhy)', desc: 'Postupné odkrývání krajiny tam, kudy skutečně projdeš' },
    { key: 'kctTrails', icon: '🥾', title: 'Turistické značky KČT a stezky', desc: 'Červené, modré, zelené a žluté pěší trasy z dat OpenStreetMap' },
    { key: 'contours', icon: '⛰️', title: 'Vrstevnice a terén', desc: 'Zobrazení výškového reliéfu a kopců na mapě' },
    { key: 'show3dBuildings', icon: '🏢', title: '🏢 Zobrazovat 3D budovy ve 3D pohledu', desc: 'Jemné 3D modely domů a památek (průhlednost 45 %) pro lepší prostorovou orientaci' },
    { key: 'footprints', icon: '👣', title: 'Stopy pohorek za mnou', desc: 'Střídavé otisky bot ve směru tvé chůze, které za tebou pomalu blednou' },
    { key: 'orbitalArrow', icon: '🎯', title: 'Zlatá směrová šipka u Avatara', desc: 'Šipka obíhající postavičku ukazující směr k další zastávce' },
    { key: 'voiceNav', icon: '🗣️', title: 'Česká hlasová navigace', desc: 'Hlasové hlášení odboček a cílů v českém jazyce' },
    { key: 'soundFx', icon: '🔊', title: 'Zvukové efekty a fanfáry', desc: 'Zvuky při potvrzení zastávky, razítku a odškrtnutí cíle' },
    { key: 'hapticFeedback', icon: '📳', title: 'Haptická odezva (vibrace)', desc: 'Jemné zavibrování zařízení při zaznamenání GPS razítka nebo příchodu k nové zastávce' },
    { key: 'keepAwake', icon: '📱', title: 'Držet rozsvícený displej', desc: 'Zabrání zhasnutí obrazovky při chůzi v terénu' },
    { key: 'autoSortStops', icon: '🔄', title: 'Chytré řazení zastávek', desc: 'Automatické seřazení cílů podle pěších mostů a stezek' },
  ];

  function renderAppSettingsModalUi() {
    const listEl = $('walk-settings-pills-list');
    if (!listEl) return;

    root.querySelectorAll('[data-modal-game-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.modalGameMode === appSettings.gameMode);
    });

    const vibrateSupported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    const visibleItems = SETTINGS_ITEMS.filter(item => {
      if (item.key === 'hapticFeedback' && !vibrateSupported) return false;
      return true;
    });

    listEl.innerHTML = visibleItems.map(item => {
      const isEnabled = appSettings[item.key] !== false;
      return `
        <div class="settings-pill-row">
          <div class="settings-pill-info">
            <span class="settings-pill-icon">${item.icon}</span>
            <div class="settings-pill-texts">
              <strong>${e(item.title)}</strong>
              <small>${e(item.desc)}</small>
            </div>
          </div>
          <div class="settings-pill-buttons" role="group" aria-label="${e(item.title)}">
            <button type="button" class="settings-pill-btn btn-on ${isEnabled ? 'selected' : ''}" data-pill-key="${item.key}" data-pill-val="1">
              ✓ Zapnuto
            </button>
            <button type="button" class="settings-pill-btn btn-off ${!isEnabled ? 'selected' : ''}" data-pill-key="${item.key}" data-pill-val="0">
              Vypnuto
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  function updateGpsTelemetryUi(fix = lastFix, pausedByAccuracy = false) {
    const gpsBadge = $('gps-accuracy-badge');
    const fogBadge = $('fog-radius-badge');
    const accBanner = $('walk-accuracy-banner');

    if (fogBadge) {
      fogBadge.innerHTML = `🗺️ Dosah odkrývání: <strong>${FOG_REVEAL_RADIUS_M} m</strong>`;
    }

    const bgStatusEl = $('bg-record-status');
    if (bgStatusEl) {
      bgStatusEl.textContent = formatBackgroundGpsStatus(fix?.timestamp || (fix ? Date.now() : null));
    }

    if (!gpsBadge) return;

    if (gpsBrowseOnlyMode) {
      gpsBadge.className = 'telemetry-pill gps-pill is-inaccurate';
      gpsBadge.innerHTML = `🗺️ Režim prohlížení mapy (poloha GPS není povolena)`;
      if (accBanner) {
        accBanner.hidden = false;
        accBanner.innerHTML = `
          <strong>🔒 Přístup k poloze GPS byl zamítnut nebo selhal — jsi v režimu prohlížení mapy.</strong>
          <span>Jak polohu v prohlížeči znovu povolit: klepni na ikonu zámku nebo nastavení webu vlevo u adresního řádku prohlížeče, přepni <strong>Poloha (Location) → Povolit</strong> a poté klikni na tlačítko níže.</span>
          <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="button small primary" id="btn-retry-gps-locate">🔄 Zkusit znovu</button>
          </div>
        `;
        $('btn-retry-gps-locate')?.addEventListener('click', () => {
          gpsBrowseOnlyMode = false;
          if (accBanner) accBanner.hidden = true;
          startUnifiedExpedition();
        });
      }
      return;
    }

    if (walkState === 'locating') {
      gpsBadge.className = 'telemetry-pill gps-pill';
      gpsBadge.innerHTML = `⏳ Hledám polohu GPS (záznam začne po zaměření)…`;
      if (accBanner && (!fix || fix.accuracy <= MAX_GPS_ACCURACY_M)) {
        accBanner.hidden = false;
        accBanner.innerHTML = `
          <strong>⏳ Hledám polohu GPS (záznam začne po zaměření)…</strong>
          <span>Čekáme na platný signál GPS s přesností ≤ ${MAX_GPS_ACCURACY_M} m. Dokud není poloha zaměřena, čas ani ušlé metry se nepřičítají.</span>
        `;
      }
      return;
    }

    if (gpsOutageWarning && telemetry.lastKnownPosition) {
      gpsBadge.className = 'telemetry-pill gps-pill is-inaccurate';
      gpsBadge.innerHTML = `⚠️ Výpadek GPS: zobrazena poslední známá poloha`;
      if (accBanner) {
        accBanner.hidden = false;
        accBanner.innerHTML = `
          <strong>📡 Výpadek signálu GPS — na mapě zůstává zobrazena tvoje poslední známá poloha.</strong>
          <span>Jakmile přijde nové platné měření (≤ ${MAX_GPS_ACCURACY_M} m), sledování a průzkum plynule navážou bez falešné čáry přes neprojité území.</span>
        `;
      }
      return;
    }

    if (!fix || !Number.isFinite(fix.accuracy)) {
      gpsBadge.className = 'telemetry-pill gps-pill';
      gpsBadge.innerHTML = `📡 Nepřesnost GPS: čekám na signál (limit ≤ ${MAX_GPS_ACCURACY_M} m)`;
      if (accBanner) accBanner.hidden = true;
      return;
    }

    const acc = Math.round(fix.accuracy);
    if (acc > MAX_GPS_ACCURACY_M || pausedByAccuracy) {
      gpsBadge.className = 'telemetry-pill gps-pill is-inaccurate';
      gpsBadge.innerHTML = `⚠️ Nepřesnost GPS: <strong>±${acc} m</strong> (limit ${MAX_GPS_ACCURACY_M} m — pozastaveno)`;
      if (accBanner) {
        accBanner.hidden = false;
        accBanner.innerHTML = `
          <strong>⏸ Průzkum je dočasně pozastaven kvůli nepřesné GPS (±${acc} m &gt; ${MAX_GPS_ACCURACY_M} m).</strong>
          <span>Hodnota ±${acc} m vyjadřuje odchylku přijímané polohy, nikoli dosah odkrývání mapy (ten zůstává pevně ${FOG_REVEAL_RADIUS_M} m). Jakmile se signál zpřesní pod ${MAX_GPS_ACCURACY_M} m, odkrývání mapy i potvrzování zastávek automaticky pokračují.</span>
        `;
      }
    } else {
      gpsBadge.className = 'telemetry-pill gps-pill is-accurate';
      gpsBadge.innerHTML = `✓ Přesnost GPS: <strong>±${acc} m</strong> (v normě ≤ ${MAX_GPS_ACCURACY_M} m)`;
      if (accBanner) accBanner.hidden = true;
    }
  }

  function renderCompactTopHud(totalPts, rank) {
    const el = $('compact-top-summary');
    if (!el) return;
    el.innerHTML = `<span>⭐ <strong>${number(totalPts)}</strong> b. · 🗺️ <strong>${number(progress.cells.length)}</strong> dílků · 🏅 Úroveň ${rank.level} · Můj pas →</span>`;
  }

  function goalProgressSuffix() {
    if (!currentExpedition || currentExpedition.state === 'ended' || !currentExpedition.goal) return '';
    const g = currentExpedition.goal;
    if (isGoalAchieved(currentExpedition, progress)) return ` · 🎯 ${g.label}: ✓ splněno`;
    const gainedM = Math.max(0, progress.meters - (currentExpedition.startMeters || 0));
    const gainedC = Math.max(0, progress.cells.length - (currentExpedition.startCells || 0));
    if (g.type === 'meters') return ` · 🎯 ${Math.round(gainedM)} / ${g.target} m`;
    if (g.type === 'cells') return ` · 🎯 ${gainedC} / ${g.target} dílků`;
    return '';
  }

  function stats() {
    const totalPts = totalScore(stateObj);
    const rank = explorerRank(totalPts);

    renderCompactTopHud(totalPts, rank);
    updateGpsTelemetryUi(lastFix);
    renderTouristStatsHud(lastFix);

    const gainedM = currentExpedition ? Math.max(0, progress.meters - currentExpedition.startMeters) : 0;
    const gainedC = currentExpedition ? Math.max(0, progress.cells.length - currentExpedition.startCells) : 0;
    const confirmedCount = getPlannedPlaces().filter(p => isStopVisitedInSession(p)).length;
    const totalStops = getPlannedPlaces().length;

    if ($('walk-session')) {
      const modePrefix = simSandboxActive ? '🧪 Test' : demo ? 'Ukázka' : 'Tato výprava';
      $('walk-session').textContent = `${modePrefix}: ${Math.round(gainedM)} m · ${gainedC} nových dílků · ${confirmedCount}/${totalStops} zastávek${goalProgressSuffix()}`;
    }

    const hasExpedition = Boolean(currentExpedition && currentExpedition.state !== 'ended');
    const isPaused = walkState === 'paused' || (hasExpedition && currentExpedition.state === 'paused');
    const statePill = $('walk-state-pill');

    if (hasExpedition || walkState === 'locating' || walkState === 'running' || walkState === 'paused') {
      if ($('walk-stop')) $('walk-stop').hidden = false;
      if ($('walk-end')) $('walk-end').hidden = false;
      if (walkState === 'locating') {
        const startBtn = $('walk-start');
        if (startBtn) {
          startBtn.textContent = '⏳ Hledám polohu GPS…';
          startBtn.disabled = true;
        }
        if ($('walk-stop')) $('walk-stop').disabled = false;
        if ($('walk-end')) $('walk-end').disabled = false;
        if (statePill) {
          statePill.className = 'telemetry-pill state-running';
          statePill.textContent = '⏳ Hledám polohu GPS (záznam začne po zaměření)…';
        }
      } else if (walkState === 'running' || active) {
        const startBtn = $('walk-start');
        if (startBtn) {
          startBtn.textContent = '▶ Procházka běží';
          startBtn.disabled = true;
        }
        if ($('walk-stop')) $('walk-stop').disabled = false;
        if ($('walk-end')) $('walk-end').disabled = false;
        if (statePill) {
          statePill.className = 'telemetry-pill state-running';
          statePill.textContent = '▶ Procházka běží';
        }
      } else if (isPaused) {
        const startBtn = $('walk-start');
        if (startBtn) {
          startBtn.textContent = '▶ Pokračovat v procházce';
          startBtn.disabled = starting || demo || Boolean(storageError);
        }
        if ($('walk-stop')) $('walk-stop').disabled = true;
        if ($('walk-end')) $('walk-end').disabled = false;
        if (statePill) {
          statePill.className = 'telemetry-pill state-paused';
          statePill.textContent = '⏸ Pozastaveno';
        }
      }
    } else {
      const planned = getPlannedPlaces();
      const startBtn = $('walk-start');
      if (startBtn) {
        if (planned.length > 0) {
          const isLoop = plannedRoute.routeType === 'loop' && planned.length >= 2;
          const routedM = lastRoutedGeometry && !lastRoutedGeometry.isFallback ? lastRoutedGeometry.distanceM : null;
          const est = analyzePlannedRoute(plannedRoute.origin, planned, stateObj.companionMode, {
            returnToOrigin: isLoop,
            routedDistanceM: routedM,
          });
          const km = ((est?.estimatedWalkDistanceM || 0) / 1000).toFixed(1).replace('.', ',');
          startBtn.textContent = `▶ Začít procházku (${planned.length} zastávek · ~${km} km)`;
        } else {
          startBtn.textContent = '▶ Začít procházku';
        }
        startBtn.disabled = active || starting || demo || Boolean(storageError);
      }
      if ($('walk-stop')) {
        $('walk-stop').disabled = true;
        $('walk-stop').hidden = true;
      }
      if ($('walk-end')) {
        $('walk-end').disabled = true;
        $('walk-end').hidden = true;
      }
      if (statePill) {
        statePill.className = 'telemetry-pill state-ready';
        statePill.textContent = storageError ? '⚠️ Uložení se nezdařilo' : (walkState === 'finished' ? '✓ Dokončeno' : '● Připraveno');
      }
    }

    if ($('walk-step')) $('walk-step').hidden = !demo;
    if ($('walk-demo-banner')) $('walk-demo-banner').hidden = !demo;
    if ($('walk-demo')) $('walk-demo').textContent = demo ? 'Ukončit ukázku' : 'Ukázka pohybu';

    const curBasketSig = `${confirmedStopIds.size}|${(plannedRoute.selectedPlaceIds || []).join(',')}|${currentElevationProfile ? currentElevationProfile.gainM : 'none'}`;
    const walkedEl = $('xray-walked-dist');
    if (curBasketSig !== lastBasketRenderSig || !walkedEl) {
      renderPlannerBasketAndXray();
    } else {
      walkedEl.textContent = formatMetersCz(gainedM);
      const remEl = $('xray-remaining-dist');
      if (remEl) {
        const plannedPlaces = getPlannedPlaces();
        const isLoop = plannedRoute.routeType === 'loop' && plannedPlaces.length >= 2;
        const currentPos = lastFix || telemetry.lastKnownPosition || plannedRoute.origin || { lat: 49.6014, lng: 13.8644 };
        const remShared = computeRemainingFromSharedRoute({
          sharedRoute: lastRoutedGeometry,
          currentPos,
          plannedPlaces,
          confirmedStopIds,
          companionMode: 'solo',
          returnToOrigin: isLoop,
          origin: getRouteOriginPoint(),
        });
        if (remShared.isRouteValid && remShared.remainingDistanceM != null) {
          remEl.textContent = formatDistanceLabel(remShared.remainingDistanceM);
        }
      }
    }
    renderPhase1AndPhase4Ui(lastFix || telemetry.lastKnownPosition);
    updateMapActionBar();
  }

  let lastSavedExpeditionId = null;
  let lastSavedSummary = null;

  function showPostcardModal(summary) {
    const container = $('session-summary-container');
    if (!container || !summary) return;

    let currentTheme = summary.postcardTheme || summary.gameMode || appSettings.gameMode || 'gamified';
    let privacyTrimEnabled = summary.privacyTrimmed !== undefined ? Boolean(summary.privacyTrimmed) : true;
    let hideMapEnabled = Boolean(summary.hideMap);

    const buildPreviewDataUrl = () => {
      const summaryTaskId = beginMapTask('⏳ Připravuji souhrn procházky…');
      try {
        return generatePostcardDataUrl(summary, {
          theme: currentTheme,
          privacyTrim: privacyTrimEnabled,
          hideMap: hideMapEnabled,
        });
      } finally {
        endMapTask(summaryTaskId);
      }
    };

    let dataUrl = buildPreviewDataUrl();

    const distStr = summary.distanceMeters >= 1000
      ? (summary.distanceMeters / 1000).toFixed(1).replace('.', ',') + ' km'
      : Math.round(summary.distanceMeters || 0) + ' m';
    const activeTimeStr = formatActiveDuration(summary.activeDurationMs ?? summary.durationMs ?? 60000);
    const estSteps = summary.estimatedSteps != null
      ? Math.max(0, Math.round(Number(summary.estimatedSteps)))
      : estimateStepsFromMeters(summary.distanceMeters || 0);
    const elevStr = formatElevationSummary(summary);
    const memList = Array.isArray(summary.personalMemories) ? summary.personalMemories : [];
    const confirmedList = Array.isArray(summary.confirmedPlaces) ? summary.confirmedPlaces : [];
    const nearbyList = Array.isArray(summary.nearbyPlaces) ? summary.nearbyPlaces : [];

    container.innerHTML = `
      <div class="session-modal" id="postcard-modal" role="dialog" aria-modal="true" aria-labelledby="postcard-modal-title" tabindex="-1">
        <div class="session-modal-card" style="max-width:620px;text-align:left;position:relative">
          <button type="button" class="button small ghost" id="btn-close-postcard-x" aria-label="Zavřít souhrn procházky" style="position:absolute;top:12px;right:12px;padding:4px 10px;min-height:38px;font-weight:800">✕</button>
          <div class="eyebrow" style="margin-bottom:4px">🏁 Vzpomínka na procházku · Souhrn a pohlednice</div>
          <h2 id="postcard-modal-title" style="padding-right:36px;margin:0 0 6px">Procházka úspěšně dokončena! 🎉</h2>
          <p class="small-note" style="margin:0 0 12px">${simSandboxActive ? '🧪 Testovací procházka v simulátoru byla vyhodnocena v oddělené paměti (skutečný pas uživatele zůstal nedotčen).' : '✓ Tvoje procházka byla bezpečně uložena do osobního atlasu v „🎒 Můj pas“.'}</p>

          <!-- Pravdivé statistiky procházky -->
          <div class="session-stats-grid" style="margin-bottom:12px">
            <div class="session-stat-box"><strong>${e(distStr)}</strong><span>📏 Ušlá vzdálenost</span></div>
            <div class="session-stat-box"><strong>${e(activeTimeStr)}</strong><span>⏱️ Čistý aktivní čas</span></div>
            <div class="session-stat-box"><strong>~${estSteps.toLocaleString('cs-CZ')}</strong><span>👣 Odhad kroků</span></div>
            <div class="session-stat-box"><strong>${e(elevStr)}</strong><span>📈 Odhad převýšení</span></div>
            <div class="session-stat-box"><strong>+${Number(summary.newCellsCount) || 0}</strong><span>🗺️ Nové dílky mapy</span></div>
            <div class="session-stat-box"><strong>+${Number(summary.newStampsCount) || 0}</strong><span>📍 Potvrzená místa</span></div>
          </div>

          <!-- Přehled potvrzených míst, průchodů v okolí a vlastních vzpomínek -->
          <div class="postcard-discoveries-summary" style="margin-bottom:12px">
            ${confirmedList.length > 0 ? `<div class="pds-summary-row"><strong>📍 Potvrzeno podle GPS (zastávka):</strong> ${confirmedList.map(p => e(p.title || p)).join(', ')}</div>` : ''}
            ${nearbyList.length > 0 ? `<div class="pds-summary-row"><strong>📍 Zaznamenáno poblíž (dle GPS):</strong> ${nearbyList.map(p => e(p.title || p)).join(', ')}</div>` : ''}
            <div class="pds-summary-row">
              <strong>✨ Moje malé objevy (vlastní symboly):</strong>
              ${memList.length > 0
                ? memList.map(m => `<span class="memory-mini-chip">${e(m.symbolIcon || '✨')} ${e(m.title || 'Vzpomínka')}${m.note ? ` („${e(m.note)}“)` : ''}</span>`).join(' ')
                : '<span class="muted">Žádná vlastní vzpomínka nebyla při této chůzi uložena.</span>'}
            </div>
          </div>

          <!-- Výběr ze 3 vizuálních motivů pohlednice -->
          <div class="postcard-theme-picker" role="radiogroup" aria-label="Vizuální motiv pohlednice" style="margin-bottom:10px">
            <span class="eyebrow" style="display:block;margin-bottom:6px">Vizuální motiv pohlednice:</span>
            <div class="postcard-theme-buttons">
              ${Object.values(POSTCARD_THEMES).map(t => `
                <button type="button" class="button small postcard-theme-btn ${currentTheme === t.id ? 'active lime' : 'ghost'}" data-postcard-theme="${e(t.id)}" role="radio" aria-checked="${currentTheme === t.id}">
                  ${e(t.label)}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Náhled soukromí (Domov v bezpečí + Maximální soukromí Bez mapy) -->
          <div class="privacy-preview-box" style="margin-bottom:12px;display:flex;flex-direction:column;gap:8px">
            <label class="privacy-preview-toggle" for="chk-postcard-privacy-trim">
              <input type="checkbox" id="chk-postcard-privacy-trim" ${privacyTrimEnabled ? 'checked' : ''}>
              <span>
                <strong>🔒 Skrýt začátek a konec trasy (ochrana soukromí domova)</strong>
                <small>Ořízne z mini-mapy na pohlednici prvních a posledních 150 metrů trasy a skryje přesné časy průchodu.</small>
              </span>
            </label>
            <label class="privacy-preview-toggle" for="chk-postcard-no-map" style="padding-top:6px;border-top:1px solid rgba(16,185,129,0.28)">
              <input type="checkbox" id="chk-postcard-no-map" ${hideMapEnabled ? 'checked' : ''}>
              <span>
                <strong>🛡️ Maximální soukromí (Bez mapy)</strong>
                <small>Zcela skryje zákres trasy i souřadnice na pohlednici — zůstane jen koláž míst, statistiky a počet dílků.</small>
              </span>
            </label>
          </div>

          <!-- Animovaný 3D náhled pohlednice (.postcard-animated-wrap) -->
          <div class="postcard-animated-wrap" id="postcard-animated-wrap">
            <img id="postcard-preview-img" src="${dataUrl}" alt="Ilustrovaná pohlednice Vzpomínka na procházku" style="width:100%;height:auto;display:block">
          </div>

          <!-- Sdílení a stažení pohlednice -->
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:12px">
            <button type="button" class="button primary" id="btn-share-postcard">📤 Sdílet vzpomínku</button>
            <button type="button" class="button" id="btn-download-postcard">📥 Stáhnout pohlednici (PNG)</button>
          </div>

          <!-- DÁVKA 3 (Bod 1.3): Co udělat s naplánovanou trasou pro příští start -->
          <div class="postcard-postwalk-actions" style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(0,0,0,0.12);display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between;align-items:center">
            <button type="button" class="button lime" id="btn-postcard-new-walk" title="Vyčistí naplánované zastávky pro příští čistý start">
              ✨ Nová procházka
            </button>
            <button type="button" class="button ghost" id="btn-postcard-keep-route" title="Ponechá současné vybrané zastávky na mapě">
              🔄 Ponechat vybranou trasu
            </button>
          </div>
        </div>
      </div>
    `;

    const refreshPreviewImg = () => {
      dataUrl = buildPreviewDataUrl();
      const imgEl = $('postcard-preview-img');
      if (imgEl) imgEl.src = dataUrl;
      summary.postcardTheme = currentTheme;
      summary.privacyTrimmed = privacyTrimEnabled;
      summary.hideMap = hideMapEnabled;
    };

    const closePostcard = () => {
      container.innerHTML = '';
      playTick(stateObj.soundEnabled);
    };

    // Přesun fokusu do přístupného modálního dialogu
    setTimeout(() => {
      const modalEl = $('postcard-modal');
      if (modalEl) {
        modalEl.focus({ preventScroll: true });
      }
    }, 30);

    container.querySelectorAll('[data-postcard-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentTheme = btn.dataset.postcardTheme || 'gamified';
        container.querySelectorAll('[data-postcard-theme]').forEach(b => {
          const isAct = b.dataset.postcardTheme === currentTheme;
          b.classList.toggle('active', isAct);
          b.classList.toggle('lime', isAct);
          b.classList.toggle('ghost', !isAct);
          b.setAttribute('aria-checked', String(isAct));
        });
        refreshPreviewImg();
        playTick(stateObj.soundEnabled);
      });
    });

    $('chk-postcard-privacy-trim')?.addEventListener('change', (ev) => {
      privacyTrimEnabled = Boolean(ev.target.checked);
      refreshPreviewImg();
      playTick(stateObj.soundEnabled);
    });

    $('chk-postcard-no-map')?.addEventListener('change', (ev) => {
      hideMapEnabled = Boolean(ev.target.checked);
      refreshPreviewImg();
      playTick(stateObj.soundEnabled);
    });

    $('postcard-modal')?.addEventListener('click', (ev) => {
      if (ev.target === $('postcard-modal')) {
        closePostcard();
      }
    });

    $('btn-download-postcard')?.addEventListener('click', async () => {
      try {
        const blob = await generatePostcardBlob(summary, {
          theme: currentTheme,
          privacyTrim: privacyTrimEnabled,
          hideMap: hideMapEnabled,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pohlednice-${summary.id}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      } catch {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `pohlednice-${summary.id}.svg`;
        a.click();
      }
    });

    $('btn-share-postcard')?.addEventListener('click', async () => {
      try {
        const blob = await generatePostcardBlob(summary, {
          theme: currentTheme,
          privacyTrim: privacyTrimEnabled,
          hideMap: hideMapEnabled,
        });
        const file = new File([blob], `pohlednice-${summary.id}.png`, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'Vzpomínka na procházku · Czekpoint',
            text: `Vzpomínka na procházku s Czekpointem (${distStr}).`,
            files: [file],
          });
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `pohlednice-${summary.id}.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
        }
      } catch (err) {
        if (err.name !== 'AbortError') status('Sdílení se nezdařilo.');
      }
    });

    // ✨ Nová procházka: vyčistí naplánované zastávky pro příští start
    $('btn-postcard-new-walk')?.addEventListener('click', () => {
      plannedRoute.selectedPlaceIds = [];
      plannedRoute.embeddedStops = [];
      confirmedStopIds.clear();
      nearbyRecordedIds.clear();
      memoryTrail = [];
      lastRoutedGeometry = null;
      plannedRouteCoords = null;
      currentElevationProfile = null;
      walkState = 'idle';
      saveAppState();
      closePostcard();
      recalculateRemainingRoute('✨ Připraveno na novou procházku (předchozí výprava je uložena v pasu).');
      stats();
    });

    // 🔄 Ponechat vybranou trasu: ponechá zastávky a zavře souhrn
    $('btn-postcard-keep-route')?.addEventListener('click', () => {
      confirmedStopIds.clear();
      nearbyRecordedIds.clear();
      memoryTrail = [];
      walkState = 'idle';
      saveAppState();
      closePostcard();
      stats();
      status('🔄 Vybraná trasa ponechána pro další procházku.');
    });

    $('btn-close-postcard-x')?.addEventListener('click', closePostcard);
  }

  async function releaseWake() {
    if (wake) { const w = wake; wake = null; await w.release().catch(() => {}); }
    if (!disposed && $('wake-status')) $('wake-status').textContent = 'Displej: zámek není aktivní.';
  }

  async function holdWake() {
    if (!active || !$('walk-awake')?.checked) return;
    if (!navigator.wakeLock) {
      if ($('wake-status')) $('wake-status').textContent = 'Telefon neumí držet displej zapnutý.';
      return;
    }
    try {
      const w = await navigator.wakeLock.request('screen');
      if (!active || disposed || !$('walk-awake')?.checked) { await w.release(); return; }
      wake = w;
      if ($('wake-status')) $('wake-status').textContent = 'Displej zůstává zapnutý.';
      w.addEventListener('release', () => {
        if (wake === w) {
          wake = null;
          if (!disposed && $('wake-status')) $('wake-status').textContent = 'Telefon uvolnil zámek displeje.';
        }
      });
    } catch {
      if (!disposed && $('wake-status')) $('wake-status').textContent = 'Zámek displeje nebyl povolen.';
    }
  }

  function pauseSession(message) {
    active = false;
    starting = false;
    document.body?.classList?.remove('nav-active');
    walkState = currentExpedition && currentExpedition.state !== 'ended' ? 'paused' : 'idle';
    if (gpsLocatingTaskId !== null) {
      endMapTask(gpsLocatingTaskId);
      gpsLocatingTaskId = null;
    }
    if (watch !== null) { navigator.geolocation.clearWatch(watch); watch = null; }
    fakeGpsSim?.pause?.();
    anchor = null;
    pendingPlaceStamps = {};
    pendingStopSamples = {};
    telemetry = updateTelemetryTimers(telemetry, Date.now(), false);
    telemetry.currentSpeedKmH = 0;
    if (lastFix) {
      memoryTrail = appendTrail(memoryTrail, { lat: lastFix.lat, lng: lastFix.lng, segmentBreak: true }, Date.now());
    }
    releaseWake();
    pauseBackgroundTracking();
    releaseLock?.(); releaseLock = null;

    let saveFailedMsg = '';
    if (currentExpedition && currentExpedition.state === 'active') {
      currentExpedition = pauseExpedition(currentExpedition);
      stateObj.activeExpedition = currentExpedition;
      if (canPersistRealState()) {
        try {
          stateObj = saveState(stateObj);
          storageError = '';
        } catch (err) {
          storageError = err.message;
          saveFailedMsg = `Uložení se nezdařilo: ${err.message}`;
        }
      }
    }

    if (!disposed) {
      updateMapActionBar();
      stats();
      if (saveFailedMsg) status(saveFailedMsg);
      else if (message) status(message);
    }
  }

  function finishUnifiedExpedition() {
    fakeGpsSim?.stopMovement?.();
    phase4MenuOpen = false;
    moreMenuOpen = false;
    if ($('walk-more-menu')) $('walk-more-menu').hidden = true;
    if ($('walk-more-btn')) $('walk-more-btn').setAttribute('aria-expanded', 'false');
    if (gpsLocatingTaskId !== null) {
      endMapTask(gpsLocatingTaskId);
      gpsLocatingTaskId = null;
    }
    if (watch !== null) {
      try { navigator.geolocation?.clearWatch?.(watch); } catch {}
      watch = null;
    }
    stopWatchdog();
    releaseWake();
    stopBackgroundTracking();
    keepAliveCtrl.stop();
    if ($('pocket-mode-overlay')) $('pocket-mode-overlay').hidden = true;
    if ($('arrival-goal-modal')) $('arrival-goal-modal').hidden = true;
    active = false;
    starting = false;
    walkState = 'finished';
    lockedExpeditionOrigin = null;

    // DÁVKA 3 (Bod 1.3): Zabránit dvojímu uložení téže výpravy, pokud už byla ukončena
    if (!currentExpedition && lastSavedSummary && lastSavedExpeditionId === lastSavedSummary.id) {
      showPostcardModal(lastSavedSummary);
      return;
    }

    if (!currentExpedition) {
      currentExpedition = createExpedition({ progress, goal: DEFAULT_GOALS[0] });
    }

    const expStartMs = Number(currentExpedition.createdAt) || (Date.now() - 60000);
    const gainedM = Math.max(0, progress.meters - (currentExpedition.startMeters || 0));
    const gainedC = Math.max(0, progress.cells.length - (currentExpedition.startCells || 0));
    const gainedS = Math.max(0, progress.discoveries.length - (currentExpedition.startDiscoveries || 0));
    const earnedPoints = expeditionPointsDelta(currentExpedition, progress);

    // 6.1 Uložíme do dat pohlednice pole navštívených míst včetně jejich fotek/obrázků (visitedPlacesWithPhotos)
    const allKnownPlaces = getAllAvailablePlaces();
    const plannedPlaces = getPlannedPlaces();
    const visitedIdsList = [
      ...new Set([
        ...confirmedStopIds,
        ...(currentExpedition.visitedPlaces || []).map(v => v.id || v),
        ...plannedPlaces.filter(p => isStopVisitedInSession(p)).map(p => p.id),
      ]),
    ];
    const visitedSourcePlaces = visitedIdsList
      .map(id => allKnownPlaces.find(p => p.id === id) || plannedPlaces.find(p => p.id === id))
      .filter(Boolean);
    const fallbackVisitedPlaces = visitedSourcePlaces.length > 0 ? visitedSourcePlaces : plannedPlaces.slice(0, 4);
    const visitedPlacesWithPhotos = fallbackVisitedPlaces.map(p => {
      const photoInfo = getPlacePhotoSync(p, { showExternalPhotos: appSettings.showExternalPhotos !== false });
      return {
        id: p.id,
        title: p.title,
        kind: p.kind || 'forest',
        category: p.category || 'nature',
        photoUrl: photoInfo.photoUrl,
        isRealPhoto: photoInfo.isRealPhoto,
      };
    });

    const confirmedPlaces = visitedSourcePlaces.map(p => ({
      id: p.id,
      title: p.title,
      recordType: VISIT_RECORD_TYPES.GPS_CONFIRMED,
      badge: '📍 Potvrzeno podle GPS (zastávka)',
    }));

    const nearbyPlaces = [...nearbyRecordedIds]
      .filter(id => !confirmedStopIds.has(id))
      .map(id => allKnownPlaces.find(p => p.id === id) || plannedPlaces.find(p => p.id === id))
      .filter(Boolean)
      .map(p => ({
        id: p.id,
        title: p.title,
        recordType: VISIT_RECORD_TYPES.NEARBY_PASS,
        badge: '📍 Zaznamenáno poblíž (dle GPS)',
      }));

    // Vlastní vzpomínky uložené během procházky (nebo v osobním atlasu)
    const sessionMemories = personalMemories
      .filter(m => {
        const ts = Date.parse(m.createdAt || '');
        return !Number.isFinite(ts) || ts >= expStartMs - 3600000;
      })
      .slice(0, 8);
    const memoriesForPostcard = sessionMemories.length > 0 ? sessionMemories : personalMemories.slice(0, 4);

    // Skutečně prošlé segmenty se zachováním případných výpadků GPS
    const trailSegmentsFromMemory = normalizeWalkSegments(memoryTrail);
    const sessionWalkSegments = trailSegmentsFromMemory.length > 0
      ? trailSegmentsFromMemory.map(seg => seg.map(pt => [pt.lat, pt.lng]))
      : (Array.isArray(progress.walkSegments) && progress.walkSegments.length > 0
          ? progress.walkSegments.slice(-8)
          : (Array.isArray(plannedRouteCoords) && plannedRouteCoords.length >= 2 ? [plannedRouteCoords] : []));

    const elevationKnown = Boolean(
      currentElevationProfile &&
      Array.isArray(currentElevationProfile.points) &&
      currentElevationProfile.points.length > 0 &&
      Number.isFinite(Number(currentElevationProfile.gainM))
    );

    let endResult = null;
    try {
      endResult = endExpedition({
        expedition: currentExpedition,
        currentProgress: progress,
        pointsEarned: earnedPoints,
        avatarId: stateObj.profile?.avatarId || 'liska',
      });
    } catch {}

    const baseSummary = endResult?.summary || {
      id: currentExpedition.id,
      date: new Date().toISOString(),
      distanceMeters: gainedM,
      cellsCount: gainedC,
      stampsCount: gainedS,
      newCellsCount: gainedC,
      newStampsCount: gainedS,
      durationMs: Math.max(1000, Date.now() - expStartMs),
      activeDurationMs: telemetry?.movingTimeMs > 0 ? telemetry.movingTimeMs : Math.max(1000, Date.now() - expStartMs),
      pointsEarned: earnedPoints || 10,
      goal: currentExpedition.goal || DEFAULT_GOALS[0],
      avatarId: stateObj.profile?.avatarId || 'liska',
      companionMode: stateObj.companionMode || 'solo',
    };

    const summary = {
      ...baseSummary,
      activeDurationMs: telemetry?.movingTimeMs > 0 ? telemetry.movingTimeMs : baseSummary.activeDurationMs,
      estimatedSteps: estimateStepsFromMeters(gainedM),
      elevationKnown,
      elevationGainM: elevationKnown ? Math.round(Number(currentElevationProfile.gainM)) : null,
      gameMode: appSettings.gameMode || 'gamified',
      postcardTheme: appSettings.gameMode || 'gamified',
      privacyTrimmed: true,
      visitedPlacesWithPhotos,
      confirmedPlaces,
      nearbyPlaces,
      personalMemories: memoriesForPostcard,
      walkSegments: sessionWalkSegments,
      trailCoordinates: memoryTrail.length >= 2
        ? memoryTrail.filter(pt => pt && Number.isFinite(pt.lat)).map(pt => [pt.lat, pt.lng])
        : (plannedRouteCoords || []),
    };

    const prevStateSnapshot = { ...stateObj };
    const prevExpeditionSnapshot = currentExpedition;
    const history = upsertExpeditionHistory(stateObj.expeditionHistory || [], summary);

    const badge = createStickBadge({
      expId: currentExpedition.id,
      distanceMeters: gainedM,
      stampsCount: gainedS,
      companionMode: stateObj.companionMode || 'solo',
      categories: currentExpedition.categories || [],
    });
    const existingBadges = Array.isArray(stateObj.stickBadges)
      ? stateObj.stickBadges.filter(b => b && b.expId !== currentExpedition.id)
      : [];
    stateObj.stickBadges = [badge, ...existingBadges].slice(0, 200);

    stateObj = {
      ...stateObj,
      activeExpedition: null,
      expeditionHistory: history,
      walkSegments: progress.walkSegments,
      revealedFeatures: progress.revealedFeatures,
      personalMemories,
    };

    // DÁVKA 4: Idempotentní zápis procházky do pointsLedger a vyhodnocení 8 milníků
    if (!simSandboxActive && !demo) {
      stateObj.pointsLedger = recordWalkInLedger(stateObj.pointsLedger, summary, summary.pointsEarned);
      const milestoneRes = evaluateMilestones(stateObj);
      stateObj.pointsLedger = milestoneRes.updatedLedger;
    }
    document.body?.classList?.remove('nav-active');

    lastSavedExpeditionId = summary.id;
    lastSavedSummary = summary;
    currentExpedition = null;

    if (canPersistRealState()) {
      try {
        stateObj = saveState(stateObj);
        storageError = '';
      } catch (err) {
        stateObj = prevStateSnapshot;
        currentExpedition = prevExpeditionSnapshot;
        storageError = err.message;
        stats();
        status('Uložení se nezdařilo: ' + err.message);
        return;
      }
    }

    if (gainedM > 0 || gainedS > 0) {
      playStampChord(stateObj.soundEnabled);
    }
    updateMapActionBar();
    updateTopBarUi();
    stats();
    const statePill = $('walk-state-pill');
    if (statePill) {
      statePill.className = 'telemetry-pill state-ready';
      statePill.textContent = simSandboxActive ? '🧪 Simulace dokončena' : '✓ Výprava uložena';
    }
    status(simSandboxActive ? 'Testovací výprava v simulátoru ukončena.' : 'Výprava byla úspěšně uložena.');
    showPostcardModal(summary);
  }
  const finishExpedition = finishUnifiedExpedition;

  function shortenRouteToStart() {
    moreMenuOpen = false;
    if ($('walk-more-menu')) $('walk-more-menu').hidden = true;
    if ($('walk-more-btn')) $('walk-more-btn').setAttribute('aria-expanded', 'false');
    const curPos = lastFix || telemetry.lastKnownPosition || getRouteOriginPoint();
    if (!curPos) return;
    const startOrigin = getExpeditionStartPoint();
    const returnStopId = 'return-to-start-stop';
    const returnStopObj = {
      id: returnStopId,
      title: `Cíl: ${startOrigin.label || 'Návrat na start'}`,
      lat: startOrigin.lat,
      lng: startOrigin.lng,
      kind: 'route-start',
      category: 'nature',
      pointKind: 'route-start',
    };
    plannedRoute.embeddedStops = [
      ...(plannedRoute.embeddedStops || []).filter(item => item.id !== returnStopId),
      returnStopObj,
    ];
    const visitedIds = (plannedRoute.selectedPlaceIds || []).filter(id => confirmedStopIds.has(id));
    plannedRoute.selectedPlaceIds = [...visitedIds, returnStopId];
    plannedRoute.routeType = 'oneway';
    lastRoutedGeometry = null;
    recalculateRemainingRoute('🏠 Trasa zkrácena: zbývající zastávky vyškrtnuty, navádím rovnou na start.');
    playStampChord(stateObj.soundEnabled);
  }

  function togglePauseUnified() {
    if (walkState === 'locating') {
      // Pokud jsme čekali na polohu a uživatel dal Pauzu, přejdeme do paused
      walkState = 'paused';
      starting = false;
      active = false;
      if (gpsLocatingTaskId !== null) {
        endMapTask(gpsLocatingTaskId);
        gpsLocatingTaskId = null;
      }
      if (watch !== null) {
        try { navigator.geolocation?.clearWatch?.(watch); } catch {}
        watch = null;
      }
      fakeGpsSim?.pause?.();
      if (currentExpedition && currentExpedition.state === 'active') {
        currentExpedition = pauseExpedition(currentExpedition);
        stateObj.activeExpedition = currentExpedition;
      }
      updateMapActionBar();
      updateTopBarUi();
      stats();
      status('⏸ Výprava pozastavena.');
      playTick(stateObj.soundEnabled);
      return;
    }

    if (!currentExpedition) return;
    if (walkState === 'paused' || currentExpedition.state === 'paused') {
      currentExpedition = resumeExpedition(currentExpedition);
      stateObj.activeExpedition = currentExpedition;
      telemetry.lastTickMs = Date.now();
      anchor = null;
      if (simSandboxActive || demo || lastAcceptedFix) {
        walkState = 'running';
        active = true;
        starting = false;
      } else {
        walkState = 'locating';
        starting = true;
        active = false;
        if (gpsLocatingTaskId === null) {
          gpsLocatingTaskId = beginMapTask('⏳ Čekám na polohu GPS…');
        }
      }
      if (simSandboxActive) {
        fakeGpsSim?.resume?.();
      } else {
        restartGpsWatch();
      }
      startBackgroundTracking({
        title: 'Výprava pokračuje · Czekpoint',
        artist: 'Czekpoint · Objevování a mapa',
        album: 'Záznam chůze i při zhasnutém displeji',
        onPause: () => { togglePauseUnified(); },
        onResume: () => { togglePauseUnified(); },
        onStop: () => { finishUnifiedExpedition(); },
      });
      status(walkState === 'locating'
        ? '⏳ Hledám polohu GPS (záznam začne po zaměření)…'
        : '▶ Výprava pokračuje (záznam běží i při zhasnutém displeji).');
    } else {
      walkState = 'paused';
      active = false;
      starting = false;
      anchor = null;
      pendingPlaceStamps = {};
      pendingStopSamples = {};
      if (gpsLocatingTaskId !== null) {
        endMapTask(gpsLocatingTaskId);
        gpsLocatingTaskId = null;
      }
      if (watch !== null) {
        try { navigator.geolocation?.clearWatch?.(watch); } catch {}
        watch = null;
      }
      telemetry = updateTelemetryTimers(telemetry, Date.now(), false);
      telemetry.currentSpeedKmH = 0;
      currentExpedition = pauseExpedition(currentExpedition);
      stateObj.activeExpedition = currentExpedition;
      fakeGpsSim?.pause?.();
      pauseBackgroundTracking();
      status('⏸ Výprava pozastavena. Průzkum je uložený.');
    }
    if (canPersistRealState()) {
      try { stateObj = saveState(stateObj); } catch {}
    }
    updateMapActionBar();
    updateTopBarUi();
    stats();
    playTick(stateObj.soundEnabled);
  }

  let watchdogTimer = null;
  let lastFixReceivedAt = 0;

  function stopWatchdog() {
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
  }

  function startWatchdog() {
    stopWatchdog();
    watchdogTimer = setInterval(() => {
      if ((walkState !== 'running' && walkState !== 'locating') || disposed || demo || simSandboxActive) return;
      if (Date.now() - lastFixReceivedAt > GPS_OUTAGE_WARNING_MS) {
        gpsOutageWarning = true;
        anchor = null; // přerušíme úsek po výpadku, aby se nespojila místa čarou
        updateGpsTelemetryUi(lastFix);
        restartGpsWatch();
      }
    }, 10000);
  }

  function handleGpsFix(coords) {
    if (disposed) return;

    // DÁVKA 1 (Bod 2.3): Nepropustná Pauza — ve stavu 'paused' nesmí příchod reálného ani simulovaného vzorku
    // obnovit procházku ani přičíst metry, aktivní čas, buňky mlhy či místa!
    if (walkState === 'paused' || (currentExpedition && currentExpedition.state === 'paused')) {
      return;
    }

    lastFixReceivedAt = Date.now();
    gpsOutageWarning = false;
    gpsBrowseOnlyMode = false;

    const normCoords = normalizePointLatLng(coords);
    if (!normCoords || Number(coords?.accuracy) > 500) {
      return;
    }

    const now = Date.now();
    const fixTime = Number.isFinite(Number(coords.timestamp)) && Number(coords.timestamp) > 0
      ? Number(coords.timestamp)
      : now;

    const cleanFix = {
      lat: normCoords.lat,
      lng: normCoords.lng,
      accuracy: Math.max(1, Number(coords.accuracy) || 10),
      altitude: Number.isFinite(coords.altitude) ? Number(coords.altitude) : null,
      timestamp: fixTime,
      speed: Number.isFinite(coords.speed) ? Number(coords.speed) : null,
      simulated: Boolean(coords.simulated),
    };

    // DÁVKA 1 (Bod 3.2): Kompletní validace vzorku GPS podle 4 kritérií před přijetím do lastAcceptedFix:
    // (a) platné číselné souřadnice, (b) časová následnost (timestamp), (c) přesnost <= 40 m, (d) přiměřená rychlost posunu vůči času.
    const validation = validateGpsSample(cleanFix, lastAcceptedFix, coords.simulated ? fixTime : now);

    if (!validation.valid) {
      // Nepřesný vzorek (> 40 m, např. ±55 m) pouze upraví poloměr kruhu nejistoty accuracyRing,
      // ale nemění start, nepotvrzuje místa a nepřičítá metry!
      if (validation.failedCriterion === 'accuracy') {
        if (accuracyRing) {
          if (lastAcceptedFix) {
            accuracyRing.setLatLng([lastAcceptedFix.lat, lastAcceptedFix.lng]);
          } else {
            accuracyRing.setLatLng([cleanFix.lat, cleanFix.lng]);
          }
          accuracyRing.setRadius(cleanFix.accuracy);
        }
        updateGpsTelemetryUi(cleanFix, true);
        status(validation.reason);
      } else if (validation.failedCriterion === 'speed') {
        // Nereálný GPS teleport odfiltrujeme a přerušíme anchor
        anchor = null;
        status(validation.reason);
      }
      return;
    }

    // Vzorek prošel všemi 4 kritérii -> vyhodnotíme případný kurz chůze z GPS (DÁVKA 3 Bod 3.2 & Dávka 1) a uložíme do lastAcceptedFix
    const coordsHeading = (coords.heading !== null && coords.heading !== undefined && coords.heading !== '' && Number.isFinite(Number(coords.heading)))
      ? Number(coords.heading)
      : null;
    const coordsSpeed = (coords.speed !== null && coords.speed !== undefined && coords.speed !== '' && Number.isFinite(Number(coords.speed)))
      ? Number(coords.speed)
      : null;
    const gpsCourseRes = computeGpsWalkingCourseDeg(prevAcceptedFixForCourse || lastAcceptedFix, {
      ...cleanFix,
      heading: coordsHeading,
      speed: coordsSpeed,
    });
    cleanFix.heading = coordsHeading;
    cleanFix.speed = coordsSpeed;
    prevAcceptedFixForCourse = cleanFix;
    lastAcceptedFix = cleanFix;
    lastFix = cleanFix;

    if (gpsCourseRes.valid) {
      lastGpsCourseHeading = gpsCourseRes.headingDeg;
      if (followHeadingMode && compassSensorState !== 'active') {
        if (compassSensorState === 'unknown') {
          compassSensorState = 'unavailable';
        }
        updateHeadingModeBannerUi();
        if (follow) {
          applyHeadingToMapCamera(gpsCourseRes.headingDeg, 'gps_course');
        }
      }
    }

    // Pokud jsme byli ve stavu 'locating' (čekání na první platnou GPS polohu),
    // TEPRVE NYNÍ přecházíme do stavu 'running' a spouštíme záznam času a metrů!
    if (walkState === 'locating') {
      if (gpsLocatingTaskId !== null) {
        endMapTask(gpsLocatingTaskId);
        gpsLocatingTaskId = null;
      }
      walkState = 'running';
      starting = false;
      active = true;
      document.body?.classList?.add('nav-active');
      telemetry.lastTickMs = Date.now();
      if (!lockedExpeditionOrigin) {
        lockedExpeditionOrigin = plannedRoute.origin
          ? { ...plannedRoute.origin }
          : { id: 'start-gps', label: 'Místo startu', lat: cleanFix.lat, lng: cleanFix.lng };
      }
      if (!expeditionStartPoint) {
        expeditionStartPoint = { ...lockedExpeditionOrigin };
      }
      updateMapActionBar();
      updateTopBarUi();
    }

    if (!active && walkState === 'idle' && !lockedExpeditionOrigin && !userExplicitlyPickedOrigin) {
      const prev = plannedRoute.origin;
      const isUnset = !prev || prev.id === 'namesti' || prev.id === 'my-gps';
      if (isUnset || (haversineMeters(prev, cleanFix) ?? 0) > 40) {
        plannedRoute.origin = {
          id: 'my-gps',
          label: 'Moje aktuální GPS poloha',
          lat: cleanFix.lat,
          lng: cleanFix.lng,
        };
        const origLabel = $('wiz-active-origin-label');
        if (origLabel) origLabel.textContent = 'Moje aktuální GPS poloha';
      }
    }

    // KRITICKÁ OPRAVA 2 (Hotfix v2.0.2):
    // 1. Herní logika (zápis do walkSegments, přičtení metrů v sample(), potvrzení zastávek <= 35 m a hlasová navigace updateTurnNavPill())
    //    probíhá OKAMŽITĚ A SYNCHRONNĚ v handleGpsFix bez čekání na smoothMovePlayerTo() nebo requestAnimationFrame!
    updateGpsTelemetryUi(cleanFix);
    renderCompass(cleanFix);
    refreshWeatherStrip(cleanFix);

    if (walkState === 'running' || demo) {
      sample(cleanFix, coords.simulated ? fixTime : now);
      if (walkState === 'running' && !coords.simulated) {
        const gainedM = currentExpedition ? Math.max(0, progress.meters - (currentExpedition.startMeters || 0)) : progress.meters;
        const durMin = Math.max(1, Math.round((Date.now() - (currentExpedition?.createdAt || Date.now())) / 60000));
        const plannedPlaces = getPlannedPlaces();
        const nextTarget = plannedPlaces.find(p => !isStopVisited(p));
        const nextTitle = nextTarget ? ` · Cíl: ${nextTarget.title}` : '';
        updateBackgroundTracking({
          title: `👣 ${Math.round(gainedM)} m (${durMin} min)${nextTitle}`,
          album: 'Czekpoint · Záznam běží i při zhasnutém displeji',
        });
      }
    } else {
      renderQuestHud(cleanFix);
    }

    // 2. Vizuální posun postavičky na mapě:
    //    Když je obrazovka zhasnutá (document.hidden === true), prohlížeč zastaví requestAnimationFrame.
    //    Proto při document.hidden === true přeskočíme animaci smoothMovePlayerTo a rovnou nastavíme visualPlayerPos = cleanFix.
    const isHiddenOrPocket = (typeof document !== 'undefined' && document.hidden === true) || ($('pocket-mode-overlay') && !$('pocket-mode-overlay').hidden);
    if (isHiddenOrPocket) {
      if (playerLerpRafId) {
        cancelAnimationFrame(playerLerpRafId);
        playerLerpRafId = null;
      }
      const snapped = snapPointToPedestrianPath(cleanFix, plannedRouteCoords, 16);
      const targetPt = snapped && snapped.snapped ? { lat: snapped.lat, lng: snapped.lng } : cleanFix;
      visualPlayerPos = targetPt;
      if (map && player && accuracyRing) {
        setPlayerMarkerVisible(true);
        updatePlayerAvatarIcon(walkState === 'running');
        player.setLatLng([targetPt.lat, targetPt.lng]);
        accuracyRing.setLatLng([targetPt.lat, targetPt.lng]);
        accuracyRing.setRadius(cleanFix.accuracy);
      }
    } else if (map && player && accuracyRing) {
      smoothMovePlayerTo(cleanFix.lat, cleanFix.lng, coords.simulated ? 920 : 1050);
      accuracyRing.setRadius(cleanFix.accuracy);
    } else {
      visualPlayerPos = cleanFix;
    }
  }

  function onGeolocationError(error) {
    if (disposed) return;
    if (gpsLocatingTaskId !== null) {
      endMapTask(gpsLocatingTaskId);
      gpsLocatingTaskId = null;
    }
    if (error && error.code === 1) {
      // PERMISSION_DENIED -> přepnout do režimu pouhého prohlížení mapy a zobrazit návod + tlačítko Zkusit znovu
      gpsBrowseOnlyMode = true;
      walkState = 'idle';
      active = false;
      starting = false;
      if (watch !== null) {
        try { navigator.geolocation?.clearWatch?.(watch); } catch {}
        watch = null;
      }
      stopWatchdog();
      releaseWake();
      pauseBackgroundTracking();
      updateGpsTelemetryUi(lastFix);
      updateMapActionBar();
      updateTopBarUi();
      stats();
      status('🔒 Přístup k poloze GPS byl zamítnut. Jsi v režimu prohlížení mapy — povol polohu v prohlížeči a klikni na „Zkusit znovu“.');
    } else if (walkState === 'locating') {
      // Pokud selhalo prvotní zaměření polohy (timeout / nedostupnost), přepneme do režimu prohlížení mapy s možností Zkusit znovu
      gpsBrowseOnlyMode = true;
      walkState = 'idle';
      active = false;
      starting = false;
      updateGpsTelemetryUi(lastFix);
      updateMapActionBar();
      updateTopBarUi();
      stats();
      status('⚠️ Polohu GPS se nepodařilo zaměřit. Jsi v režimu prohlížení mapy — můžeš to zkusit znovu nebo použít simulátor.');
    } else {
      anchor = null;
      pendingPlaceStamps = {};
      pendingStopSamples = {};
      gpsOutageWarning = true;
      updateGpsTelemetryUi(lastFix);
      status('Hledám polohu… GPS signál má výpadek (zobrazena poslední známá poloha).');
    }
  }

  function restartGpsWatch() {
    if (watch !== null) {
      navigator.geolocation.clearWatch(watch);
      watch = null;
    }
    if (!navigator.geolocation || disposed || (walkState !== 'running' && walkState !== 'locating') || simSandboxActive) return;

    navigator.geolocation.getCurrentPosition(
      p => handleGpsFix({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: p.coords.accuracy,
        altitude: p.coords.altitude,
        speed: p.coords.speed,
        heading: p.coords.heading,
        timestamp: p.timestamp,
        simulated: false,
      }),
      error => onGeolocationError(error),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );

    watch = navigator.geolocation.watchPosition(
      p => handleGpsFix({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: p.coords.accuracy,
        altitude: p.coords.altitude,
        speed: p.coords.speed,
        heading: p.coords.heading,
        timestamp: p.timestamp,
        simulated: false,
      }),
      error => onGeolocationError(error),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    );
  }

  /**
   * Jednotný průběh průzkumu pro skutečnou chůzi i autopilota (Body 7, 8, 16, 19, 28, 30, 31, 32):
   * přijatá poloha -> odkrytí území a přírodních objektů -> potvrzení zastávek (< 20 m) -> překreslení mapy -> uložení.
   */
  function showArrivalGoalModal() {
    const modal = $('arrival-goal-modal');
    if (!modal) return;
    modal.hidden = false;
    triggerPocketProximityAlert('stamp');
  }

  function sample(fix, now = Date.now()) {
    if (disposed || (walkState !== 'running' && !demo)) return;
    if (walkState === 'paused' || (currentExpedition && currentExpedition.state === 'paused')) return;

    // 8.3 Background Gap Recovery: Pokud v kapse vznikla mezera > 12 s (do 3 km rychlostí <= 3.5 m/s),
    // dopočítáme body podél naplánované trasy, odkryjeme mlhu, přičteme metry a uznáme zastávky!
    if (lastSampledFix && !fix.interpolated && (now - lastSampledFix.ts) > 12000 && fix.accuracy <= MAX_GPS_ACCURACY_M) {
      const gapRes = interpolateBackgroundGap({
        prevFix: lastSampledFix,
        nextFix: { lat: fix.lat, lng: fix.lng, ts: now },
        plannedCoords: plannedRouteCoords || [],
      });
      if (gapRes.recovered && gapRes.points.length > 1) {
        for (let i = 0; i < gapRes.points.length - 1; i++) {
          const pt = gapRes.points[i];
          const stepRes = acceptFix(progress, anchor, { lat: pt.lat, lng: pt.lng, accuracy: 12, simulated: fix.simulated, interpolated: true }, pt.ts);
          anchor = stepRes.anchor;
          if (stepRes.accepted) {
            progress = {
              ...progress,
              cells: stepRes.progress.cells,
              meters: stepRes.progress.meters,
              walkSegments: stepRes.progress.walkSegments || progress.walkSegments,
            };
          }
          const plannedForGap = getPlannedPlaces();
          if (plannedForGap.length > 0) {
            for (const sp of plannedForGap) {
              if (!confirmedStopIds.has(sp.id) && (haversineMeters(pt, sp) ?? Infinity) <= 35) {
                confirmedStopIds.add(sp.id);
                if (currentExpedition) {
                  currentExpedition = recordExpeditionVisit(currentExpedition, sp);
                  stateObj.activeExpedition = currentExpedition;
                }
              }
            }
          }
        }
      }
    }
    if (fix.accuracy <= MAX_GPS_ACCURACY_M) {
      lastSampledFix = { lat: fix.lat, lng: fix.lng, ts: now };
    }

    const effectiveFixTime = fix?.simulated ? (fix.timestamp || now) : now;
    const result = acceptFix(progress, anchor, fix, effectiveFixTime);
    anchor = result.anchor;

    telemetry = updateTelemetryFromFix(telemetry, fix, result, now);
    updateGpsTelemetryUi(fix, Boolean(result.pausedByAccuracy));

    if (!result.eligibleForVisit) {
      pendingPlaceStamps = {};
      pendingStopSamples = {};
    }

    const validFix = result.eligibleForVisit ? (result.anchor?.lastValidFix || fix) : null;
    let stateChanged = false;

    if (validFix && fix.accuracy <= MAX_GPS_ACCURACY_M) {
      memoryTrail = appendTrail(memoryTrail, validFix, now);

      const natEval = evaluateNaturalFeatureReveals(validFix, progress.revealedFeatures, BUILTIN_NATURAL_FEATURES);
      activeLocalReveals = natEval.activeLocalReveals || [];
      if (natEval.newlyRevealedFeatures.length > 0) {
        stateChanged = true;
        progress = {
          ...progress,
          revealedFeatures: natEval.revealedFeatureIds,
        };
        stateObj.revealedFeatures = progress.revealedFeatures;
        const pondNames = natEval.newlyRevealedFeatures.map(f => f.title).join(', ');
        status(`💧 Odhalena celá vodní plocha: ${pondNames}.`);
      }

      // 8.4 Vibrace v kapse, zaznamenání poblíž (dle GPS) a zvuk při přiblížení k zastávce (< 35 m)
      const plannedPlaces = getPlannedPlaces();
      if (plannedPlaces.length > 0) {
        for (const sp of plannedPlaces) {
          const dToStop = haversineMeters(validFix, sp) ?? Infinity;
          if (!confirmedStopIds.has(sp.id) && dToStop <= NEARBY_RECORD_RADIUS_M) {
            nearbyRecordedIds.add(sp.id);
          }
          if (!confirmedStopIds.has(sp.id) && !alertedProximityStopIds.has(sp.id)) {
            if (dToStop < 35) {
              alertedProximityStopIds.add(sp.id);
              vibrateStopArrival(appSettings.hapticFeedback !== false);
              triggerPocketProximityAlert('proximity', appSettings.hapticFeedback !== false);
            }
          }
        }

        const stopEval = evaluateStopConfirmation(validFix, plannedPlaces, pendingStopSamples, confirmedStopIds, now);
        if (stopEval.newlyConfirmedIds.length > 0) {
          stateChanged = true;
          for (const stopId of stopEval.newlyConfirmedIds) {
            confirmedStopIds.add(stopId);
            justConfirmedStopId = stopId;
            const stopPlace = plannedPlaces.find(p => p.id === stopId);
            if (stopPlace) {
              if (currentExpedition) {
                currentExpedition = recordExpeditionVisit(currentExpedition, stopPlace);
                stateObj.activeExpedition = currentExpedition;
              }
              if (stopPlace.collectible !== false && !hasLifetimeStamp(stopPlace)) {
                progress = {
                  ...progress,
                  discoveries: [...progress.discoveries, stopId],
                };
                stateObj = recordSummitEntry(stateObj, stopId);
              }
            }
          }
          stateObj.confirmedStopIds = [...confirmedStopIds];
          stateObj.discoveries = progress.discoveries;

          vibrateStopArrival(appSettings.hapticFeedback !== false);
          playStampChord(stateObj.soundEnabled);
          triggerPocketProximityAlert('stamp', appSettings.hapticFeedback !== false);

          const confirmedNames = stopEval.newlyConfirmedStops.map(s => s.title).join(', ');
          animateStampEarned(confirmedNames, {
            totalStamps: progress.discoveries.length,
            mapContainer: root.querySelector('.walk-map-wrap'),
          });
          const nextStop = getPlannedPlaces().find(p => !isStopVisitedInSession(p));
          speakCzechNav(
            nextStop
              ? `Potvrzeno podle GPS: ${confirmedNames}. Další zastávka: ${nextStop.title}.`
              : `Potvrzeno podle GPS: ${confirmedNames}. Jsi v cíli své trasy!`,
            `stamp:${stopEval.newlyConfirmedIds.join(',')}`
          );
          status(
            nextStop
              ? `📍 Potvrzeno podle GPS (≤ ${STOP_CONFIRM_RADIUS_M} m): ${confirmedNames}. Další cíl: ${nextStop.title}.`
              : `🎉 Jsi v cíli své trasy — 📍 Potvrzeno podle GPS (${confirmedNames})!`
          );

          // 1.2 Krok 4: Jakmile uživatel během výpravy projde posledním vybraným bodem trasy (dosažen cíl),
          // automaticky zobrazíme velké, přehledné dialogové okno!
          if (!nextStop) {
            const routeFinishKey = plannedPlaces.map(p => p.id).join(',');
            if (arrivalGoalPromptShownForKey !== routeFinishKey) {
              arrivalGoalPromptShownForKey = routeFinishKey;
              showArrivalGoalModal();
            }
          }
        }
      }

      // 3. Kontrola GPS razítek a odhalení Tajemných siluet v mlze při přiblížení na <= 25 m
      const allPlaces = getAllAvailablePlaces();
      let stampedProgress = discoverNearby(progress, validFix, allPlaces, pendingPlaceStamps);
      for (const cand of allPlaces) {
        if (!cand || !cand.id || cand.pointKind === 'route-start') continue;
        if (!stampedProgress.discoveries.includes(cand.id) && !confirmedStopIds.has(cand.id)) {
          const dM = haversineMeters(validFix, cand);
          if (dM !== null && dM <= 25) {
            stampedProgress = {
              ...stampedProgress,
              discoveries: [...stampedProgress.discoveries, cand.id],
            };
          }
        }
      }

      if (stampedProgress.discoveries.length > progress.discoveries.length) {
        stateChanged = true;
        const addedCount = stampedProgress.discoveries.length - progress.discoveries.length;
        const newStampIds = stampedProgress.discoveries.filter(id => !progress.discoveries.includes(id));
        const revealedTitles = [];
        for (const newId of newStampIds) {
          stateObj = recordSummitEntry(stateObj, newId);
          confirmedStopIds.add(newId);
          justConfirmedStopId = newId;
          justDiscoveredFlipIds.add(newId);
          const foundPlace = allPlaces.find(p => p.id === newId);
          if (foundPlace?.title) revealedTitles.push(foundPlace.title);
          if (foundPlace && currentExpedition) {
            currentExpedition = recordExpeditionVisit(currentExpedition, foundPlace);
            stateObj.activeExpedition = currentExpedition;
          }
        }
        vibrateStampRecorded(appSettings.hapticFeedback !== false);
        playStampChord(stateObj.soundEnabled);
        triggerPocketProximityAlert('stamp', appSettings.hapticFeedback !== false);
        progress = { ...progress, discoveries: stampedProgress.discoveries };
        stateObj = { ...stateObj, discoveries: progress.discoveries, confirmedStopIds: [...confirmedStopIds] };
        animateStampEarned(revealedTitles.join(', '), {
          totalStamps: progress.discoveries.length,
          mapContainer: root.querySelector('.walk-map-wrap'),
        });

        // DÁVKA 4: Idempotentní zápis získaných GPS razítek do pointsLedger a vyhodnocení 8 milníků
        if (!simSandboxActive && !demo) {
          for (const newId of newStampIds) {
            const foundPlace = allPlaces.find(p => p.id === newId);
            stateObj.pointsLedger = recordGpsPlaceInLedger(stateObj.pointsLedger, newId, foundPlace?.title || '');
          }
          const milestoneRes = evaluateMilestones(stateObj);
          stateObj.pointsLedger = milestoneRes.updatedLedger;
        }

        const placeNameNote = revealedTitles.length > 0 ? `: ${revealedTitles.join(', ')}` : '';
        status(`🏆 Tajemné místo odhaleno${placeNameNote}! +${addedCount * 30} bodů.`);
      }

      // 4. Radar upozornění
      if (stateObj.explorationMode === 'radar') {
        const plannedIds = plannedRoute.selectedPlaceIds || [];
        const nearbyUnplanned = allPlaces.find(p => {
          if (!p.collectible || plannedIds.includes(p.id) || isStopVisitedInSession(p)) return false;
          const d = haversineMeters(validFix, p);
          return d != null && d <= 150;
        });

        if (nearbyUnplanned && nearbyUnplanned.id !== lastRadarAlertId) {
          lastRadarAlertId = nearbyUnplanned.id;
          playRadar(stateObj.soundEnabled);
          const banner = $('walk-radar-banner');
          if (banner) {
            banner.hidden = false;
            banner.innerHTML = `
              <span>📡 <strong>Radar poblíž:</strong> ${e(nearbyUnplanned.title)} je v dosahu cca ${Math.round(haversineMeters(validFix, nearbyUnplanned))} m!</span>
              <button type="button" class="button small lime add-radar-place-btn" data-place-id="${e(nearbyUnplanned.id)}">+ Přidat do trasy</button>
            `;
          }
        }
      }
    }

    if (result.accepted) {
      stateChanged = true;
      progress = {
        ...progress,
        cells: result.progress.cells,
        meters: result.progress.meters,
        walkSegments: result.progress.walkSegments || progress.walkSegments,
        revealedFeatures: progress.revealedFeatures,
      };
      stateObj = {
        ...stateObj,
        cells: progress.cells,
        meters: progress.meters,
        discoveries: progress.discoveries,
        walkSegments: progress.walkSegments,
        revealedFeatures: progress.revealedFeatures,
        confirmedStopIds: [...confirmedStopIds],
      };
    }

    if (stateChanged && canPersistRealState(fix)) {
      try {
        stateObj = saveState(stateObj);
        storageError = '';
      } catch (error) {
        storageError = error.message;
        pauseSession('Uložení se nezdařilo: ' + error.message);
        return;
      }
    }

    stats();
    if (stateChanged || result.accepted) {
      const movedSincePlaceRenderM = (validFix && lastPlacesRenderPlayerPos)
        ? (haversineMeters(lastPlacesRenderPlayerPos, validFix) ?? 999)
        : 999;
      if (justConfirmedStopId || movedSincePlaceRenderM >= 30 || !lastPlacesRenderPlayerPos) {
        if (validFix && Number.isFinite(validFix.lat) && Number.isFinite(validFix.lng)) {
          lastPlacesRenderPlayerPos = { lat: validFix.lat, lng: validFix.lng };
        }
        renderPlaces({ skipListRebuild: true });
      }
      scheduleFog();
      renderTrail();
    }
    updateTurnNavPill(validFix || fix);
    updatePlayerLead(validFix || fix);

    if (!result.accepted) {
      status(result.reason);
      return;
    }

    if (!justConfirmedStopId) {
      status(`Procházka běží · ${result.reason} Přesnost GPS ±${Math.round(fix.accuracy)} m · Dosah odkrývání ${FOG_REVEAL_RADIUS_M} m.`);
    }
    justConfirmedStopId = null;
  }

  function updateTopBarUi() {
    renderPhase1AndPhase4Ui(lastFix || telemetry.lastKnownPosition);
  }

  function updateMapActionBar() {
    const isStarted = walkState === 'locating' || walkState === 'running' || walkState === 'paused' || Boolean(demo);
    const inactiveGrp = $('mab-inactive-group');
    const activeGrp = $('mab-active-group');
    if (inactiveGrp) inactiveGrp.hidden = isStarted;
    if (activeGrp) activeGrp.hidden = !isStarted;

    const pauseBtn = $('walk-pause');
    if (pauseBtn) {
      const isPaused = walkState === 'paused' || currentExpedition?.state === 'paused';
      pauseBtn.textContent = isPaused ? '▶ Pokračovat' : '⏸ Pauza';
      pauseBtn.setAttribute('aria-label', isPaused ? 'Pokračovat v procházce' : 'Pozastavit procházku');
    }
    const topPauseBtn = $('btn-top-pause');
    if (topPauseBtn) {
      topPauseBtn.hidden = !isStarted;
      const isPaused = walkState === 'paused' || currentExpedition?.state === 'paused';
      topPauseBtn.textContent = isPaused ? '▶ Pokračovat' : '⏸ Pauza';
    }
  }

  async function startUnifiedExpedition(source = 'button') {
    if (disposed) return;
    if (walkState === 'running' && active && currentExpedition && currentExpedition.state === 'active') {
      return;
    }

    gpsBrowseOnlyMode = false;
    if ($('walk-accuracy-banner')) $('walk-accuracy-banner').hidden = true;
    follow = true;
    updateFollowUi();
    unlockSpeechSynthesis();

    if (simSandboxActive) {
      if (!currentExpedition || currentExpedition.state === 'ended') {
        confirmedStopIds = new Set();
        stateObj.confirmedStopIds = [];
        telemetry = createTelemetryState(Date.now());
        currentExpedition = createExpedition({ progress, goal: DEFAULT_GOALS[0] });
      } else if (currentExpedition.state === 'paused') {
        currentExpedition = resumeExpedition(currentExpedition);
        telemetry.lastTickMs = Date.now();
      }
      stateObj.activeExpedition = currentExpedition;
      walkState = 'running';
      active = true;
      starting = false;
      anchor = null;
      lockedExpeditionOrigin = plannedRoute.origin
        ? { ...plannedRoute.origin }
        : (lastFix ? { id: 'start-gps', label: 'Místo startu', lat: lastFix.lat, lng: lastFix.lng } : null);
      expeditionStartPoint = lockedExpeditionOrigin ? { ...lockedExpeditionOrigin } : null;
      if (lastFix) centerMapOnPlayer(lastFix, false);
      keepAliveCtrl.start('Czekpoint Simulátor aktivní');
      startBackgroundTracking({
        title: 'Výprava běží (Simulátor)',
        artist: 'Czekpoint GPS aktivní',
        album: 'Záznam chůze i při zhasnutém displeji',
        onPause: () => { togglePauseUnified(); },
        onResume: () => { togglePauseUnified(); },
        onStop: () => { finishUnifiedExpedition(); },
        onTick: () => { keepAliveCtrl.triggerManualTick?.(); },
      });
      holdWake();
      updateMapActionBar();
      updateTopBarUi();
      stats();
      status('Výprava běží (testovací simulátor GPS v izolovaném paměťovém prostoru).');
      return;
    }

    stateObj = loadState();
    progress = {
      version: 1,
      cells: [...(stateObj.cells || [])],
      meters: Number(stateObj.meters) || 0,
      discoveries: [...(stateObj.discoveries || [])],
      walkSegments: Array.isArray(stateObj.walkSegments) ? stateObj.walkSegments.map(s => [...s]) : [],
      revealedFeatures: Array.isArray(stateObj.revealedFeatures) ? [...stateObj.revealedFeatures] : [],
    };

    if (!currentExpedition || currentExpedition.state === 'ended') {
      confirmedStopIds = new Set();
      stateObj.confirmedStopIds = [];
      telemetry = createTelemetryState(Date.now());
      currentExpedition = createExpedition({ progress, goal: DEFAULT_GOALS[0] });
    } else if (currentExpedition.state === 'paused') {
      confirmedStopIds = new Set(Array.isArray(stateObj.confirmedStopIds) ? stateObj.confirmedStopIds : []);
      currentExpedition = resumeExpedition(currentExpedition);
      telemetry.lastTickMs = Date.now();
    }

    stateObj.activeExpedition = currentExpedition;
    if (canPersistRealState()) {
      try {
        stateObj = saveState(stateObj);
        storageError = '';
      } catch (err) {
        starting = false;
        walkState = 'idle';
        storageError = err.message;
        stats();
        status('Uložení se nezdařilo: ' + err.message);
        return;
      }
    }

    anchor = null;
    follow = true;
    updateFollowUi();

    // DÁVKA 2 (Bod 3.2): Zamknutý start okruhu při zahájení — pohyb hráče v handleGpsFix nikdy nesmí přepsat start okruhu!
    if (!lockedExpeditionOrigin) {
      const fallbackStart = lastAcceptedFix && !lastAcceptedFix.simulated
        ? { id: 'start-gps', label: 'Místo startu', lat: lastAcceptedFix.lat, lng: lastAcceptedFix.lng }
        : (plannedRoute.origin ? { ...plannedRoute.origin } : { ...START_PRESETS[0] });
      lockedExpeditionOrigin = plannedRoute.origin ? { ...plannedRoute.origin } : fallbackStart;
    }
    if (!expeditionStartPoint && lockedExpeditionOrigin) {
      expeditionStartPoint = { ...lockedExpeditionOrigin };
    }

    // DÁVKA 1 (Bod 2.1): Kritické pravidlo — dokud prohlížeč nevrátí platnou GPS polohu,
    // jsme ve stavu 'locating' (nepřičítáme čas ani metry) a zobrazujeme indikátor v mapě.
    if (lastAcceptedFix && !lastAcceptedFix.simulated && (Date.now() - (lastAcceptedFix.timestamp || 0)) < 15000) {
      walkState = 'running';
      starting = false;
      active = true;
      telemetry.lastTickMs = Date.now();
      centerMapOnPlayer(lastAcceptedFix, false);
    } else {
      walkState = 'locating';
      starting = true;
      active = false;
      if (gpsLocatingTaskId === null) {
        gpsLocatingTaskId = beginMapTask('⏳ Čekám na polohu GPS…');
      }
    }

    updateMapActionBar();
    updateTopBarUi();
    stats();
    playStampChord(stateObj.soundEnabled);

    if (source !== 'sim') {
      keepAliveCtrl.start('Czekpoint GPS aktivní');
      startBackgroundTracking({
        title: walkState === 'locating' ? 'Hledám polohu GPS…' : 'Výprava běží',
        artist: 'Czekpoint GPS aktivní',
        album: 'Záznam chůze i při zhasnutém displeji',
        onPause: () => { togglePauseUnified(); },
        onResume: () => { togglePauseUnified(); },
        onStop: () => { finishUnifiedExpedition(); },
        onTick: () => { keepAliveCtrl.triggerManualTick?.(); },
      });
      if (isSecureContext && navigator.geolocation) {
        status(walkState === 'locating'
          ? '⏳ Hledám polohu GPS (záznam začne po zaměření)…'
          : `▶ Procházka běží (GPS ≤ ${MAX_GPS_ACCURACY_M} m, dosah ${FOG_REVEAL_RADIUS_M} m)…`);
        lastFixReceivedAt = Date.now();
        restartGpsWatch();
        startWatchdog();
        holdWake();
      } else {
        if (gpsLocatingTaskId !== null) {
          endMapTask(gpsLocatingTaskId);
          gpsLocatingTaskId = null;
        }
        status('⏳ Hledám polohu GPS (záznam začne po zaměření)… Na PC můžeš zapnout 🧪 Testovací simulátor GPS.');
      }
    }
  }
  const start = startUnifiedExpedition;

  // Tik na pozadí (z Web Workeru / Audio smyčky) udržuje pohyb postavičky i hlasovou navigaci při zhasnutém displeji
  keepAliveCtrl.onTick((now) => {
    if (disposed) return;
    if (simSandboxActive && fakeGpsSim && fakeGpsSim.isOpen && walkState !== 'paused') {
      fakeGpsSim.triggerLoopTick?.(now);
    }
    if (walkState === 'running' || demo) {
      renderTouristStatsHud(lastFix);
      updateTurnNavPill(lastFix);
    }
  });

  let lastApplied3DModeStateKey = null;

  // Inicializace jediné mapy MapLibre GL JS (verze 4.7.1) — 3D terén a 3D budovy se přidávají/odebírají striktně při přepnutí režimu
  function ensureCustomMapSourcesAndLayers(options = {}) {
    if (!map || typeof map.getSource !== 'function') return;
    try {
      if (!map.getSource('radius-circle-source')) {
        map.addSource('radius-circle-source', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer('radius-circle-fill')) {
        map.addLayer({
          id: 'radius-circle-fill',
          type: 'fill',
          source: 'radius-circle-source',
          paint: {
            'fill-color': '#2f6f4e',
            'fill-opacity': 0.04,
          },
        });
      }
      if (!map.getLayer('radius-circle-line')) {
        map.addLayer({
          id: 'radius-circle-line',
          type: 'line',
          source: 'radius-circle-source',
          paint: {
            'line-color': '#2f6f4e',
            'line-width': 1.5,
            'line-opacity': 0.35,
            'line-dasharray': [4, 4],
          },
        });
      }

      // Vrstva KČT používá výhradně přesnou rastrovou vrstvu waymarked-hiking-layer (žádné umělé čáry z PILOT_HIKING_TRAILS)

      if (!map.getSource('walked-segments-source')) {
        map.addSource('walked-segments-source', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer('walked-segments-casing')) {
        map.addLayer({
          id: 'walked-segments-casing',
          type: 'line',
          source: 'walked-segments-source',
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#ffffff',
            'line-width': 7,
            'line-opacity': 0.65,
          },
        });
      }
      if (!map.getLayer('walked-segments-line')) {
        map.addLayer({
          id: 'walked-segments-line',
          type: 'line',
          source: 'walked-segments-source',
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#1f6f43',
            'line-width': 4.5,
            'line-opacity': 0.92,
          },
        });
      }

      if (!map.getSource('footprints-source')) {
        map.addSource('footprints-source', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer('footprints-layer')) {
        map.addLayer({
          id: 'footprints-layer',
          type: 'circle',
          source: 'footprints-source',
          paint: {
            'circle-radius': 4,
            'circle-color': '#5c4028',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.2,
            'circle-opacity': ['coalesce', ['get', 'opacity'], 0.75],
            'circle-pitch-alignment': 'map',
          },
        });
      }

      if (!map.getSource('planned-route-source')) {
        map.addSource('planned-route-source', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer('planned-route-casing')) {
        map.addLayer({
          id: 'planned-route-casing',
          type: 'line',
          source: 'planned-route-source',
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': ['coalesce', ['get', 'casingColor'], '#2e1065'],
            'line-width': ['coalesce', ['get', 'casingWidth'], 9],
            'line-opacity': ['coalesce', ['get', 'casingOpacity'], 0.94],
          },
        });
      }
      if (!map.getLayer('planned-route-line')) {
        map.addLayer({
          id: 'planned-route-line',
          type: 'line',
          source: 'planned-route-source',
          filter: ['!=', ['get', 'isFallback'], true],
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': ['coalesce', ['get', 'lineColor'], '#f5b82e'],
            'line-width': ['coalesce', ['get', 'lineWidth'], 5],
            'line-opacity': ['coalesce', ['get', 'lineOpacity'], 0.98],
          },
        });
      }
      if (!map.getLayer('planned-route-fallback-line')) {
        map.addLayer({
          id: 'planned-route-fallback-line',
          type: 'line',
          source: 'planned-route-source',
          filter: ['==', ['get', 'isFallback'], true],
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': ['coalesce', ['get', 'lineColor'], '#9333ea'],
            'line-width': ['coalesce', ['get', 'lineWidth'], 5],
            'line-opacity': ['coalesce', ['get', 'lineOpacity'], 0.92],
            'line-dasharray': [2, 2],
          },
        });
      }

      if (!map.getSource('accuracy-ring-source')) {
        map.addSource('accuracy-ring-source', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer('accuracy-ring-fill')) {
        map.addLayer({
          id: 'accuracy-ring-fill',
          type: 'fill',
          source: 'accuracy-ring-source',
          paint: {
            'fill-color': '#218bea',
            'fill-opacity': 0.12,
          },
        });
      }
      if (!map.getLayer('accuracy-ring-line')) {
        map.addLayer({
          id: 'accuracy-ring-line',
          type: 'line',
          source: 'accuracy-ring-source',
          paint: {
            'line-color': '#218bea',
            'line-width': 1.5,
            'line-opacity': 0.75,
          },
        });
      }

      if (!map.getSource('czekpoint-fog-source')) {
        const initCenter = lastFix || telemetry.lastKnownPosition || getRouteOriginPoint() || { lat: 49.6014, lng: 13.8644 };
        fogGeographicBounds = computeFogGeographicBounds(initCenter, {
          walkSegments: progress.walkSegments,
          cells: progress.cells,
        });
        map.addSource('czekpoint-fog-source', {
          type: 'image',
          url: EMPTY_TRANSPARENT_PNG,
          coordinates: fogGeographicBounds.coordinates,
        });
      }
      if (!map.getLayer('czekpoint-fog-layer')) {
        const beforeLayerId = map.getLayer('czekpoint-3d-forests')
          ? 'czekpoint-3d-forests'
          : map.getLayer('czekpoint-3d-buildings')
          ? 'czekpoint-3d-buildings'
          : map.getLayer('planned-route-casing')
          ? 'planned-route-casing'
          : map.getLayer('walked-segments-casing')
          ? 'walked-segments-casing'
          : undefined;

        map.addLayer(
          {
            id: 'czekpoint-fog-layer',
            type: 'raster',
            source: 'czekpoint-fog-source',
            paint: {
              'raster-opacity': fogMode === 'none' ? 0 : (fogMode === 'full' ? 0.94 : 0.82),
              'raster-fade-duration': 0,
              'raster-resampling': 'linear',
            },
          },
          beforeLayerId
        );
      }

      const active3d = Boolean(is3dMode || is3DMode);
      const showBuildings = appSettings.show3dBuildings !== false;
      const target3DStateKey = `${active3d ? '3d' : '2d'}:${showBuildings ? 'b1' : 'b0'}`;
      const force3DSync = Boolean(options && options.force3DSync);

      if (force3DSync || lastApplied3DModeStateKey !== target3DStateKey) {
        if (active3d) {
          if (!map.getSource('terrain-dem')) {
            map.addSource('terrain-dem', {
              type: 'raster-dem',
              tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
              encoding: 'terrarium',
              tileSize: 256,
              maxzoom: 14,
            });
          }
          if (!map.getSource('hillshade-dem')) {
            map.addSource('hillshade-dem', {
              type: 'raster-dem',
              tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
              encoding: 'terrarium',
              tileSize: 256,
              maxzoom: 14,
            });
          }
          if (!map.getSource('openfreemap-v')) {
            map.addSource('openfreemap-v', {
              type: 'vector',
              url: config?.openFreeMapVectorUrl || 'https://tiles.openfreemap.org/planet',
            });
          }

          if (!map.getLayer('terrain-hillshade')) {
            const hillshadeBefore = map.getLayer('opentopo-raster-layer')
              ? 'opentopo-raster-layer'
              : map.getLayer('waymarked-hiking-layer')
              ? 'waymarked-hiking-layer'
              : map.getLayer('czekpoint-fog-layer')
              ? 'czekpoint-fog-layer'
              : undefined;
            map.addLayer(
              {
                id: 'terrain-hillshade',
                type: 'hillshade',
                source: 'hillshade-dem',
                minzoom: 0,
                maxzoom: 22,
                layout: {
                  visibility: 'visible',
                },
                paint: {
                  'hillshade-exaggeration': 0.65,
                  'hillshade-shadow-color': '#142f24',
                  'hillshade-highlight-color': '#fffef5',
                  'hillshade-accent-color': '#b58938',
                },
              },
              hillshadeBefore
            );
          } else {
            try { map.setLayoutProperty('terrain-hillshade', 'visibility', 'visible'); } catch {}
          }

          if (!map.getLayer('czekpoint-3d-buildings')) {
            const buildingsBefore = map.getLayer('planned-route-casing')
              ? 'planned-route-casing'
              : map.getLayer('walked-segments-casing')
              ? 'walked-segments-casing'
              : undefined;
            map.addLayer(
              {
                id: 'czekpoint-3d-buildings',
                source: 'openfreemap-v',
                'source-layer': 'building',
                type: 'fill-extrusion',
                minzoom: 13,
                maxzoom: 22,
                layout: {
                  visibility: showBuildings ? 'visible' : 'none',
                },
                paint: {
                  'fill-extrusion-color': '#d8cfc0',
                  'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 9],
                  'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
                  'fill-extrusion-opacity': 0.72,
                },
              },
              buildingsBefore
            );
          } else {
            try {
              map.setLayoutProperty('czekpoint-3d-buildings', 'visibility', showBuildings ? 'visible' : 'none');
            } catch {}
          }

          try {
            map.setTerrain({ source: 'terrain-dem', exaggeration: DEFAULT_TERRAIN_EXAGGERATION });
            appliedTerrain3D = true;
          } catch {}
        } else {
          try {
            map.setTerrain(null);
            appliedTerrain3D = false;
          } catch {}
          if (map.getLayer('terrain-hillshade')) {
            try { map.setLayoutProperty('terrain-hillshade', 'visibility', 'none'); } catch {}
          }
          if (map.getLayer('czekpoint-3d-buildings')) {
            try { map.setLayoutProperty('czekpoint-3d-buildings', 'visibility', 'none'); } catch {}
          }
        }
        lastApplied3DModeStateKey = target3DStateKey;
      }
    } catch {}
  }

  function verify3DMapState(context = 'switch') {
    if (!map) return { ok: false, reason: 'map_missing' };
    const hasTerrainDem = Boolean(typeof map.getSource === 'function' && map.getSource('terrain-dem'));
    const hasHillshadeDem = Boolean(typeof map.getSource === 'function' && map.getSource('hillshade-dem'));
    const hasOpenFreeMap = Boolean(typeof map.getSource === 'function' && map.getSource('openfreemap-v'));
    const hasTerrainHillshade = Boolean(typeof map.getLayer === 'function' && map.getLayer('terrain-hillshade'));
    const hasBuildings = Boolean(typeof map.getLayer === 'function' && map.getLayer('czekpoint-3d-buildings'));
    const terrainObj = typeof map.getTerrain === 'function' ? map.getTerrain() : null;
    const isTerrainActive = Boolean(terrainObj && terrainObj.source === 'terrain-dem');
    const curPitch = typeof map.getPitch === 'function' ? Number(map.getPitch().toFixed(1)) : 0;
    const ok = is3DMode ? (hasTerrainDem && isTerrainActive) : (!hasTerrainDem && !terrainObj);

    const result = {
      ok,
      context,
      is3DMode,
      hasTerrainDem,
      hasHillshadeDem,
      hasOpenFreeMap,
      hasTerrainHillshade,
      hasBuildings,
      terrain: terrainObj,
      pitch: curPitch,
    };

    if (typeof window !== 'undefined') {
      window.__map = map;
      window.__czekpointLast3DCheck = result;
      window.czekpointVerify3DState = () => verify3DMapState('manual');
    }

    return result;
  }

  function update3DUiState() {
    const toggleBtn = $('btn-toggle-3d');
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-pressed', String(is3DMode));
      toggleBtn.classList.toggle('active', is3DMode);
      toggleBtn.innerHTML = `<span class="btn-3d-label" id="btn-toggle-3d-label">${is3DMode ? '2.5D' : '2D'}</span>`;
      toggleBtn.title = 'Přepnout 2D a 2.5D pohled';
    }
    $('walk-map-wrap')?.classList.toggle('is-3d-mode', is3DMode);
    updatePlayerAvatarIcon(Boolean(active || demo || simSandboxActive));
    syncTurnPillCompassBearing();
  }

  function enableAllMapInteractions() {
    if (!map) return;
    try {
      map.dragPan?.enable?.();
      map.touchZoomRotate?.enable?.();
      map.dragRotate?.enable?.();
      map.touchPitch?.enable?.();
    } catch {}
  }

  function sync3DBuildingsLayerState() {
    if (!map || typeof map.getLayer !== 'function') return;
    ensureCustomMapSourcesAndLayers({ force3DSync: true });
  }

  function setMap3DMode(enable3D, opts = {}) {
    if (!map) return;
    const next3D = Boolean(enable3D);
    is3DMode = next3D;
    is3dMode = next3D;
    enableAllMapInteractions();

    if (next3D) {
      const padding = getMapCameraPadding();
      const styleReady = typeof map.isStyleLoaded === 'function' ? map.isStyleLoaded() : true;
      if (!styleReady) {
        update3DUiState();
        try {
          map.easeTo({
            pitch: DEFAULT_3D_PITCH,
            zoom: Math.max(map.getZoom(), 16.2),
            padding,
            duration: opts.instant ? 0 : 550,
          });
        } catch {}
        if (!opts.silent) {
          status('🏔️ Přepnuto na 2.5D pohled (náklon 52°).');
        }
        return;
      }
      try {
        ensureCustomMapSourcesAndLayers({ force3DSync: true });
        try {
          map.setTerrain({ source: 'terrain-dem', exaggeration: DEFAULT_TERRAIN_EXAGGERATION });
          appliedTerrain3D = true;
        } catch {}
        sync3DBuildingsLayerState();
        update3DUiState();
        drawFog(true);
        map.easeTo({
          pitch: DEFAULT_3D_PITCH,
          zoom: Math.max(map.getZoom(), 16.2),
          padding: getMapCameraPadding(),
          duration: opts.instant ? 0 : 550,
        });
        if (!opts.silent) {
          status('🏔️ Přepnuto na 2.5D terénní pohled (náklon 52°).');
        }
        verify3DMapState('setMap3DMode');
      } catch {
        is3DMode = false;
        is3dMode = false;
        appliedTerrain3D = false;
        ensureCustomMapSourcesAndLayers({ force3DSync: true });
        try { map.easeTo({ pitch: 0, padding: getMapCameraPadding(), duration: 300 }); } catch {}
        update3DUiState();
        status('2.5D terén není momentálně dostupný, pokračuji ve 2D zobrazení.');
        verify3DMapState('fallback2D');
      }
    } else {
      is3DMode = false;
      is3dMode = false;
      try {
        ensureCustomMapSourcesAndLayers({ force3DSync: true });
        drawFog(true);
      } catch {}
      update3DUiState();
      try {
        map.easeTo({
          pitch: 0,
          bearing: followHeadingMode ? map.getBearing() : 0,
          padding: getMapCameraPadding(),
          duration: opts.instant ? 0 : 450,
        });
      } catch {}
      if (!opts.silent) {
        status(opts.fallbackMessage || '🗺️ Přepnuto na 2D pohled shora.');
      }
      verify3DMapState('setMap2DMode');
    }
  }

  // DÁVKA 4 (Bod 1.1): Ošetření nedostupného WebGL nebo ztráty grafického kontextu (webglcontextlost / webglcontextrestored)
  function showWebGLErrorBanner(reason = '') {
    const banner = $('webgl-error-banner');
    if (banner) {
      banner.innerHTML = buildWebGLErrorBannerHtml(reason);
      banner.hidden = false;
    }
    status('⚠️ Mapu se nepodařilo vykreslit (WebGL). Záznam procházky i uložená data jsou v bezpečí.');
  }

  function hideWebGLErrorBanner() {
    const banner = $('webgl-error-banner');
    if (banner) {
      banner.hidden = true;
      banner.innerHTML = '';
    }
  }

  function hardenMapLibreInternals(mapInstance, fallbackCenter) {
    if (!mapInstance) return;
    const safeDefaultLng = Number.isFinite(Number(fallbackCenter?.lng)) ? Number(fallbackCenter.lng) : 13.8644;
    const safeDefaultLat = Number.isFinite(Number(fallbackCenter?.lat)) ? Number(fallbackCenter.lat) : 49.6014;

    // 1. Ochrana interních front úloh (_renderTaskQueue / _taskQueue) proti re-entrantnímu volání a uváznutí _currentlyRunning
    for (const queueKey of ['_renderTaskQueue', '_taskQueue']) {
      const q = mapInstance[queueKey];
      if (q && typeof q.run === 'function' && !q.__czekpointHardened) {
        const origRun = q.run.bind(q);
        q.run = function (id) {
          if (this._currentlyRunning) {
            return;
          }
          try {
            return origRun(id);
          } catch {
            // Zabráníme zamrznutí vykreslovací smyčky při výjimce v animaci nebo scrollZoom
          } finally {
            this._currentlyRunning = false;
          }
        };
        q.__czekpointHardened = true;
      }
    }

    const makeSafeLngLat = (lngVal, latVal) => {
      const c = mapInstance.transform?.center;
      const fallbackLng = Number.isFinite(Number(c?.lng)) ? Number(c.lng) : safeDefaultLng;
      const fallbackLat = Number.isFinite(Number(c?.lat)) ? Number(c.lat) : safeDefaultLat;
      const lng = Number.isFinite(Number(lngVal)) ? Number(lngVal) : fallbackLng;
      const lat = Math.max(-85.05112878, Math.min(85.05112878, Number.isFinite(Number(latVal)) ? Number(latVal) : fallbackLat));
      if (maplibregl?.LngLat) {
        try {
          return new maplibregl.LngLat(lng, lat);
        } catch {}
      }
      return {
        lng,
        lat,
        wrap() { return this; },
        toArray() { return [this.lng, this.lat]; },
        toString() { return `LngLat(${this.lng}, ${this.lat})`; }
      };
    };

    const ensureValidLngLat = (candidate) => {
      if (candidate && Number.isFinite(Number(candidate.lng)) && Number.isFinite(Number(candidate.lat))) {
        if (typeof candidate.wrap === 'function') {
          return candidate;
        }
        return makeSafeLngLat(candidate.lng, candidate.lat);
      }
      return makeSafeLngLat(safeDefaultLng, safeDefaultLat);
    };

    const hardenTerrainInstance = (terrainObj) => {
      if (!terrainObj || terrainObj.__czekpointHardened) return;
      terrainObj.__lastSmoothElev = null;
      if (typeof terrainObj.getElevationForLngLatZoom === 'function') {
        const origGetElev = terrainObj.getElevationForLngLatZoom.bind(terrainObj);
        terrainObj.getElevationForLngLatZoom = function (lngLat, zoom) {
          const safeLl = ensureValidLngLat(lngLat);
          const src = this.sourceCache?.getSource?.();
          const maxSourceZoom = Number.isFinite(Number(src?.maxzoom)) ? Number(src.maxzoom) : 14;
          const minSourceZoom = Number.isFinite(Number(src?.minzoom)) ? Number(src.minzoom) : 0;
          const rawZoom = Number.isFinite(Number(zoom))
            ? Math.floor(Number(zoom))
            : Math.min(maxSourceZoom, Math.floor(Number(mapInstance.transform?.tileZoom) || 14));
          const safeZoom = Math.max(minSourceZoom, Math.min(maxSourceZoom, rawZoom));
          try {
            const rawElev = Number(origGetElev(safeLl, safeZoom));
            if (Number.isFinite(rawElev)) {
              this.__lastSmoothElev = rawElev;
              return rawElev;
            }
            return Number.isFinite(this.__lastSmoothElev) ? this.__lastSmoothElev : 0;
          } catch {
            return Number.isFinite(this.__lastSmoothElev) ? this.__lastSmoothElev : 0;
          }
        };
      }
      terrainObj.__czekpointHardened = true;
    };

    // 2. Ochrana transformace proti nulovým rozměrům a NaN souřadnicím v pointCoordinate / pointLocation / coordinateLocation / recalculateZoom
    const tr = mapInstance.transform;
    if (tr && !tr.__czekpointHardened) {
      if (!Number.isFinite(tr.width) || tr.width <= 0 || !Number.isFinite(tr.height) || tr.height <= 0) {
        try {
          const cont = typeof mapInstance.getContainer === 'function' ? mapInstance.getContainer() : null;
          const w = Math.max(320, Number(cont?.clientWidth) || 390);
          const h = Math.max(320, Number(cont?.clientHeight) || 600);
          if (typeof tr.resize === 'function') tr.resize(w, h);
        } catch {}
      }

      if (typeof tr.pointCoordinate === 'function') {
        const origPointCoordinate = tr.pointCoordinate.bind(tr);
        tr.pointCoordinate = function (p, terrain) {
          hardenTerrainInstance(terrain);
          const safeW = Number.isFinite(tr.width) && tr.width > 0 ? tr.width : 390;
          const safeH = Number.isFinite(tr.height) && tr.height > 0 ? tr.height : 600;
          if (!Number.isFinite(tr.width) || tr.width <= 0 || !Number.isFinite(tr.height) || tr.height <= 0) {
            try { tr.resize?.(safeW, safeH); } catch {}
          }
          const px = Number.isFinite(Number(p?.x)) ? Number(p.x) : safeW / 2;
          const py = Number.isFinite(Number(p?.y)) ? Number(p.y) : safeH / 2;
          const safePoint = (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
            ? p
            : { x: px, y: py };
          try {
            const coord = origPointCoordinate(safePoint, terrain);
            if (coord && Number.isFinite(Number(coord.x)) && Number.isFinite(Number(coord.y))) {
              return coord;
            }
          } catch {}
          try {
            const safeCenter = ensureValidLngLat(tr.center);
            if (typeof tr.locationCoordinate === 'function') {
              return tr.locationCoordinate(safeCenter);
            }
            if (maplibregl?.MercatorCoordinate?.fromLngLat) {
              return maplibregl.MercatorCoordinate.fromLngLat(safeCenter, 0);
            }
          } catch {}
          return { x: 0.5, y: 0.5, z: 0, toLngLat: () => ensureValidLngLat(tr.center) };
        };
      }

      if (typeof tr.pointLocation === 'function') {
        const origPointLocation = tr.pointLocation.bind(tr);
        tr.pointLocation = function (p, terrain) {
          hardenTerrainInstance(terrain);
          const safeW = Number.isFinite(tr.width) && tr.width > 0 ? tr.width : 390;
          const safeH = Number.isFinite(tr.height) && tr.height > 0 ? tr.height : 600;
          if (!Number.isFinite(tr.width) || tr.width <= 0 || !Number.isFinite(tr.height) || tr.height <= 0) {
            try { tr.resize?.(safeW, safeH); } catch {}
          }
          const px = Number.isFinite(Number(p?.x)) ? Number(p.x) : safeW / 2;
          const py = Number.isFinite(Number(p?.y)) ? Number(p.y) : safeH / 2;
          const safePoint = (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
            ? p
            : { x: px, y: py };
          try {
            const ll = origPointLocation(safePoint, terrain);
            if (ll && Number.isFinite(Number(ll.lng)) && Number.isFinite(Number(ll.lat))) {
              return ensureValidLngLat(ll);
            }
          } catch {}
          return ensureValidLngLat(tr.center);
        };
      }

      if (typeof tr.coordinateLocation === 'function') {
        const origCoordLocation = tr.coordinateLocation.bind(tr);
        tr.coordinateLocation = function (coord) {
          if (coord && Number.isFinite(Number(coord.x)) && Number.isFinite(Number(coord.y))) {
            try {
              const ll = origCoordLocation(coord);
              if (ll && Number.isFinite(Number(ll.lng)) && Number.isFinite(Number(ll.lat))) {
                return ensureValidLngLat(ll);
              }
            } catch {}
          }
          return ensureValidLngLat(tr.center);
        };
      }

      if (typeof tr.recalculateZoom === 'function') {
        const origRecalculateZoom = tr.recalculateZoom.bind(tr);
        tr.recalculateZoom = function (terrain) {
          hardenTerrainInstance(terrain);
          try {
            return origRecalculateZoom(terrain);
          } catch {}
        };
      }

      tr.__czekpointHardened = true;
    }

    if (mapInstance.terrain) {
      hardenTerrainInstance(mapInstance.terrain);
    }

    if (typeof mapInstance.setTerrain === 'function' && !mapInstance.__czekpointSetTerrainHardened) {
      const origSetTerrain = mapInstance.setTerrain.bind(mapInstance);
      mapInstance.setTerrain = function (options) {
        try {
          const res = origSetTerrain(options);
          if (this.terrain) hardenTerrainInstance(this.terrain);
          return res;
        } catch {}
      };
      mapInstance.__czekpointSetTerrainHardened = true;
    }

    if (typeof mapInstance._finalizeElevation === 'function' && !mapInstance.__czekpointFinalizeElevHardened) {
      const origFinalizeElevation = mapInstance._finalizeElevation.bind(mapInstance);
      mapInstance._finalizeElevation = function () {
        if (this.terrain) hardenTerrainInstance(this.terrain);
        try {
          return origFinalizeElevation();
        } catch {}
      };
      mapInstance.__czekpointFinalizeElevHardened = true;
    }

    // 3. Ochrana map.unproject proti NaN vstupu i výstupu
    if (typeof mapInstance.unproject === 'function' && !mapInstance.__czekpointUnprojectHardened) {
      const origUnproject = mapInstance.unproject.bind(mapInstance);
      mapInstance.unproject = function (point) {
        const safeW = Number.isFinite(mapInstance.transform?.width) && mapInstance.transform.width > 0 ? mapInstance.transform.width : 390;
        const safeH = Number.isFinite(mapInstance.transform?.height) && mapInstance.transform.height > 0 ? mapInstance.transform.height : 600;
        let safePt = point;
        if (Array.isArray(point)) {
          const x = Number.isFinite(Number(point[0])) ? Number(point[0]) : safeW / 2;
          const y = Number.isFinite(Number(point[1])) ? Number(point[1]) : safeH / 2;
          safePt = [x, y];
        } else if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
          safePt = { x: safeW / 2, y: safeH / 2 };
        }
        try {
          const res = origUnproject(safePt);
          if (res && Number.isFinite(Number(res.lng)) && Number.isFinite(Number(res.lat))) {
            return ensureValidLngLat(res);
          }
        } catch {}
        return ensureValidLngLat(mapInstance.transform?.center);
      };
      mapInstance.__czekpointUnprojectHardened = true;
    }

    // 4. Ochrana ScrollZoomHandler (us.wheel / us._start) proti událostem s NaN pozicí nebo při nulové velikosti mapy
    const sz = mapInstance.scrollZoom;
    if (sz && !sz.__czekpointHardened) {
      if (typeof sz.wheel === 'function') {
        const origWheel = sz.wheel.bind(sz);
        sz.wheel = function (e) {
          const w = mapInstance.transform?.width || 0;
          const h = mapInstance.transform?.height || 0;
          if (w <= 0 || h <= 0) return;
          try {
            return origWheel(e);
          } catch {}
        };
      }
      if (typeof sz._start === 'function') {
        const origStart = sz._start.bind(sz);
        sz._start = function (e) {
          const w = Number.isFinite(mapInstance.transform?.width) && mapInstance.transform.width > 0 ? mapInstance.transform.width : 390;
          const h = Number.isFinite(mapInstance.transform?.height) && mapInstance.transform.height > 0 ? mapInstance.transform.height : 600;
          if (!this._pos || !Number.isFinite(Number(this._pos.x)) || !Number.isFinite(Number(this._pos.y))) {
            this._pos = { x: w / 2, y: h / 2 };
          }
          try {
            return origStart(e);
          } catch {}
        };
      }
      sz.__czekpointHardened = true;
    }
  }

  function initializeMapLibreInstance() {
    if (!maplibregl || disposed) return false;
    const webglCheck = checkWebGLSupport();
    if (!webglCheck.supported) {
      showWebGLErrorBanner(webglCheck.reason);
      return false;
    }

    const rawCenter = lastFix || (progress.cells.length ? cellCenter(progress.cells.at(-1)) : { lat: 49.6014, lng: 13.8644 });
    const center = (rawCenter && Number.isFinite(Number(rawCenter.lat)) && Number.isFinite(Number(rawCenter.lng)))
      ? { lat: Number(rawCenter.lat), lng: Number(rawCenter.lng) }
      : { lat: 49.6014, lng: 13.8644 };

    try {
      if (map) {
        try { map.remove(); } catch {}
        map = null;
      }
      const mapContainer = $('walk-map');
      if (mapContainer) mapContainer.innerHTML = '';

      lastApplied3DModeStateKey = null;
      const rawDpr = (typeof window !== 'undefined' && Number(window.devicePixelRatio)) ? Number(window.devicePixelRatio) : 1;
      const safeMobilePixelRatio = Math.min(rawDpr, 1.5);
      map = new maplibregl.Map({
        container: mapContainer,
        style: buildMapLibreStyle(config, { showContourLayer, showHikingTrails, is3dMode, show3dBuildings: appSettings.show3dBuildings !== false }),
        center: [center.lng, center.lat],
        zoom: is3dMode ? 17 : 16.5,
        pitch: is3dMode ? DEFAULT_3D_PITCH : 0,
        bearing: 0,
        minZoom: 3,
        maxZoom: 19,
        maxPitch: 65,
        pixelRatio: safeMobilePixelRatio,
        fadeDuration: 0,
        maxTileCacheSize: 20,
        collectResourceTiming: false,
        refreshExpiredTiles: false,
        attributionControl: false,
      });
      window.__czekpointMap = map;
      hardenMapLibreInternals(map, center);
      appliedTerrain3D = false;
      update3DUiState();
      enableAllMapInteractions();
      hideWebGLErrorBanner();
    } catch (err) {
      map = null;
      showWebGLErrorBanner(err?.message || 'Chyba při inicializaci WebGL mapy');
      return false;
    }

    let accCenter = { lat: center.lat, lng: center.lng };
    let lastSyncedAccCenter = null;
    let accRadiusM = 0;
    let lastSyncedAccRadiusM = -1;
    accuracyRing = {
      setLatLng([lat, lng]) {
        const nLat = Number(lat);
        const nLng = Number(lng);
        if (Number.isFinite(nLat) && Number.isFinite(nLng)) {
          accCenter = { lat: nLat, lng: nLng };
          const movedM = lastSyncedAccCenter
            ? (haversineMeters(lastSyncedAccCenter, accCenter) ?? 999)
            : 999;
          if (movedM >= 2.5) {
            this.sync();
          }
        }
      },
      setRadius(r) {
        const nextR = Math.max(0, Number(r) || 0);
        accRadiusM = nextR;
        if (Math.abs(nextR - lastSyncedAccRadiusM) >= 0.5) {
          this.sync();
        }
      },
      sync() {
        if (!map || typeof map.getSource !== 'function') return;
        ensureCustomMapSourcesAndLayers();
        try {
          const src = map.getSource('accuracy-ring-source');
          if (!src) return;
          lastSyncedAccCenter = { lat: accCenter.lat, lng: accCenter.lng };
          lastSyncedAccRadiusM = accRadiusM;
          if (accRadiusM <= 0.5) {
            src.setData({ type: 'FeatureCollection', features: [] });
          } else {
            const feat = createGeoJsonCirclePolygon(accCenter, accRadiusM, 36);
            src.setData({
              type: 'FeatureCollection',
              features: feat ? [feat] : [],
            });
          }
        } catch {}
      },
    };

    const playerEl = document.createElement('div');
    playerEl.className = 'player-avatar-marker-anchor';
    playerEl.style.width = '86px';
    playerEl.style.height = '86px';
    playerEl.style.pointerEvents = 'none';
    playerEl.style.opacity = '1';
    playerEl.style.zIndex = '45';
    playerEl.innerHTML = renderPlayerAvatarMarkerHtml({
      avatarId: stateObj.profile?.avatarId || 'liska',
      bearingDeg: targetBearing || 0,
      isWalking: walkState === 'running',
      is3D: Boolean(is3dMode || is3DMode),
    });
    let playerPos = { lat: center.lat, lng: center.lng };
    visualPlayerPos = { lat: center.lat, lng: center.lng };
    let playerOpacity = 1;
    const rawPlayerMarker = new maplibregl.Marker({ element: playerEl, anchor: 'center' })
      .setLngLat([center.lng, center.lat])
      .addTo(map);
    player = {
      marker: rawPlayerMarker,
      setLatLng([lat, lng]) {
        const norm = normalizePointLatLng([lat, lng]);
        if (norm) {
          playerPos = { lat: norm.lat, lng: norm.lng };
          visualPlayerPos = { lat: norm.lat, lng: norm.lng };
          rawPlayerMarker.setLngLat([playerPos.lng, playerPos.lat]);
        }
      },
      getLatLng() {
        return { lat: playerPos.lat, lng: playerPos.lng };
      },
      getElement() {
        return playerEl;
      },
      setOpacity(val) {
        playerOpacity = Number(val) || 0;
        playerEl.style.opacity = String(playerOpacity);
      },
      getOpacity() {
        return playerOpacity;
      },
      remove() {
        try { rawPlayerMarker.remove(); } catch {}
      },
    };

    let lastStyleInitAt = 0;
    const onStyleOrMapLoad = () => {
      if (disposed || !map) return;
      const now = Date.now();
      if (now - lastStyleInitAt < 150) return;
      lastStyleInitAt = now;
      hardenMapLibreInternals(map, center);
      enableAllMapInteractions();
      ensureCustomMapSourcesAndLayers({ force3DSync: true });
      try {
        sync3DBuildingsLayerState();
        update3DUiState();
      } catch {}
      plannedRouteRenderKey = null;
      renderPlannedRouteOnMap(true);
      renderHikingTrailsOnMap();
      renderTrail();
      renderPlaces({ skipListRebuild: true });
      accuracyRing.sync();
      applyGameMode(appSettings.gameMode || 'gamified', { silent: true });
      drawFog(true);
      verify3DMapState('onStyleOrMapLoad');
    };

    map.on('style.load', onStyleOrMapLoad);
    map.on('load', onStyleOrMapLoad);
    if (typeof map.isStyleLoaded !== 'function' || map.isStyleLoaded()) {
      ensureCustomMapSourcesAndLayers({ force3DSync: true });
    }
    update3DUiState();

    // Události ztráty a obnovení grafického kontextu WebGL (webglcontextlost / webglcontextrestored)
    const mapCanvas = typeof map.getCanvas === 'function' ? map.getCanvas() : null;
    if (mapCanvas && typeof mapCanvas.addEventListener === 'function') {
      mapCanvas.addEventListener('webglcontextlost', (ev) => {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        if (disposed) return;
        showWebGLErrorBanner('Grafický kontext WebGL byl pozastaven');
      }, { signal: aborter.signal });

      mapCanvas.addEventListener('webglcontextrestored', () => {
        if (disposed || !map) return;
        hideWebGLErrorBanner();
        onStyleOrMapLoad();
        status('✓ Grafický kontext mapy (WebGL) byl úspěšně obnoven.');
      }, { signal: aborter.signal });
    }

    let contourFallbackTriggered = false;
    map.on('error', (ev) => {
      if (disposed || !map) return;
      const errMsg = String(ev?.error?.message || ev?.message || '');
      if (/webgl|context lost|failed to initialize webgl/i.test(errMsg)) {
        showWebGLErrorBanner('Chyba vykreslování WebGL');
        return;
      }
      const srcId = ev?.sourceId || ev?.source?.id || '';
      if (srcId === 'opentopo-raster' && showContourLayer && !contourFallbackTriggered) {
        contourFallbackTriggered = true;
        try {
          if (map.getLayer('opentopo-raster-layer')) {
            map.setLayoutProperty('opentopo-raster-layer', 'visibility', 'none');
          }
        } catch {}
        status('Podklad vrstevnic (OpenTopoMap) není dostupný — zachován standardní mapový podklad OSM.');
      } else if (srcId === 'waymarked-hiking') {
        try {
          if (map.getLayer('waymarked-hiking-layer')) {
            map.setLayoutProperty('waymarked-hiking-layer', 'visibility', 'none');
          }
        } catch {}
      } else if (srcId === 'osm-raster') {
        if ($('tile-status')) $('tile-status').textContent = 'Mapový podklad se nenačetl. Průzkum funguje dál.';
      }
    });
    if (fakeGpsSim) {
      fakeGpsSim.unbindEvents();
      fakeGpsSim.map = map;
      if (fakeGpsSim.isOpen) {
        fakeGpsSim.bindEvents();
      }
    }
    return true;
  }

  if (maplibregl && initializeMapLibreInstance()) {

    function scheduleMapPanAutoFetch() {
      if (!map) return;
      if (autoPanFetchTimer) clearTimeout(autoPanFetchTimer);
      autoPanFetchTimer = setTimeout(async () => {
        if (disposed || !map) return;
        const c = map.getCenter();
        if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return;
        const currentCenter = { lat: Number(c.lat.toFixed(4)), lng: Number(c.lng.toFixed(4)) };
        const distFromLast = lastAutoPanCenter
          ? (haversineMeters(lastAutoPanCenter, currentCenter) ?? Infinity)
          : Infinity;

        // ZADÁNÍ #10 (Bod 1.1): 100% automatické načítání míst z Overpass API na pozadí při posunu mapy
        // s debounce 700 ms, pokud se střed posunul o > 1,2 km (1200 m).
        if (distFromLast >= 1200) {
          if (autoPlacesLoading) {
            pendingAutoPanCenter = currentCenter;
            return;
          }
          lastAutoPanCenter = currentCenter;
          await refreshAutoPlaces(currentCenter, {
            silent: true,
            autoPlan: false,
            forceRefresh: false,
          });
        }
      }, 700);
    }

    map.on('zoomstart', () => {
      userZoomLocked = true;
      lastUserZoomAt = Date.now();
    });
    map.on('zoomend', () => {
      lastUserZoomAt = Date.now();
      renderTrail();
      renderPlaces({ skipListRebuild: true });
      scheduleFog(80, true);
    });
    // DÁVKA 1 (v2.2.1 P0 Bod 4): Zákaz odpojování follow při pouhém kliknutí — odpojení pouze při posunu > 12 px
    let mapTouchStartPointer = null;

    map.on('dragstart', (e) => {
      if (!e || e.originalEvent) {
        isUserTouchingMap = true;
        follow = false;
        updateRecenterButtonVisibility();
        updateFollowUi();
      }
    });
    map.on('drag', (e) => {
      if (!e || e.originalEvent) {
        follow = false;
        updateRecenterButtonVisibility();
        updateFollowUi();
      }
    });
    map.on('dragend', () => {
      isUserTouchingMap = false;
      mapTouchStartPointer = null;
    });
    map.on('pitchstart', (e) => {
      if (!e || e.originalEvent) {
        isUserTouchingMap = true;
        follow = false;
        updateRecenterButtonVisibility();
        updateFollowUi();
      }
    });
    map.on('pitchend', () => {
      isUserTouchingMap = false;
    });
    map.on('mousedown', (e) => {
      if (e && e.originalEvent) {
        isUserTouchingMap = true;
        const oe = e.originalEvent;
        mapTouchStartPointer = { x: oe.clientX, y: oe.clientY };
      }
    });
    map.on('mousemove', (e) => {
      if (isUserTouchingMap && mapTouchStartPointer && e && e.originalEvent) {
        const oe = e.originalEvent;
        const dx = oe.clientX - mapTouchStartPointer.x;
        const dy = oe.clientY - mapTouchStartPointer.y;
        if (Math.hypot(dx, dy) > 12) {
          follow = false;
          updateRecenterButtonVisibility();
          updateFollowUi();
        }
      }
    });
    map.on('mouseup', () => {
      isUserTouchingMap = false;
      mapTouchStartPointer = null;
    });
    map.on('touchstart', (e) => {
      if (e && e.originalEvent) {
        isUserTouchingMap = true;
        const touch = e.originalEvent.touches?.[0] || e.originalEvent;
        mapTouchStartPointer = { x: touch.clientX, y: touch.clientY };
      }
    });
    map.on('touchmove', (e) => {
      if (isUserTouchingMap && mapTouchStartPointer && e && e.originalEvent) {
        const touch = e.originalEvent.touches?.[0] || e.originalEvent;
        const dx = touch.clientX - mapTouchStartPointer.x;
        const dy = touch.clientY - mapTouchStartPointer.y;
        if (Math.hypot(dx, dy) > 12) {
          follow = false;
          updateRecenterButtonVisibility();
          updateFollowUi();
        }
      }
    });
    map.on('touchend', () => {
      isUserTouchingMap = false;
      mapTouchStartPointer = null;
    });
    // DÁVKA 3 (Bod 2.2): Při otočení mapy (ve 2D, 3D i při ručním otočení) okamžitě přepočítáme směrovou šipku u Avatara a okrajový štítek
    map.on('rotate', () => {
      updateDirectionalIndicators();
    });
    map.on('pitch', () => {
      updateOffscreenTargetIndicator();
    });
    map.on('moveend', () => {
      updateRecenterButtonVisibility();
      const curC = typeof map.getCenter === 'function' ? map.getCenter() : null;
      const curZ = typeof map.getZoom === 'function' ? map.getZoom() : 15;
      const movedCenterM = (curC && lastMoveendCenterPos)
        ? (haversineMeters(lastMoveendCenterPos, { lat: curC.lat, lng: curC.lng }) ?? 999)
        : 999;
      const zoomDelta = lastMoveendZoomVal !== null ? Math.abs(curZ - lastMoveendZoomVal) : 999;
      if (movedCenterM >= 35 || zoomDelta >= 0.3) {
        if (curC && Number.isFinite(curC.lat) && Number.isFinite(curC.lng)) {
          lastMoveendCenterPos = { lat: curC.lat, lng: curC.lng };
        }
        lastMoveendZoomVal = curZ;
        renderPlaces({ skipListRebuild: true });
        updateScanMapAreaButtonState();
        scheduleMapPanAutoFetch();
      }
      updateDirectionalIndicators();
      scheduleFog(120);
    });

    map.on('click', ev => {
      if (Date.now() - lastMarkerInteractedAt < 400) {
        return;
      }
      const clickPt = ev?.lngLat || ev?.latlng;
      if ($('place-detail-sheet') && !$('place-detail-sheet').hidden) {
        closePlaceDetail();
      }
      if ($('map-lupa-search-results') && !$('map-lupa-search-results').hidden) {
        $('map-lupa-search-results').hidden = true;
      }
      if (!clickPt || !Number.isFinite(clickPt.lat) || !Number.isFinite(clickPt.lng)) return;

      if (pickingCustomEndOnMap) {
        pickingCustomEndOnMap = false;
        phase1EndMode = 'custom';
        plannedRoute.routeType = 'oneway';
        const customEndId = 'custom-end-stop';
        const customEndStop = {
          id: customEndId,
          title: `Cíl v mapě [${clickPt.lat.toFixed(4)}, ${clickPt.lng.toFixed(4)}]`,
          lat: clickPt.lat,
          lng: clickPt.lng,
          kind: 'view',
          category: 'views',
        };
        plannedRoute.embeddedStops = [
          ...(plannedRoute.embeddedStops || []).filter(s => s.id !== customEndId),
          customEndStop,
        ];
        const others = getPlannedPlaces().filter(s => s.id !== customEndId);
        const orderedOthers = others.length >= 2
          ? optimizeRouteOrder(getRouteOriginPoint(), others, {
              returnToOrigin: false,
              visitedStopIds: confirmedStopIds,
              currentPosition: (active || demo) && lastFix ? lastFix : null,
            })
          : others;
        plannedRoute.selectedPlaceIds = [...orderedOthers.map(s => s.id), customEndId];
        recalculateRemainingRoute('🏁 Jiný cíl nastaven kliknutím do mapy.');
        playStampChord(stateObj.soundEnabled);
        return;
      }
      if (pickingStartOnMap) {
        pickingStartOnMap = false;
        userExplicitlyPickedOrigin = true;
        const customOrigin = {
          id: 'custom-map',
          label: `Bod v mapě [${clickPt.lat.toFixed(3)}, ${clickPt.lng.toFixed(3)}]`,
          lat: clickPt.lat,
          lng: clickPt.lng,
          custom: true,
        };
        if (editModalOpen && editDraft) {
          editDraft.origin = customOrigin;
          $('edit-walk-modal').hidden = false;
          renderEditWalkModal();
        } else {
          plannedRoute.origin = customOrigin;
          wizardScenario = 'from-home';
          renderTripWizardUi();
          refreshWeatherStrip(customOrigin);
          applyPhase1QuickSelection(true);
          refreshAutoPlaces(customOrigin, { autoPlan: true, forceRefresh: true });
          status('📍 Start nastaven v mapě — načítám zajímavá místa v okolí a stavím trasu…');
        }
        playTick(stateObj.soundEnabled);
      }
    });

    loadAndRenderHikingTrails();

    // v2.1 (Bod 2.1): Okamžité zaměření polohy při otevření mapy
    if (typeof navigator !== 'undefined' && navigator.geolocation && !simSandboxActive && !demo) {
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (disposed || simSandboxActive || demo) return;
            const norm = normalizePointLatLng({
              lat: pos?.coords?.latitude,
              lng: pos?.coords?.longitude,
            });
            if (!norm) return;
            const initialFix = {
              lat: norm.lat,
              lng: norm.lng,
              accuracy: Number.isFinite(pos?.coords?.accuracy) ? pos.coords.accuracy : 15,
              altitude: pos?.coords?.altitude ?? null,
              speed: Number.isFinite(pos?.coords?.speed) ? pos.coords.speed : null,
              heading: Number.isFinite(pos?.coords?.heading) ? pos.coords.heading : null,
              timestamp: pos?.timestamp || Date.now(),
              simulated: false,
            };
            lastFix = initialFix;
            visualPlayerPos = { lat: norm.lat, lng: norm.lng };
            if (player) {
              player.setLatLng([norm.lat, norm.lng]);
              setPlayerMarkerVisible(true);
            }
            if (!userExplicitlyPickedOrigin) {
              plannedRoute.origin = {
                id: 'my-gps',
                label: 'Moje aktuální GPS poloha',
                lat: norm.lat,
                lng: norm.lng,
              };
              const origLabel = $('wiz-active-origin-label');
              if (origLabel) origLabel.textContent = 'Moje aktuální GPS poloha';
              if (follow) {
                centerMapOnPlayer(norm, false);
              }
              plannedRouteRenderKey = null;
              renderPlannedRouteOnMap(true);
            }
            renderPlaces({ skipListRebuild: true });
            scheduleFog(100, true);
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 15000, timeout: 8000 }
        );
      } catch {}
    }
  } else if (!maplibregl) {
    $('walk-map').innerHTML = `
      <div class="map-missing-fallback" role="alert" style="padding:24px;text-align:center">
        <strong>Mapová knihovna chybí nebo se nenačetla.</strong>
        <p style="margin:8px 0 0">Zobrazení interaktivní mapy a mapových vrstev není v tuto chvíli dostupné. Plánování zastávek, seznam míst a záznam GPS procházky zůstávají funkční.</p>
      </div>
    `;
    ['walk-center', 'walk-fog-toggle', 'walk-trails-toggle', 'walk-zen-toggle', 'btn-toggle-3d', 'btn-follow-heading', 'btn-north-up', 'draft-btn-origin-map'].forEach(btnId => {
      const btn = $(btnId);
      if (btn) {
        btn.disabled = true;
        btn.title = 'Nedostupné — mapová knihovna se nenačetla';
      }
    });
  }

  const simStartPos = lastFix || plannedRoute?.origin || (progress.cells.length ? cellCenter(progress.cells.at(-1)) : ROZMITAL_CENTER);
  fakeGpsSim = initGpsSimulator({
    map,
    container: $('simulator-test-zone'),
    initialPosition: simStartPos,
    onOpen: () => {
      const zone = $('simulator-test-zone');
      if (zone) zone.hidden = false;
      const toggleBtn = $('walk-fake-gps-toggle');
      if (toggleBtn) {
        toggleBtn.classList.add('active');
        toggleBtn.setAttribute('aria-expanded', 'true');
      }
      $('btn-top-sim-toggle')?.classList.add('active');
      enterSimulatorSandbox();
    },
    onClose: () => {
      const zone = $('simulator-test-zone');
      if (zone) zone.hidden = true;
      const toggleBtn = $('walk-fake-gps-toggle');
      if (toggleBtn) {
        toggleBtn.classList.remove('active');
        toggleBtn.setAttribute('aria-expanded', 'false');
      }
      $('btn-top-sim-toggle')?.classList.remove('active');
      exitSimulatorSandbox();
    },
    onAutopilotPause: (reason) => {
      status(reason);
    },
    onFix: (fix, heading) => {
      if (disposed) return;
      enterSimulatorSandbox();
      // DÁVKA 1 (Bod 2.3): Ve stavu 'paused' nesmí ani simulovaný vzorek polohy obnovit chůzi ani přičíst metry!
      if (walkState === 'paused' || (currentExpedition && currentExpedition.state === 'paused')) {
        return;
      }
      const simMoved = !lastFix || (haversineMeters(lastFix, fix) ?? 1) > 0.5;
      if (walkState !== 'running' && walkState !== 'paused' && simMoved) {
        startUnifiedExpedition('sim');
      }
      handleGpsFix({ ...fix, simulated: true });
      if (heading != null && Number.isFinite(heading)) {
        updateCompassRotation(heading);
      }
    },
    onHeadingChange: (heading) => {
      if (heading != null && Number.isFinite(heading)) {
        updateCompassRotation(heading);
      }
    },
    onResetAnchor: () => {
      anchor = null;
    },
    onStopRealGps: () => {
      stopWatchdog();
      if (watch !== null) {
        navigator.geolocation?.clearWatch?.(watch);
        watch = null;
      }
    },
    getPlannedWaypoints: () => {
      return getPlannedPlaces();
    },
    getSharedWalkingRoute: () => {
      return lastRoutedGeometry;
    },
    getCollectiblePlaces: () => {
      return getAllAvailablePlaces().filter(p => p.collectible !== false);
    },
  });

  // DÁVKA 4 (Bod 1.1): Kliknutí na tlačítko „🔄 Znovu načíst mapu“ (#btn-reload-webgl-map) při chybě WebGL
  $('webgl-error-banner')?.addEventListener('click', (ev) => {
    if (ev.target.closest('#btn-reload-webgl-map')) {
      const ok = initializeMapLibreInstance();
      if (ok) {
        status('✓ Mapa byla úspěšně znovu načtena. Tvůj postup procházky pokračuje.');
      }
      playTick(stateObj.soundEnabled);
    }
  });

  // ZÓNA 2 (Apple HIG — 1 tlačítko = 1 akce):
  // a) 🎯 (#btn-recenter-map): 1. klik vycentruje na postavičku (follow = true) BEZ změny 2D/2.5D;
  //    2. klik (když už je vycentrováno follow === true) zapne/vypne otáčení mapy podle kompasu (followHeadingMode).
  //    KRITICKÁ OPRAVA PRO iOS SAFARI: DeviceOrientationEvent.requestPermission() se volá SYNCHRONNĚ přímo na prvním řádku obsluhy!
  $('btn-recenter-map')?.addEventListener('click', () => {
    const willEnableHeading = Boolean(follow && !followHeadingMode);
    let iosPermPromise = null;
    if (
      willEnableHeading &&
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        iosPermPromise = DeviceOrientationEvent.requestPermission();
      } catch {}
    }

    if (!follow) {
      follow = true;
      updateFollowUi();
      const pos = visualPlayerPos || lastFix || telemetry.lastKnownPosition || getRouteOriginPoint();
      if (pos && map) {
        centerMapOnPlayer(pos, true);
      }
      status('🎯 Mapa vycentrována na postavičku.');
      playTick(stateObj.soundEnabled);
      return;
    }

    if (willEnableHeading && iosPermPromise && typeof iosPermPromise.then === 'function') {
      iosPermPromise
        .then(perm => {
          if (perm === 'granted') {
            compassSensorState = 'active';
            bindOrientationListeners();
          } else {
            compassSensorState = 'denied';
          }
          setFollowHeadingMode(true);
        })
        .catch(() => {
          compassSensorState = 'denied';
          setFollowHeadingMode(true);
        });
    } else {
      setFollowHeadingMode(willEnableHeading);
    }
    playTick(stateObj.soundEnabled);
  });

  // b) 2D / 2.5D (#btn-toggle-3d): čistě přepíná kolmý 2D pohled (pitch: 0) a nakloněný 2.5D terénní pohled (pitch: 32)
  $('btn-toggle-3d')?.addEventListener('click', () => {
    terrainFallbackTriggered = false;
    setMap3DMode(!is3DMode);
    updateDirectionalIndicators();
    playTick(stateObj.soundEnabled);
  });

  $('btn-north-up')?.addEventListener('click', () => {
    if (!map) return;
    if (followHeadingMode) {
      followHeadingMode = false;
      updateHeadingModeBannerUi();
    }
    try {
      map.easeTo({ bearing: 0, duration: 450 });
      status('⬆️ Mapa srovnána severem nahoru.');
    } catch {}
    playTick(stateObj.soundEnabled);
  });

  $('btn-cam-tilt-up')?.addEventListener('click', () => {
    if (!map) return;
    try {
      const nextPitch = Math.min(70, (map.getPitch?.() || 0) + 12);
      map.easeTo({ pitch: nextPitch, duration: 300 });
    } catch {}
    playTick(stateObj.soundEnabled);
  });

  $('btn-cam-tilt-down')?.addEventListener('click', () => {
    if (!map) return;
    try {
      const nextPitch = Math.max(0, (map.getPitch?.() || 0) - 12);
      map.easeTo({ pitch: nextPitch, duration: 300 });
    } catch {}
    playTick(stateObj.soundEnabled);
  });

  $('btn-cam-rotate-left')?.addEventListener('click', () => {
    if (!map) return;
    try {
      map.easeTo({ bearing: (map.getBearing?.() || 0) - 25, duration: 300 });
    } catch {}
    playTick(stateObj.soundEnabled);
  });

  $('btn-cam-rotate-right')?.addEventListener('click', () => {
    if (!map) return;
    try {
      map.easeTo({ bearing: (map.getBearing?.() || 0) + 25, duration: 300 });
    } catch {}
    playTick(stateObj.soundEnabled);
  });

  // Ovládání rozbalovacího přehledu turistických údajů a počasí (Body 28 & 29)
  $('btn-toggle-tourist-stats')?.addEventListener('click', () => {
    statsDrawerOpen = !statsDrawerOpen;
    const drawer = $('tourist-stats-drawer');
    const btn = $('btn-toggle-tourist-stats');
    if (drawer) drawer.hidden = !statsDrawerOpen;
    if (btn) {
      btn.setAttribute('aria-expanded', String(statsDrawerOpen));
      btn.textContent = statsDrawerOpen ? '📊 Skrýt podrobnosti ▲' : '📊 Podrobné údaje ▼';
    }
    renderTouristStatsHud(lastFix);
    playTick(stateObj.soundEnabled);
  });

  $('btn-toggle-weather-detail')?.addEventListener('click', () => {
    weatherExpanded = !weatherExpanded;
    const panel = $('weather-detail-panel');
    const btn = $('btn-toggle-weather-detail');
    if (panel) panel.hidden = !weatherExpanded;
    if (btn) {
      btn.setAttribute('aria-expanded', String(weatherExpanded));
      btn.textContent = weatherExpanded ? 'Skrýt počasí ▲' : 'Počasí podrobně ▼';
    }
    renderWeatherStripUi();
    playTick(stateObj.soundEnabled);
  });

  // Ovládání sjednoceného dialogu „Upravit procházku“ (Bod 20: Potvrdit změny / Zrušit)
  function openEditWalkModal() {
    editDraft = {
      origin: plannedRoute.origin ? { ...plannedRoute.origin } : { ...START_PRESETS[0] },
      radiusKm: plannedRoute.radiusKm || 10,
      categories: [...(plannedRoute.categories || PLANNER_CATEGORIES.map(c => c.id))],
      selectedPlaceIds: [...(plannedRoute.selectedPlaceIds || [])],
      companionMode: stateObj.companionMode || plannedRoute.companionMode || 'solo',
      explorationMode: stateObj.explorationMode || plannedRoute.explorationMode || 'focus',
      routeType: plannedRoute.routeType || 'oneway',
    };
    editModalOpen = true;
    if ($('draft-auto-feedback')) $('draft-auto-feedback').hidden = true;
    $('edit-walk-modal').hidden = false;
    renderEditWalkModal();
    playTick(stateObj.soundEnabled);
  }

  function cancelEditWalkModal() {
    editDraft = null;
    editModalOpen = false;
    pickingStartOnMap = false;
    $('edit-walk-modal').hidden = true;
    status('Úpravy procházky zrušeny. Původní plán i rozchozená výprava zůstaly beze změny.');
    playTick(stateObj.soundEnabled);
  }

  function confirmEditWalkModal() {
    if (!editDraft) return;
    plannedRoute = {
      ...plannedRoute,
      origin: editDraft.origin,
      radiusKm: editDraft.radiusKm,
      categories: [...editDraft.categories],
      selectedPlaceIds: [...editDraft.selectedPlaceIds],
      companionMode: editDraft.companionMode,
      explorationMode: editDraft.explorationMode,
      routeType: editDraft.routeType || 'oneway',
    };
    stateObj.companionMode = editDraft.companionMode;
    stateObj.explorationMode = editDraft.explorationMode;
    stateObj.plannedRoute = plannedRoute;

    editDraft = null;
    editModalOpen = false;
    $('edit-walk-modal').hidden = true;

    recalculateRemainingRoute('Změny procházky potvrzeny. Zbývající trasa byla přepočítána.');
    refreshAutoPlaces();
    refreshWeatherStrip();
    playStampChord(stateObj.soundEnabled);
  }

  function renderEditWalkModal() {
    if (!editDraft || !editModalOpen) return;

    root.querySelectorAll('[data-draft-origin]').forEach(btn => {
      btn.classList.toggle('primary', editDraft.origin?.id === btn.dataset.draftOrigin);
    });
    if ($('draft-origin-desc')) {
      $('draft-origin-desc').textContent = `Zvolený start: ${editDraft.origin?.label || 'Vlastní bod'}`;
    }

    root.querySelectorAll('[data-draft-companion]').forEach(btn => {
      btn.classList.toggle('primary', editDraft.companionMode === btn.dataset.draftCompanion);
    });

    root.querySelectorAll('[data-draft-mode]').forEach(btn => {
      btn.classList.toggle('primary', editDraft.explorationMode === btn.dataset.draftMode);
    });

    root.querySelectorAll('[data-draft-radius]').forEach(btn => {
      btn.classList.toggle('primary', Number(btn.dataset.draftRadius) === editDraft.radiusKm);
    });

    root.querySelectorAll('[data-draft-cat]').forEach(chip => {
      chip.classList.toggle('selected', editDraft.categories.includes(chip.dataset.draftCat));
    });

    const draftPlaces = getPlannedPlaces(editDraft.selectedPlaceIds);
    if ($('draft-basket-count')) $('draft-basket-count').textContent = String(draftPlaces.length);
    if ($('draft-btn-optimize')) $('draft-btn-optimize').disabled = draftPlaces.length < 2;

    const draftStopsEl = $('draft-stops-list');
    if (draftStopsEl) {
      if (draftPlaces.length === 0) {
        draftStopsEl.innerHTML = '<p class="small-note">Žádné pevné zastávky (volná procházka). Přidej zastávky níže nebo zvol automatický okruh.</p>';
      } else {
        draftStopsEl.innerHTML = draftPlaces.map((p, idx) => `
          <div class="basket-item" data-draft-stop-index="${idx}">
            <div class="basket-item-main">
              <span class="basket-index">${idx + 1}.</span>
              <strong class="basket-title">${e(p.title)}</strong>
              ${isStopVisitedInSession(p) ? '<span class="stop-state-badge confirmed">✓ Navštíveno dnes</span>' : hasLifetimeStamp(p) ? '<span class="stop-state-badge pending">📜 V pasu z dřívějška</span>' : ''}
            </div>
            <div class="basket-item-controls">
              <button type="button" class="button small ghost" data-draft-stop-action="up" data-draft-stop-index="${idx}" ${idx === 0 ? 'disabled' : ''}>↑ Nahoru</button>
              <button type="button" class="button small ghost" data-draft-stop-action="down" data-draft-stop-index="${idx}" ${idx === draftPlaces.length - 1 ? 'disabled' : ''}>↓ Dolů</button>
              <button type="button" class="button small ghost" data-draft-stop-action="replace" data-draft-stop-index="${idx}">⇄ Nahradit</button>
              <button type="button" class="button small ghost danger" data-draft-stop-action="remove" data-draft-stop-index="${idx}">✕ Odebrat</button>
            </div>
          </div>
        `).join('');
      }
    }

    const availEl = $('draft-available-places');
    if (availEl) {
      const candidates = getAllAvailablePlaces()
        .filter(p => !editDraft.selectedPlaceIds.includes(p.id))
        .slice(0, 12);
      availEl.innerHTML = candidates.map(p => `
        <button type="button" class="draft-add-place-chip" data-draft-add-id="${e(p.id)}">
          + ${e(p.title)}
        </button>
      `).join('');
    }
  }

  $('btn-open-edit-walk')?.addEventListener('click', openEditWalkModal);
  $('btn-sheet-edit-walk')?.addEventListener('click', openEditWalkModal);
  $('btn-close-edit-walk-x')?.addEventListener('click', cancelEditWalkModal);
  $('btn-cancel-walk-edit')?.addEventListener('click', cancelEditWalkModal);
  $('btn-confirm-walk-edit')?.addEventListener('click', confirmEditWalkModal);

  // Události uvnitř modálu „Upravit procházku“
  $('edit-walk-modal')?.addEventListener('click', ev => {
    if (ev.target === $('edit-walk-modal') || !ev.target.closest('.edit-walk-modal-card')) {
      cancelEditWalkModal();
      return;
    }
    if (!editDraft) return;

    const originBtn = ev.target.closest('[data-draft-origin]');
    if (originBtn) {
      const originId = originBtn.dataset.draftOrigin;
      if (originId === 'my-gps') {
        if (lastFix) {
          editDraft.origin = { id: 'my-gps', label: 'Moje GPS poloha', lat: lastFix.lat, lng: lastFix.lng };
        } else {
          status('Pro start od tvé GPS polohy nejprve spusť GPS.');
        }
      } else {
        const preset = START_PRESETS.find(s => s.id === originId);
        if (preset) editDraft.origin = { ...preset };
      }
      renderEditWalkModal();
      return;
    }

    if (ev.target.closest('#draft-btn-origin-map')) {
      if (!map) return;
      pickingStartOnMap = true;
      $('edit-walk-modal').hidden = true;
      status('Klikni do mapy pro výběr startovního bodu návrhu…');
      return;
    }

    const compBtn = ev.target.closest('[data-draft-companion]');
    if (compBtn) {
      editDraft.companionMode = compBtn.dataset.draftCompanion;
      renderEditWalkModal();
      return;
    }

    const modeBtn = ev.target.closest('[data-draft-mode]');
    if (modeBtn) {
      editDraft.explorationMode = modeBtn.dataset.draftMode;
      renderEditWalkModal();
      return;
    }

    const radBtn = ev.target.closest('[data-draft-radius]');
    if (radBtn) {
      editDraft.radiusKm = Number(radBtn.dataset.draftRadius);
      renderEditWalkModal();
      return;
    }

    const catBtn = ev.target.closest('[data-draft-cat]');
    if (catBtn) {
      const catId = catBtn.dataset.draftCat;
      if (editDraft.categories.includes(catId)) {
        editDraft.categories = editDraft.categories.filter(c => c !== catId);
      } else {
        editDraft.categories = [...editDraft.categories, catId];
      }
      renderEditWalkModal();
      return;
    }

    if (ev.target.closest('#draft-btn-free')) {
      editDraft.explorationMode = 'radar';
      editDraft.selectedPlaceIds = [];
      editDraft.routeType = 'oneway';
      if ($('draft-auto-feedback')) $('draft-auto-feedback').hidden = true;
      renderEditWalkModal();
      return;
    }

    const autoBtn = ev.target.closest('#draft-btn-auto-2, #draft-btn-auto-5, #draft-btn-auto-10');
    if (autoBtn) {
      const targetKm = autoBtn.id.endsWith('-2') ? 2 : autoBtn.id.endsWith('-10') ? 10 : 5;
      const trip = autoSuggestTrip({
        origin: editDraft.origin,
        targetKm,
        companionMode: editDraft.companionMode,
        availablePlaces: getAllAvailablePlaces(),
        discoveries: progress.discoveries,
      });
      const fbEl = $('draft-auto-feedback');
      if (!trip.found) {
        if (fbEl) {
          fbEl.hidden = false;
          fbEl.textContent = `⚠️ ${trip.reason}`;
        }
        status(trip.reason);
        return;
      }
      editDraft.selectedPlaceIds = trip.selectedPlaceIds;
      editDraft.explorationMode = 'focus';
      editDraft.routeType = 'loop';
      if (fbEl) {
        const kmStr = (trip.analysis.estimatedWalkDistanceM / 1000).toFixed(1).replace('.', ',');
        fbEl.hidden = false;
        fbEl.textContent = `✓ Sestaven uzavřený okruh zpět na start: ${trip.selectedPlaceIds.length} zastávek, celková délka ~${kmStr} km (~${trip.analysis.estimatedMinutes} min).`;
      }
      renderEditWalkModal();
      return;
    }

    // Bod 27: Uspořádat zastávky podle skutečné pěší vzdálenosti (zachová již navštívené zastávky při běžící chůzi)
    if (ev.target.closest('#draft-btn-optimize')) {
      const draftPlaces = getPlannedPlaces(editDraft.selectedPlaceIds);
      if (draftPlaces.length >= 2) {
        const ordered = optimizeRouteOrder(editDraft.origin, draftPlaces, {
          returnToOrigin: editDraft.routeType === 'loop',
          visitedStopIds: confirmedStopIds,
          currentPosition: active && lastFix ? lastFix : null,
        });
        editDraft.selectedPlaceIds = ordered.map(p => p.id);
        renderEditWalkModal();
      }
      return;
    }

    const stopActBtn = ev.target.closest('[data-draft-stop-action]');
    if (stopActBtn) {
      const action = stopActBtn.dataset.draftStopAction;
      const idx = Number(stopActBtn.dataset.draftStopIndex);
      if (action === 'up') {
        editDraft.selectedPlaceIds = reorderPlannedStops(editDraft.selectedPlaceIds, idx, idx - 1);
      } else if (action === 'down') {
        editDraft.selectedPlaceIds = reorderPlannedStops(editDraft.selectedPlaceIds, idx, idx + 1);
      } else if (action === 'remove') {
        editDraft.selectedPlaceIds = removePlannedStop(editDraft.selectedPlaceIds, idx);
      } else if (action === 'replace') {
        const replacement = getAllAvailablePlaces().find(p => !editDraft.selectedPlaceIds.includes(p.id));
        if (replacement) {
          editDraft.selectedPlaceIds = replacePlannedStop(editDraft.selectedPlaceIds, idx, replacement.id);
        }
      }
      renderEditWalkModal();
      return;
    }

    const addChip = ev.target.closest('[data-draft-add-id]');
    if (addChip) {
      const id = addChip.dataset.draftAddId;
      if (editDraft.selectedPlaceIds.length < 10 && !editDraft.selectedPlaceIds.includes(id)) {
        editDraft.selectedPlaceIds = [...editDraft.selectedPlaceIds, id];
        renderEditWalkModal();
      }
    }
  });

  $('walk-fake-gps-toggle')?.addEventListener('click', () => {
    unlockSpeechSynthesis();
    if (fakeGpsSim) {
      fakeGpsSim.toggle();
      const zone = $('simulator-test-zone');
      if (zone) {
        zone.hidden = !fakeGpsSim.isOpen;
        if (fakeGpsSim.isOpen) {
          closeCompetingMapOverlays('sim');
          // Zajistíme, aby měl simulátor ihned platnou pěší trasu po chodnících a stezkách (ne vzduchem přes budovy)
          if (!plannedRoute.selectedPlaceIds || plannedRoute.selectedPlaceIds.length === 0) {
            const avail = getAllAvailablePlaces();
            const preferred = ['zamek-rozmital', 'podbrdske-muzeum', 'kostel-stary-rozmital'].filter(id =>
              avail.some(p => p.id === id)
            );
            const defaultSimStops = preferred.length > 0 ? preferred : avail.slice(0, 3).map(p => p.id);
            if (defaultSimStops.length > 0) {
              plannedRoute.selectedPlaceIds = defaultSimStops;
            }
          }
          const orig = lastFix || getRouteOriginPoint();
          const stopPlaces = getPlannedPlaces();
          if (!lastRoutedGeometry || lastRoutedGeometry.isFallback || !Array.isArray(lastRoutedGeometry.coordinates) || lastRoutedGeometry.coordinates.length < 2) {
            lastRoutedGeometry = buildLocalRoutedGeometry([orig, ...stopPlaces], { useLocalFootpathGraph: true, isFallback: false });
            plannedRouteCoords = lastRoutedGeometry.coordinates;
            applyPlannedRouteGeoJsonToMap(plannedRouteCoords, false);
          }
          fakeGpsSim.setSharedWalkingRoute(lastRoutedGeometry);
          if (fakeGpsSim.mode === 'idle') {
            fakeGpsSim.startAutopilot(stopPlaces, getAllAvailablePlaces(), lastRoutedGeometry);
            fakeGpsSim.triggerLoopTick?.(Date.now());
          }
          updateTurnNavPill(lastFix || orig);
          zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
    playTick(stateObj.soundEnabled);
  });

  // DÁVKA 2 (P1 Bod 7.1): Pokud byl odkaz otevřen z nastavení se sim=1 nebo actions.sim, automaticky otevřeme simulátor
  if (actions.sim || (typeof location !== 'undefined' && (location.hash.includes('sim=1') || location.search.includes('sim=1')))) {
    setTimeout(() => {
      if (!disposed && fakeGpsSim && !fakeGpsSim.isOpen) {
        fakeGpsSim.open();
        const zone = $('simulator-test-zone');
        if (zone) {
          zone.hidden = false;
          zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }, 150);
  }

  $('walk-start')?.addEventListener('click', () => {
    pickingCustomEndOnMap = false;
    pickingStartOnMap = false;
    startUnifiedExpedition('bar');
  });
  $('walk-stop')?.addEventListener('click', () => pauseSession('Pozastaveno. Průzkum je uložený.'));
  $('walk-end')?.addEventListener('click', finishExpedition);
  $('walk-awake')?.addEventListener('change', () => { $('walk-awake')?.checked ? holdWake() : releaseWake(); });
  $('walk-sound')?.addEventListener('change', (ev) => {
    stateObj.soundEnabled = ev.target.checked;
    saveAppState();
  });

  // ZÓNA 3: Otevírání a zavírání vysouvacího spodního šuplíku míst (#walk-bottom-sheet) se 2 záložkami
  let activeDrawerTab = 'places';

  function setDrawerTab(tabName) {
    activeDrawerTab = tabName === 'route' ? 'route' : 'places';
    const sheetEl = $('walk-bottom-sheet');
    if (sheetEl) {
      sheetEl.setAttribute('data-active-drawer-tab', activeDrawerTab);
    }
    const isPlaces = activeDrawerTab === 'places';
    root.querySelectorAll('[data-drawer-tab]').forEach(btn => {
      const isMatch = btn.getAttribute('data-drawer-tab') === activeDrawerTab;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-selected', String(isMatch));
    });
    if ($('drawer-places-box')) $('drawer-places-box').hidden = !isPlaces;
    if ($('top-route-itinerary-wrap')) $('top-route-itinerary-wrap').hidden = isPlaces;
    if ($('drawer-basket-box')) $('drawer-basket-box').hidden = isPlaces;
    if ($('route-xray-card')) $('route-xray-card').hidden = isPlaces;
    if ($('personal-atlas-section')) $('personal-atlas-section').hidden = isPlaces;
    if ($('drawer-share-row')) $('drawer-share-row').hidden = isPlaces;
    if ($('mindfulness-prompt-card')) {
      $('mindfulness-prompt-card').hidden = isPlaces || appSettings.mindfulnessPrompts === false || mindfulnessSkippedSession;
    }
  }

  function setPlacesDrawerOpen(open, preferredTab) {
    const sheetEl = $('walk-bottom-sheet');
    if (!sheetEl) return;
    const isOpen = Boolean(open);
    if (isOpen) {
      closeCompetingMapOverlays('drawer');
      setDrawerTab(preferredTab || activeDrawerTab || 'places');
    }
    sheetEl.hidden = !isOpen;
    sheetEl.classList.toggle('is-drawer-open', isOpen);
    sheetEl.classList.remove('collapsed');
    if (isOpen) {
      renderPlaces();
      renderPlannerBasketAndXray();
    }
  }

  root.querySelectorAll('[data-drawer-tab]').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      const targetTab = tabBtn.getAttribute('data-drawer-tab') || 'places';
      setDrawerTab(targetTab);
      playTick(stateObj.soundEnabled);
    });
  });

  root.querySelectorAll('[data-open-places-drawer]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sheetEl = $('walk-bottom-sheet');
      const targetTab = btn.getAttribute('data-open-places-drawer') === 'route' ? 'route' : 'places';
      const isCurrentlyOpen = sheetEl && !sheetEl.hidden;
      if (isCurrentlyOpen && activeDrawerTab === targetTab) {
        setPlacesDrawerOpen(false);
      } else {
        setPlacesDrawerOpen(true, targetTab);
      }
      playTick(stateObj.soundEnabled);
    });
  });

  $('btn-close-places-drawer')?.addEventListener('click', () => {
    setPlacesDrawerOpen(false);
    playTick(stateObj.soundEnabled);
  });

  $('sheet-toggle-btn')?.addEventListener('click', () => {
    setPlacesDrawerOpen(false);
    playTick(stateObj.soundEnabled);
  });

  root.querySelectorAll('#btn-drawer-quick-loop, [data-drawer-quick-loop]').forEach(quickLoopBtn => {
    quickLoopBtn.addEventListener('click', () => {
      const originPt = getRouteOriginPoint();
      const allPlaces = getAllAvailablePlaces();
      let trip = autoSuggestTrip({
        origin: originPt,
        targetKm: 3,
        companionMode: stateObj.companionMode || 'solo',
        availablePlaces: allPlaces,
        discoveries: progress.discoveries,
      });
      if (!trip.found) {
        trip = autoSuggestTrip({
          origin: originPt,
          targetKm: 5,
          companionMode: 'solo',
          availablePlaces: allPlaces,
          discoveries: [],
        });
      }
      if (!trip.found || !Array.isArray(trip.selectedPlaceIds) || trip.selectedPlaceIds.length === 0) {
        status(trip.reason || 'V tomto okolí se nepodařilo automaticky sestavit okruh.');
        return;
      }
      plannedRoute.selectedPlaceIds = trip.selectedPlaceIds;
      plannedRoute.embeddedStops = trip.selectedPlaceIds
        .map(id => allPlaces.find(p => p.id === id))
        .filter(Boolean)
        .map(p => ({
          id: p.id,
          title: p.title,
          lat: p.lat,
          lng: p.lng,
          kind: p.kind || 'forest',
          category: p.category || 'nature',
        }));
      plannedRoute.routeType = 'loop';
      stateObj.explorationMode = 'focus';
      setPlacesDrawerOpen(false);
      recalculateRemainingRoute('✨ Navržen pěší okruh v okolí — fialovo-zlatá trasa je vykreslena na mapě!');
      playStampChord(stateObj.soundEnabled);
    });
  });

  const handleViewportChange = () => {
    if (!map || disposed) return;
    resizeMap();
    if (follow && (lastFix || telemetry.lastKnownPosition)) {
      centerMapOnPlayer(lastFix || telemetry.lastKnownPosition, false);
    }
  };
  window.addEventListener('resize', handleViewportChange, { signal: aborter.signal });
  window.addEventListener('orientationchange', handleViewportChange, { signal: aborter.signal });

  // DÁVKA 4 (Bod 1.2): Ošetření přerušené a obnovené sítě (offline / online) bez přerušení záznamu procházky
  const handleNetworkOffline = () => {
    if (disposed) return;
    if ($('tile-status')) {
      $('tile-status').textContent = '📡 Jsi offline (bez připojení k síti). Záznam GPS procházky, odkrývání mlhy i potvrzování míst běží normálně dál z paměti zařízení.';
    }
  };
  const handleNetworkOnline = () => {
    if (disposed) return;
    if ($('tile-status')) {
      $('tile-status').textContent = '';
    }
  };
  window.addEventListener('offline', handleNetworkOffline, { signal: aborter.signal });
  window.addEventListener('online', handleNetworkOnline, { signal: aborter.signal });

  function updateZenMode() {
    $('walk-map-wrap')?.classList.toggle('zen-mode', zenMode);
    document.body?.classList.toggle('has-zen-mode', zenMode);
    const iosTabBar = document.querySelector('#ios-tab-bar');
    if (iosTabBar) iosTabBar.hidden = zenMode;
    const zenToggleBtn = $('walk-zen-toggle');
    if (zenToggleBtn) {
      zenToggleBtn.setAttribute('aria-pressed', String(zenMode));
      zenToggleBtn.setAttribute('aria-label', zenMode ? 'Ukončit celou obrazovku' : 'Celá obrazovka');
      zenToggleBtn.title = zenMode ? 'Ukončit celou obrazovku' : 'Celá obrazovka';
      zenToggleBtn.textContent = zenMode ? '✕' : '⛶';
    }
    if (zenMode) {
      follow = true;
      userZoomLocked = false;
    }
    updateFollowUi();
    if (map) {
      resizeMap();
      const pos = lastFix || telemetry.lastKnownPosition || getRouteOriginPoint();
      if (pos) centerMapOnPlayer(pos, false);
      setTimeout(() => {
        if (!disposed && map) {
          resizeMap();
          if (follow && (lastFix || telemetry.lastKnownPosition)) {
            centerMapOnPlayer(lastFix || telemetry.lastKnownPosition, false);
          }
        }
      }, 60);
      setTimeout(() => {
        if (!disposed && map) {
          resizeMap();
          if (follow && (lastFix || telemetry.lastKnownPosition)) {
            centerMapOnPlayer(lastFix || telemetry.lastKnownPosition, false);
          }
        }
      }, 240);
    }
  }

  $('zen-follow-btn')?.addEventListener('click', () => {
    follow = true;
    userZoomLocked = false;
    updateFollowUi();
    const pos = lastFix || telemetry.lastKnownPosition || getRouteOriginPoint();
    if (pos && map) {
      centerMapOnPlayer(pos, true);
    }
    playTick(stateObj.soundEnabled);
  });

  $('walk-zen-toggle')?.addEventListener('click', () => {
    zenMode = !zenMode;
    updateZenMode();
    playTick(stateObj.soundEnabled);
  });

  $('zen-close-btn')?.addEventListener('click', () => {
    zenMode = false;
    updateZenMode();
    playTick(stateObj.soundEnabled);
  });

  const onEscapeKey = (ev) => {
    if (ev.key === 'Escape') {
      if ($('postcard-modal')) {
        if ($('session-summary-container')) $('session-summary-container').innerHTML = '';
        playTick(stateObj.soundEnabled);
        return;
      }
      if ($('arrival-goal-modal') && !$('arrival-goal-modal').hidden) {
        $('arrival-goal-modal').hidden = true;
        playTick(stateObj.soundEnabled);
        return;
      }
      if ($('pocket-mode-overlay') && !$('pocket-mode-overlay').hidden) {
        setPocketModeUi(false);
        playTick(stateObj.soundEnabled);
        return;
      }
      if ($('map-style-popover') && !$('map-style-popover').hidden) {
        $('map-style-popover').hidden = true;
        $('btn-top-pill-style')?.setAttribute('aria-expanded', 'false');
        $('btn-top-pill-style')?.classList.remove('is-open');
        playTick(stateObj.soundEnabled);
        return;
      }
      if (appSettingsModalOpen || ($('app-settings-modal') && !$('app-settings-modal').hidden)) {
        appSettingsModalOpen = false;
        if ($('app-settings-modal')) $('app-settings-modal').hidden = true;
        playTick(stateObj.soundEnabled);
        return;
      }
      if (saveMemoryModalOpen || ($('save-memory-modal') && !$('save-memory-modal').hidden)) {
        closeSaveMemoryModal();
        playTick(stateObj.soundEnabled);
        return;
      }
      if (editModalOpen || ($('edit-walk-modal') && !$('edit-walk-modal').hidden)) {
        cancelEditWalkModal();
        return;
      }
      if ($('place-detail-sheet') && !$('place-detail-sheet').hidden) {
        closePlaceDetail();
        playTick(stateObj.soundEnabled);
        return;
      }
      if ($('map-lupa-search-results') && !$('map-lupa-search-results').hidden) {
        $('map-lupa-search-results').hidden = true;
        return;
      }
      if (replacingStopIndex !== null) {
        replacingStopIndex = null;
        renderReplaceStopPicker();
        return;
      }
      if (zenMode) {
        zenMode = false;
        updateZenMode();
        playTick(stateObj.soundEnabled);
      }
    }
  };
  window.addEventListener('keydown', onEscapeKey, { signal: aborter.signal });

  // Rychlé navržení automatického okruhu (Bod 5 & 27)
  $('btn-quick-auto-trip')?.addEventListener('click', () => {
    let trip = autoSuggestTrip({
      origin: plannedRoute.origin,
      targetKm: 5,
      companionMode: stateObj.companionMode || 'solo',
      availablePlaces: getAllAvailablePlaces(),
      discoveries: progress.discoveries,
    });
    if (!trip.found) {
      trip = autoSuggestTrip({
        origin: plannedRoute.origin,
        targetKm: 10,
        companionMode: stateObj.companionMode || 'solo',
        availablePlaces: getAllAvailablePlaces(),
        discoveries: progress.discoveries,
      });
    }
    if (!trip.found) {
      status(trip.reason);
      return;
    }
    plannedRoute.selectedPlaceIds = trip.selectedPlaceIds;
    plannedRoute.routeType = 'loop';
    const kmStr = (trip.analysis.estimatedWalkDistanceM / 1000).toFixed(1).replace('.', ',');
    recalculateRemainingRoute(`Navržen uzavřený okruh zpět na start: ${trip.selectedPlaceIds.length} zastávek (~${kmStr} km).`);
    playStampChord(stateObj.soundEnabled);
    if (map && !active) {
      const pts = [plannedRoute.origin, ...getPlannedPlaces()]
        .filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map(p => [p.lat, p.lng]);
      if (pts.length >= 2) {
        follow = false;
        updateFollowUi();
        setTimeout(() => {
          resizeMap();
          fitMapToLatLngPoints(pts, 40, 16);
        }, 80);
      }
    }
  });

  let autoPlacesQueued = false;
  let queuedAutoPlacesTarget = null;
  let queuedAutoPlacesOpts = {};

  function getVisibleMapSearchRadiusM(centerPos) {
    if (!map) return 6000;
    try {
      const bounds = map.getBounds();
      const ne = bounds?.getNorthEast?.();
      if (ne && centerPos) {
        const dist = haversineMeters(centerPos, { lat: ne.lat, lng: ne.lng });
        if (Number.isFinite(dist) && dist > 1000) {
          return Math.max(4500, Math.min(12000, Math.round(dist * 0.9)));
        }
      }
    } catch {}
    return 6000;
  }

  function updateScanMapAreaButtonState() {
    const scanBtn = $('btn-scan-map-area');
    if (!scanBtn || !map) return;
    const c = map.getCenter();
    const curOrigin = getRouteOriginPoint();
    const distFromOriginM = curOrigin ? (haversineMeters(curOrigin, { lat: c.lat, lng: c.lng }) ?? 0) : 0;
    const pannedAway = distFromOriginM > 450;
    scanBtn.classList.toggle('is-panned-away', pannedAway);
    if (active || demo) {
      scanBtn.hidden = !pannedAway;
      scanBtn.textContent = '✨ Načíst zajímavá místa v této části mapy';
    } else {
      scanBtn.hidden = false;
      scanBtn.textContent = pannedAway
        ? '✨ Načíst zajímavá místa v této oblasti mapy a navrhnout trasu'
        : '✨ Načíst další zajímavá místa z mapy v okolí';
    }
  }

  let autoPlacesReqId = 0;

  async function refreshAutoPlaces(targetPos = null, opts = {}) {
    if (autoPlacesLoading && !opts.autoPlan && !opts.forceRefresh) {
      return;
    }
    const myReqId = ++autoPlacesReqId;
    autoPlacesLoading = true;
    const originPos = targetPos || plannedRoute.origin || lastFix || { lat: 49.6014, lng: 13.8644 };
    const radiusM = opts.radiusM || getVisibleMapSearchRadiusM(originPos);
    const scanBtn = $('btn-scan-map-area');
    const p1ScanBtn = $('btn-p1-scan-map');
    if (scanBtn && !opts.silent) scanBtn.classList.add('is-loading');
    if (p1ScanBtn && !opts.silent) p1ScanBtn.classList.add('is-loading');
    const placesTaskId = opts.silent ? null : beginMapTask('⏳ Načítám místa v okolí…');

    // Okamžitě vykreslíme lokální a uložená místa ještě před síťovým dotazem
    renderPlaces();

    const mergeAndRenderPartial = (partialPlaces) => {
      if (disposed || !Array.isArray(partialPlaces) || partialPlaces.length === 0) return;
      const mergedById = new Map();
      for (const p of partialPlaces) {
        if (p && p.id) mergedById.set(p.id, p);
      }
      for (const p of nearby) {
        if (p && p.id && !mergedById.has(p.id)) mergedById.set(p.id, p);
      }
      nearby = [...mergedById.values()].slice(0, 800);
      renderPlaces();
    };

    try {
      const autoPlaces = await loadAutoPlacesForArea(
        originPos,
        routes,
        config,
        aborter.signal,
        fetch,
        null,
        {
          radiusM,
          forceRefresh: Boolean(opts.forceRefresh),
          onPartialPlaces: mergeAndRenderPartial,
        }
      );
      const loadStatus = getLastAutoPlacesStatus();
      if (!disposed && $('nearby-status')) {
        if (loadStatus.loadFailed && !opts.silent) {
          $('nearby-status').textContent = 'Místa v okolí se nepodařilo načíst';
        } else if (Array.isArray(autoPlaces) && autoPlaces.length > 0) {
          $('nearby-status').textContent = '';
        }
      }
      if (!disposed && Array.isArray(autoPlaces) && autoPlaces.length > 0) {
        mergeAndRenderPartial(autoPlaces);
        if (myReqId === autoPlacesReqId && opts.autoPlan && !active && !demo) {
          applyPhase1QuickSelection(Boolean(opts.silent));
          status(`✨ V oblasti „${plannedRoute.origin?.label || 'mapa'}“ nalezeno ${autoPlaces.length} zajímavých míst — trasa byla navržena!`);
        } else if (myReqId === autoPlacesReqId) {
          renderQuestHud(lastFix || plannedRoute.origin);
        }
      } else if (!disposed && myReqId === autoPlacesReqId && opts.autoPlan && !active && !demo) {
        applyPhase1QuickSelection(Boolean(opts.silent));
      }
    } catch {
      if (!disposed && $('nearby-status') && !opts.silent) {
        $('nearby-status').textContent = 'Místa v okolí se nepodařilo načíst';
      }
    }
    finally {
      if (placesTaskId) endMapTask(placesTaskId);
      if (myReqId === autoPlacesReqId) {
        autoPlacesLoading = false;
        if (scanBtn) scanBtn.classList.remove('is-loading');
        if (p1ScanBtn) p1ScanBtn.classList.remove('is-loading');
        updateScanMapAreaButtonState();
        if (pendingAutoPanCenter && !disposed) {
          const nextCenter = pendingAutoPanCenter;
          pendingAutoPanCenter = null;
          refreshAutoPlaces(nextCenter, { silent: true, autoPlan: false, forceRefresh: false });
        }
      }
    }
  }
  refreshAutoPlaces(null, { silent: true });
  refreshWeatherStrip();

  async function scanCurrentMapViewAndPlan() {
    if (!map) return;
    const c = map.getCenter();
    const mapCenterPt = { lat: Number(c.lat.toFixed(5)), lng: Number(c.lng.toFixed(5)) };

    // Pokud je blízko některého pojmenovaného presetu nebo místa v katalogu, převezmeme jeho pěkný název
    let areaLabel = `Oblast v mapě [${mapCenterPt.lat.toFixed(3)}, ${mapCenterPt.lng.toFixed(3)}]`;
    let areaId = 'map-view-origin';
    for (const preset of CZECH_PLACE_PRESETS) {
      if ((haversineMeters(mapCenterPt, preset) ?? Infinity) < 1800) {
        areaLabel = preset.label.split('(')[0].trim();
        areaId = preset.id;
        break;
      }
    }
    if (areaId === 'map-view-origin') {
      const closestKnown = getAllAvailablePlaces()
        .map(p => ({ p, d: haversineMeters(mapCenterPt, p) ?? Infinity }))
        .sort((a, b) => a.d - b.d)[0];
      if (closestKnown && closestKnown.d < 1600) {
        areaLabel = `Okolí: ${closestKnown.p.title}`;
      }
    }

    if (!active && !demo) {
      pickingStartOnMap = false;
      pickingCustomEndOnMap = false;
      userExplicitlyPickedOrigin = true;
      plannedRoute.origin = {
        id: areaId,
        label: areaLabel,
        lat: mapCenterPt.lat,
        lng: mapCenterPt.lng,
        custom: true,
      };
      status(`🔍 Hledám zajímavá místa v této části mapy (${areaLabel}) a sestavuji trasu…`);
      playTick(stateObj.soundEnabled);
      refreshWeatherStrip(mapCenterPt);
      await refreshAutoPlaces(mapCenterPt, { autoPlan: true, forceRefresh: true });
    } else {
      status(`🔍 Načítám zajímavá místa v zobrazené části mapy…`);
      playTick(stateObj.soundEnabled);
      await refreshAutoPlaces(mapCenterPt, { autoPlan: false, forceRefresh: true });
    }
  }

  async function searchCzechPlaceAndPlan(rawQuery) {
    const query = String(rawQuery || '').trim();
    if (!query) {
      status('Zadej název města nebo místa v ČR (např. Příbram, Brdy, Karlštejn, Tábor)…');
      return;
    }
    const qNorm = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // 1. Zkontrolujeme nejdříve rychlé presety a vestavěný katalog (okamžitá odezva 0 ms)
    const matchedPreset = CZECH_PLACE_PRESETS.find(p =>
      p.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(qNorm) ||
      p.id.toLowerCase().includes(qNorm)
    );
    if (matchedPreset) {
      userExplicitlyPickedOrigin = true;
      plannedRoute.origin = { id: matchedPreset.id, label: matchedPreset.label, lat: matchedPreset.lat, lng: matchedPreset.lng };
      if (map) {
        follow = false;
        updateFollowUi();
        setMapView(matchedPreset.lat, matchedPreset.lng, 13, true);
      }
      refreshWeatherStrip(matchedPreset);
      applyPhase1QuickSelection(true);
      await refreshAutoPlaces(matchedPreset, { autoPlan: true, forceRefresh: true });
      playStampChord(stateObj.soundEnabled);
      return;
    }

    status(`🔍 Hledám „${query}“ na mapě ČR…`);
    const results = await searchPlaceNominatim(query, aborter.signal);
    if (Array.isArray(results) && results.length > 0) {
      const best = results[0];
      const targetOrigin = {
        id: best.id || `cz-${Date.now()}`,
        label: best.shortLabel || best.label || query,
        lat: best.lat,
        lng: best.lng,
        custom: true,
      };
      userExplicitlyPickedOrigin = true;
      plannedRoute.origin = targetOrigin;
      if (map) {
        follow = false;
        updateFollowUi();
        setMapView(targetOrigin.lat, targetOrigin.lng, 13, true);
      }
      refreshWeatherStrip(targetOrigin);
      await refreshAutoPlaces(targetOrigin, { autoPlan: true, forceRefresh: true });
      playStampChord(stateObj.soundEnabled);
    } else {
      status(`Místo „${query}“ se nepodařilo najít. Zkus jiný název obce nebo posuň mapu ručně.`);
    }
  }

  $('btn-scan-map-area')?.addEventListener('click', () => {
    scanCurrentMapViewAndPlan();
  });

  // Bod 27: Uspořádat zastávky podle skutečné pěší vzdálenosti (zachová již navštívené zastávky a počítá od současné polohy při chůzi)
  $('btn-optimize-route')?.addEventListener('click', () => {
    const plannedPlaces = getPlannedPlaces();
    if (plannedPlaces.length < 2) return;
    const isLoop = plannedRoute.routeType === 'loop';
    const ordered = optimizeRouteOrder(plannedRoute.origin, plannedPlaces, {
      returnToOrigin: isLoop,
      visitedStopIds: confirmedStopIds,
      currentPosition: (active && lastFix) ? lastFix : null,
    });
    plannedRoute.selectedPlaceIds = ordered.map(p => p.id);
    playHammer(stateObj.soundEnabled);
    recalculateRemainingRoute('Zastávky byly uspořádány podle skutečné pěší vzdálenosti (se zachováním již navštívených míst).');
  });

  // Sdílení a import kódu trasy
  $('btn-share-route-code')?.addEventListener('click', async () => {
    try {
      const code = encodeRouteShareCode(plannedRoute, getAllAvailablePlaces());
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        status(`Kód trasy ${code} byl zkopírován do schránky!`);
      } else {
        status(`Kód trasy: ${code}`);
      }
      playTick(stateObj.soundEnabled);
    } catch (err) {
      status('Chyba při kódování trasy: ' + err.message);
    }
  });

  $('btn-import-route-code')?.addEventListener('click', () => {
    const input = window.prompt('Vlož sdílený kód trasy (např. CZK1-...):');
    if (!input) return;
    try {
      const available = getAllAvailablePlaces();
      const plan = decodeRouteShareCode(input.trim(), available);
      const check = validateDecodedRoutePlan(plan, available);
      if (!check.valid) {
        throw new Error(check.reason);
      }
      plannedRoute = {
        ...plannedRoute,
        ...plan,
        embeddedStops: Array.isArray(plan.embeddedStops) ? plan.embeddedStops : [],
      };
      stateObj.companionMode = plan.companionMode;
      stateObj.explorationMode = plan.explorationMode;
      recalculateRemainingRoute(`Sdílená trasa (${plan.selectedPlaceIds.length} zastávek) byla ověřena a načtena!`);
      playStampChord(stateObj.soundEnabled);
    } catch (err) {
      status('Kód trasy nebyl načten (původní plán zachován): ' + err.message);
    }
  });

  // Přepínač mapového stylu / mlhy (Pergamen / Čistá mapa / Plná mlha)
  const FOG_MODE_ORDER = ['explore', 'none', 'full'];
  function updateFogToggleLabel() {
    const btn = $('walk-fog-toggle');
    if (!btn) return;
    if (fogMode === 'none') {
      btn.textContent = '🗺️';
      btn.title = 'Přepnout pergamen / běžnou mapu (nyní: Čistá mapa)';
      btn.setAttribute('aria-label', 'Přepnout pergamen nebo běžnou mapu');
    } else if (fogMode === 'full') {
      btn.textContent = '🌑';
      btn.title = 'Přepnout pergamen / běžnou mapu (nyní: Plná mlha)';
      btn.setAttribute('aria-label', 'Přepnout pergamen nebo běžnou mapu');
    } else {
      btn.textContent = '📜';
      btn.title = 'Přepnout pergamen / běžnou mapu (nyní: Pergamen)';
      btn.setAttribute('aria-label', 'Přepnout pergamen nebo běžnou mapu');
    }
    btn.dataset.fogMode = fogMode;
    btn.classList.toggle('active', fogMode !== 'none');
  }
  $('walk-fog-toggle')?.addEventListener('click', () => {
    const idx = FOG_MODE_ORDER.indexOf(fogMode);
    fogMode = FOG_MODE_ORDER[(idx + 1) % FOG_MODE_ORDER.length];
    updateFogToggleLabel();
    playTick(stateObj.soundEnabled);
    scheduleFog();
  });
  updateFogToggleLabel();

  // ZADÁNÍ #09 (Fáze 1): Okamžitý výpočet trasy podle 3 rychlých voleb (Co chci vidět / Délka / Kde končím)
  function getCategoriesForPhase1Theme(theme) {
    if (theme === 'castles') return ['castles', 'town'];
    if (theme === 'nature') return ['nature', 'views'];
    if (theme === 'water') return ['water', 'nature'];
    return PLANNER_CATEGORIES.map(c => c.id);
  }

  function applyPhase1QuickSelection(silent = false) {
    const cats = getCategoriesForPhase1Theme(phase1Theme);
    plannedRoute.categories = cats;
    plannedRoute.targetKm = phase1DurationKm;
    plannedRoute.companionMode = 'solo';
    plannedRoute.terrainDifficulty = 'medium';
    wizardCategories = [...cats];
    wizardDistanceMode = String(phase1DurationKm);

    const originPt = getRouteOriginPoint();
    const rawAllPlaces = getAllAvailablePlaces();
    const localPlaces = rawAllPlaces.filter(p => (haversineMeters(originPt, p) ?? Infinity) <= 15000);
    const allPlaces = localPlaces.length > 0 ? localPlaces : rawAllPlaces;
    let pool = allPlaces.filter(p => {
      if (phase1Theme === 'all') return true;
      if (phase1Theme === 'castles') return p.category === 'castles' || p.kind === 'culture' || p.kind === 'heritage' || p.kind === 'castle';
      if (phase1Theme === 'nature') return p.category === 'nature' || p.category === 'views' || p.kind === 'view' || p.kind === 'nature' || p.kind === 'peak';
      if (phase1Theme === 'water') return p.category === 'water' || p.kind === 'water' || p.kind === 'spring';
      return true;
    });
    if (pool.length < 2) pool = allPlaces;

    let trip = autoSuggestTrip({
      origin: originPt,
      targetKm: phase1DurationKm,
      companionMode: 'solo',
      terrainDifficulty: 'medium',
      availablePlaces: pool,
      discoveries: progress.discoveries,
    });
    if (!trip.found) {
      trip = autoSuggestTrip({
        origin: originPt,
        targetKm: phase1DurationKm,
        companionMode: 'solo',
        terrainDifficulty: 'medium',
        availablePlaces: allPlaces,
        discoveries: progress.discoveries,
      });
    }

    if (trip.found && trip.selectedPlaceIds.length > 0) {
      if (phase1EndMode === 'custom') {
        plannedRoute.routeType = 'oneway';
        const existingCustomEnd = (plannedRoute.embeddedStops || []).find(s => s.id === 'custom-end-stop');
        const baseIds = trip.selectedPlaceIds.filter(id => id !== 'custom-end-stop');
        plannedRoute.selectedPlaceIds = existingCustomEnd ? [...baseIds, 'custom-end-stop'] : baseIds;
      } else {
        plannedRoute.routeType = 'loop';
        plannedRoute.selectedPlaceIds = trip.selectedPlaceIds;
      }

      // Uložíme dynamicky načtené body (OSM / Wikipedia) do embeddedStops, aby trasa kdekoliv v ČR zůstala trvale uložená
      const catalogueIds = new Set(catalogue.map(c => c.id));
      const existingEmbedded = (plannedRoute.embeddedStops || []).filter(s => s && s.id === 'custom-end-stop');
      const dynamicSelected = plannedRoute.selectedPlaceIds
        .filter(id => !catalogueIds.has(id) && id !== 'custom-end-stop')
        .map(id => allPlaces.find(p => p.id === id))
        .filter(Boolean)
        .map(p => ({
          id: p.id,
          title: p.title,
          lat: p.lat,
          lng: p.lng,
          kind: p.kind || 'nature',
          category: p.category || 'nature',
        }));
      plannedRoute.embeddedStops = [...existingEmbedded, ...dynamicSelected];
    }

    lastRoutedGeometry = null;
    recalculateRemainingRoute(
      silent ? '' : `Trasa upravena: ~${phase1DurationKm} km · ${plannedRoute.selectedPlaceIds.length} zastávky.`
    );
  }

  $('phase1-bottom-bar')?.addEventListener('click', (ev) => {
    const simBtn = ev.target.closest('#btn-top-sim-toggle');
    if (simBtn) {
      $('walk-fake-gps-toggle')?.click();
      simBtn.classList.toggle('active', Boolean(fakeGpsSim?.isOpen));
      return;
    }

    const gmBtn = ev.target.closest('[data-p1-gamemode]');
    if (gmBtn) {
      const parent = gmBtn.parentElement;
      if (parent) {
        parent.querySelectorAll('[data-p1-gamemode]').forEach(btn => {
          btn.classList.remove('active');
          btn.setAttribute('aria-pressed', 'false');
        });
      }
      gmBtn.classList.add('active');
      gmBtn.setAttribute('aria-pressed', 'true');
      applyGameMode(gmBtn.dataset.p1Gamemode);
      renderPhase1AndPhase4Ui(lastFix || telemetry.lastKnownPosition);
      return;
    }

    const themeBtn = ev.target.closest('[data-p1-theme]');
    if (themeBtn) {
      const parent = themeBtn.parentElement;
      if (parent) {
        parent.querySelectorAll('[data-p1-theme]').forEach(btn => {
          btn.classList.remove('active');
          btn.setAttribute('aria-pressed', 'false');
        });
      }
      themeBtn.classList.add('active');
      themeBtn.setAttribute('aria-pressed', 'true');
      phase1Theme = themeBtn.dataset.p1Theme || 'all';
      const cats = phase1Theme === 'castles'
        ? ['castles']
        : phase1Theme === 'nature'
          ? ['nature', 'views']
          : phase1Theme === 'water'
            ? ['water']
            : PLANNER_CATEGORIES.map(c => c.id);
      plannedRoute.categories = [...cats];
      wizardCategories = [...cats];
      renderPlaces();
      renderPhase1AndPhase4Ui(lastFix || telemetry.lastKnownPosition);
      playTick(stateObj.soundEnabled);
      return;
    }
  });

  // DÁVKA 2 (P1 Bod 6): Lupa vyhledávání přímo v mapě s respektováním Nominatim pravidel,
  // rate limitem 1 dotaz/s, bez falešných výsledků a bez automatického posouvání mapy.
  let lupaAbortController = null;
  let lastNominatimCallAt = 0;
  let lupaRequestId = 0;

  async function performInMapLupaSearch(rawQuery, isExplicitSubmit = false) {
    const resultsBox = $('map-lupa-search-results');
    const clearBtn = $('map-lupa-search-clear');
    const q = String(rawQuery || '').trim();
    if (clearBtn) clearBtn.hidden = q.length === 0;
    if (!resultsBox) return;

    const currentReqId = ++lupaRequestId;

    // 1. Když je pole prázdné: zobrazíme místní tipy v okolí
    if (!q) {
      const presets = CZECH_PLACE_PRESETS.slice(0, 6).map(p => ({
        id: p.id,
        title: p.label,
        sub: 'Místní tip v okolí (výchozí bod)',
        lat: p.lat,
        lng: p.lng,
      }));
      lastLupaResults = presets;
      resultsBox.hidden = false;
      resultsBox.innerHTML = `
        <div class="map-search-header-note" style="padding:6px 12px;font-size:0.78rem;font-weight:700;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.08)">📍 Místní tipy v okolí:</div>
        ${presets.map((item, idx) => `
          <div class="map-search-item" role="option" data-lupa-idx="${idx}">
            <div class="map-search-item-head">
              <strong class="map-search-item-title">${e(item.title)}</strong>
              <span class="map-search-item-sub">${e(item.sub || '')}</span>
            </div>
            <div class="map-search-item-actions">
              <button type="button" class="button small map-search-action-btn start-here" data-lupa-action="start" data-lupa-idx="${idx}">
                📍 Začít zde
              </button>
              <button type="button" class="button small map-search-action-btn add-stop" data-lupa-action="add" data-lupa-idx="${idx}">
                + Přidat
              </button>
            </div>
          </div>
        `).join('')}
      `;
      return;
    }

    if (q.length < 2) {
      resultsBox.hidden = true;
      resultsBox.innerHTML = '';
      return;
    }

    const qNorm = normalizeSearchQuery(q);
    const localCandidates = [
      ...CZECH_PLACE_PRESETS.map(p => ({ id: p.id, title: p.label, lat: p.lat, lng: p.lng, sub: 'Město / oblast v ČR' })),
      ...getAllAvailablePlaces().map(p => ({ id: p.id, title: p.title, lat: p.lat, lng: p.lng, sub: 'Místo v paměti / v okolí', kind: p.kind, category: p.category })),
    ].filter(item => normalizeSearchQuery(item.title).includes(qNorm));

    // Pokud uživatel pouze píše (není explicitní submit Enter / Hledat):
    // Při psaní filtrujeme VÝHRADNĚ lokální místa v paměti (dodržení pravidel Nominatim API)
    if (!isExplicitSubmit) {
      lastLupaResults = localCandidates.slice(0, 8);
      resultsBox.hidden = false;
      if (lastLupaResults.length === 0) {
        resultsBox.innerHTML = `
          <div class="map-search-item">
            <span class="map-search-item-sub">V lokální paměti nenalezeno. Pro celosvětové hledání stiskni <strong>Enter</strong> nebo tlačítko <strong>Hledat</strong>.</span>
          </div>
        `;
      } else {
        resultsBox.innerHTML = `
          ${lastLupaResults.map((item, idx) => `
            <div class="map-search-item" role="option" data-lupa-idx="${idx}">
              <div class="map-search-item-head">
                <strong class="map-search-item-title">${e(item.title)}</strong>
                <span class="map-search-item-sub">${e(item.sub || '')}</span>
              </div>
              <div class="map-search-item-actions">
                <button type="button" class="button small map-search-action-btn start-here" data-lupa-action="start" data-lupa-idx="${idx}">
                  📍 Začít zde
                </button>
                <button type="button" class="button small map-search-action-btn add-stop" data-lupa-action="add" data-lupa-idx="${idx}">
                  + Přidat
                </button>
              </div>
            </div>
          `).join('')}
          <div class="map-search-footer-hint" style="padding:6px 12px;font-size:0.75rem;color:#94a3b8;border-top:1px solid rgba(255,255,255,0.08)">
            Pro celosvětové hledání mimo paměť stiskni <strong>Enter</strong> nebo tlačítko <strong>Hledat</strong>.
          </div>
        `;
      }
      return;
    }

    // Uživatel výslovně potvrdil odeslání (Enter nebo klik na tlačítko Hledat)
    // Zrušíme předchozí běžící dotaz (AbortController)
    if (lupaAbortController) {
      try { lupaAbortController.abort(); } catch {}
    }
    lupaAbortController = new AbortController();

    // Dodržíme limit max 1 dotaz za sekundu (Nominatim Usage Policy)
    const now = Date.now();
    const elapsed = now - lastNominatimCallAt;
    if (elapsed < 1000) {
      await new Promise(r => setTimeout(r, 1000 - elapsed));
      if (currentReqId !== lupaRequestId || disposed) return;
    }
    lastNominatimCallAt = Date.now();

    resultsBox.hidden = false;
    resultsBox.innerHTML = `<div class="map-search-item"><span class="map-search-item-sub">🔍 Hledám „${e(q)}“…</span></div>`;

    let onlineItems = [];
    let fetchError = false;
    try {
      const nom = await searchPlaceNominatim(q, {
        signal: lupaAbortController.signal,
        fetchImpl: typeof fetch !== 'undefined' ? fetch : null,
      });
      if (currentReqId !== lupaRequestId || disposed) return;
      onlineItems = (nom || []).map((n, i) => ({
        id: n.id || `nom-${Date.now()}-${i}`,
        title: n.label.split(',')[0].trim(),
        sub: n.label,
        lat: n.lat,
        lng: n.lng,
        kind: 'culture',
        category: 'views',
      }));
    } catch (err) {
      if (currentReqId !== lupaRequestId || disposed) return;
      if (err?.name !== 'AbortError') {
        fetchError = true;
      }
    }

    // Sloučíme lokální shody a online výsledky (bez duplicit)
    const seenMap = new Set();
    const combined = [];
    for (const item of [...localCandidates, ...onlineItems]) {
      const key = `${Math.round(item.lat * 1000)},${Math.round(item.lng * 1000)}`;
      if (!seenMap.has(key)) {
        seenMap.add(key);
        combined.push(item);
      }
    }
    const finalItems = combined.slice(0, 10);
    lastLupaResults = finalItems;

    if (finalItems.length === 0) {
      resultsBox.hidden = false;
      const msg = fetchError
        ? 'Chyba připojení při vyhledávání.'
        : `Žádné odpovídající místo nebylo nalezeno pro „${e(q)}“.`;
      resultsBox.innerHTML = `<div class="map-search-item"><span class="map-search-item-sub">${e(msg)}</span></div>`;
      return;
    }

    resultsBox.hidden = false;
    resultsBox.innerHTML = finalItems.map((item, idx) => `
      <div class="map-search-item" role="option" data-lupa-idx="${idx}">
        <div class="map-search-item-head">
          <strong class="map-search-item-title">${e(item.title)}</strong>
          <span class="map-search-item-sub">${e(item.sub || '')}</span>
        </div>
        <div class="map-search-item-actions">
          <button type="button" class="button small map-search-action-btn start-here" data-lupa-action="start" data-lupa-idx="${idx}">
            📍 Začít zde
          </button>
          <button type="button" class="button small map-search-action-btn add-stop" data-lupa-action="add" data-lupa-idx="${idx}">
            + Přidat do trasy
          </button>
        </div>
      </div>
    `).join('');
  }

  $('map-lupa-search-input')?.addEventListener('focus', () => {
    const inp = $('map-lupa-search-input');
    if (inp && !inp.value.trim()) {
      performInMapLupaSearch('', false);
    }
  });

  $('map-lupa-search-input')?.addEventListener('input', (ev) => {
    const val = ev.target.value;
    if (lupaSearchTimer) clearTimeout(lupaSearchTimer);
    lupaSearchTimer = setTimeout(() => {
      performInMapLupaSearch(val, false);
    }, 200);
  });

  $('map-lupa-search-input')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (lupaSearchTimer) clearTimeout(lupaSearchTimer);
      performInMapLupaSearch(ev.currentTarget.value, true);
    }
  });

  $('map-lupa-search-submit')?.addEventListener('click', () => {
    const inp = $('map-lupa-search-input');
    if (lupaSearchTimer) clearTimeout(lupaSearchTimer);
    performInMapLupaSearch(inp ? inp.value : '', true);
  });

  $('map-lupa-search-clear')?.addEventListener('click', () => {
    const inp = $('map-lupa-search-input');
    if (inp) inp.value = '';
    if ($('map-lupa-search-clear')) $('map-lupa-search-clear').hidden = true;
    if ($('map-lupa-search-results')) {
      $('map-lupa-search-results').hidden = true;
      $('map-lupa-search-results').innerHTML = '';
    }
  });

  $('map-lupa-search-results')?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-lupa-action]');
    if (!btn) return;
    const action = btn.dataset.lupaAction;
    const idx = Number(btn.dataset.lupaIdx);
    const item = lastLupaResults[idx];
    if (!item) return;

    if ($('map-lupa-search-results')) $('map-lupa-search-results').hidden = true;

    if (action === 'start') {
      userExplicitlyPickedOrigin = true;
      plannedRoute.origin = {
        id: item.id || `lupa-${Date.now()}`,
        label: item.title,
        lat: item.lat,
        lng: item.lng,
        custom: true,
      };
      if (map) {
        follow = false;
        updateFollowUi();
        setMapView(item.lat, item.lng, 14, true);
      }
      refreshWeatherStrip(plannedRoute.origin);
      refreshAutoPlaces(plannedRoute.origin, { autoPlan: false, forceRefresh: true });
      recalculateRemainingRoute(`📍 Start výpravy nastaven na: ${item.title}.`);
      playStampChord(stateObj.soundEnabled);
    } else if (action === 'add') {
      const stopObj = {
        id: item.id || `stop-${Date.now()}`,
        title: item.title,
        lat: item.lat,
        lng: item.lng,
        kind: item.kind || 'culture',
        category: item.category || 'views',
      };
      if (map) {
        follow = false;
        updateFollowUi();
        setMapView(item.lat, item.lng, Math.max(map.getZoom?.() || 14, 14), true);
      }
      playStampChord(stateObj.soundEnabled);
      addStopToRoute(stopObj, {
        reasonMsg: `+ Místo „${item.title}“ přidáno do trasy.`,
      });
    }
  });

  // 7.2 Tlačítko „📥 Stáhnout tuto oblast offline“ (#btn-download-offline-map)
  $('btn-download-offline-map')?.addEventListener('click', async () => {
    const banner = $('offline-download-banner');
    const bounds = map ? map.getBounds() : { south: 49.56, west: 13.80, north: 49.64, east: 13.92 };
    const center = map ? map.getCenter() : getRouteOriginPoint();
    if (banner) {
      banner.hidden = false;
      banner.textContent = 'Stahuji mapu do paměti: 0 %...';
    }
    playTick(stateObj.soundEnabled);
    await downloadOfflineArea({
      bounds,
      center: { lat: center.lat, lng: center.lng },
      places: getAllAvailablePlaces(),
      plannedRoute,
      onProgress: (info) => {
        if (banner) {
          banner.hidden = false;
          banner.textContent = info.text;
        }
        status(info.text);
      },
    });
    playStampChord(stateObj.soundEnabled);
    setTimeout(() => {
      if (banner && !disposed) banner.hidden = true;
    }, 4500);
  });

  // 8.2 Kapesní režim (#btn-pocket-mode a #pocket-mode-overlay)
  function setPocketModeUi(enabled) {
    keepAliveCtrl.setPocketMode(enabled);
    const overlay = $('pocket-mode-overlay');
    if (!overlay) return;
    overlay.hidden = !enabled;
    if (enabled) {
      const plannedPlaces = getPlannedPlaces();
      const rem = computeRemainingFromSharedRoute({
        sharedRoute: lastRoutedGeometry,
        currentPos: lastFix || getRouteOriginPoint(),
        plannedPlaces,
        confirmedStopIds,
        companionMode: 'solo',
        returnToOrigin: plannedRoute.routeType === 'loop',
        origin: getRouteOriginPoint(),
      });
      const statsEl = $('pocket-mode-stats');
      if (statsEl) {
        if (rem.nextStop) {
          statsEl.textContent = `Další cíl: ${rem.nextStop.title} (${formatDistanceLabel(rem.nextStopDistanceM)})`;
        } else if (plannedPlaces.length > 0) {
          statsEl.textContent = `Zbývá do cíle: ${formatDistanceLabel(rem.remainingDistanceM)}`;
        } else {
          const gainedM = currentExpedition ? Math.max(0, progress.meters - (currentExpedition.startMeters || 0)) : progress.meters;
          statsEl.textContent = `Ušlá vzdálenost: ${formatMetersCz(gainedM)}`;
        }
      }
      const curPos = lastFix || telemetry.lastKnownPosition || getRouteOriginPoint();
      const instr = computeActiveTurnInstruction(lastRoutedGeometry, curPos, plannedPlaces, confirmedStopIds);
      const voiceMsg = instr?.voiceText || instr?.text || (rem.nextStop ? `Kapesní režim aktivní. Další cíl ${rem.nextStop.title}, ${ Math.round(rem.nextStopDistanceM || 0) } metrů.` : 'Kapesní režim aktivní. Hlasová navigace běží na pozadí.');
      speakCzechNav(voiceMsg, `pocket-enter-${Date.now()}`, instr?.turnDirection || 'straight');
    }
  }

  $('btn-pocket-mode')?.addEventListener('click', (ev) => {
    ev?.stopPropagation?.();
    unlockSpeechSynthesis();
    setPocketModeUi(true);
    playTick(stateObj.soundEnabled);
  });

  $('btn-direct-pocket-mode')?.addEventListener('click', (ev) => {
    ev?.stopPropagation?.();
    unlockSpeechSynthesis();
    if (walkState === 'idle') {
      startUnifiedExpedition('pocket-direct');
    }
    setPocketModeUi(true);
    playTick(stateObj.soundEnabled);
  });

  $('btn-pocket-unlock')?.addEventListener('click', () => {
    setPocketModeUi(false);
    playTick(stateObj.soundEnabled);
  });

  $('pocket-mode-overlay')?.addEventListener('dblclick', () => {
    setPocketModeUi(false);
    playTick(stateObj.soundEnabled);
  });

  $('pocket-mode-overlay')?.addEventListener('click', (ev) => {
    if (ev.target === $('pocket-mode-overlay') || !ev.target.closest('.pocket-mode-box')) {
      setPocketModeUi(false);
      playTick(stateObj.soundEnabled);
    }
  });

  // 1.2 Krok 4: Obsluha tlačítek v dialogu „🎉 Jsi v cíli své trasy! Co chceš udělat dál?“
  $('arrival-goal-modal')?.addEventListener('click', (ev) => {
    if (ev.target === $('arrival-goal-modal') || !ev.target.closest('.arrival-goal-dialog')) {
      $('arrival-goal-modal').hidden = true;
      playTick(stateObj.soundEnabled);
    }
  });

  $('btn-arrival-close-x')?.addEventListener('click', () => {
    if ($('arrival-goal-modal')) $('arrival-goal-modal').hidden = true;
    playTick(stateObj.soundEnabled);
  });

  $('btn-arrival-return-start')?.addEventListener('click', () => {
    if ($('arrival-goal-modal')) $('arrival-goal-modal').hidden = true;
    shortenRouteToStart();
  });

  $('btn-arrival-finish-postcard')?.addEventListener('click', () => {
    if ($('arrival-goal-modal')) $('arrival-goal-modal').hidden = true;
    finishUnifiedExpedition();
  });

  // Interaktivní itinerář zastávek v horní liště (#top-route-itinerary-strip)
  $('top-route-itinerary-strip')?.addEventListener('click', (ev) => {
    const removeBtn = ev.target.closest('[data-itinerary-remove]');
    if (removeBtn) {
      ev.stopPropagation();
      const idx = Number(removeBtn.dataset.itineraryRemove);
      const ids = plannedRoute.selectedPlaceIds || [];
      const removedPlace = getAllAvailablePlaces().find(p => p.id === ids[idx]);
      plannedRoute.selectedPlaceIds = removePlannedStop(ids, idx);
      playTick(stateObj.soundEnabled);
      recalculateRemainingRoute(`✕ Zastávka „${removedPlace?.title || ''}“ byla vynechána z trasy.`);
      return;
    }

    const focusBtn = ev.target.closest('[data-itinerary-focus]');
    if (focusBtn) {
      const placeId = focusBtn.dataset.itineraryFocus;
      const place = getAllAvailablePlaces().find(p => p.id === placeId);
      if (place) {
        if (map) {
          follow = false;
          updateFollowUi();
          setMapView(place.lat, place.lng, Math.max(map.getZoom?.() || 15, 15), true);
        }
        openPlaceDetail(place);
        playTick(stateObj.soundEnabled);
      }
      return;
    }

    if (ev.target.closest('[data-itinerary-start]')) {
      const orig = getRouteOriginPoint();
      if (map && orig) {
        follow = false;
        updateFollowUi();
        setMapView(orig.lat, orig.lng, Math.max(map.getZoom?.() || 14, 14), true);
        playTick(stateObj.soundEnabled);
      }
    }
  });

  // Kliknutí na zastávku v košíku pod mapou vycentruje mapu na bod a otevře detail místo chyby
  $('planner-basket-list')?.addEventListener('click', (ev) => {
    const focusEl = ev.target.closest('[data-focus-stop-id]');
    if (focusEl && !ev.target.closest('.basket-item-controls')) {
      const stopId = focusEl.dataset.focusStopId;
      const place = getAllAvailablePlaces().find(p => p.id === stopId);
      if (place) {
        if (map) {
          follow = false;
          updateFollowUi();
          setMapView(place.lat, place.lng, Math.max(map.getZoom?.() || 16, 16), true);
        }
        openPlaceDetail(place);
        playTick(stateObj.soundEnabled);
      }
    }
  });

  // Kliknutí na kategorii v legendě tvarů a barev (#poi-category-legend) filtruje body zájmu
  $('poi-category-legend')?.addEventListener('click', (ev) => {
    const chip = ev.target.closest('[data-visual-cat-filter]');
    if (!chip) return;
    const val = chip.dataset.visualCatFilter || 'all';
    plannedRoute.visualCategoryFilter = (plannedRoute.visualCategoryFilter === val && val !== 'all') ? 'all' : val;
    playTick(stateObj.soundEnabled);
    renderPlaces();
  });

  // Tlačítka v horní liště (#phase1-top-bar): Celá obrazovka, Upravit zastávky, Nastavení, Pauza, Sbalit volby
  $('btn-top-fullscreen')?.addEventListener('click', () => {
    zenMode = !zenMode;
    updateZenMode();
    playTick(stateObj.soundEnabled);
  });

  $('btn-top-edit-walk')?.addEventListener('click', () => {
    openEditWalkModal();
    playTick(stateObj.soundEnabled);
  });

  $('btn-top-settings')?.addEventListener('click', () => {
    appSettingsModalOpen = true;
    const modal = $('app-settings-modal');
    if (modal) modal.hidden = false;
    renderAppSettingsModalUi();
    playTick(stateObj.soundEnabled);
  });

  function setStylePopoverOpen(open) {
    const isOpen = Boolean(open);
    if (isOpen) {
      closeCompetingMapOverlays('style');
    }
    const pop = $('map-style-popover');
    const btn = $('btn-top-pill-style');
    if (pop) pop.hidden = !isOpen;
    if (btn) {
      btn.setAttribute('aria-expanded', String(isOpen));
      btn.classList.toggle('is-open', isOpen);
    }
  }

  $('btn-top-pill-style')?.addEventListener('click', (ev) => {
    ev?.stopPropagation?.();
    const pop = $('map-style-popover');
    if (pop) {
      const nextOpen = Boolean(pop.hidden);
      setStylePopoverOpen(nextOpen);
      playTick(stateObj.soundEnabled);
      return;
    }
    appSettingsModalOpen = true;
    const modal = $('app-settings-modal');
    if (modal) modal.hidden = false;
    renderAppSettingsModalUi();
    playTick(stateObj.soundEnabled);
  });

  $('btn-close-style-popover')?.addEventListener('click', (ev) => {
    ev?.stopPropagation?.();
    setStylePopoverOpen(false);
    playTick(stateObj.soundEnabled);
  });

  $('map-style-popover')?.addEventListener('click', (ev) => {
    ev?.stopPropagation?.();
    const gmBtn = ev.target.closest('[data-p1-gamemode]');
    if (gmBtn) {
      applyGameMode(gmBtn.dataset.p1Gamemode);
      renderPhase1AndPhase4Ui(lastFix || telemetry.lastKnownPosition);
      setStylePopoverOpen(false);
      return;
    }
    if (ev.target.closest('#btn-popover-sim-toggle')) {
      setStylePopoverOpen(false);
      $('walk-fake-gps-toggle')?.click();
      return;
    }
    if (ev.target.closest('#btn-popover-all-settings')) {
      setStylePopoverOpen(false);
      appSettingsModalOpen = true;
      const modal = $('app-settings-modal');
      if (modal) modal.hidden = false;
      renderAppSettingsModalUi();
      playTick(stateObj.soundEnabled);
    }
  });

  $('btn-top-pill-sim')?.addEventListener('click', (ev) => {
    ev?.stopPropagation?.();
    $('walk-fake-gps-toggle')?.click();
  });

  document.addEventListener('click', (ev) => {
    const pop = $('map-style-popover');
    if (!pop || pop.hidden) return;
    if (ev.target.closest('#map-style-popover') || ev.target.closest('#btn-top-pill-style')) return;
    setStylePopoverOpen(false);
  }, { signal: aborter.signal });

  $('turn-pill-compass')?.addEventListener('click', (ev) => {
    ev?.stopPropagation?.();
    if (!map) return;
    follow = true;
    const pos = visualPlayerPos || lastFix || telemetry.lastKnownPosition || getRouteOriginPoint();
    try {
      map.easeTo({
        bearing: 0,
        center: pos ? [pos.lng, pos.lat] : undefined,
        duration: 400,
      });
    } catch {}
    syncTurnPillCompassBearing();
    playTick(stateObj.soundEnabled);
  });

  $('btn-top-pause')?.addEventListener('click', () => {
    togglePauseUnified();
  });

  $('btn-toggle-p1-bar')?.addEventListener('click', () => {
    p1PlannerCollapsed = !p1PlannerCollapsed;
    renderPhase1AndPhase4Ui(lastFix || telemetry.lastKnownPosition);
    playTick(stateObj.soundEnabled);
  });

  // DÁVKA 1 (Bod 2.1): Kliknutí na „▶ Vyrazit“ okamžitě zahájí proces startu (locating),
  // i když uživatel nemá naklikanou žádnou trasu (volná procházka).
  $('btn-phase1-go')?.addEventListener('click', () => {
    pickingCustomEndOnMap = false;
    pickingStartOnMap = false;
    phase4MenuOpen = false;
    follow = true;
    updateFollowUi();
    startUnifiedExpedition('top-bar');
  });

  // Události Fáze 4: [ 🏁 Dokončit / Zkrátit ] -> 2 možnosti
  $('btn-phase4-toggle')?.addEventListener('click', () => {
    phase4MenuOpen = !phase4MenuOpen;
    renderPhase1AndPhase4Ui(lastFix || telemetry.lastKnownPosition);
    playTick(stateObj.soundEnabled);
  });

  // 1) 🏠 Už chci do cíle (Zkrátit trasu)
  $('btn-phase4-shorten')?.addEventListener('click', async () => {
    phase4MenuOpen = false;
    renderPhase1AndPhase4Ui(lastFix || telemetry.lastKnownPosition);

    const startOrigin = getRouteOriginPoint();
    const planned = getPlannedPlaces();
    const finalTarget = (plannedRoute.routeType === 'oneway' && planned.length > 0)
      ? planned[planned.length - 1]
      : startOrigin;

    const fromPos = lastFix || telemetry.lastKnownPosition || map?.getCenter() || startOrigin;
    const curPoint = { lat: Number(fromPos.lat), lng: Number(fromPos.lng) };
    playStampChord(stateObj.soundEnabled);
    status('🏠 Zkracuji trasu — počítám nejkratší pěší cestu rovnou do cíle…');

    let retRoute = null;
    const shortenTaskId = beginMapTask('⏳ Počítám trasu…');
    try {
      retRoute = await buildReturnToOriginRoute(curPoint, finalTarget);
    } finally {
      endMapTask(shortenTaskId);
    }
    if (disposed || !retRoute) return;

    const returnStopId = 'return-origin-stop';
    const returnStopObj = {
      id: returnStopId,
      title: finalTarget.title || finalTarget.label || 'Cíl výpravy',
      lat: finalTarget.lat,
      lng: finalTarget.lng,
      kind: 'town',
      category: 'views',
    };
    plannedRoute.embeddedStops = [
      ...(plannedRoute.embeddedStops || []).filter(s => s.id !== returnStopId),
      returnStopObj,
    ];
    const visitedIds = (plannedRoute.selectedPlaceIds || []).filter(id => confirmedStopIds.has(id));
    plannedRoute.selectedPlaceIds = [...visitedIds, returnStopId];
    plannedRoute.routeType = 'oneway';
    lastRoutedGeometry = retRoute;
    fakeGpsSim?.setSharedWalkingRoute(lastRoutedGeometry);

    recalculateRemainingRoute(
      `🏠 Trasa zkrácena — naviguji nejkratší pěší cestou rovnou do cíle (${formatDistanceLabel(retRoute.distanceM)}).`
    );
  });

  // 2) ⏹ Ukončit výpravu hned tady (bez penalizace, se štítkem na hůl a pohlednicí)
  $('btn-phase4-finish-now')?.addEventListener('click', () => {
    phase4MenuOpen = false;
    finishExpedition();
  });

  // DÁVKA 1 (Bod 2.1 & 2.3): Přímé akce z trvale viditelné lišty u mapy (.map-action-bar)
  $('walk-start-unified')?.addEventListener('click', () => {
    pickingCustomEndOnMap = false;
    pickingStartOnMap = false;
    startUnifiedExpedition('bar');
  });

  $('btn-toggle-quick-planner')?.addEventListener('click', () => {
    p1PlannerCollapsed = !p1PlannerCollapsed;
    renderPhase1AndPhase4Ui(lastFix || plannedRoute.origin);
    playTick(stateObj.soundEnabled);
  });

  $('walk-finish')?.addEventListener('click', () => {
    finishUnifiedExpedition();
  });

  $('walk-shorten-to-start')?.addEventListener('click', () => {
    shortenRouteToStart();
  });

  $('walk-pause')?.addEventListener('click', () => {
    togglePauseUnified();
  });

  $('walk-more-btn')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    moreMenuOpen = !moreMenuOpen;
    const menu = $('walk-more-menu');
    if (menu) menu.hidden = !moreMenuOpen;
    $('walk-more-btn')?.setAttribute('aria-expanded', String(moreMenuOpen));
    playTick(stateObj.soundEnabled);
  });

  $('walk-more-settings')?.addEventListener('click', (ev) => {
    ev?.stopPropagation?.();
    moreMenuOpen = false;
    if ($('walk-more-menu')) $('walk-more-menu').hidden = true;
    $('walk-more-btn')?.setAttribute('aria-expanded', 'false');
    appSettingsModalOpen = true;
    const modal = $('app-settings-modal');
    if (modal) {
      modal.hidden = false;
      const firstFocusable = modal.querySelector('button, [tabindex="0"]');
      firstFocusable?.focus();
    }
    renderAppSettingsModalUi();
    playTick(stateObj.soundEnabled);
  });

  $('walk-search-toggle')?.addEventListener('click', () => {
    const searchOverlay = $('map-search-overlay');
    if (searchOverlay) {
      const willOpen = Boolean(searchOverlay.hidden);
      if (willOpen) {
        closeCompetingMapOverlays('search');
      }
      searchOverlay.hidden = !willOpen;
      $('walk-search-toggle')?.classList.toggle('active', willOpen);
      $('walk-map-wrap')?.classList.toggle('has-search-open', willOpen);
      if (willOpen) {
        const searchInput = $('map-lupa-search-input');
        if (searchInput) {
          searchInput.focus();
          searchInput.select?.();
        }
      } else if ($('map-lupa-search-results')) {
        $('map-lupa-search-results').hidden = true;
      }
    }
    playTick(stateObj.soundEnabled);
  });

  // Přepínač vrstvy turistických tras KČT (Waymarked Trails + lokální trasy OSM)
  function syncHikingTrailsLayerState() {
    const btn = $('walk-trails-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', String(showHikingTrails));
      btn.classList.toggle('active', showHikingTrails);
      btn.textContent = showHikingTrails ? '🥾 Turistické značky KČT: ZAP' : '🥾 Turistické značky KČT: VYP';
    }
    if ($('wiz-chk-trails')) $('wiz-chk-trails').checked = showHikingTrails;
    if (map) {
      try {
        if (map.getLayer('waymarked-hiking-layer')) {
          map.setLayoutProperty('waymarked-hiking-layer', 'visibility', showHikingTrails ? 'visible' : 'none');
        }
      } catch {}
    }
    renderHikingTrailsOnMap();
  }

  $('walk-trails-toggle')?.addEventListener('click', () => {
    showHikingTrails = !showHikingTrails;
    syncHikingTrailsLayerState();
    playTick(stateObj.soundEnabled);
  });

  // ZADÁNÍ #08 (Bod 4): Přepínač vrstevnic a terénu (OpenTopoMap s automatickým fallbackem na OSM při chybě dlaždic)
  function setContourLayer(enabled) {
    showContourLayer = Boolean(enabled);
    const btn = $('walk-contours-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', String(showContourLayer));
      btn.classList.toggle('active', showContourLayer);
      btn.textContent = showContourLayer ? '⛰️ Vrstevnice: ZAP' : '⛰️ Vrstevnice: VYP';
    }
    if ($('wiz-chk-contours')) $('wiz-chk-contours').checked = showContourLayer;
    if (!map) return;
    try {
      if (map.getLayer('opentopo-raster-layer')) {
        map.setLayoutProperty('opentopo-raster-layer', 'visibility', showContourLayer ? 'visible' : 'none');
      }
    } catch {}
  }

  $('walk-contours-toggle')?.addEventListener('click', () => {
    setContourLayer(!showContourLayer);
    playTick(stateObj.soundEnabled);
  });

  // ZADÁNÍ #08 (Bod 5): Přepínač hlasové navigace v češtině (Web Speech API)
  function setVoiceNavigation(enabled) {
    voiceNavEnabled = Boolean(enabled);
    stateObj.voiceNavEnabled = voiceNavEnabled;
    if ($('walk-voice-nav')) $('walk-voice-nav').checked = voiceNavEnabled;
    const pillBtn = $('btn-voice-nav-pill');
    if (pillBtn) {
      pillBtn.setAttribute('aria-pressed', String(voiceNavEnabled));
      pillBtn.classList.toggle('active', voiceNavEnabled);
      pillBtn.textContent = voiceNavEnabled ? '🔊 Hlas ZAP' : '🔈 Hlas';
    }
    saveAppState();
    if (voiceNavEnabled) {
      lastSpokenNavStepKey = '';
      speakCzechNav('Hlasová navigace v češtině je zapnutá.', 'voice-init');
      status('🔊 Hlasová navigace v češtině zapnuta.');
    } else {
      try { window.speechSynthesis?.cancel?.(); } catch {}
      status('🔈 Hlasová navigace vypnuta.');
    }
  }

  $('walk-voice-nav')?.addEventListener('change', (ev) => {
    setVoiceNavigation(ev.target.checked);
  });
  $('btn-voice-nav-pill')?.addEventListener('click', () => {
    setVoiceNavigation(!voiceNavEnabled);
    playTick(stateObj.soundEnabled);
  });

  // ZADÁNÍ #08 (Bod 5): Tlačítko „🏠 Navést zpět na start“ (1 klik z jakéhokoliv místa)
  $('btn-return-to-start')?.addEventListener('click', async () => {
    const startOrigin = plannedRoute.origin || START_PRESETS[0];
    const fromPos = lastFix || telemetry.lastKnownPosition || map?.getCenter() || startOrigin;
    const curPoint = { lat: Number(fromPos.lat), lng: Number(fromPos.lng) };
    playStampChord(stateObj.soundEnabled);
    status(`🏠 Počítám nejkratší pěší trasu zpět na start (${startOrigin.label || 'Start'})…`);

    let retRoute = null;
    const returnTaskId = beginMapTask('⏳ Počítám trasu…');
    try {
      retRoute = await buildReturnToOriginRoute(curPoint, startOrigin);
    } finally {
      endMapTask(returnTaskId);
    }
    if (disposed || !retRoute) return;

    const returnStopId = 'return-origin-stop';
    const returnStopObj = {
      id: returnStopId,
      title: `Návrat: ${startOrigin.label || 'Startovní bod'}`,
      lat: startOrigin.lat,
      lng: startOrigin.lng,
      kind: 'town',
      category: 'views',
    };
    plannedRoute.embeddedStops = [
      ...(plannedRoute.embeddedStops || []).filter(s => s.id !== returnStopId),
      returnStopObj,
    ];
    plannedRoute.selectedPlaceIds = [returnStopId];
    plannedRoute.routeType = 'oneway';
    lastRoutedGeometry = retRoute;
    fakeGpsSim?.setSharedWalkingRoute(lastRoutedGeometry);

    recalculateRemainingRoute(
      `🏠 Naviguji nejkratší pěší cestou zpět na start (${startOrigin.label || 'Start'}, ${formatDistanceLabel(retRoute.distanceM)}).`
    );
    speakCzechNav(`Naviguji zpět na start ${startOrigin.label || ''}. Vzdálenost ${Math.round(retRoute.distanceM)} metrů.`, 'return-home');
  });

  // ZADÁNÍ #08 (Bod 1): Logika jednoduchého Průvodce před výpravou (.trip-wizard-sheet)
  function renderTripWizardUi() {
    const sheetEl = $('trip-wizard-sheet');
    if (!sheetEl) return;

    const bodyEl = $('trip-wizard-body');
    const toggleBtn = $('btn-toggle-trip-wizard');
    sheetEl.classList.toggle('collapsed', wizardCollapsed);
    if (bodyEl) bodyEl.hidden = wizardCollapsed;
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', String(!wizardCollapsed));
      toggleBtn.textContent = wizardCollapsed ? '▼ Rozbalit průvodce' : '▲ Sbalit průvodce';
    }

    if ($('wiz-scenario-onsite')) {
      $('wiz-scenario-onsite').classList.toggle('active', wizardScenario === 'on-site');
      $('wiz-scenario-onsite').setAttribute('aria-pressed', String(wizardScenario === 'on-site'));
    }
    if ($('wiz-scenario-home')) {
      $('wiz-scenario-home').classList.toggle('active', wizardScenario === 'from-home');
      $('wiz-scenario-home').setAttribute('aria-pressed', String(wizardScenario === 'from-home'));
    }
    if ($('wiz-home-panel')) {
      $('wiz-home-panel').hidden = wizardScenario !== 'from-home';
    }
    if ($('wiz-active-origin-label')) {
      $('wiz-active-origin-label').textContent = plannedRoute.origin?.label || 'Rožmitál pod Třemšínem — náměstí';
    }

    root.querySelectorAll('[data-wiz-cat]').forEach(chip => {
      const catId = chip.dataset.wizCat;
      const sel = wizardCategories.includes(catId);
      chip.classList.toggle('selected', sel);
      chip.setAttribute('aria-pressed', String(sel));
    });

    root.querySelectorAll('[data-wiz-dist]').forEach(btn => {
      const activeDist = btn.dataset.wizDist === wizardDistanceMode;
      btn.classList.toggle('primary', activeDist);
    });

    root.querySelectorAll('[data-wiz-diff]').forEach(btn => {
      const activeDiff = btn.dataset.wizDiff === wizardDifficulty;
      btn.classList.toggle('active', activeDiff);
      btn.setAttribute('aria-pressed', String(activeDiff));
    });

    if ($('wiz-chk-fog')) $('wiz-chk-fog').checked = fogMode !== 'none';
    if ($('wiz-chk-trails')) $('wiz-chk-trails').checked = showHikingTrails;
    if ($('wiz-chk-contours')) $('wiz-chk-contours').checked = showContourLayer;

    const savedWrap = $('wiz-saved-trips-wrap');
    const savedList = $('wiz-saved-trips-list');
    const savedTrips = Array.isArray(stateObj.savedTrips) ? stateObj.savedTrips : [];
    if (savedWrap && savedList) {
      savedWrap.hidden = savedTrips.length === 0;
      savedList.innerHTML = savedTrips.map(t => `
        <button type="button" class="wiz-preset-chip saved-trip-chip" data-load-saved-trip="${e(t.id)}" title="Načíst uložený výlet">
          📂 ${e(t.title)} (${(t.selectedPlaceIds || []).length} zast.)
        </button>
      `).join('');
    }
  }

  function updateWizardRoutePreviewBox() {
    const previewBox = $('wiz-route-preview-box');
    const summaryLine = $('wiz-route-summary-line');
    if (!previewBox || !summaryLine) return;

    const plannedPlaces = getPlannedPlaces();
    if (plannedPlaces.length === 0 && wizardDistanceMode !== 'manual') {
      previewBox.hidden = true;
      return;
    }

    const isLoop = plannedRoute.routeType === 'loop' && plannedPlaces.length >= 2;
    const routedM = lastRoutedGeometry && !lastRoutedGeometry.isFallback ? lastRoutedGeometry.distanceM : null;
    const analysis = analyzePlannedRoute(plannedRoute.origin, plannedPlaces, stateObj.companionMode || 'solo', {
      returnToOrigin: isLoop,
      routedDistanceM: routedM,
      terrainDifficulty: wizardDifficulty,
    });
    const distKm = ((analysis?.estimatedWalkDistanceM || 0) / 1000).toFixed(1).replace('.', ',');
    const elevM = analysis?.estimatedElevationGainM ?? 85;
    const mins = analysis?.estimatedMinutes ?? 40;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const timeFormatted = h > 0 ? `${h} h ${m} min` : `${m} min`;

    summaryLine.textContent = `Délka: ${distKm} km · Převýšení: +${elevM} m · Čas: ~${timeFormatted} · ${plannedPlaces.length} zastávky`;
    previewBox.hidden = false;
  }

  $('btn-toggle-trip-wizard')?.addEventListener('click', () => {
    wizardCollapsed = !wizardCollapsed;
    renderTripWizardUi();
    playTick(stateObj.soundEnabled);
  });

  $('trip-wizard-sheet')?.addEventListener('click', async (ev) => {
    const modeBtn = ev.target.closest('[data-select-game-mode]');
    if (modeBtn) {
      applyGameMode(modeBtn.dataset.selectGameMode);
      return;
    }

    if (ev.target.closest('#wiz-scenario-onsite')) {
      wizardScenario = 'on-site';
      userExplicitlyPickedOrigin = false;
      if (lastFix) {
        plannedRoute.origin = { id: 'my-gps', label: 'Moje aktuální GPS poloha', lat: lastFix.lat, lng: lastFix.lng };
        if (map) centerMapOnPlayer(lastFix, false);
      } else {
        plannedRoute.origin = null;
      }
      renderTripWizardUi();
      recalculateRemainingRoute('Zvolen scénář: 📍 Jsem na místě (Vyrazit od mé GPS).');
      playTick(stateObj.soundEnabled);
      return;
    }

    if (ev.target.closest('#wiz-scenario-home')) {
      wizardScenario = 'from-home';
      renderTripWizardUi();
      playTick(stateObj.soundEnabled);
      return;
    }

    const presetBtn = ev.target.closest('[data-wiz-preset]');
    if (presetBtn) {
      const presetId = presetBtn.dataset.wizPreset;
      const preset = CZECH_PLACE_PRESETS.find(p => p.id === presetId);
      if (preset) {
        plannedRoute.origin = { id: preset.id, label: preset.label, lat: preset.lat, lng: preset.lng };
        if (map) {
          follow = false;
          updateFollowUi();
          setMapView(preset.lat, preset.lng, 14, true);
        }
        renderTripWizardUi();
        recalculateRemainingRoute(`Start výpravy přesunut na: ${preset.label}.`);
        refreshAutoPlaces();
        refreshWeatherStrip(preset);
        playTick(stateObj.soundEnabled);
      }
      return;
    }

    if (ev.target.closest('#btn-wiz-search-place')) {
      const inputEl = $('wiz-place-search-input');
      const resultsEl = $('wiz-place-search-results');
      const query = inputEl?.value?.trim() || '';
      if (!query) {
        status('Zadej název města, obce nebo místa v ČR (např. Písek, Beroun, Březnice).');
        return;
      }
      const results = await searchPlaceNominatim(query, aborter.signal);
      if (!resultsEl) return;
      if (!results.length) {
        resultsEl.hidden = false;
        resultsEl.innerHTML = `<span class="small-note">Místo „${e(query)}“ nebylo nalezeno. Zkus jiný název nebo klikni do mapy.</span>`;
        return;
      }
      resultsEl.hidden = false;
      resultsEl.innerHTML = results.map((r, idx) => `
        <button type="button" class="wiz-preset-chip" data-wiz-nominatim-idx="${idx}" data-lat="${r.lat}" data-lng="${r.lng}" data-label="${e(r.label)}">
          📍 ${e(r.label)}
        </button>
      `).join('');
      return;
    }

    const nomChip = ev.target.closest('[data-wiz-nominatim-idx]');
    if (nomChip) {
      const lat = Number(nomChip.dataset.lat);
      const lng = Number(nomChip.dataset.lng);
      const label = nomChip.dataset.label || 'Vyhledané místo';
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        plannedRoute.origin = { id: `place-${Date.now()}`, label, lat, lng };
        if ($('wiz-place-search-results')) $('wiz-place-search-results').hidden = true;
        if (map) {
          follow = false;
          updateFollowUi();
          setMapView(lat, lng, 14, true);
        }
        renderTripWizardUi();
        recalculateRemainingRoute(`Start výpravy přesunut na: ${label}.`);
        refreshAutoPlaces();
        refreshWeatherStrip({ lat, lng });
        playTick(stateObj.soundEnabled);
      }
      return;
    }

    if (ev.target.closest('#btn-wiz-pick-map')) {
      if (!map) return;
      pickingStartOnMap = true;
      status('🗺️ Klikni kamkoliv do mapy pro nastavení startu plánovaného výletu…');
      playTick(stateObj.soundEnabled);
      return;
    }

    if (ev.target.closest('#btn-wiz-save-trip')) {
      const tripTitle = `${plannedRoute.origin?.label || 'Výlet'} (${new Date().toLocaleDateString('cs-CZ')})`;
      const newTrip = {
        id: `trip-${Date.now()}`,
        title: tripTitle,
        origin: { ...(plannedRoute.origin || START_PRESETS[0]) },
        selectedPlaceIds: [...(plannedRoute.selectedPlaceIds || [])],
        categories: [...wizardCategories],
        terrainDifficulty: wizardDifficulty,
        routeType: plannedRoute.routeType || 'loop',
        createdAt: Date.now(),
      };
      stateObj.savedTrips = [newTrip, ...(stateObj.savedTrips || [])].slice(0, 20);
      saveAppState();
      renderTripWizardUi();
      playStampChord(stateObj.soundEnabled);
      status(`💾 Výlet „${tripTitle}“ byl uložen na později.`);
      return;
    }

    const loadSavedBtn = ev.target.closest('[data-load-saved-trip]');
    if (loadSavedBtn) {
      const tripId = loadSavedBtn.dataset.loadSavedTrip;
      const found = (stateObj.savedTrips || []).find(t => t.id === tripId);
      if (found) {
        plannedRoute.origin = { ...found.origin };
        plannedRoute.selectedPlaceIds = [...(found.selectedPlaceIds || [])];
        plannedRoute.categories = [...(found.categories || PLANNER_CATEGORIES.map(c => c.id))];
        plannedRoute.terrainDifficulty = found.terrainDifficulty || 'medium';
        plannedRoute.routeType = found.routeType || 'loop';
        wizardCategories = [...plannedRoute.categories];
        wizardDifficulty = plannedRoute.terrainDifficulty;
        if (map && found.origin) {
          follow = false;
          updateFollowUi();
          setMapView(found.origin.lat, found.origin.lng, 14, true);
        }
        renderTripWizardUi();
        recalculateRemainingRoute(`📂 Načten uložený výlet: ${found.title}.`);
        updateWizardRoutePreviewBox();
        playStampChord(stateObj.soundEnabled);
      }
      return;
    }

    const catChip = ev.target.closest('[data-wiz-cat]');
    if (catChip) {
      const catId = catChip.dataset.wizCat;
      if (wizardCategories.includes(catId)) {
        if (wizardCategories.length > 1) {
          wizardCategories = wizardCategories.filter(c => c !== catId);
        }
      } else {
        wizardCategories = [...wizardCategories, catId];
      }
      plannedRoute.categories = [...wizardCategories];
      renderTripWizardUi();
      renderPlaces();
      playTick(stateObj.soundEnabled);
      return;
    }

    const distBtn = ev.target.closest('[data-wiz-dist]');
    if (distBtn) {
      wizardDistanceMode = distBtn.dataset.wizDist;
      renderTripWizardUi();
      playTick(stateObj.soundEnabled);
      return;
    }

    const diffBtn = ev.target.closest('[data-wiz-diff]');
    if (diffBtn) {
      wizardDifficulty = diffBtn.dataset.wizDiff;
      plannedRoute.terrainDifficulty = wizardDifficulty;
      renderTripWizardUi();
      updateWizardRoutePreviewBox();
      playTick(stateObj.soundEnabled);
      return;
    }

    if (ev.target.closest('#btn-wiz-calc-route')) {
      plannedRoute.categories = [...wizardCategories];
      plannedRoute.terrainDifficulty = wizardDifficulty;

      if (wizardDistanceMode === 'manual') {
        const currentPlaces = getPlannedPlaces();
        if (currentPlaces.length >= 2) {
          const ordered = optimizeRouteOrder(plannedRoute.origin, currentPlaces, {
            returnToOrigin: plannedRoute.routeType === 'loop',
            visitedStopIds: confirmedStopIds,
            currentPosition: active && lastFix ? lastFix : null,
          });
          plannedRoute.selectedPlaceIds = ordered.map(p => p.id);
        }
        recalculateRemainingRoute('Trasa přepočítána podle ručně vybraných bodů.');
        updateWizardRoutePreviewBox();
        playStampChord(stateObj.soundEnabled);
        return;
      }

      const targetKm = Number(wizardDistanceMode) || 5;
      const available = getAllAvailablePlaces().filter(p =>
        !wizardCategories.length || !p.category || wizardCategories.includes(p.category)
      );
      let trip = autoSuggestTrip({
        origin: plannedRoute.origin,
        targetKm,
        companionMode: stateObj.companionMode || 'solo',
        terrainDifficulty: wizardDifficulty,
        availablePlaces: available.length >= 2 ? available : getAllAvailablePlaces(),
        discoveries: progress.discoveries,
      });
      if (!trip.found) {
        trip = autoSuggestTrip({
          origin: plannedRoute.origin,
          targetKm: 10,
          companionMode: stateObj.companionMode || 'solo',
          terrainDifficulty: wizardDifficulty,
          availablePlaces: getAllAvailablePlaces(),
          discoveries: progress.discoveries,
        });
      }
      if (!trip.found) {
        status(trip.reason);
        return;
      }
      plannedRoute.selectedPlaceIds = trip.selectedPlaceIds;
      plannedRoute.routeType = 'loop';
      plannedRoute.explorationMode = 'focus';
      recalculateRemainingRoute(`✨ Vypočítána nejlepší trasa (${trip.selectedPlaceIds.length} zastávek, obtížnost: ${wizardDifficulty}).`);
      updateWizardRoutePreviewBox();
      playStampChord(stateObj.soundEnabled);
      return;
    }

    // KROK 3: „▶ POTVRDIT A VYRAZIT NA TRASU“ -> sbalí průvodce do čisté mapy, vycentruje kameru na Avatara a spustí chůzi
    if (ev.target.closest('#btn-wiz-confirm-go')) {
      wizardCollapsed = true;
      renderTripWizardUi();
      sheetCollapsed = true;
      $('walk-bottom-sheet')?.classList.add('collapsed');
      if ($('sheet-toggle-btn')) {
        $('sheet-toggle-btn').setAttribute('aria-expanded', 'false');
        $('sheet-toggle-btn').textContent = '⬆ Rozbalit panel';
      }
      const hudPanel = $('quest-hud-panel');
      if (hudPanel) {
        hudPanel.classList.add('collapsed');
        $('quest-hud-toggle-btn')?.setAttribute('aria-expanded', 'false');
        if ($('qhud-toggle-icon')) $('qhud-toggle-icon').textContent = '▼ Detail';
      }
      follow = true;
      updateFollowUi();
      const startPos = lastFix || plannedRoute.origin || ROZMITAL_CENTER;
      if (map && player) {
        smoothMovePlayerTo(startPos.lat, startPos.lng, 450);
        centerMapOnPlayer(startPos, false);
      }
      playStampChord(stateObj.soundEnabled);
      start();
      return;
    }
  });

  $('wiz-place-search-input')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      $('btn-wiz-search-place')?.click();
    }
  });

  $('wiz-chk-fog')?.addEventListener('change', (ev) => {
    fogMode = ev.target.checked ? 'explore' : 'none';
    updateFogToggleLabel();
    scheduleFog();
    playTick(stateObj.soundEnabled);
  });

  $('wiz-chk-trails')?.addEventListener('change', (ev) => {
    showHikingTrails = Boolean(ev.target.checked);
    syncHikingTrailsLayerState();
    playTick(stateObj.soundEnabled);
  });

  $('wiz-chk-contours')?.addEventListener('change', (ev) => {
    setContourLayer(Boolean(ev.target.checked));
    playTick(stateObj.soundEnabled);
  });

  $('active-compass-widget')?.addEventListener('click', async () => {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm === 'granted') {
          status('Kompas: Senzor natočení byl povolen.');
        } else {
          status('Kompas: Přístup k senzoru nebyl udělen.');
        }
      } catch (err) {
        status('Kompas: ' + err.message);
      }
    }
  });

  $('quest-hud-toggle-btn')?.addEventListener('click', () => {
    const panel = $('quest-hud-panel');
    if (!panel) return;
    const willExpand = panel.classList.contains('collapsed');
    if (willExpand) {
      closeCompetingMapOverlays('route-detail');
    }
    const collapsed = panel.classList.toggle('collapsed');
    $('quest-hud-toggle-btn').setAttribute('aria-expanded', String(!collapsed));
    $('qhud-toggle-icon').textContent = collapsed ? '▼ Detail' : '▲ Sbalit';
    playTick(stateObj.soundEnabled);
  });

  $('qhud-stops-list')?.addEventListener('click', ev => {
    const row = ev.target.closest('[data-qhud-stop]');
    if (!row || !map) return;
    const p = getPlannedPlaces()[Number(row.dataset.qhudStop)];
    if (!p) return;
    follow = false;
    updateFollowUi();
    panMapTo(p.lat, p.lng, true);
    playTick(stateObj.soundEnabled);
  });

  // KRITICKÁ OPRAVA 1 (Hotfix v2.0.1): Tlačítka „🎯 Zpět na postavičku“ (#btn-recenter-avatar) a „◎ Moje poloha“ (#walk-center)
  const restoreFollowOnPlayer = () => {
    follow = true;
    const recenterBtn = $('btn-recenter-avatar');
    if (recenterBtn) recenterBtn.hidden = true;
    const returnBtn = $('btn-return-to-gps');
    if (returnBtn) returnBtn.hidden = true;

    const playerPos = getAvatarReferencePosition();
    if (playerPos && map && Number.isFinite(playerPos.lat) && Number.isFinite(playerPos.lng)) {
      if (typeof map.flyTo === 'function') {
        map.flyTo({
          center: [playerPos.lng, playerPos.lat],
          zoom: Math.max(map.getZoom(), 16.5),
          pitch: is3DMode ? DEFAULT_3D_PITCH : 0,
          duration: 700,
        });
      } else {
        centerMapOnPlayer(playerPos, true);
      }
      if (followHeadingMode) {
        const headingToApply = (compassSensorState === 'active' && currentDeviceHeading != null)
          ? currentDeviceHeading
          : lastGpsCourseHeading;
        if (headingToApply != null) {
          applyHeadingToMapCamera(headingToApply, compassSensorState === 'active' ? 'compass' : 'gps_course');
        }
      }
      status('🎯 Sledování postavičky obnoveno.');
    } else {
      status('Nejdřív spusť GPS nebo simulátor.');
    }
    playTick(stateObj.soundEnabled);
  };

  $('walk-zoom-in')?.addEventListener('click', () => {
    if (!map) return;
    userZoomLocked = true;
    lastUserZoomAt = Date.now();
    map.zoomIn({ duration: 250 });
    playTick(stateObj.soundEnabled);
  });

  $('walk-zoom-out')?.addEventListener('click', () => {
    if (!map) return;
    userZoomLocked = true;
    lastUserZoomAt = Date.now();
    map.zoomOut({ duration: 250 });
    playTick(stateObj.soundEnabled);
  });

  $('walk-center')?.addEventListener('click', restoreFollowOnPlayer);
  $('btn-recenter-avatar')?.addEventListener('click', restoreFollowOnPlayer);
  $('btn-return-to-gps')?.addEventListener('click', restoreFollowOnPlayer);

  let demoTimer = null;
  let demoRouteCoords = [];

  function stopDemoTimer() {
    if (demoTimer) {
      clearInterval(demoTimer);
      demoTimer = null;
    }
  }

  function buildDemoPedestrianCoords() {
    const orig = getRouteOriginPoint() || ROZMITAL_CENTER;
    const demoStops = ['zamek-rozmital', 'cvokarske-muzeum', 'kostel-stary-rozmital', 'podbrdske-muzeum', 'kostel-jan-nepomucky']
      .map(id => getAllAvailablePlaces().find(p => p.id === id))
      .filter(Boolean);
    const routed = buildLocalRoutedGeometry([orig, ...demoStops], { useLocalFootpathGraph: true, isFallback: false });
    if (!lastRoutedGeometry || lastRoutedGeometry.isFallback) {
      lastRoutedGeometry = routed;
      plannedRouteCoords = routed.coordinates;
    }
    const raw = Array.isArray(routed.coordinates) && routed.coordinates.length >= 2
      ? routed.coordinates
      : [[49.60141, 13.86441], [49.60180, 13.86350], [49.60215, 13.86310], [49.60240, 13.86232]];
    // Rozdělíme úseky po cca 12 metrech, aby postavička v ukázce plynule kráčela po chodnících a cestách
    const subdivided = [];
    for (let i = 0; i < raw.length - 1; i++) {
      const a = { lat: raw[i][0], lng: raw[i][1] };
      const b = { lat: raw[i + 1][0], lng: raw[i + 1][1] };
      const dist = haversineMeters(a, b) ?? 0;
      const stepsCount = Math.max(1, Math.ceil(dist / 12));
      for (let s = 0; s < stepsCount; s++) {
        const t = s / stepsCount;
        subdivided.push({
          lat: Number((a.lat + (b.lat - a.lat) * t).toFixed(6)),
          lng: Number((a.lng + (b.lng - a.lng) * t).toFixed(6)),
        });
      }
    }
    const lastPt = raw[raw.length - 1];
    subdivided.push({ lat: lastPt[0], lng: lastPt[1] });
    return subdivided;
  }

  $('walk-demo')?.addEventListener('click', () => {
    unlockSpeechSynthesis();
    stopDemoTimer();
    pauseSession();
    demo = !demo;
    lastFix = null; anchor = null;
    memoryTrail = [];
    pendingPlaceStamps = {};
    pendingStopSamples = {};
    if (demo) {
      progress = emptyWalk();
      stateObj = emptyState();
      telemetry = createTelemetryState(Date.now());
      currentExpedition = createExpedition({ progress, goal: DEFAULT_GOALS[0] });
      demoRouteCoords = buildDemoPedestrianCoords();
      demoIndex = 0;
      stats();
      stepDemo();
      demoTimer = setInterval(() => {
        if (!demo || disposed) {
          stopDemoTimer();
          return;
        }
        stepDemo();
      }, 1200);
    } else {
      try {
        stateObj = loadState();
        progress = {
          version: 1,
          cells: [...stateObj.cells],
          meters: stateObj.meters,
          discoveries: [...stateObj.discoveries],
          walkSegments: Array.isArray(stateObj.walkSegments) ? stateObj.walkSegments.map(s => [...s]) : [],
          revealedFeatures: Array.isArray(stateObj.revealedFeatures) ? [...stateObj.revealedFeatures] : [],
        };
        currentExpedition = stateObj.activeExpedition;
        confirmedStopIds = new Set(Array.isArray(stateObj.confirmedStopIds) ? stateObj.confirmedStopIds : []);
      } catch (error) {
        storageError = error.message;
        progress = emptyWalk();
        currentExpedition = null;
      }
      renderPlaces();
      scheduleFog(50, true);
      renderTrail();
      stats();
      status(storageError || 'Ukázka skončila.');
      if (map) {
        setPlayerMarkerVisible(true);
        accuracyRing.setRadius(0);
        const c = progress.cells.length ? cellCenter(progress.cells.at(-1)) : { lat: 49.6014, lng: 13.8644 };
        player?.setLatLng([c.lat, c.lng]);
        setMapView(c.lat, c.lng, map.getZoom?.() || 15.5, false);
      }
    }
  });

  function stepDemo() {
    if (!Array.isArray(demoRouteCoords) || demoRouteCoords.length === 0) {
      demoRouteCoords = buildDemoPedestrianCoords();
    }
    const pt = demoRouteCoords[demoIndex % demoRouteCoords.length];
    const fix = {
      lat: pt.lat,
      lng: pt.lng,
      accuracy: 6,
      timestamp: Date.now() + demoIndex * 12000,
      simulated: true,
    };
    demoIndex++;
    handleGpsFix(fix);
  }
  $('walk-step')?.addEventListener('click', stepDemo);

  // Globální delegace pro správu zastávek (Nahoru, Dolů, Nahradit, Odebrat), přidávání míst, turistické trasy a zavírání vyskakovacích oken kliknutím mimo ně
  const handleDocumentOutsideClick = (event) => {
    if (disposed) return;
    const t = event.target;
    if (!t || typeof t.closest !== 'function') return;

    // 1. Zavření modálu s pohlednicí (#postcard-modal) při kliknutí kamkoliv mimo .session-modal-card
    if ($('postcard-modal')) {
      const clickedInsidePostcard = t.closest('.session-modal-card');
      const clickedFinishTrigger =
        t.closest('#walk-finish') ||
        t.closest('#walk-end') ||
        t.closest('#btn-phase4-finish-now') ||
        t.closest('#btn-arrival-finish-postcard');
      if (!clickedInsidePostcard && !clickedFinishTrigger) {
        if ($('session-summary-container')) $('session-summary-container').innerHTML = '';
        playTick(stateObj.soundEnabled);
        return;
      }
    }

    // 2. Zavření cílového okna (#arrival-goal-modal) při kliknutí kamkoliv mimo .arrival-goal-dialog
    if ($('arrival-goal-modal') && !$('arrival-goal-modal').hidden) {
      if (!t.closest('.arrival-goal-dialog')) {
        $('arrival-goal-modal').hidden = true;
        playTick(stateObj.soundEnabled);
        return;
      }
    }

    // 3. Zavření kapesního režimu (#pocket-mode-overlay) při kliknutí mimo .pocket-mode-box
    if ($('pocket-mode-overlay') && !$('pocket-mode-overlay').hidden) {
      if (!t.closest('.pocket-mode-box') && !t.closest('#btn-pocket-mode') && !t.closest('#btn-direct-pocket-mode')) {
        setPocketModeUi(false);
        playTick(stateObj.soundEnabled);
        return;
      }
    }

    // 3b. Zavření plovoucího výběru herního stylu na mapě (#map-style-popover) při kliknutí mimo něj
    if ($('map-style-popover') && !$('map-style-popover').hidden) {
      if (!t.closest('#map-style-popover') && !t.closest('#btn-top-pill-style')) {
        $('map-style-popover').hidden = true;
      }
    }

    // 4. Zavření modálu „Upravit procházku“ (#edit-walk-modal) při kliknutí mimo .edit-walk-modal-card
    if ($('edit-walk-modal') && !$('edit-walk-modal').hidden) {
      const clickedOpenEdit =
        t.closest('#btn-open-edit-walk') ||
        t.closest('#btn-sheet-edit-walk') ||
        t.closest('#btn-top-edit-walk');
      if (!t.closest('.edit-walk-modal-card') && !clickedOpenEdit) {
        cancelEditWalkModal();
        return;
      }
    }

    // 5. Zavření modálu „Nastavení aplikace“ (#app-settings-modal) při kliknutí mimo .edit-walk-modal-card
    if ($('app-settings-modal') && !$('app-settings-modal').hidden) {
      const clickedOpenSettings =
        t.closest('#btn-open-settings-modal') ||
        t.closest('#btn-top-settings') ||
        t.closest('#btn-top-pill-style') ||
        t.closest('#walk-more-settings') ||
        t.closest('#walk-more-options') ||
        t.closest('#walk-more-menu') ||
        t.closest('#walk-more-btn');
      if (!t.closest('.edit-walk-modal-card') && !clickedOpenSettings) {
        appSettingsModalOpen = false;
        $('app-settings-modal').hidden = true;
        playTick(stateObj.soundEnabled);
        return;
      }
    }

    // 6. Zavření výsledků lupy vyhledávání při kliknutí mimo vyhledávací lištu
    if ($('map-lupa-search-results') && !$('map-lupa-search-results').hidden) {
      if (!t.closest('#map-search-overlay')) {
        $('map-lupa-search-results').hidden = true;
      }
    }

    // 7. Zavření bubliny detailu místa (#place-detail-sheet) při kliknutí mimo ni
    if ($('place-detail-sheet') && !$('place-detail-sheet').hidden) {
      const clickedInsideSheet = t.closest('#place-detail-sheet');
      const clickedTrigger =
        t.closest('.czekpoint-marker-anchor') ||
        t.closest('.open-map-detail-btn') ||
        t.closest('#btn-hero-place-detail') ||
        t.closest('[data-itinerary-focus]');
      if (!clickedInsideSheet && !clickedTrigger) {
        closePlaceDetail();
      }
    }

    // 8. Zavření výběru náhradní zastávky (#stop-replace-picker) při kliknutí mimo něj
    if (replacingStopIndex !== null && $('stop-replace-picker') && !$('stop-replace-picker').hidden) {
      if (!t.closest('#stop-replace-picker') && !t.closest('[data-stop-action="replace"]')) {
        replacingStopIndex = null;
        renderReplaceStopPicker();
      }
    }
  };
  document.addEventListener('click', handleDocumentOutsideClick, { signal: aborter.signal });

  root.addEventListener('click', async event => {
    const stopActionBtn = event.target.closest('[data-stop-action]');
    if (stopActionBtn) {
      const action = stopActionBtn.dataset.stopAction;
      const idx = Number(stopActionBtn.dataset.stopIndex);
      const ids = plannedRoute.selectedPlaceIds || [];

      if (action === 'up') {
        plannedRoute.selectedPlaceIds = reorderPlannedStops(ids, idx, idx - 1);
        replacingStopIndex = null;
        playTick(stateObj.soundEnabled);
        recalculateRemainingRoute(`Zastávka #${idx + 1} posunuta v pořadí nahoru (ruční pořadí zachováno). Zbývající trasa přepočítána.`);
      } else if (action === 'down') {
        plannedRoute.selectedPlaceIds = reorderPlannedStops(ids, idx, idx + 1);
        replacingStopIndex = null;
        playTick(stateObj.soundEnabled);
        recalculateRemainingRoute(`Zastávka #${idx + 1} posunuta v pořadí dolů (ruční pořadí zachováno). Zbývající trasa přepočítána.`);
      } else if (action === 'remove') {
        const removedPlace = getAllAvailablePlaces().find(p => p.id === ids[idx]);
        plannedRoute.selectedPlaceIds = removePlannedStop(ids, idx);
        replacingStopIndex = null;
        playTick(stateObj.soundEnabled);
        recalculateRemainingRoute(`Zastávka „${removedPlace?.title || ''}“ odebrána. Zbývající trasa přepočítána.`);
      } else if (action === 'replace') {
        replacingStopIndex = replacingStopIndex === idx ? null : idx;
        renderReplaceStopPicker();
        playTick(stateObj.soundEnabled);
      }
      return;
    }

    const replaceCandidateBtn = event.target.closest('[data-replace-with-id]');
    if (replaceCandidateBtn && replacingStopIndex != null) {
      const newId = replaceCandidateBtn.dataset.replaceWithId;
      const newPlace = getAllAvailablePlaces().find(p => p.id === newId);
      plannedRoute.selectedPlaceIds = replacePlannedStop(plannedRoute.selectedPlaceIds || [], replacingStopIndex, newId);
      const replacedIdx = replacingStopIndex + 1;
      replacingStopIndex = null;
      playTick(stateObj.soundEnabled);
      recalculateRemainingRoute(`Zastávka #${replacedIdx} nahrazena místem „${newPlace?.title || newId}“. Zbývající trasa přepočítána.`);
      return;
    }

    if (event.target.closest('#btn-cancel-replace-stop')) {
      replacingStopIndex = null;
      renderReplaceStopPicker();
      return;
    }

    const planBtn = event.target.closest('.toggle-plan-place-btn');
    if (planBtn) {
      const placeId = planBtn.dataset.placeId;
      playTick(stateObj.soundEnabled);
      await togglePlaceInRoute(placeId);
      return;
    }

    const openMapDetailBtn = event.target.closest('.open-map-detail-btn');
    if (openMapDetailBtn) {
      const placeId = openMapDetailBtn.dataset.placeId;
      const targetPlace = getAllAvailablePlaces().find(item => item.id === placeId);
      if (targetPlace) {
        setPlacesDrawerOpen(false);
        if (map) {
          follow = false;
          updateFollowUi();
          setMapView(targetPlace.lat, targetPlace.lng, Math.max(map.getZoom?.() || 16, 16), true);
        }
        openPlaceDetail(targetPlace);
        playTick(stateObj.soundEnabled);
      }
      return;
    }

    const addRadarBtn = event.target.closest('.add-radar-place-btn');
    if (addRadarBtn) {
      const placeId = addRadarBtn.dataset.placeId;
      $('walk-radar-banner').hidden = true;
      playTick(stateObj.soundEnabled);
      await addStopToRoute(placeId, {
        reasonMsg: 'Místo z radaru přidáno mezi zastávky.',
      });
      return;
    }

    const trailChip = event.target.closest('[data-trail-id]');
    if (trailChip && map) {
      const trailId = trailChip.dataset.trailId;
      const trail = loadedHikingTrails.find(t => t.id === trailId);
      if (trail && trail.coordinates?.length >= 2) {
        if (!showHikingTrails) {
          showHikingTrails = true;
          const btn = $('walk-trails-toggle');
          if (btn) {
            btn.setAttribute('aria-pressed', 'true');
            btn.classList.add('active');
            btn.textContent = '🥾 Turistické trasy: ZAP';
          }
          renderHikingTrailsOnMap();
        }
        follow = false;
        updateFollowUi();
        fitMapToLatLngPoints(trail.coordinates, 36, 15);
        status(`Zobrazena turistická trasa: ${trail.name}.`);
        playTick(stateObj.soundEnabled);
      }
      return;
    }

    const visitBtn = event.target.closest('[data-walk-action="visit"]');
    if (visitBtn) {
      const routeId = visitBtn.dataset.route;
      const targetRoute = routes.find(r => r.id === routeId);
      if (!targetRoute) return;
      visitBtn.disabled = true;
      if (onAddVisit) await onAddVisit(routeId);
      stats();
      status(`Návštěva ${targetRoute.title} byla zaznamenána do tvého pasu.`);
      return;
    }

    if (event.target.closest('#btn-open-settings-modal')) {
      appSettingsModalOpen = true;
      const modal = $('app-settings-modal');
      if (modal) modal.hidden = false;
      renderAppSettingsModalUi();
      playTick(stateObj.soundEnabled);
      return;
    }

    if (
      event.target.closest('#btn-close-app-settings') ||
      event.target.closest('#btn-close-app-settings-x') ||
      (event.target.closest('#app-settings-modal') && !event.target.closest('.edit-walk-modal-card'))
    ) {
      appSettingsModalOpen = false;
      const modal = $('app-settings-modal');
      if (modal) modal.hidden = true;
      playTick(stateObj.soundEnabled);
      return;
    }

    const modalGameModeBtn = event.target.closest('[data-modal-game-mode]');
    if (modalGameModeBtn) {
      applyGameMode(modalGameModeBtn.dataset.modalGameMode);
      return;
    }

    const pillBtn = event.target.closest('[data-pill-key]');
    if (pillBtn) {
      const key = pillBtn.dataset.pillKey;
      const val = pillBtn.dataset.pillVal === '1';
      appSettings[key] = val;
      if (key === 'show3dBuildings') {
        appSettings.show3dBuildingsExplicit = true;
      }
      stateObj.appSettings = { ...appSettings };
      saveAppState();
      if (key === 'kctTrails') syncHikingTrailsLayerState();
      if (key === 'contours') setContourLayer(val);
      if (key === 'show3dBuildings') sync3DBuildingsLayerState();
      if (key === 'fogParchment') {
        fogMode = val ? 'explore' : 'none';
        updateFogToggleLabel();
        scheduleFog();
      }
      if (key === 'voiceNav') setVoiceNavigation(val);
      if (key === 'keepAwake') {
        val ? holdWake() : releaseWake();
      }
      if (key === 'soundFx') {
        stateObj.soundEnabled = val;
      }
      if (key === 'hapticFeedback' && val) {
        vibrateStopArrival(true);
      }
      if (key === 'showExternalPhotos') {
        renderPlaces();
        renderNextCheckpointHero(lastFix || telemetry.lastKnownPosition);
        if (selectedDetailPlace && !$('place-detail-sheet')?.hidden) {
          openPlaceDetail(selectedDetailPlace);
        }
      }
      if (key === 'mindfulnessPrompts') {
        if (val) mindfulnessSkippedSession = false;
        renderMindfulnessPromptUi();
      }
      renderAppSettingsModalUi();
      playTick(stateObj.soundEnabled);
      return;
    }
  }, { signal: aborter.signal });

  // DÁVKA 2 (Bod 1.1 & 1.2): Osobní atlas malých objevů (✨ Uložit vzpomínku) a bezpečné výzvy všímavosti
  function renderMindfulnessPromptUi() {
    const cardEl = $('mindfulness-prompt-card');
    const textEl = $('mindfulness-prompt-text');
    if (!cardEl || !textEl) return;

    if (appSettings.mindfulnessPrompts === false || mindfulnessSkippedSession) {
      cardEl.hidden = true;
      return;
    }
    cardEl.hidden = activeDrawerTab !== 'route';
    const promptItem = MINDFULNESS_PROMPTS[mindfulnessPromptIndex % MINDFULNESS_PROMPTS.length] || MINDFULNESS_PROMPTS[0];
    textEl.textContent = promptItem.text;
  }

  function renderPersonalMemoriesUi() {
    const countEl = $('personal-memories-count');
    const listEl = $('personal-memories-list');
    if (countEl) countEl.textContent = String(personalMemories.length);
    if ($('drawer-tab-route-count')) {
      $('drawer-tab-route-count').textContent = String((plannedRoute.selectedPlaceIds?.length || 0) + personalMemories.length);
    }
    if (!listEl) return;

    listEl.innerHTML = '';
    if (personalMemories.length === 0) {
      const emptyP = document.createElement('p');
      emptyP.className = 'small-note';
      emptyP.style.margin = '0';
      emptyP.textContent = 'Zatím nemáš uloženou žádnou vlastní vzpomínku. Klepni na „✨ Uložit vzpomínku“ a zaznamenej si svůj objev v terénu.';
      listEl.appendChild(emptyP);
      return;
    }

    for (const mem of personalMemories.slice(0, 20)) {
      const row = document.createElement('div');
      row.className = 'personal-memory-item';
      row.dataset.memoryId = mem.id;

      const head = document.createElement('div');
      head.className = 'personal-memory-head';

      const titleStrong = document.createElement('strong');
      titleStrong.className = 'personal-memory-title';
      titleStrong.textContent = `${mem.symbolIcon || '✨'} ${mem.symbolTitle || 'Vlastní vzpomínka'}`;

      const badgeSpan = document.createElement('span');
      badgeSpan.className = 'personal-memory-badge';
      badgeSpan.textContent = '✨ Vlastnoruční vzpomínka uživatele (soukromě v zařízení)';

      head.appendChild(titleStrong);
      head.appendChild(badgeSpan);
      row.appendChild(head);

      if (mem.note) {
        const noteP = document.createElement('p');
        noteP.className = 'personal-memory-note';
        // DÁVKA 2 (Bod 1.1): Bezpečné vykreslení vlastní poznámky výhradně přes textContent proti XSS!
        noteP.textContent = mem.note;
        row.appendChild(noteP);
      }

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'personal-memory-actions';

      if (Number.isFinite(Number(mem.lat)) && Number.isFinite(Number(mem.lng))) {
        const showBtn = document.createElement('button');
        showBtn.type = 'button';
        showBtn.className = 'button small ghost';
        showBtn.textContent = '🔍 Ukázat v mapě';
        showBtn.addEventListener('click', () => {
          if (map) {
            follow = false;
            updateFollowUi();
            setMapView(Number(mem.lat), Number(mem.lng), Math.max(map.getZoom?.() || 16, 16), true);
          }
          playTick(stateObj.soundEnabled);
        });
        actionsDiv.appendChild(showBtn);
      }

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'button small ghost danger';
      delBtn.textContent = '✕ Smazat';
      delBtn.addEventListener('click', () => {
        personalMemories = personalMemories.filter(item => item.id !== mem.id);
        stateObj.personalMemories = personalMemories;
        saveAppState();
        renderPersonalMemoriesUi();
        renderPlaces({ skipListRebuild: true });
        status('Vlastní vzpomínka byla odstraněna z osobního atlasu.');
        playTick(stateObj.soundEnabled);
      });
      actionsDiv.appendChild(delBtn);

      row.appendChild(actionsDiv);
      listEl.appendChild(row);
    }
  }

  function openSaveMemoryModal() {
    saveMemoryModalOpen = true;
    selectedMemorySymbolId = PERSONAL_MEMORY_SYMBOLS[0].id;
    const modal = $('save-memory-modal');
    if (modal) modal.hidden = false;
    const noteInp = $('memory-note-input');
    if (noteInp) noteInp.value = '';
    root.querySelectorAll('[data-memory-symbol]').forEach(btn => {
      const isSel = btn.dataset.memorySymbol === selectedMemorySymbolId;
      btn.classList.toggle('selected', isSel);
      btn.setAttribute('aria-checked', String(isSel));
    });
    playTick(stateObj.soundEnabled);
  }

  function closeSaveMemoryModal() {
    saveMemoryModalOpen = false;
    const modal = $('save-memory-modal');
    if (modal) modal.hidden = true;
  }

  function confirmSaveMemoryModal() {
    const noteInp = $('memory-note-input');
    const cleanNote = sanitizeMemoryNoteText(noteInp ? noteInp.value : '');
    const refPos = lastFix || telemetry.lastKnownPosition || (map ? map.getCenter() : null) || getRouteOriginPoint();
    const entry = createPersonalMemoryEntry({
      symbolId: selectedMemorySymbolId,
      note: cleanNote,
      lat: refPos?.lat ?? null,
      lng: refPos?.lng ?? null,
      now: Date.now(),
    });
    personalMemories = [entry, ...personalMemories].slice(0, 200);
    stateObj.personalMemories = personalMemories;

    // DÁVKA 4: Idempotentní zápis paměti do pointsLedger a vyhodnocení 8 milníků
    if (!simSandboxActive && !demo) {
      stateObj.pointsLedger = recordMemoryInLedger(stateObj.pointsLedger, entry);
      const milestoneRes = evaluateMilestones(stateObj);
      stateObj.pointsLedger = milestoneRes.updatedLedger;
    }

    saveAppState();
    closeSaveMemoryModal();
    renderPersonalMemoriesUi();
    renderPlaces({ skipListRebuild: true });
    playStampChord(stateObj.soundEnabled);
    status(`✨ Uložena vlastnoruční vzpomínka do osobního atlasu: ${entry.symbolIcon} ${entry.symbolTitle} (soukromě v zařízení).`);
  }

  $('walk-save-memory')?.addEventListener('click', openSaveMemoryModal);
  $('btn-sheet-save-memory')?.addEventListener('click', openSaveMemoryModal);
  $('btn-mindfulness-save-memory')?.addEventListener('click', openSaveMemoryModal);
  $('btn-close-save-memory-x')?.addEventListener('click', closeSaveMemoryModal);
  $('btn-cancel-save-memory')?.addEventListener('click', closeSaveMemoryModal);
  $('btn-confirm-save-memory')?.addEventListener('click', confirmSaveMemoryModal);

  $('memory-symbols-grid')?.addEventListener('click', (ev) => {
    const symBtn = ev.target.closest('[data-memory-symbol]');
    if (!symBtn) return;
    selectedMemorySymbolId = symBtn.dataset.memorySymbol || PERSONAL_MEMORY_SYMBOLS[0].id;
    root.querySelectorAll('[data-memory-symbol]').forEach(btn => {
      const isSel = btn.dataset.memorySymbol === selectedMemorySymbolId;
      btn.classList.toggle('selected', isSel);
      btn.setAttribute('aria-checked', String(isSel));
    });
    playTick(stateObj.soundEnabled);
  });

  $('save-memory-modal')?.addEventListener('click', (ev) => {
    if (ev.target === $('save-memory-modal') || !ev.target.closest('.edit-walk-modal-card')) {
      closeSaveMemoryModal();
      playTick(stateObj.soundEnabled);
    }
  });

  $('btn-skip-mindfulness')?.addEventListener('click', () => {
    mindfulnessSkippedSession = true;
    renderMindfulnessPromptUi();
    status('Výzva všímavosti byla přeskočena (můžeš je také trvale vypnout v Nastavení).');
    playTick(stateObj.soundEnabled);
  });

  $('btn-next-mindfulness')?.addEventListener('click', () => {
    mindfulnessPromptIndex = (mindfulnessPromptIndex + 1) % MINDFULNESS_PROMPTS.length;
    renderMindfulnessPromptUi();
    playTick(stateObj.soundEnabled);
  });

  renderMindfulnessPromptUi();
  renderPersonalMemoriesUi();

  $('walk-nearby')?.addEventListener('click', async () => {
    if (demo) { if ($('nearby-status')) $('nearby-status').textContent = 'Ukázka používá připravený katalog.'; return; }
    const queryOrigin = lastFix || plannedRoute.origin || { lat: 49.6014, lng: 13.8644 };
    if ($('walk-nearby')) $('walk-nearby').disabled = true;
    if ($('nearby-status')) $('nearby-status').textContent = 'Hledám místa v okolí…';
    const nearbyTaskId = beginMapTask('⏳ Načítám místa v okolí…');
    try {
      const found = await fetchNearby(queryOrigin, config.overpassUrl, aborter.signal, routes, {
        radiusM: (plannedRoute.radiusKm || 10) * 1000,
        categories: plannedRoute.categories,
      });
      if (disposed || demo) return;
      nearby = found;
      renderPlaces();
      if ($('nearby-status')) $('nearby-status').textContent = found.length ? `Načteno ${found.length} míst v okolí.` : 'V okolí nejsou další známá místa.';
    } catch (error) {
      if (!disposed && $('nearby-status')) $('nearby-status').textContent = error.name === 'AbortError' ? 'Hledání trvalo příliš dlouho.' : error.message;
    } finally {
      endMapTask(nearbyTaskId);
      if (!disposed && $('walk-nearby')) $('walk-nearby').disabled = false;
    }
  });

  // Export a obnova ze zálohy JSON
  $('walk-export')?.addEventListener('click', () => {
    try {
      const jsonStr = exportStateJson();
      const today = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(new Blob([jsonStr], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `czekpoint-zaloha-${today}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status('Záloha osobního atlasu byla úspěšně stažena do souboru.');
    } catch (error) { status(error.message); }
  });

  $('walk-import-btn')?.addEventListener('click', () => {
    $('walk-import-file')?.click();
  });

  $('walk-import-file')?.addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const preview = previewImportState(text);
      pauseSession();
      stateObj = importStateJson(text);
      progress = {
        version: 1,
        cells: [...stateObj.cells],
        meters: stateObj.meters,
        discoveries: [...stateObj.discoveries],
        walkSegments: Array.isArray(stateObj.walkSegments) ? stateObj.walkSegments.map(s => [...s]) : [],
        revealedFeatures: Array.isArray(stateObj.revealedFeatures) ? [...stateObj.revealedFeatures] : [],
      };
      currentExpedition = stateObj.activeExpedition;
      plannedRoute = stateObj.plannedRoute || plannedRoute;
      confirmedStopIds = new Set(Array.isArray(stateObj.confirmedStopIds) ? stateObj.confirmedStopIds : []);
      personalMemories = Array.isArray(stateObj.personalMemories) ? [...stateObj.personalMemories] : [];
      storageError = '';
      renderPersonalMemoriesUi();
      stats();
      status(`Průzkum obnoven ze zálohy (${preview.cellsCount} dílků, ${preview.stampsCount} razítek).`);
    } catch (err) {
      status('Chyba při obnově zálohy (původní data zachována): ' + err.message);
    } finally {
      ev.target.value = '';
    }
  });

  let hiddenStartedAtMs = 0;

  const visibility = () => {
    if (document.hidden) {
      hiddenStartedAtMs = Date.now();
      if (active || walkState === 'running' || walkState === 'locating' || simSandboxActive || demo) {
        keepAliveCtrl.start('Czekpoint GPS aktivní');
        keepAliveCtrl.triggerManualTick?.();
        const curPos = lastFix || telemetry.lastKnownPosition || getRouteOriginPoint();
        const plannedPlaces = getPlannedPlaces();
        const instr = computeActiveTurnInstruction(lastRoutedGeometry, curPos, plannedPlaces, confirmedStopIds);
        const nextStop = plannedPlaces.find(p => !isStopVisited(p));
        const pocketSpeech = instr?.voiceText || instr?.text || (nextStop ? `Pokračuj po cestě k cíli ${nextStop.title}.` : 'Navigace v kapse je aktivní.');
        speakCzechNav(pocketSpeech, `screen-lock-${Math.floor(Date.now() / 15000)}`, instr?.turnDirection || 'straight');
      }
      if (canPersistRealState()) {
        try { saveState(stateObj); } catch {}
      }
      return;
    }

    if (!document.hidden && !disposed) {
      // DÁVKA 3 (Bod 3.3): Po návratu do aplikace z pozadí čistě obnovíme odběr senzoru orientace bez duplicitních listenerů
      bindOrientationListeners();
      updateDirectionalIndicators();

      // KRITICKÁ OPRAVA 2 (Hotfix v2.0.2): Plynulá synchronizace a přemostění při rozsvícení displeje bez skákání postavičky
      if (map) {
        resizeMap();
        const latestFix = lastAcceptedFix || lastFix;
        if (latestFix && Number.isFinite(latestFix.lat) && Number.isFinite(latestFix.lng)) {
          const snapped = snapPointToPedestrianPath(latestFix, plannedRouteCoords, 16);
          const targetPt = snapped && snapped.snapped ? { lat: snapped.lat, lng: snapped.lng } : latestFix;
          visualPlayerPos = { lat: targetPt.lat, lng: targetPt.lng };
          if (player) {
            setPlayerMarkerVisible(true);
            smoothMovePlayerTo(targetPt.lat, targetPt.lng, 650);
          }
          if (accuracyRing) {
            accuracyRing.setLatLng([targetPt.lat, targetPt.lng]);
          }
          if (follow) {
            centerMapOnPlayer(targetPt, true);
          }
        }
        updateFogCanvas(true);
        renderTrail();
      }

      if ((active || walkState === 'running' || walkState === 'locating') && !simSandboxActive) {
        restartGpsWatch();
        holdWake();
        keepAliveCtrl.start('Czekpoint GPS aktivní');
        stats();
      }
    }
  };
  document.addEventListener('visibilitychange', visibility, { signal: aborter.signal });
  window.addEventListener('pageshow', visibility, { signal: aborter.signal });
  window.addEventListener('focus', visibility, { signal: aborter.signal });

  const pagehide = () => {
    // ZADÁNÍ: Při zhasnutí obrazovky nebo uspání telefonu v kapse NIKDY nepozastavovat výpravu!
    // Pouze bezpečně zaznamenáme aktuální stav do úložiště.
    if (canPersistRealState()) {
      try { saveState(stateObj); } catch {}
    }
  };
  window.addEventListener('pagehide', pagehide, { signal: aborter.signal });

  const storageChanged = event => {
    if (event.key === STATE_KEY && !demo && !simSandboxActive) {
      if (!active) {
        pauseSession();
      }
      try {
        stateObj = loadState();
        progress = {
          version: 1,
          cells: [...stateObj.cells],
          meters: stateObj.meters,
          discoveries: [...stateObj.discoveries],
          walkSegments: Array.isArray(stateObj.walkSegments) ? stateObj.walkSegments.map(s => [...s]) : [],
          revealedFeatures: Array.isArray(stateObj.revealedFeatures) ? [...stateObj.revealedFeatures] : [],
        };
        currentExpedition = stateObj.activeExpedition;
        plannedRoute = stateObj.plannedRoute || plannedRoute;
        confirmedStopIds = new Set(Array.isArray(stateObj.confirmedStopIds) ? stateObj.confirmedStopIds : []);
        personalMemories = Array.isArray(stateObj.personalMemories) ? [...stateObj.personalMemories] : [];
        storageError = '';
      } catch (err) { storageError = err.message; }
      renderPersonalMemoriesUi();
      renderPlaces();
      scheduleFog(50, true);
      renderTrail();
      stats();
      status(storageError || 'Průzkum se změnil v jiné kartě.');
    }
  };
  window.addEventListener('storage', storageChanged, { signal: aborter.signal });

  // ZADÁNÍ #10 (Bod 1.1): Při prvním otevření mapy NEVYBÍRÁME automaticky zastávky,
  // aby horní lišta „Půjdeš ~X hod...“ nesvítila bez kontextu hned po otevření!
  renderTripWizardUi();
  renderPlaces();
  scheduleFog(50, true);
  renderTrail();
  stats();
  renderQuestHud(plannedRoute.origin);
  renderPhase1AndPhase4Ui(lastFix || plannedRoute.origin);

  const handleVisualViewportChange = () => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const rightBar = root.querySelector('.map-right-toolbar');
    if (rightBar) {
      rightBar.style.removeProperty('max-height');
    }
  };
  if (typeof window !== 'undefined' && window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleVisualViewportChange, { signal: aborter.signal });
    window.visualViewport.addEventListener('scroll', handleVisualViewportChange, { signal: aborter.signal });
  }

  return () => {
    disposed = true;
    stopDemoTimer();
    document.body?.classList?.remove('nav-active');
    clearAllMapTasks();
    keepAliveCtrl.stop();
    stopBackgroundTracking();
    if (compassCheckTimer) {
      clearTimeout(compassCheckTimer);
      compassCheckTimer = null;
    }
    if (playerLerpRafId) {
      cancelAnimationFrame(playerLerpRafId);
      playerLerpRafId = null;
    }
    try { window.speechSynthesis?.cancel?.(); } catch {}
    stopWatchdog();
    pauseSession();
    aborter.abort();
    if (typeof window !== 'undefined' && window.visualViewport) {
      try {
        window.visualViewport.removeEventListener('resize', handleVisualViewportChange);
        window.visualViewport.removeEventListener('scroll', handleVisualViewportChange);
      } catch {}
    }
    window.removeEventListener('keydown', onEscapeKey);
    window.removeEventListener('resize', handleViewportChange);
    window.removeEventListener('orientationchange', handleViewportChange);
    document.removeEventListener('visibilitychange', visibility);
    unbindOrientationListeners();
    window.removeEventListener('pagehide', pagehide);
    window.removeEventListener('storage', storageChanged);
    if (frame) cancelAnimationFrame(frame);
    clearFootprintMarkers();
    clearHikingBlazeMarkers();
    clearRouteOverlayMarkers();
    for (const entry of placeMarkersById.values()) {
      try { entry.marker.remove(); } catch {}
    }
    placeMarkersById.clear();
    try { player?.remove?.(); } catch {}
    if (fogRenderTimer) clearTimeout(fogRenderTimer);
    if (fogTextureCanvas) {
      fogTextureCanvas.width = 0;
      fogTextureCanvas.height = 0;
      fogTextureCanvas = null;
    }
    fakeGpsSim?.destroy();
    try { map?.remove?.(); } catch {}
    map = null;
  };
}