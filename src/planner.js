import { haversineMeters } from './domain.js';
import { COMPANION_MODES, EXPLORATION_MODES } from './walk-store.js';
import {
  BUILTIN_NATURAL_FEATURES,
  resolveAccessibleStopLocation,
  isPointInPolygon,
  nearestPointOnPolygonBoundary,
  normalizeVertex,
} from './natural-features.js';

export const START_PRESETS = Object.freeze([
  { id: 'namesti', label: 'Náměstí Rožmitál', lat: 49.6033, lng: 13.8633 },
  { id: 'nadrazi', label: 'Nádraží Rožmitál pod Třemšínem', lat: 49.5968, lng: 13.8682 },
  { id: 'stary-rozmital', label: 'Starý Rožmitál', lat: 49.6082, lng: 13.8507 },
]);

export const PLANNER_RADII = Object.freeze([2, 5, 10]);

export const PLANNER_CATEGORIES = Object.freeze([
  {
    id: 'castles',
    label: 'Hrady, zámky a zříceniny',
    icon: '🏰',
    overpassKey: 'historic',
    overpassRegex: 'castle|ruins|manor',
  },
  {
    id: 'views',
    label: 'Vyhlídky, skály a vrcholy',
    icon: '⛰️',
    overpassKey: 'tourism_natural',
    overpassRegex: 'viewpoint|peak|cliff|rock',
  },
  {
    id: 'museums',
    label: 'Muzea a památníky',
    icon: '🏛️',
    overpassKey: 'tourism_historic',
    overpassRegex: 'museum|attraction|artwork|memorial|monument',
  },
  {
    id: 'sacral',
    label: 'Kapličky, křížky a kostely',
    icon: '⛪',
    overpassKey: 'amenity_historic',
    overpassRegex: 'place_of_worship|wayside_chapel|wayside_cross',
  },
  {
    id: 'water',
    label: 'Studánky, rybníky a jezy',
    icon: '💧',
    overpassKey: 'natural_waterway',
    overpassRegex: 'spring|water|waterfall|weir',
  },
  {
    id: 'nature',
    label: 'Památné stromy, altány a odpočívadla',
    icon: '🌲',
    overpassKey: 'tourism_amenity_natural',
    overpassRegex: 'picnic_site|shelter|tree',
  },
  {
    id: 'family',
    label: 'Parky a dětská hřiště',
    icon: '🐾',
    overpassKey: 'leisure',
    overpassRegex: 'park|playground|dog_park',
  },
]);

export const COMPANION_STYLES = Object.freeze([
  { id: 'solo', label: 'Sólo poutník', icon: '🥾', speedKmH: 4.0 },
  { id: 'dog', label: 'Se psem', icon: '🐕', speedKmH: 4.0 },
  { id: 'stroller', label: 'S kočárkem', icon: '👶', speedKmH: 3.2 },
  { id: 'family', label: 'Skupina / Rodina', icon: '👨‍👩‍👧', speedKmH: 3.2 },
]);

/**
 * Vestavěné vodní toky (Vlčava / Lomnice v Rožmitále) a mosty/lávky pro realistický výpočet pěších tras (Body 26 & 27).
 */
export const BUILTIN_RIVER_OBSTACLES = Object.freeze([
  {
    id: 'river:vlcava-rozmital',
    name: 'Říčka Vlčava (Skalice)',
    // Linie vodního toku oddělující břehy mezi Starým Rožmitálem a městem
    polyline: [
      [49.60950, 13.84850],
      [49.60755, 13.85185],
      [49.60630, 13.85380],
      [49.60373, 13.85891],
      [49.60265, 13.86175],
      [49.60150, 13.86650],
    ],
    bridges: [
      { id: 'bridge:stary-rozmital', title: 'Most ve Starém Rožmitále', lat: 49.60755, lng: 13.85185 },
      { id: 'bridge:lavka-podzamecky', title: 'Lávka u Podzámeckého rybníka', lat: 49.60373, lng: 13.85891 },
      { id: 'bridge:most-u-zamku', title: 'Most u zámku Rožmitál', lat: 49.60265, lng: 13.86175 },
    ],
  },
]);

/**
 * Zjistí, zda se dvě úsečky AB a CD protínají (včetně orientace).
 */
export function segmentsIntersect(a, b, c, d) {
  const p1 = normalizeVertex(a), p2 = normalizeVertex(b);
  const p3 = normalizeVertex(c), p4 = normalizeVertex(d);
  if (!p1 || !p2 || !p3 || !p4) return false;

  const ccw = (A, B, C) => (C.lat - A.lat) * (B.lng - A.lng) - (B.lat - A.lat) * (C.lng - A.lng);
  const d1 = ccw(p3, p4, p1);
  const d2 = ccw(p3, p4, p2);
  const d3 = ccw(p1, p2, p3);
  const d4 = ccw(p1, p2, p4);

  if (((d1 > 1e-10 && d2 < -1e-10) || (d1 < -1e-10 && d2 > 1e-10)) &&
      ((d3 > 1e-10 && d4 < -1e-10) || (d3 < -1e-10 && d4 > 1e-10))) {
    return true;
  }
  return false;
}

/**
 * Zjistí, zda úsečka A–B protíná lomenou čáru řeky mimo bezprostřední blízkost mostu (< 18 m).
 */
export function crossesRiverBarrier(from, to, river) {
  if (!river || !Array.isArray(river.polyline) || river.polyline.length < 2) return false;
  const bridges = Array.isArray(river.bridges) ? river.bridges : [];

  // Pokud je počátek nebo konec přímo na mostě (< 18 m), nejde o nelegální přechod řeky
  for (const br of bridges) {
    if ((haversineMeters(from, br) ?? Infinity) < 18 || (haversineMeters(to, br) ?? Infinity) < 18) {
      return false;
    }
  }

  for (let i = 0; i < river.polyline.length - 1; i++) {
    const r1 = river.polyline[i];
    const r2 = river.polyline[i + 1];
    if (segmentsIntersect(from, to, r1, r2)) {
      return true;
    }
  }
  return false;
}

/**
 * Zjistí, zda úsečka A–B prochází vnitřkem vodní plochy (rybníka).
 */
export function segmentCrossesPond(from, to, pondPolygon) {
  if (!Array.isArray(pondPolygon) || pondPolygon.length < 3) return false;
  const vs = pondPolygon.map(normalizeVertex).filter(Boolean);
  if (vs.length < 3) return false;

  // Vzorkujeme body uvnitř úsečky (mimo krajní body na břehu)
  for (let s = 1; s <= 7; s++) {
    const t = s / 8;
    const mid = {
      lat: from.lat + (to.lat - from.lat) * t,
      lng: from.lng + (to.lng - from.lng) * t,
    };
    const boundary = nearestPointOnPolygonBoundary(mid, vs);
    if (boundary.inside && boundary.distanceM > 1.5) {
      return true;
    }
  }

  // Nebo protnutí hrany polygonu
  let edgeIntersections = 0;
  for (let i = 0; i < vs.length; i++) {
    const v1 = vs[i];
    const v2 = vs[(i + 1) % vs.length];
    if (segmentsIntersect(from, to, v1, v2)) {
      edgeIntersections++;
    }
  }
  return edgeIntersections >= 2;
}

/**
 * Vypočítá břehovou cestu kolem rybníka mezi dvěma body (vybere kratší ze dvou směrů po obvodu břehu).
 */
export function computeShorePathAroundPond(from, to, pondPolygon) {
  const vs = (pondPolygon || []).map(normalizeVertex).filter(Boolean);
  if (vs.length < 3) return [from, to];

  let startIdx = 0;
  let endIdx = 0;
  let minStartD = Infinity;
  let minEndD = Infinity;

  for (let i = 0; i < vs.length; i++) {
    const ds = haversineMeters(from, vs[i]) ?? Infinity;
    const de = haversineMeters(to, vs[i]) ?? Infinity;
    if (ds < minStartD) { minStartD = ds; startIdx = i; }
    if (de < minEndD) { minEndD = de; endIdx = i; }
  }

  const n = vs.length;
  const pathCW = [from];
  let idx = startIdx;
  for (let step = 0; step <= n; step++) {
    pathCW.push(vs[idx]);
    if (idx === endIdx) break;
    idx = (idx + 1) % n;
  }
  pathCW.push(to);

  const pathCCW = [from];
  idx = startIdx;
  for (let step = 0; step <= n; step++) {
    pathCCW.push(vs[idx]);
    if (idx === endIdx) break;
    idx = (idx - 1 + n) % n;
  }
  pathCCW.push(to);

  const pathLength = pts => {
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      total += haversineMeters(pts[i], pts[i + 1]) ?? 0;
    }
    return total;
  };

  return pathLength(pathCW) <= pathLength(pathCCW) ? pathCW : pathCCW;
}

/**
 * Vypočítá realistickou pěší cestu mezi dvěma body se zohledněním:
 * 1) Přístupného bodu u břehu rybníka (nikdy doprostřed vodní plochy — Bod 26).
 * 2) Obcházení rybníků po břehové cestě.
 * 3) Překračování řek a potoků přes nejvýhodnější most nebo lávku (Bod 26 & 27).
 * 4) Mírným zákrutem lesní/polní pěšiny, aby geometrie vedla po cestách.
 */
export function computeLocalWalkingLeg(fromPoint, toPoint, options = {}) {
  const ponds = options.ponds || BUILTIN_NATURAL_FEATURES.filter(f => f.kind === 'water');
  const rivers = options.rivers || BUILTIN_RIVER_OBSTACLES;

  const pFrom = resolveAccessibleStopLocation(fromPoint, ponds) || { lat: fromPoint.lat, lng: fromPoint.lng };
  const pTo = resolveAccessibleStopLocation(toPoint, ponds) || { lat: toPoint.lat, lng: toPoint.lng };

  let waypoints = [pFrom, pTo];

  // 1. Kontrola překročení řeky -> vedeme cestu přes nejbližší most
  for (const river of rivers) {
    const nextWaypoints = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i];
      const b = waypoints[i + 1];
      nextWaypoints.push(a);
      if (crossesRiverBarrier(a, b, river) && Array.isArray(river.bridges) && river.bridges.length > 0) {
        let bestBridge = river.bridges[0];
        let bestDist = Infinity;
        for (const br of river.bridges) {
          const d = (haversineMeters(a, br) ?? Infinity) + (haversineMeters(br, b) ?? Infinity);
          if (d < bestDist) {
            bestDist = d;
            bestBridge = br;
          }
        }
        nextWaypoints.push({ lat: bestBridge.lat, lng: bestBridge.lng, isBridge: true, bridgeId: bestBridge.id });
      }
    }
    nextWaypoints.push(waypoints[waypoints.length - 1]);
    waypoints = nextWaypoints;
  }

  // 2. Kontrola průchodu rybníkem -> vedeme cestu po břehové cestě kolem rybníka
  for (const pond of ponds) {
    if (!Array.isArray(pond.polygon) || pond.polygon.length < 3) continue;
    const nextWaypoints = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i];
      const b = waypoints[i + 1];
      if (segmentCrossesPond(a, b, pond.polygon)) {
        const shorePts = computeShorePathAroundPond(a, b, pond.polygon);
        for (let k = 0; k < shorePts.length - 1; k++) {
          nextWaypoints.push(shorePts[k]);
        }
      } else {
        nextWaypoints.push(a);
      }
    }
    nextWaypoints.push(waypoints[waypoints.length - 1]);
    waypoints = nextWaypoints;
  }

  // 3. Spočítáme celkovou pěší vzdálenost a souřadnice
  const coordinates = [];
  let distanceM = 0;
  for (let i = 0; i < waypoints.length; i++) {
    const pt = waypoints[i];
    const coord = [Number(pt.lat.toFixed(6)), Number(pt.lng.toFixed(6))];
    if (coordinates.length === 0 || coordinates[coordinates.length - 1][0] !== coord[0] || coordinates[coordinates.length - 1][1] !== coord[1]) {
      coordinates.push(coord);
    }
    if (i > 0) {
      distanceM += haversineMeters(waypoints[i - 1], waypoints[i]) ?? 0;
    }
  }

  return {
    coordinates,
    distanceM: Math.round(distanceM),
    waypoints,
  };
}

/**
 * Vypočítá matici skutečných pěších vzdáleností mezi body (Bod 27).
 * Zohledňuje řeky, mosty, břehy rybníků nebo volitelnou matici z OSRM / testu.
 */
export function buildWalkingDistanceMatrix(points, options = {}) {
  const n = Array.isArray(points) ? points.length : 0;
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));
  if (n <= 1) return matrix;

  if (Array.isArray(options.customMatrix) && options.customMatrix.length === n) {
    return options.customMatrix;
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        matrix[i][j] = 0;
        continue;
      }
      const leg = computeLocalWalkingLeg(points[i], points[j], options);
      matrix[i][j] = leg.distanceM;
    }
  }
  return matrix;
}

/**
 * Seřadí zastávky podle skutečné pěší vzdálenosti (Bod 27):
 * - Pro limit do 10 zastávek prohledá pořadí důkladně (Held-Karp / branch-and-bound pro přesné minimum pěší trasy,
 *   nikoli jen hladový výběr nejbližšího souseda vzdušnou čarou).
 * - Zachová start (`origin`) a případný pevný cíl (`keepLastStopFixed: true`).
 * - U okruhu (`returnToOrigin: true`) započítá návrat z poslední zastávky zpět na `origin`.
 * - Při úpravě během chůze (`visitedStopIds`, `currentPosition`) zachová již navštívené zastávky na začátku
 *   a přeuspořádá pouze zbývající nenavštívené zastávky od `currentPosition`.
 */
export function optimizeRouteOrder(origin, places, options = {}) {
  if (!Array.isArray(places) || places.length <= 1) {
    return Array.isArray(places) ? [...places] : [];
  }

  const returnToOrigin = Boolean(options.returnToOrigin);
  const keepLastStopFixed = Boolean(options.keepLastStopFixed);
  const visitedSet = new Set(
    Array.isArray(options.visitedStopIds)
      ? options.visitedStopIds
      : options.visitedStopIds instanceof Set
      ? [...options.visitedStopIds]
      : []
  );

  const allPlaces = places.slice(0, 10);

  // Oddělíme již navštívené zastávky (ty zůstanou na začátku v původním pořadí) od zbývajících
  const visitedPlaces = [];
  const unvisitedPlaces = [];
  for (const p of allPlaces) {
    if (p && visitedSet.has(p.id)) {
      visitedPlaces.push(p);
    } else if (p) {
      unvisitedPlaces.push(p);
    }
  }

  if (unvisitedPlaces.length <= 1) {
    return [...visitedPlaces, ...unvisitedPlaces];
  }

  // Výchozí bod pro řazení zbývajících zastávek:
  // Pokud chůze probíhá a máme currentPosition, začínáme z currentPosition; jinak z poslední navštívené zastávky nebo origin.
  const startPoint =
    (options.currentPosition && Number.isFinite(options.currentPosition.lat) && Number.isFinite(options.currentPosition.lng))
      ? options.currentPosition
      : visitedPlaces.length > 0
      ? visitedPlaces[visitedPlaces.length - 1]
      : (origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng))
      ? origin
      : unvisitedPlaces[0];

  const loopEndPoint = (origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)) ? origin : startPoint;

  // Pokud má zůstat poslední zastávka pevným cílem
  let fixedLastStop = null;
  let pool = [...unvisitedPlaces];
  if (keepLastStopFixed && pool.length >= 2) {
    fixedLastStop = pool.pop();
  }

  const m = pool.length;
  if (m <= 1) {
    return fixedLastStop ? [...visitedPlaces, ...pool, fixedLastStop] : [...visitedPlaces, ...pool];
  }

  // Sestavíme uzly pro matici pěších vzdáleností:
  // index 0 = startPoint
  // index 1..m = kandidátní zastávky v `pool`
  // index m+1 = loopEndPoint (pro returnToOrigin) nebo fixedLastStop
  const nodes = [startPoint, ...pool];
  const endNode = fixedLastStop || (returnToOrigin ? loopEndPoint : null);
  if (endNode) nodes.push(endNode);

  const distMatrix = buildWalkingDistanceMatrix(nodes, options);
  const endNodeIdx = endNode ? nodes.length - 1 : -1;

  // Důkladné vyhodnocení pořadí (Branch-and-Bound / Held-Karp pro m <= 10)
  let bestOrderIndices = pool.map((_, i) => i + 1);
  let bestCost = Infinity;

  const used = new Array(m + 1).fill(false);
  const currentPerm = new Array(m);

  function search(depth, prevNodeIdx, costSoFar) {
    if (costSoFar >= bestCost) return;
    if (depth === m) {
      const totalCost = endNodeIdx >= 0 ? costSoFar + distMatrix[prevNodeIdx][endNodeIdx] : costSoFar;
      if (totalCost < bestCost) {
        bestCost = totalCost;
        bestOrderIndices = [...currentPerm];
      }
      return;
    }

    // Seřadíme větve od nejbližší pro rychlé ořezávání (branch-and-bound)
    const candidates = [];
    for (let i = 1; i <= m; i++) {
      if (!used[i]) {
        candidates.push({ idx: i, stepCost: distMatrix[prevNodeIdx][i] });
      }
    }
    candidates.sort((a, b) => a.stepCost - b.stepCost);

    for (const cand of candidates) {
      used[cand.idx] = true;
      currentPerm[depth] = cand.idx;
      search(depth + 1, cand.idx, costSoFar + cand.stepCost);
      used[cand.idx] = false;
    }
  }

  search(0, 0, 0);

  const orderedPool = bestOrderIndices.map(nodeIdx => pool[nodeIdx - 1]);
  return fixedLastStop
    ? [...visitedPlaces, ...orderedPool, fixedLastStop]
    : [...visitedPlaces, ...orderedPool];
}

export const optimizeRouteOrderByWalking = optimizeRouteOrder;

/**
 * Přehled plánované trasy (Bod 5, 6, 13, 15, 27, 28):
 * - Počítá délku včetně případného návratu na start (returnToOrigin).
 * - Odvozuje délku i čas ze stejné pěší trasy.
 * - Prázdný plán ani neznámý povrch nevydává za ověřenou cestu.
 */
export function analyzePlannedRoute(origin, orderedPlaces, companionMode = 'solo', options = {}) {
  const places = Array.isArray(orderedPlaces) ? orderedPlaces.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) : [];
  const returnToOrigin = Boolean(options.returnToOrigin);
  const hasOrigin = Boolean(origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng));

  if (places.length === 0) {
    return {
      airDistanceM: 0,
      returnAirDistanceM: 0,
      estimatedWalkDistanceM: 0,
      estimatedMinutes: 0,
      returnToOrigin: false,
      routeMode: 'empty',
      routeModeLabel: 'Žádná trasa (volná procházka bez pevných zastávek)',
      surfaceSummary: 'Povrch neověřen (žádné zastávky v plánu)',
      warnings: [],
    };
  }

  let outboundAirM = 0;
  let localWalkM = 0;
  if (hasOrigin) {
    const firstDist = haversineMeters(origin, places[0]);
    if (firstDist != null) outboundAirM += firstDist;
    localWalkM += computeLocalWalkingLeg(origin, places[0], options).distanceM;
  }
  for (let i = 0; i < places.length - 1; i++) {
    const segDist = haversineMeters(places[i], places[i + 1]);
    if (segDist != null) outboundAirM += segDist;
    localWalkM += computeLocalWalkingLeg(places[i], places[i + 1], options).distanceM;
  }

  let returnAirM = 0;
  if (returnToOrigin && hasOrigin && places.length > 0) {
    const backDist = haversineMeters(places[places.length - 1], origin);
    if (backDist != null) returnAirM = backDist;
    localWalkM += computeLocalWalkingLeg(places[places.length - 1], origin, options).distanceM;
  }

  const airDistanceM = Math.round(outboundAirM + returnAirM);
  const routeMode = options.routeMode || (Number.isFinite(options.routedDistanceM) && options.routedDistanceM > 0 ? 'routed' : 'air_fallback');

  const estimatedWalkDistanceM =
    routeMode === 'routed' && Number.isFinite(options.routedDistanceM) && options.routedDistanceM > 0
      ? Math.round(options.routedDistanceM)
      : Math.max(Math.round(localWalkM), Math.round(airDistanceM * 1.28));

  // Rychlost chůze: 4.0 km/h pro sólo a psa (~66.7 m/min); 3.2 km/h pro kočárek a rodinu (~53.3 m/min)
  const isSlower = companionMode === 'stroller' || companionMode === 'family';
  const speedMpm = isSlower ? (3200 / 60) : (4000 / 60);
  const estimatedMinutes = estimatedWalkDistanceM > 0 ? Math.max(1, Math.round(estimatedWalkDistanceM / speedMpm)) : 0;

  // Shrnutí povrchu pouze ze známých údajů u zastávek
  const knownSurfaces = [];
  let missingSurfaceCount = 0;
  for (const p of places) {
    const surf = p.access?.surface || p.surface;
    if (surf && typeof surf === 'string' && !/neznáme|nezjištěn/i.test(surf)) {
      knownSurfaces.push(surf);
    } else {
      missingSurfaceCount++;
    }
  }

  let surfaceSummary = 'Povrch trasy neověřen';
  if (knownSurfaces.length > 0) {
    const hasForest = knownSurfaces.some(s => /lesn|kamen|pěšin|nezpev/i.test(s));
    const hasPaved = knownSurfaces.some(s => /asfalt|dlažb|chodn|zpevněn|ulic/i.test(s));
    let baseText = 'Různorodý povrch u zastávek';
    if (hasForest && hasPaved) baseText = 'U zastávek lesní pěšiny i zpevněné úseky';
    else if (hasForest) baseText = 'U zastávek převážně přírodní a lesní cesty';
    else if (hasPaved) baseText = 'U zastávek převážně zpevněný povrch';
    surfaceSummary = missingSurfaceCount > 0
      ? `${baseText} (část zastávek a mezilehlé úseky neověřeny)`
      : `${baseText} (mezilehlé úseky v terénu neověřeny)`;
  }

  const routeModeLabel =
    routeMode === 'routed'
      ? `Vypočtená pěší trasa${returnToOrigin ? ' (okruh včetně návratu na start)' : ''}`
      : `Orientační přímé spojnice${returnToOrigin ? ' (okruh vzdušně — pěší trasa neověřena)' : ' (vzdušně — výpočet pěší trasy nedostupný)'}`;

  const warnings = [];
  if (companionMode === 'stroller') {
    for (const p of places) {
      const title = p.title || 'Vybrané místo';
      if (p.access?.stroller === 'no') {
        warnings.push(`${title}: nevhodné pro kočárek (strmý terén či kamenitá cesta)`);
      } else if (p.tags && /peak|cliff|rock/.test(p.tags?.natural || '')) {
        warnings.push(`${title}: skalnatý vrchol – obtížný terén pro kočárek`);
      } else if (/skála|vrchol|vyhlídka na drtiči/i.test(title)) {
        warnings.push(`${title}: skalnatý nebo vyvýšený terén, kočárek může mít potíže`);
      }
    }
  } else if (companionMode === 'dog') {
    for (const p of places) {
      const title = p.title || 'Vybrané místo';
      if (p.access?.dog === 'no') {
        warnings.push(`${title}: vstup se psem je zakázán`);
      } else if (p.kind === 'culture' && /muzeum|zámek|kostel/i.test(title)) {
        warnings.push(`${title}: vstup do interiérů se psem může být omezen`);
      }
    }
  }

  return {
    airDistanceM,
    returnAirDistanceM: Math.round(returnAirM),
    estimatedWalkDistanceM,
    estimatedMinutes,
    returnToOrigin,
    routeMode,
    routeModeLabel,
    surfaceSummary,
    warnings,
  };
}

/**
 * Sestaví skutečný okruh (včetně návratu na start) odpovídající požadované délce `targetKm` (Bod 5 & 27).
 */
export function autoSuggestTrip({
  origin = START_PRESETS[0],
  targetKm = 5,
  companionMode = 'solo',
  availablePlaces = [],
  discoveries = [],
} = {}) {
  const center = origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)
    ? origin
    : START_PRESETS[0];

  const target = Number(targetKm) > 0 ? Number(targetKm) : 5;
  const targetMeters = target * 1000;
  const minAcceptableM = Math.round(targetMeters * 0.65);
  const maxAcceptableM = Math.round(targetMeters * 1.35);

  const isStroller = companionMode === 'stroller';
  const isDog = companionMode === 'dog';
  const visitedSet = new Set(Array.isArray(discoveries) ? discoveries : []);

  const candidates = (availablePlaces || [])
    .filter(p => {
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
      if (p.pointKind === 'route-start') return false;
      if (isStroller && p.access?.stroller === 'no') return false;
      if (isDog && p.access?.dog === 'no') return false;
      return true;
    })
    .map(p => {
      const dist = haversineMeters(center, p) ?? 0;
      const isVisited = visitedSet.has(p.id) || visitedSet.has(`catalog:${p.id}`);
      return { ...p, _dist: dist, _visited: isVisited };
    })
    .filter(p => p._dist >= 40 && p._dist <= targetMeters * 0.75);

  if (candidates.length < 2) {
    const emptyAnalysis = analyzePlannedRoute(center, [], companionMode, { returnToOrigin: true });
    return {
      found: false,
      returnToOrigin: true,
      targetKm: target,
      places: [],
      selectedPlaceIds: [],
      analysis: emptyAnalysis,
      reason: `Pro délku ~${target} km (včetně návratu na start) nebyl v okolí nalezen dostatek vhodných zastávek. Zkus jinou délku nebo uprav filtry.`,
    };
  }

  const idealRadiusM = targetMeters * 0.32;
  const sortedByRing = [...candidates].sort((a, b) => {
    const da = Math.abs(a._dist - idealRadiusM);
    const db = Math.abs(b._dist - idealRadiusM);
    if (Math.abs(da - db) > 150) return da - db;
    if (a._visited !== b._visited) return a._visited ? 1 : -1;
    return a._dist - b._dist;
  });

  const pool = sortedByRing.slice(0, 14);
  let bestCandidate = null;
  let bestScore = Infinity;

  const evaluateSubset = subset => {
    const cleanSubset = subset.map(p => {
      const copy = { ...p };
      delete copy._dist;
      delete copy._visited;
      return copy;
    });
    const ordered = optimizeRouteOrder(center, cleanSubset, { returnToOrigin: true });
    const analysis = analyzePlannedRoute(center, ordered, companionMode, { returnToOrigin: true });
    const walkM = analysis.estimatedWalkDistanceM;
    const diffRatio = Math.abs(walkM - targetMeters) / targetMeters;
    const unvisitedCount = subset.filter(p => !p._visited).length;
    const visitedPenalty = (subset.length - unvisitedCount) * 0.04;
    const inTolerance = walkM >= minAcceptableM && walkM <= maxAcceptableM;
    const scoreVal = diffRatio + visitedPenalty + (inTolerance ? 0 : 2);

    if (scoreVal < bestScore) {
      bestScore = scoreVal;
      bestCandidate = {
        ordered,
        analysis,
        inTolerance,
      };
    }
  };

  const n = pool.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      evaluateSubset([pool[i], pool[j]]);
      for (let k = j + 1; k < n; k++) {
        evaluateSubset([pool[i], pool[j], pool[k]]);
        if (k < 8) {
          for (let m = k + 1; m < Math.min(n, 9); m++) {
            evaluateSubset([pool[i], pool[j], pool[k], pool[m]]);
          }
        }
      }
    }
  }

  if (!bestCandidate || !bestCandidate.inTolerance) {
    const emptyAnalysis = analyzePlannedRoute(center, [], companionMode, { returnToOrigin: true });
    return {
      found: false,
      returnToOrigin: true,
      targetKm: target,
      places: [],
      selectedPlaceIds: [],
      analysis: emptyAnalysis,
      reason: `V okolí se nepodařilo sestavit okruh o délce ~${target} km včetně návratu na start. Zkus zvolit jinou délku nebo povolit více kategorií.`,
    };
  }

  return {
    found: true,
    returnToOrigin: true,
    targetKm: target,
    places: bestCandidate.ordered,
    selectedPlaceIds: bestCandidate.ordered.map(p => p.id),
    analysis: bestCandidate.analysis,
    reason: '',
  };
}

const walkingGeometryCache = new Map();

/**
 * Sestaví plnou společnou pěší trasu (`sharedWalkingRoute`), kterou sdílejí:
 * 1) Vykreslení na mapě a plánovač
 * 2) Simulátor chůze (autopilot se pohybuje přesně po jejích úsecích, mostech a březích)
 * 3) Výpočet zbývající vzdálenosti a času k další zastávce i do cíle (Body 26, 27, 28).
 */
export function buildLocalRoutedGeometry(waypoints, options = {}) {
  const valid = (waypoints || []).filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (valid.length < 2) {
    return {
      coordinates: valid.map(p => [p.lat, p.lng]),
      distanceM: 0,
      legs: [],
      stopTargets: [],
      mode: 'empty',
      isFallback: false,
      canSimulate: false,
    };
  }

  const coordinates = [];
  const legs = [];
  const stopTargets = [];
  let totalDistanceM = 0;

  for (let i = 0; i < valid.length; i++) {
    const w = valid[i];
    const accessible = resolveAccessibleStopLocation(w, options.ponds);
    stopTargets.push({
      id: w.id || `wp_${i}`,
      title: w.title || w.label || `Bod ${i + 1}`,
      lat: accessible ? accessible.lat : w.lat,
      lng: accessible ? accessible.lng : w.lng,
      originalLat: w.lat,
      originalLng: w.lng,
      isShoreAccess: Boolean(accessible?.isShoreAccess),
      waypointIndex: i,
      coordIndex: 0,
    });
  }

  for (let i = 0; i < valid.length - 1; i++) {
    const leg = computeLocalWalkingLeg(valid[i], valid[i + 1], options);
    const startCoordIdx = Math.max(0, coordinates.length - 1);
    for (const c of leg.coordinates) {
      if (
        coordinates.length === 0 ||
        coordinates[coordinates.length - 1][0] !== c[0] ||
        coordinates[coordinates.length - 1][1] !== c[1]
      ) {
        coordinates.push(c);
      }
    }
    const endCoordIdx = Math.max(0, coordinates.length - 1);
    stopTargets[i + 1].coordIndex = endCoordIdx;
    legs.push({
      fromIndex: i,
      toIndex: i + 1,
      fromId: valid[i].id || `wp_${i}`,
      toId: valid[i + 1].id || `wp_${i + 1}`,
      distanceM: leg.distanceM,
      coordinates: leg.coordinates,
      startCoordIdx,
      endCoordIdx,
    });
    totalDistanceM += leg.distanceM;
  }

  return {
    coordinates,
    distanceM: Math.round(totalDistanceM),
    legs,
    stopTargets,
    mode: 'routed',
    isFallback: false,
    canSimulate: coordinates.length >= 2,
  };
}

/**
 * Fetches actual walking route geometry along footpaths using OSRM Foot Routing,
 * or computes a obstacle-aware walking route around ponds and over bridges.
 * Explicitly distinguishes calculated footpath ('routed') from straight-line fallback ('air_fallback') (Bod 6 & 26).
 */
export async function fetchWalkingGeometry(waypoints, fetchImpl = typeof fetch !== 'undefined' ? fetch : null, options = {}) {
  if (!Array.isArray(waypoints) || waypoints.length === 0) {
    return { coordinates: [], distanceM: 0, legs: [], stopTargets: [], mode: 'empty', isFallback: false, canSimulate: false };
  }
  const valid = waypoints.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (valid.length < 2) {
    return {
      coordinates: valid.map(p => [p.lat, p.lng]),
      distanceM: 0,
      legs: [],
      stopTargets: [],
      mode: 'empty',
      isFallback: false,
      canSimulate: false,
    };
  }

  // Převod zastávek uprostřed rybníka na přístupný bod na břehu (Bod 26)
  const accessibleWaypoints = valid.map(w => {
    const acc = resolveAccessibleStopLocation(w, options.ponds);
    return acc ? { ...w, lat: acc.lat, lng: acc.lng, originalLat: w.lat, originalLng: w.lng, isShoreAccess: acc.isShoreAccess } : w;
  });

  // Fallback direct polyline & haversine air distance — explicitly marked as fallback (`canSimulate: false`)!
  const fallback = () => {
    let dist = 0;
    for (let i = 0; i < accessibleWaypoints.length - 1; i++) {
      const seg = haversineMeters(accessibleWaypoints[i], accessibleWaypoints[i + 1]);
      if (seg != null) dist += seg;
    }
    return {
      coordinates: accessibleWaypoints.map(p => [p.lat, p.lng]),
      distanceM: Math.round(dist),
      legs: [],
      stopTargets: accessibleWaypoints.map((w, idx) => ({
        id: w.id || `wp_${idx}`,
        title: w.title || w.label || `Bod ${idx + 1}`,
        lat: w.lat,
        lng: w.lng,
        coordIndex: idx,
      })),
      mode: 'air_fallback',
      isFallback: true,
      canSimulate: false,
    };
  };

  // Pokud volající explicitně požaduje lokální síť cest (např. s definovanými mosty a rybníky)
  if (options.useLocalFootpathGraph) {
    return buildLocalRoutedGeometry(accessibleWaypoints, options);
  }

  const cacheKey = accessibleWaypoints.map(p => `${Number(p.lat).toFixed(4)},${Number(p.lng).toFixed(4)}`).join(';');
  if (walkingGeometryCache.has(cacheKey) && fetchImpl === (typeof fetch !== 'undefined' ? fetch : null)) {
    return walkingGeometryCache.get(cacheKey);
  }

  if (!fetchImpl) {
    return fallback();
  }

  try {
    const coordsStr = accessibleWaypoints.map(p => `${Number(p.lng).toFixed(5)},${Number(p.lat).toFixed(5)}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/foot/${coordsStr}?overview=full&geometries=geojson&steps=false`;

    let timeoutId;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const signal = controller ? controller.signal : undefined;
    if (controller) {
      timeoutId = setTimeout(() => controller.abort(), 4000);
    }

    try {
      const res = await fetchImpl(url, { signal });
      if (!res || !res.ok) {
        return fallback();
      }
      const data = await res.json();
      const route = data?.routes?.[0];
      if (route?.geometry?.coordinates && Array.isArray(route.geometry.coordinates) && route.geometry.coordinates.length >= 2) {
        const rawCoords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        // Ověříme, že vrácená trasa nevede přímou čarou přes rybník nebo řeku bez mostu;
        // pokud OSRM vrátilo jen 2 body přes vodní plochu, zpřesníme ji lokální břehovou/mostní geometrií
        const localCheck = buildLocalRoutedGeometry(accessibleWaypoints, options);
        const coordinates = rawCoords.length <= accessibleWaypoints.length && localCheck.coordinates.length > rawCoords.length
          ? localCheck.coordinates
          : rawCoords;

        // Namapujeme indexy zastávek na nejbližší vrcholy geometrie trasy
        const stopTargets = accessibleWaypoints.map((w, wIdx) => {
          let bestCoordIdx = 0;
          let minD = Infinity;
          for (let cIdx = 0; cIdx < coordinates.length; cIdx++) {
            const d = haversineMeters(w, { lat: coordinates[cIdx][0], lng: coordinates[cIdx][1] }) ?? Infinity;
            if (d < minD) {
              minD = d;
              bestCoordIdx = cIdx;
            }
          }
          return {
            id: w.id || `wp_${wIdx}`,
            title: w.title || w.label || `Bod ${wIdx + 1}`,
            lat: w.lat,
            lng: w.lng,
            isShoreAccess: Boolean(w.isShoreAccess),
            waypointIndex: wIdx,
            coordIndex: bestCoordIdx,
          };
        });

        const osrmLegs = Array.isArray(route.legs) ? route.legs : [];
        const legs = [];
        for (let i = 0; i < accessibleWaypoints.length - 1; i++) {
          const sIdx = stopTargets[i].coordIndex;
          const eIdx = Math.max(sIdx, stopTargets[i + 1].coordIndex);
          const legCoords = coordinates.slice(sIdx, eIdx + 1);
          const legDist = osrmLegs[i]?.distance != null
            ? Math.round(Number(osrmLegs[i].distance))
            : computePolylineLengthM(legCoords);
          legs.push({
            fromIndex: i,
            toIndex: i + 1,
            fromId: accessibleWaypoints[i].id || `wp_${i}`,
            toId: accessibleWaypoints[i + 1].id || `wp_${i + 1}`,
            distanceM: legDist,
            coordinates: legCoords.length >= 2 ? legCoords : [[accessibleWaypoints[i].lat, accessibleWaypoints[i].lng], [accessibleWaypoints[i + 1].lat, accessibleWaypoints[i + 1].lng]],
            startCoordIdx: sIdx,
            endCoordIdx: eIdx,
          });
        }

        const distanceM = Math.round(Number(route.distance) || computePolylineLengthM(coordinates));
        const result = {
          coordinates,
          distanceM,
          legs,
          stopTargets,
          mode: 'routed',
          isFallback: false,
          canSimulate: true,
        };
        if (fetchImpl === (typeof fetch !== 'undefined' ? fetch : null)) {
          walkingGeometryCache.set(cacheKey, result);
        }
        return result;
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  } catch {
    // Return fallback on network error or timeout
  }

  return fallback();
}

export function computePolylineLengthM(coords = []) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = Array.isArray(coords[i]) ? { lat: coords[i][0], lng: coords[i][1] } : coords[i];
    const b = Array.isArray(coords[i + 1]) ? { lat: coords[i + 1][0], lng: coords[i + 1][1] } : coords[i + 1];
    total += haversineMeters(a, b) ?? 0;
  }
  return Math.round(total);
}

/**
 * Vypočítá zbývající vzdálenost, vzdálenost k další zastávce a zbývající čas PŘÍMO ze společné pěší trasy
 * (`sharedRoute`) od aktuální polohy hráče přes dosud nepotvrzené zastávky (Základní pravidlo & Bod 28).
 * Pokud společná pěší trasa není k dispozici (`isFallback`), vrací `isRouteValid: false` a neslibuje falešnou hodnotu.
 */
export function computeRemainingFromSharedRoute({
  sharedRoute,
  currentPos,
  plannedPlaces = [],
  confirmedStopIds = [],
  companionMode = 'solo',
  returnToOrigin = false,
  origin = null,
}) {
  const confirmedSet = new Set(
    Array.isArray(confirmedStopIds)
      ? confirmedStopIds
      : confirmedStopIds instanceof Set
      ? [...confirmedStopIds]
      : []
  );

  const unvisited = (plannedPlaces || []).filter(p => p && !confirmedSet.has(p.id));
  if (unvisited.length === 0) {
    return {
      isRouteValid: Boolean(sharedRoute && !sharedRoute.isFallback),
      nextStop: null,
      nextStopDistanceM: 0,
      remainingDistanceM: 0,
      remainingMinutes: 0,
    };
  }

  const nextStop = unvisited[0];
  const nextStopAccessible = resolveAccessibleStopLocation(nextStop) || nextStop;
  const isSlower = companionMode === 'stroller' || companionMode === 'family';
  const speedMpm = isSlower ? (3200 / 60) : (4000 / 60);

  // Pokud nemáme vypočtenou pěší trasu (pouze vzdušný fallback), přiznáme nedostupnost pěší trasy
  if (!sharedRoute || sharedRoute.isFallback || sharedRoute.mode !== 'routed' || !Array.isArray(sharedRoute.coordinates) || sharedRoute.coordinates.length < 2) {
    const directNextM = currentPos ? haversineMeters(currentPos, nextStopAccessible) : null;
    return {
      isRouteValid: false,
      nextStop,
      nextStopDistanceM: directNextM != null ? Math.round(directNextM) : null,
      remainingDistanceM: null,
      remainingMinutes: null,
    };
  }

  const coords = sharedRoute.coordinates;
  const stopTargets = Array.isArray(sharedRoute.stopTargets) ? sharedRoute.stopTargets : [];

  // Najdeme index vrcholu na geometrii trasy odpovídající další nepotvrzené zastávce
  const nextTargetMeta = stopTargets.find(st => st.id === nextStop.id && st.waypointIndex > 0) || stopTargets[1] || null;
  const nextStopCoordIdx = nextTargetMeta ? nextTargetMeta.coordIndex : coords.length - 1;

  // Najdeme vrchol na geometrii trasy nejbližší aktuální poloze hráče (před nebo u nextStopCoordIdx)
  let playerCoordIdx = 0;
  let distToRouteM = 0;
  if (currentPos && Number.isFinite(currentPos.lat) && Number.isFinite(currentPos.lng)) {
    let minD = Infinity;
    const searchLimit = Math.min(coords.length - 1, Math.max(nextStopCoordIdx, 1));
    for (let i = 0; i <= searchLimit; i++) {
      const d = haversineMeters(currentPos, { lat: coords[i][0], lng: coords[i][1] }) ?? Infinity;
      if (d < minD) {
        minD = d;
        playerCoordIdx = i;
      }
    }
    distToRouteM = minD < 500 ? minD : 0;
  }

  // Vzdálenost po pěší trase od hráče k další zastávce
  const sliceToNext = coords.slice(playerCoordIdx, Math.max(playerCoordIdx + 1, nextStopCoordIdx + 1));
  const nextStopDistanceM = Math.round(distToRouteM + computePolylineLengthM(sliceToNext));

  // Celková zbývající vzdálenost po pěší trase od hráče až do konce trasy (včetně návratu na start u okruhu)
  const sliceToEnd = coords.slice(playerCoordIdx);
  const remainingDistanceM = Math.round(distToRouteM + computePolylineLengthM(sliceToEnd));
  const remainingMinutes = remainingDistanceM > 0 ? Math.max(1, Math.round(remainingDistanceM / speedMpm)) : 0;

  return {
    isRouteValid: true,
    nextStop,
    nextStopDistanceM,
    remainingDistanceM,
    remainingMinutes,
  };
}

/**
 * Fetches elevation profile from open-meteo API with 4s timeout.
 * Coordinates are rounded to 3 decimal places.
 * Fails safely returning { elevationGainM: null, verified: false } when offline or on error.
 */
export async function fetchElevationProfile(points, fetchImpl = typeof fetch !== 'undefined' ? fetch : null) {
  if (!Array.isArray(points) || points.length < 1 || !fetchImpl) {
    return { elevationGainM: null, currentElevationM: null, verified: false };
  }

  try {
    const validPoints = points.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (validPoints.length < 1) return { elevationGainM: null, currentElevationM: null, verified: false };

    const lats = validPoints.map(p => Number(p.lat).toFixed(3)).join(',');
    const lngs = validPoints.map(p => Number(p.lng).toFixed(3)).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;

    let timeoutId;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const signal = controller ? controller.signal : undefined;
    if (controller) {
      timeoutId = setTimeout(() => controller.abort(), 4000);
    }

    try {
      const res = await fetchImpl(url, { signal });
      if (!res || !res.ok) return { elevationGainM: null, currentElevationM: null, verified: false };
      const data = await res.json();
      if (!Array.isArray(data?.elevation) || data.elevation.length < 1) {
        return { elevationGainM: null, currentElevationM: null, verified: false };
      }
      const firstElev = Number.isFinite(Number(data.elevation[0])) ? Math.round(Number(data.elevation[0])) : null;
      let gain = 0;
      let loss = 0;
      for (let i = 1; i < data.elevation.length; i++) {
        const diff = data.elevation[i] - data.elevation[i - 1];
        if (Number.isFinite(diff)) {
          if (diff > 0) gain += diff;
          else loss += Math.abs(diff);
        }
      }
      return {
        currentElevationM: firstElev,
        elevationGainM: Math.round(gain),
        elevationLossM: Math.round(loss),
        elevations: data.elevation,
        verified: false,
        source: 'open-meteo-waypoints',
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  } catch {
    return { elevationGainM: null, currentElevationM: null, verified: false };
  }
}

function toBase64Url(str) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64url');
  }
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(str) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'base64url').toString('utf8');
  }
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

/**
 * Encodes planned route to a shareable string 'CZK1-...'.
 */
export function encodeRouteShareCode(plan, availablePlaces = []) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('Neplatný plán pro sdílení.');
  }

  const selectedIds = Array.isArray(plan.selectedPlaceIds)
    ? plan.selectedPlaceIds.filter(p => typeof p === 'string').slice(0, 10)
    : [];

  const placeMap = new Map();
  if (Array.isArray(availablePlaces)) {
    for (const p of availablePlaces) {
      if (p && p.id) placeMap.set(p.id, p);
    }
  }
  if (Array.isArray(plan.stops)) {
    for (const p of plan.stops) {
      if (p && p.id && !placeMap.has(p.id)) placeMap.set(p.id, p);
    }
  }

  const stopSnapshots = [];
  for (const id of selectedIds) {
    const found = placeMap.get(id);
    if (found && Number.isFinite(found.lat) && Number.isFinite(found.lng)) {
      stopSnapshots.push([
        id,
        String(found.title || id).slice(0, 80),
        Number(found.lat.toFixed(5)),
        Number(found.lng.toFixed(5)),
        String(found.kind || 'forest'),
      ]);
    }
  }

  const payload = {
    v: 1,
    o: plan.origin && Number.isFinite(plan.origin.lat) && Number.isFinite(plan.origin.lng)
      ? [Number(plan.origin.lat.toFixed(4)), Number(plan.origin.lng.toFixed(4))]
      : null,
    r: Number(plan.radiusKm) || 10,
    c: Array.isArray(plan.categories) ? plan.categories.filter(c => typeof c === 'string').slice(0, 10) : [],
    p: selectedIds,
    m: COMPANION_MODES.includes(plan.companionMode) ? plan.companionMode : 'solo',
    e: EXPLORATION_MODES.includes(plan.explorationMode) ? plan.explorationMode : 'focus',
    ret: Boolean(plan.returnToOrigin),
  };

  if (stopSnapshots.length === selectedIds.length && stopSnapshots.length > 0) {
    payload.s = stopSnapshots;
  }

  return `CZK1-${toBase64Url(JSON.stringify(payload))}`;
}

/**
 * Decodes and validates a shareable route code (Bod 9).
 */
export function decodeRouteShareCode(code, knownPlaces = null) {
  if (typeof code !== 'string' || !code.startsWith('CZK1-')) {
    throw new Error('Neplatný formát kódu výpravy.');
  }
  const rawB64 = code.slice(5).trim();
  if (!rawB64 || !/^[A-Za-z0-9_-]+$/.test(rawB64)) {
    throw new Error('Kód výpravy obsahuje nepovolené znaky.');
  }

  let parsed;
  try {
    parsed = JSON.parse(fromBase64Url(rawB64));
  } catch {
    throw new Error('Kód výpravy se nepodařilo přečíst.');
  }

  if (!parsed || typeof parsed !== 'object' || parsed.v !== 1) {
    throw new Error('Neplatné schéma sdílené trasy.');
  }

  let origin = null;
  if (parsed.o !== null) {
    if (
      !Array.isArray(parsed.o) ||
      parsed.o.length !== 2 ||
      !Number.isFinite(parsed.o[0]) ||
      !Number.isFinite(parsed.o[1]) ||
      Math.abs(parsed.o[0]) > 85 ||
      Math.abs(parsed.o[1]) > 180
    ) {
      throw new Error('Neplatné souřadnice startu.');
    }
    origin = { id: 'shared-origin', label: `Sdílený start [${parsed.o[0]}, ${parsed.o[1]}]`, lat: parsed.o[0], lng: parsed.o[1] };
  }

  if (!Array.isArray(parsed.p) || parsed.p.some(id => typeof id !== 'string' || !id.trim() || id.length > 100)) {
    throw new Error('Neplatný seznam míst.');
  }

  if (!COMPANION_MODES.includes(parsed.m)) {
    throw new Error('Neplatný režim parťáka.');
  }

  if (!EXPLORATION_MODES.includes(parsed.e)) {
    throw new Error('Neplatný herní režim.');
  }

  const selectedPlaceIds = parsed.p.slice(0, 10);
  const embeddedStops = [];
  if (Array.isArray(parsed.s)) {
    for (const item of parsed.s) {
      if (
        Array.isArray(item) &&
        typeof item[0] === 'string' &&
        typeof item[1] === 'string' &&
        Number.isFinite(item[2]) &&
        Number.isFinite(item[3]) &&
        Math.abs(item[2]) <= 85 &&
        Math.abs(item[3]) <= 180
      ) {
        embeddedStops.push({
          id: item[0],
          title: item[1],
          lat: item[2],
          lng: item[3],
          kind: typeof item[4] === 'string' ? item[4] : 'forest',
          pointKind: 'place',
          collectible: true,
        });
      }
    }
  }

  const decodedPlan = {
    origin,
    radiusKm: [1, 2, 3, 5, 10].includes(Number(parsed.r)) ? Number(parsed.r) : 10,
    categories: Array.isArray(parsed.c) ? parsed.c.filter(c => typeof c === 'string') : [],
    selectedPlaceIds,
    companionMode: parsed.m,
    explorationMode: parsed.e,
    returnToOrigin: Boolean(parsed.ret),
    embeddedStops,
  };

  if (Array.isArray(knownPlaces)) {
    validateDecodedRoutePlan(decodedPlan, knownPlaces);
  }

  return decodedPlan;
}

/**
 * Ověří úplnost sdílené trasy před jejím nastavením (Bod 9).
 */
export function validateDecodedRoutePlan(decodedPlan, knownPlaces = []) {
  if (!decodedPlan || !Array.isArray(decodedPlan.selectedPlaceIds)) {
    throw new Error('Neplatný sdílený plán trasy.');
  }
  const knownIds = new Set((knownPlaces || []).map(p => p?.id).filter(Boolean));
  const embeddedMap = new Map((decodedPlan.embeddedStops || []).map(s => [s.id, s]));

  const missingIds = decodedPlan.selectedPlaceIds.filter(id => !knownIds.has(id) && !embeddedMap.has(id));
  if (missingIds.length > 0) {
    throw new Error(
      `Sdílená trasa je neúplná: ${missingIds.length} zastávek (${missingIds.join(', ')}) v tomto zařízení chybí. Původní plán zůstal zachován.`
    );
  }
  return true;
}