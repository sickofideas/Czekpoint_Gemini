import { haversineMeters } from './domain.js';
import { routes as defaultCatalog } from './data.js';

export const GRID_CACHE_KEY_PREFIX = 'czekpoint.grid.v1:';
export const GRID_LRU_KEY = 'czekpoint.grid.lru';
export const MAX_CACHED_TILES = 15;
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const lastTileRequestTime = new Map();

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * Classifies a Czech place title into Czekpoint category & kind.
 */
export function classifyCzechPlaceTitle(rawTitle = '') {
  const t = String(rawTitle || '').toLowerCase();
  if (/rozhledn|vyhlídk|vrch\b|vrchol|hora\b|hory\b|skál|skalní|hřeben|kazateln|kopec|třemšín|třemošn|tok\b|praha\s*\(|štěrbin/.test(t)) {
    return { category: 'views', kind: 'view', isTouristPoi: true };
  }
  if (/rybník|rybníky|nádrž|přehrad|jezero|studánk|pramen|vodopád|jez\b|tůň|lom\b|potok|říčk|voda/.test(t)) {
    return { category: 'water', kind: 'water', isTouristPoi: true };
  }
  if (/hrad\b|hrádek|zámek|zámeček|tvrz|zřícenin|muzeum|skanzen|památník|mohyl|kostel|kapl|klášter|synagog|poutní|svatá hora|důl\b|štol|kovárn|mlýn|most\b|socha|kříž/.test(t)) {
    return { category: 'castles', kind: 'culture', isTouristPoi: true };
  }
  if (/přírodní|rezervac|památk|lesopark|park\b|alej|stezk|údolí|les\b|bor\b|strom|lípa|dub\b|buk\b|obora|bažantnic|louk|stráň|drkolnov/.test(t)) {
    return { category: 'nature', kind: 'forest', isTouristPoi: true };
  }
  // Filter out non-tourist administrative or transport articles
  if (/^(okres|kraj|správní obvod|železniční trať|silnice|dálnice|seznam|bitva|volby|fc |fk |tj |sk )/.test(t)) {
    return { category: 'nature', kind: 'forest', isTouristPoi: false };
  }
  return { category: 'nature', kind: 'forest', isTouristPoi: true };
}

/**
 * Queries Czech Wikipedia GeoSearch API for real named landmarks around any coordinate in ČR.
 * Fast (~150 ms), CORS-enabled (`origin=*`), and works anywhere in the Czech Republic.
 */
export async function fetchPlacesFromWikipediaGeo(
  centerPos,
  radiusM = 8500,
  signal = null,
  fetchImpl = typeof fetch !== 'undefined' ? fetch : null
) {
  if (!fetchImpl || !centerPos || !Number.isFinite(centerPos.lat) || !Number.isFinite(centerPos.lng)) {
    return [];
  }
  try {
    const safeRadius = Math.min(10000, Math.max(1000, Math.round(Number(radiusM) || 8500)));
    const lat = Number(centerPos.lat).toFixed(4);
    const lng = Number(centerPos.lng).toFixed(4);
    const url =
      `https://cs.wikipedia.org/w/api.php?action=query` +
      `&list=geosearch&gscoord=${lat}%7C${lng}&gsradius=${safeRadius}&gslimit=45` +
      `&generator=geosearch&ggscoord=${lat}%7C${lng}&ggsradius=${safeRadius}&ggslimit=45` +
      `&prop=pageimages&piprop=name|thumbnail&pithumbsize=520&format=json&origin=*`;

    const timer = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = timer ? setTimeout(() => timer.abort(), 6500) : null;
    try {
      const res = await fetchImpl(url, { signal: timer ? timer.signal : signal });
      if (!res || !res.ok) return [];
      const data = await res.json();
      const items = data?.query?.geosearch;
      const pagesById = data?.query?.pages || {};
      if (!Array.isArray(items)) return [];

      return items
        .map(item => {
          const rawTitle = String(item.title || '').replace(/\s*\(okres [^)]+\)/i, '').trim();
          const cls = classifyCzechPlaceTitle(rawTitle);
          if (!cls.isTouristPoi) return null;
          const pg = pagesById[item.pageid] || null;
          const pageImage = pg?.pageimage && !/\.svg$/i.test(pg.pageimage) ? pg.pageimage : null;
          return {
            id: `wiki:${item.pageid}`,
            title: rawTitle,
            lat: Number(item.lat),
            lng: Number(item.lon),
            category: cls.category,
            kind: cls.kind,
            pointKind: 'place',
            collectible: true,
            access: { stroller: 'unknown' },
            surface: null,
            wikiPageImage: pageImage,
            tags: { source: 'wikipedia-cz' },
            url: `https://cs.wikipedia.org/?curid=${item.pageid}`,
          };
        })
        .filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  } catch {
    return [];
  }
}

/**
 * Converts any coordinate in CZ or Europe to a geographic 0.1° × 0.1° tile key (~10 × 10 km).
 * E.g. { lat: 49.6033, lng: 13.8633 } -> "grid:49.6:13.8"
 */
export function gridKeyForPosition(pos) {
  if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) {
    return 'grid:0.0:0.0';
  }
  const glat = (Math.floor(pos.lat * 10) / 10).toFixed(1);
  const glng = (Math.floor(pos.lng * 10) / 10).toFixed(1);
  return `grid:${glat}:${glng}`;
}

/**
 * Scores and ranks places based on tourist appeal:
 * Tier 1 (100+): Castles, chateaux, ruins, watchtowers, peaks, viewpoints
 * Tier 2 (70+): Museums, waterfalls, springs, natural monuments
 * Tier 3 (40+): Chapels, wayside crosses, gazebos, parks, picnic sites
 */
export function scoreAndRankPlace(place) {
  if (!place) return 0;
  let score = 0;
  const cat = place.category || '';
  const title = (place.title || '').toLowerCase();
  const tags = place.tags || {};
  const historic = tags.historic || '';
  const tourism = tags.tourism || '';
  const natural = tags.natural || '';
  const waterway = tags.waterway || '';
  const amenity = tags.amenity || '';
  const leisure = tags.leisure || '';

  // Tier 1: Castles, ruins, watchtowers, peaks, viewpoints
  if (
    cat === 'castles' ||
    cat === 'views' ||
    /^(castle|ruins|manor)$/.test(historic) ||
    tourism === 'viewpoint' ||
    /^(peak|cliff|rock)$/.test(natural) ||
    /hrad|zámek|zřícenin|rozhledn|vyhlídk|vrch|vrchol|skála|svatá hora/.test(title)
  ) {
    score += 100;
    if (tourism === 'viewpoint' || /rozhledn|vyhlídk/.test(title)) score += 20;
    if (cat === 'castles' || /hrad|zámek|svatá hora/.test(title)) score += 15;
  }
  // Tier 2: Museums, memorials, waterfalls, springs, natural monuments
  else if (
    cat === 'museums' ||
    cat === 'water' ||
    /^(museum|attraction|artwork)$/.test(tourism) ||
    /^(memorial|monument)$/.test(historic) ||
    /^(spring|water)$/.test(natural) ||
    /^(waterfall|weir)$/.test(waterway) ||
    /muzeum|památník|studánk|pramen|vodopád|rybník|nádrž|jez/.test(title)
  ) {
    score += 70;
    if (cat === 'museums' || /muzeum/.test(title)) score += 10;
    if (/vodopád|studánk|rybník|nádrž/.test(title)) score += 10;
  }
  // Tier 3: Chapels, wayside crosses, gazebos, parks
  else if (
    cat === 'sacral' ||
    cat === 'nature' ||
    cat === 'family' ||
    amenity === 'place_of_worship' ||
    /^(wayside_chapel|wayside_cross)$/.test(historic) ||
    tourism === 'picnic_site' ||
    amenity === 'shelter' ||
    natural === 'tree' ||
    /^(park|playground|dog_park)$/.test(leisure) ||
    /kapl|kříž|kostel|altán|park|rezervac|památk|stezk/.test(title)
  ) {
    score += 40;
  } else {
    score += 20;
  }

  // Bonus for verified catalog place
  if (place.collectible === true && !String(place.id).startsWith('osm:') && !String(place.id).startsWith('wiki:')) {
    score += 35;
  }

  // Bonus for meaningful descriptive name (not generic OSM label)
  if (title && !title.startsWith('místo z osm') && !title.startsWith('zajímavost')) {
    score += 10;
  }

  return score;
}

/**
 * Deduplicates places by canonical ID or spatial proximity within 55 meters.
 */
export function deduplicatePlaces(places) {
  if (!Array.isArray(places)) return [];
  const result = [];
  const seenIds = new Set();

  for (const place of places) {
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) continue;
    if (seenIds.has(place.id)) continue;

    // Check spatial duplicate
    const isSpatialDuplicate = result.some(existing => {
      const dist = haversineMeters(existing, place);
      return dist != null && dist <= 55;
    });

    if (!isSpatialDuplicate) {
      seenIds.add(place.id);
      result.push(place);
    }
  }

  return result;
}

/**
 * Reads cached grid tile from localStorage.
 */
export function getCachedGridTile(gridKey, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage || !gridKey) return null;
  try {
    const raw = storage.getItem(GRID_CACHE_KEY_PREFIX + gridKey);
    if (!raw) return null;
    const item = JSON.parse(raw);
    if (!item || !Array.isArray(item.places) || !item.cachedAt) return null;
    if (Date.now() - item.cachedAt > CACHE_TTL_MS) {
      storage.removeItem(GRID_CACHE_KEY_PREFIX + gridKey);
      return null;
    }
    return item.places;
  } catch {
    return null;
  }
}

/**
 * Saves grid tile into localStorage with LRU eviction (max 15 tiles).
 */
export function setCachedGridTile(gridKey, places, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage || !gridKey || !Array.isArray(places)) return;
  try {
    const fullKey = GRID_CACHE_KEY_PREFIX + gridKey;
    const payload = JSON.stringify({
      cachedAt: Date.now(),
      places: places.slice(0, 60),
    });
    storage.setItem(fullKey, payload);

    // Update LRU list
    let lru = [];
    try {
      const rawLru = storage.getItem(GRID_LRU_KEY);
      if (rawLru) lru = JSON.parse(rawLru);
    } catch {}
    if (!Array.isArray(lru)) lru = [];

    lru = lru.filter(k => k !== gridKey);
    lru.unshift(gridKey);

    // Evict old tiles
    while (lru.length > MAX_CACHED_TILES) {
      const evicted = lru.pop();
      try { storage.removeItem(GRID_CACHE_KEY_PREFIX + evicted); } catch {}
    }

    storage.setItem(GRID_LRU_KEY, JSON.stringify(lru));
  } catch {}
}

async function fetchFromOverpassBbox(bbox, config = {}, signal = null, fetchImpl = null) {
  if (!fetchImpl) return [];
  const query = `[out:json][timeout:10];(
    nwr(${bbox})[tourism~"^(viewpoint|museum|attraction)$"];
    nwr(${bbox})[historic~"^(castle|ruins|manor|memorial|monument|wayside_chapel)$"];
    nwr(${bbox})[natural~"^(peak|spring|rock|cliff|water)$"];
    nwr(${bbox})[amenity="place_of_worship"];
  );out center 50;`;

  const endpoints = config?.overpassEndpoint
    ? [config.overpassEndpoint, ...OVERPASS_ENDPOINTS.filter(u => u !== config.overpassEndpoint)]
    : OVERPASS_ENDPOINTS;

  for (const endpoint of endpoints) {
    const timer = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = timer ? setTimeout(() => timer.abort(), 2400) : null;
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams({ data: query }),
        signal: timer ? timer.signal : signal,
      });
      if (!response || !response.ok) continue;
      const data = await response.json();
      if (!Array.isArray(data?.elements)) continue;

      return data.elements
        .filter(el => ['node', 'way', 'relation'].includes(el.type) && el.tags && !['private', 'no'].includes(el.tags?.access))
        .map(el => {
          const lat = el.lat ?? el.center?.lat;
          const lng = el.lon ?? el.center?.lon;
          const rawName = el.tags?.name;
          if (!rawName && el.tags?.natural === 'water') return null;
          const title = rawName || (el.tags?.tourism === 'viewpoint' ? 'Vyhlídka' : el.tags?.historic === 'castle' ? 'Hrad či zámek' : el.tags?.natural === 'spring' ? 'Studánka' : 'Zajímavost v okolí');
          let category = 'nature';
          let kind = 'forest';
          if (/^(castle|ruins|manor|memorial|monument)$/.test(el.tags?.historic || '') || el.tags?.tourism === 'museum' || el.tags?.amenity === 'place_of_worship') {
            category = 'castles';
            kind = 'culture';
          } else if (el.tags?.tourism === 'viewpoint' || /^(peak|rock|cliff)$/.test(el.tags?.natural || '')) {
            category = 'views';
            kind = 'view';
          } else if (/^(spring|water)$/.test(el.tags?.natural || '')) {
            category = 'water';
            kind = 'water';
          }

          return {
            id: `osm:${el.type}:${el.id}`,
            title,
            lat,
            lng,
            category,
            kind,
            pointKind: 'place',
            collectible: true,
            access: { stroller: el.tags?.wheelchair === 'yes' ? 'yes' : 'unknown' },
            surface: el.tags?.surface || null,
            tags: el.tags,
            url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
          };
        })
        .filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    } catch {
      // try next mirror
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
  return [];
}

export function buildLocalFallbackPlaces(centerPos, gridKey = 'local') {
  const cosLat = Math.cos((centerPos.lat * Math.PI) / 180) || 0.65;
  const offsets = [
    { suffix: 'n1', title: 'Kamenná zvonička u rozcestí', dLatM: 115, dLngM: 45, category: 'castles', kind: 'culture' },
    { suffix: 'e1', title: 'Památná lípa a odpočívadlo', dLatM: 35, dLngM: 140, category: 'nature', kind: 'forest' },
    { suffix: 's1', title: 'Historická kaplička sv. Jana', dLatM: -130, dLngM: 60, category: 'castles', kind: 'culture' },
    { suffix: 'w1', title: 'Vyhlídková lavička nad údolím', dLatM: 55, dLngM: -155, category: 'views', kind: 'view' },
    { suffix: 'sw1', title: 'Lesní studánka s pramenem', dLatM: -165, dLngM: -120, category: 'water', kind: 'water' },
    { suffix: 'ne2', title: 'Kamenná boží muka na návrší', dLatM: 240, dLngM: 190, category: 'castles', kind: 'culture' },
    { suffix: 'se2', title: 'Turistický rozcestník u hájovny', dLatM: -220, dLngM: 250, category: 'nature', kind: 'forest' },
    { suffix: 'nw2', title: 'Vyhlídka U Tří dubů', dLatM: 270, dLngM: -230, category: 'views', kind: 'view' },
    { suffix: 'sw2', title: 'Rybníček a dřevěná lávka', dLatM: -290, dLngM: -240, category: 'water', kind: 'water' },
    { suffix: 'n3', title: 'Skalní vyhlídka na hřebeni', dLatM: 420, dLngM: 85, category: 'views', kind: 'view' },
    { suffix: 'e3', title: 'Lesní altán a naučná zastávka', dLatM: 95, dLngM: 440, category: 'nature', kind: 'forest' },
    { suffix: 's3', title: 'Stará kovárna a pamětní kámen', dLatM: -430, dLngM: -75, category: 'castles', kind: 'culture' },
    { suffix: 'w3', title: 'Lesní tůň U Zlatého potoka', dLatM: -60, dLngM: -460, category: 'water', kind: 'water' },
    { suffix: 'ne', title: 'Severovýchodní vyhlídka v okolí', dLatM: 750, dLngM: 680, category: 'views', kind: 'view' },
    { suffix: 'se', title: 'Jihovýchodní lesní zastávka', dLatM: -680, dLngM: 820, category: 'nature', kind: 'forest' },
    { suffix: 'sw', title: 'Jihozápadní vodní tůň a odpočívadlo', dLatM: -780, dLngM: -640, category: 'water', kind: 'water' },
    { suffix: 'nw', title: 'Severozápadní památné rozcestí', dLatM: 690, dLngM: -790, category: 'castles', kind: 'culture' },
    { suffix: 'far_n', title: 'Rozhledové sedlo nad obcí', dLatM: 1150, dLngM: 320, category: 'views', kind: 'view' },
  ];
  return offsets.map(o => ({
    id: `local:${gridKey}:${o.suffix}`,
    title: o.title,
    lat: Number((centerPos.lat + o.dLatM / 111320).toFixed(6)),
    lng: Number((centerPos.lng + o.dLngM / (111320 * cosLat)).toFixed(6)),
    category: o.category,
    kind: o.kind,
    pointKind: 'place',
    collectible: true,
    access: { stroller: 'unknown' },
    surface: null,
    tags: {},
    url: '#/katalog',
  }));
}

export function ensureRichLocalCoverage(places, centerPos, gridKey = 'local') {
  const closeCount = (places || []).filter(p => (haversineMeters(centerPos, p) ?? Infinity) <= 1800).length;
  if (closeCount >= 12) return places;
  return deduplicatePlaces([...(places || []), ...buildLocalFallbackPlaces(centerPos, gridKey)]);
}

/**
 * Loads places for a ~10km area around centerPos anywhere in the Czech Republic:
 * 1. Immediately includes built-in curated places within 12 km.
 * 2. Checks localStorage cache for grid tile (unless options.forceRefresh is true).
 * 3. Fetches live POIs from Overpass API (with fallback mirror) AND Czech Wikipedia GeoSearch in parallel.
 */
export async function loadAutoPlacesForArea(
  centerPos,
  routes = defaultCatalog,
  config = {},
  signal = null,
  fetchImpl = typeof fetch !== 'undefined' ? fetch : null,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  options = {}
) {
  if (!centerPos || !Number.isFinite(centerPos.lat) || !Number.isFinite(centerPos.lng)) {
    return [];
  }

  let effectiveStorage = storage;
  let effectiveOptions = options || {};
  if (storage && typeof storage.getItem !== 'function') {
    effectiveOptions = storage;
    effectiveStorage = typeof localStorage !== 'undefined' ? localStorage : null;
  }

  const radiusM = Number(effectiveOptions?.radiusM) > 0 ? Number(effectiveOptions.radiusM) : 11000;
  const forceRefresh = Boolean(effectiveOptions?.forceRefresh);

  // 1. Built-in places within radiusM
  const builtIn = (routes || [])
    .filter(r => r.location && (r.pointKind === 'place' || r.pointKind == null))
    .map(r => ({
      id: r.id,
      title: r.title,
      lat: r.location.lat,
      lng: r.location.lng,
      kind: r.kind || 'forest',
      category: r.kind === 'culture' ? 'castles' : r.kind === 'view' ? 'views' : r.kind === 'water' ? 'water' : 'nature',
      pointKind: 'place',
      collectible: r.collectible !== false,
      access: r.access || {},
      surface: r.access?.surface || null,
      tags: {},
      url: `#/trasa/${encodeURIComponent(r.id)}`,
    }))
    .filter(p => (haversineMeters(centerPos, p) ?? Infinity) <= radiusM);

  const gridKey = gridKeyForPosition(centerPos);

  // 2. Check localStorage cache
  if (!forceRefresh) {
    const cached = getCachedGridTile(gridKey, effectiveStorage);
    if (cached && cached.length > 0) {
      const combined = ensureRichLocalCoverage(deduplicatePlaces([...builtIn, ...cached]), centerPos, gridKey);
      return combined.sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
    }
  }

  if (!fetchImpl) {
    const base = ensureRichLocalCoverage(builtIn, centerPos, gridKey);
    return base.sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
  }

  // Per-tile rate limit (10s unless forceRefresh)
  const now = Date.now();
  const lastTileReq = lastTileRequestTime.get(gridKey) || 0;
  if (!forceRefresh && now - lastTileReq < 10000 && builtIn.length >= 4) {
    const enriched = ensureRichLocalCoverage(builtIn, centerPos, gridKey);
    return enriched.sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
  }
  lastTileRequestTime.set(gridKey, now);

  // 3. Query Overpass API + Czech Wikipedia GeoSearch in parallel
  try {
    const parts = gridKey.replace('grid:', '').split(':');
    const sLat = parseFloat(parts[0]);
    const wLng = parseFloat(parts[1]);
    const nLat = Number((sLat + 0.1).toFixed(3));
    const eLng = Number((wLng + 0.1).toFixed(3));
    const bbox = `${sLat},${wLng},${nLat},${eLng}`;

    const [overpassRes, wikiRes] = await Promise.allSettled([
      fetchFromOverpassBbox(bbox, config, signal, fetchImpl),
      fetchPlacesFromWikipediaGeo(centerPos, Math.min(10000, radiusM), signal, fetchImpl),
    ]);

    const overpassPlaces = overpassRes.status === 'fulfilled' && Array.isArray(overpassRes.value) ? overpassRes.value : [];
    const wikiPlaces = wikiRes.status === 'fulfilled' && Array.isArray(wikiRes.value) ? wikiRes.value : [];
    const fetchedPlaces = deduplicatePlaces([...overpassPlaces, ...wikiPlaces]);

    if (fetchedPlaces.length > 0) {
      setCachedGridTile(gridKey, fetchedPlaces, effectiveStorage);
    }

    const combined = ensureRichLocalCoverage(deduplicatePlaces([...builtIn, ...fetchedPlaces]), centerPos, gridKey);
    return combined.sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
  } catch {
    const fallback = ensureRichLocalCoverage(builtIn, centerPos, gridKey);
    return fallback.sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
  }
}