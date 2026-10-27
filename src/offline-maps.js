// ============================================================
// CZEKPOINT v1.2 — Offline mapy a kešování oblasti (src/offline-maps.js)
// Stahuje mapové dlaždice (zoom 13, 14, 15, max ~120 dlaždic) do CacheStorage
// a ukládá místa v okolí + naplánovanou trasu do localStorage pro les bez signálu.
// ============================================================

export const OFFLINE_TILE_CACHE_NAME = 'czekpoint-tiles-v1.2';
export const OFFLINE_DATA_STORAGE_KEY = 'czekpoint.offline_area_bundle.v1.2';
export const MAX_OFFLINE_TILES = 120;

export function latLngToTileXY(lat, lng, zoom) {
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, Number(lat) || 0));
  const clampedLng = Math.max(-180, Math.min(180, Number(lng) || 0));
  const n = Math.pow(2, zoom);
  const x = Math.floor(((clampedLng + 180) / 360) * n);
  const latRad = (clampedLat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
    z: zoom,
  };
}

export function buildOfflineTileListForBounds(bounds, options = {}) {
  const zooms = Array.isArray(options.zooms) ? options.zooms : [13, 14, 15];
  const maxTiles = Number(options.maxTiles) > 0 ? Number(options.maxTiles) : MAX_OFFLINE_TILES;
  const includeHikingOverlay = options.includeHikingOverlay !== false;

  const south = Number(bounds?.south ?? bounds?.getSouth?.() ?? 49.68);
  const west = Number(bounds?.west ?? bounds?.getWest?.() ?? 13.95);
  const north = Number(bounds?.north ?? bounds?.getNorth?.() ?? 49.74);
  const east = Number(bounds?.east ?? bounds?.getEast?.() ?? 14.05);

  const centerLat = (south + north) / 2;
  const centerLng = (west + east) / 2;

  const tiles = [];
  const seen = new Set();

  for (const z of zooms) {
    const minTile = latLngToTileXY(north, west, z);
    const maxTile = latLngToTileXY(south, east, z);
    const centerTile = latLngToTileXY(centerLat, centerLng, z);

    const xStart = Math.min(minTile.x, maxTile.x);
    const xEnd = Math.max(minTile.x, maxTile.x);
    const yStart = Math.min(minTile.y, maxTile.y);
    const yEnd = Math.max(minTile.y, maxTile.y);

    const zoomCoords = [];
    for (let x = xStart; x <= xEnd; x++) {
      for (let y = yStart; y <= yEnd; y++) {
        const distSq = Math.pow(x - centerTile.x, 2) + Math.pow(y - centerTile.y, 2);
        zoomCoords.push({ z, x, y, distSq });
      }
    }
    zoomCoords.sort((a, b) => a.distSq - b.distSq);

    for (const coord of zoomCoords) {
      if (tiles.length >= maxTiles) break;
      const sub = ['a', 'b', 'c'][(coord.x + coord.y) % 3];
      const osmUrl = `https://${sub}.tile.openstreetmap.org/${coord.z}/${coord.x}/${coord.y}.png`;
      if (!seen.has(osmUrl)) {
        seen.add(osmUrl);
        tiles.push({ url: osmUrl, z: coord.z, x: coord.x, y: coord.y, layer: 'osm' });
      }
      if (includeHikingOverlay && coord.z <= 14 && tiles.length < maxTiles) {
        const hikingUrl = `https://tile.waymarkedtrails.org/hiking/${coord.z}/${coord.x}/${coord.y}.png`;
        if (!seen.has(hikingUrl)) {
          seen.add(hikingUrl);
          tiles.push({ url: hikingUrl, z: coord.z, x: coord.x, y: coord.y, layer: 'hiking' });
        }
      }
    }
    if (tiles.length >= maxTiles) break;
  }

  return tiles.slice(0, maxTiles);
}

export function saveOfflineAreaData({ bounds, center, places = [], plannedRoute = null, label = '' } = {}) {
  const payload = {
    version: '1.2.0',
    savedAt: Date.now(),
    label: label || 'Uložená oblast',
    center: center || { lat: 49.712, lng: 13.996 },
    bounds: bounds || null,
    placesCount: Array.isArray(places) ? places.length : 0,
    places: Array.isArray(places) ? places.slice(0, 250) : [],
    plannedRoute: plannedRoute || null,
  };

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(OFFLINE_DATA_STORAGE_KEY, JSON.stringify(payload));
    }
  } catch (_) {}

  return payload;
}

export function loadOfflineAreaData() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(OFFLINE_DATA_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export async function downloadOfflineArea({
  bounds,
  center,
  places = [],
  plannedRoute = null,
  onProgress = null,
  fetchImpl = typeof fetch !== 'undefined' ? fetch : null,
} = {}) {
  const tileList = buildOfflineTileListForBounds(bounds, {
    zooms: [13, 14, 15],
    maxTiles: MAX_OFFLINE_TILES,
    includeHikingOverlay: true,
  });

  const savedBundle = saveOfflineAreaData({
    bounds: bounds
      ? {
          south: Number(bounds.south ?? bounds.getSouth?.() ?? 49.68),
          west: Number(bounds.west ?? bounds.getWest?.() ?? 13.95),
          north: Number(bounds.north ?? bounds.getNorth?.() ?? 49.74),
          east: Number(bounds.east ?? bounds.getEast?.() ?? 14.05),
        }
      : null,
    center,
    places,
    plannedRoute,
  });

  const total = Math.max(1, tileList.length);
  let completed = 0;
  let cachedCount = 0;

  const report = (customText) => {
    const percent = Math.min(100, Math.round((completed / total) * 100));
    const text =
      customText ||
      (completed < total
        ? `Stahuji mapu do paměti: ${percent} %...`
        : `Offline mapa uložena (${cachedCount} dlaždic, ${savedBundle.placesCount} míst)`);
    if (typeof onProgress === 'function') {
      onProgress({ completed, total, percent, cachedCount, text, savedBundle });
    }
  };

  report(`Stahuji mapu do paměti: 0 %...`);

  let cache = null;
  try {
    if (typeof caches !== 'undefined' && caches.open) {
      cache = await caches.open(OFFLINE_TILE_CACHE_NAME);
    }
  } catch (_) {}

  const concurrency = 6;
  for (let i = 0; i < tileList.length; i += concurrency) {
    const batch = tileList.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (tile) => {
        try {
          if (cache) {
            const existing = await cache.match(tile.url);
            if (existing) {
              cachedCount++;
              completed++;
              return;
            }
          }
          if (fetchImpl) {
            const response = await fetchImpl(tile.url, { mode: 'cors', credentials: 'omit' });
            if (response && (response.ok || response.type === 'opaque')) {
              if (cache) {
                await cache.put(tile.url, response.clone());
              }
              cachedCount++;
            }
          }
        } catch (_) {
        } finally {
          completed = Math.min(total, completed + 1);
        }
      })
    );
    report();
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'PRECACHE_TILES',
        urls: tileList.slice(0, 30).map((t) => t.url),
      });
    }
  } catch (_) {}

  const finalPercent = 100;
  const finalText = `Offline mapa připravena (${cachedCount}/${total} dlaždic, ${savedBundle.placesCount} míst v paměti)`;
  if (typeof onProgress === 'function') {
    onProgress({
      completed: total,
      total,
      percent: finalPercent,
      cachedCount,
      text: finalText,
      savedBundle,
      done: true,
    });
  }

  return {
    total,
    cachedCount,
    placesCount: savedBundle.placesCount,
    text: finalText,
    savedBundle,
  };
}
