export const config = {
  appName: 'Czekpoint',
  regionName: 'Rožmitálsko a Brdy',
  defaultCity: 'Rožmitál pod Třemšínem',
  dataUrl: './data/routes.json',
  mapTileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  waymarkedTrailsUrl: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
  openTopoMapUrl: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
  overpassUrl: 'https://overpass-api.de/api/interpreter',
  // Volitelný klíč pro budoucí nasazení MapTiler Outdoor / Terrain-RGB
  maptilerApiKey: '',
  // Veřejný výškový zdroj (DEM) pro skutečný 3D reliéf v MapLibre GL JS bez nutnosti API klíče
  terrainDemUrl: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  terrainEncoding: 'terrarium',
  terrainTileSize: 256,
  terrainMaxZoom: 15,
  terrainExaggeration: 1.9,
  openFreeMapVectorUrl: 'https://tiles.openfreemap.org/planet',
  firebase: {
    enabled: false,
    apiKey: '',
    authDomain: '',
    projectId: '',
    appId: ''
  }
};

export const CONFIG = config;
export default config;

/**
 * Převede bod z aplikačního formátu `{ lat, lng }` nebo `[lat, lng]`
 * na pořadí vyžadované v MapLibre GL JS a GeoJSON: `[lng, lat]`.
 * Datové schéma v úložišti a jádru aplikace zůstává `{ lat, lng }`.
 */
export function toLngLat(pt) {
  if (!pt) return null;
  if (Array.isArray(pt)) {
    const lat = Number(pt[0]);
    const lng = Number(pt[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lng, lat];
  }
  const lat = Number(pt.lat);
  const lng = Number(pt.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lng, lat];
}

/**
 * Vytvoří GeoJSON Polygon kružnice se zadaným poloměrem v metrech.
 * Souřadnice jsou v GeoJSON pořadí `[lng, lat]`.
 */
export function createGeoJsonCirclePolygon(center, radiusMeters, steps = 48) {
  const cLngLat = toLngLat(center);
  const r = Number(radiusMeters);
  if (!cLngLat || !Number.isFinite(r) || r <= 0) {
    return {
      type: 'FeatureCollection',
      features: [],
    };
  }
  const [centerLng, centerLat] = cLngLat;
  const latRad = (centerLat * Math.PI) / 180;
  const degLatPerMeter = 1 / 111320;
  const degLngPerMeter = 1 / Math.max(1e-6, 111320 * Math.cos(latRad));

  const ring = [];
  const count = Math.max(16, Math.round(steps));
  for (let i = 0; i <= count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const dLat = Math.sin(angle) * r * degLatPerMeter;
    const dLng = Math.cos(angle) * r * degLngPerMeter;
    ring.push([centerLng + dLng, centerLat + dLat]);
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { radiusMeters: r },
        geometry: {
          type: 'Polygon',
          coordinates: [ring],
        },
      },
    ],
  };
}

/**
 * Sestaví čistý MapLibre GL styl (v8) s rastrovými vrstvami (OSM, OpenTopoMap, Waymarked Trails),
 * skutečným výškovým zdrojem `raster-dem` (`terrain-dem`), prostorovým stínováním svahů (`terrain-hillshade`)
 * a 3D budovami (`czekpoint-3d-buildings` z bezklíčového `openfreemap-v`).
 */
export function buildMapLibreStyle(cfg = config, options = {}) {
  const showContourLayer = Boolean(options.showContourLayer);
  const showHikingTrails = options.showHikingTrails !== false;
  const is3dMode = Boolean(options.is3dMode || options.is3DMode);
  const hasMaptilerKey = Boolean(cfg?.maptilerApiKey && String(cfg.maptilerApiKey).trim());

  const terrainDemSource = hasMaptilerKey
    ? {
        type: 'raster-dem',
        url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${encodeURIComponent(String(cfg.maptilerApiKey).trim())}`,
        tileSize: 256,
      }
    : {
        type: 'raster-dem',
        tiles: [cfg?.terrainDemUrl || 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: cfg?.terrainEncoding || 'terrarium',
        tileSize: cfg?.terrainTileSize || 256,
        maxzoom: cfg?.terrainMaxZoom || 15,
      };

  return {
    version: 8,
    name: 'Czekpoint Outdoor MapLibre Style',
    sources: {
      'osm-raster': {
        type: 'raster',
        tiles: [cfg?.mapTileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> (ODbL)',
      },
      'opentopo-raster': {
        type: 'raster',
        tiles: [cfg?.openTopoMapUrl || 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 17,
        attribution: 'Map data: &copy; OpenStreetMap, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)',
      },
      'waymarked-hiking': {
        type: 'raster',
        tiles: [cfg?.waymarkedTrailsUrl || 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 18,
        attribution: '&copy; <a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a>',
      },
      'terrain-dem': terrainDemSource,
      'openfreemap-v': {
        type: 'vector',
        url: cfg?.openFreeMapVectorUrl || 'https://tiles.openfreemap.org/planet',
      },
    },
    layers: [
      {
        id: 'osm-raster-layer',
        type: 'raster',
        source: 'osm-raster',
        minzoom: 0,
        maxzoom: 22,
      },
      {
        id: 'terrain-hillshade',
        type: 'hillshade',
        source: 'terrain-dem',
        paint: {
          'hillshade-exaggeration': 0.65,
          'hillshade-shadow-color': '#193e32',
          'hillshade-accent-color': '#2d5a46',
        },
      },
      {
        id: 'opentopo-raster-layer',
        type: 'raster',
        source: 'opentopo-raster',
        minzoom: 0,
        maxzoom: 22,
        layout: {
          visibility: showContourLayer ? 'visible' : 'none',
        },
        paint: {
          'raster-opacity': 0.85,
        },
      },
      {
        id: 'waymarked-hiking-layer',
        type: 'raster',
        source: 'waymarked-hiking',
        minzoom: 0,
        maxzoom: 22,
        layout: {
          visibility: showHikingTrails ? 'visible' : 'none',
        },
        paint: {
          'raster-opacity': 0.92,
        },
      },
      {
        id: 'czekpoint-3d-buildings',
        source: 'openfreemap-v',
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 14,
        layout: {
          visibility: is3dMode ? 'visible' : 'none',
        },
        paint: {
          'fill-extrusion-color': '#dfd8c8',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 9],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
          'fill-extrusion-opacity': 0.85,
        },
      },
    ],
  };
}
