export const config = {
  appName: 'Czekpoint',
  version: '2.3.0',
  appVersion: 'v2.3',
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
  terrainMaxZoom: 14,
  terrainExaggeration: 1.8,
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
 * Ochrana proti záměně `lat` a `lng` (Česko = `lat: 47..52`, `lng: 11..20`).
 * Vždy vrací objekt `{ lat, lng }` pro interní výpočty vzdálenosti a `planner.js`.
 */
export function normalizePointLatLng(pt) {
  if (!pt) return null;
  let lat;
  let lng;
  if (Array.isArray(pt)) {
    if (pt.length < 2) return null;
    lat = Number(pt[0]);
    lng = Number(pt[1]);
  } else if (typeof pt === 'object') {
    lat = Number(pt.lat ?? pt.latitude);
    lng = Number(pt.lng ?? pt.lon ?? pt.longitude);
  } else {
    return null;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // V ČR je zeměpisná šířka lat vždy mezi 47 a 52 a zeměpisná délka lng vždy mezi 11 a 20.
  // Pokud jsou prohozené (lat < 25 && lng > 45), automaticky je opravíme!
  if (lat < 25 && lng > 45) {
    const tmp = lat;
    lat = lng;
    lng = tmp;
  }
  return { lat, lng };
}

/**
 * Pro MapLibre GeoJSON (`plannedRoute` čára na mapě) vždy vrací striktně pole `[lng, lat]` (`[13.86..., 49.60...]`).
 */
export function toMapLibreLngLat(pt) {
  const norm = normalizePointLatLng(pt);
  if (!norm) return null;
  return [norm.lng, norm.lat];
}

/**
 * Převede bod z aplikačního formátu `{ lat, lng }` nebo `[lat, lng]`
 * na pořadí vyžadované v MapLibre GL JS a GeoJSON: `[lng, lat]`.
 * Datové schéma v úložišti a jádru aplikace zůstává `{ lat, lng }`.
 */
export function toLngLat(pt) {
  return toMapLibreLngLat(pt);
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
 * skutečným výškovým zdrojem `raster-dem` (`terrain-dem`), prostorovým stínováním svahů (`terrain-hillshade`),
 * 3D lesy (`czekpoint-3d-forests`) a 3D budovami (`czekpoint-3d-buildings` z bezklíčového `openfreemap-v`).
 */
export function buildMapLibreStyle(cfg = config, options = {}) {
  const showContourLayer = Boolean(options.showContourLayer);
  const showHikingTrails = options.showHikingTrails !== false;
  const is3dMode = options.is3dMode !== undefined
    ? Boolean(options.is3dMode)
    : options.is3DMode !== undefined
    ? Boolean(options.is3DMode)
    : true;
  const show3dBuildings = options.show3dBuildings !== false;
  const hasMaptilerKey = Boolean(cfg?.maptilerApiKey && String(cfg.maptilerApiKey).trim());
  const exaggeration = Number(cfg?.terrainExaggeration) || 1.8;

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
        maxzoom: cfg?.terrainMaxZoom || 14,
      };

  const styleObj = {
    version: 8,
    name: 'Czekpoint Outdoor 3D MapLibre Style',
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
        maxzoom: 17,
        attribution: '&copy; <a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a>',
      },
      'terrain-dem': { ...terrainDemSource },
      'hillshade-dem': { ...terrainDemSource },
      'openfreemap-v': {
        type: 'vector',
        url: cfg?.openFreeMapVectorUrl || 'https://tiles.openfreemap.org/planet',
      },
    },
    terrain: is3dMode
      ? {
          source: 'terrain-dem',
          exaggeration,
        }
      : undefined,
    sky: {
      'sky-color': '#bcdbf4',
      'horizon-color': '#eef6fc',
      'fog-color': '#dfeef9',
      'sky-horizon-blend': 0.45,
      'horizon-fog-blend': 0.5,
      'fog-ground-blend': 0.25,
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
        source: 'hillshade-dem',
        layout: {
          visibility: is3dMode ? 'visible' : 'none',
        },
        paint: {
          'hillshade-exaggeration': 0.85,
          'hillshade-shadow-color': '#0f291e',
          'hillshade-highlight-color': '#fffef2',
          'hillshade-accent-color': '#2d6a4f',
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
          'raster-opacity': 0.78,
        },
      },
      {
        id: 'waymarked-hiking-layer',
        type: 'raster',
        source: 'waymarked-hiking',
        minzoom: 0,
        maxzoom: 19,
        layout: {
          visibility: showHikingTrails ? 'visible' : 'none',
        },
        paint: {
          'raster-opacity': 0.92,
        },
      },
      {
        id: 'czekpoint-3d-forests',
        source: 'openfreemap-v',
        'source-layer': 'landcover',
        type: 'fill-extrusion',
        minzoom: 11,
        filter: ['==', ['get', 'class'], 'wood'],
        layout: {
          visibility: is3dMode ? 'visible' : 'none',
        },
        paint: {
          'fill-extrusion-color': '#2d6a4f',
          'fill-extrusion-height': 12,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.58,
        },
      },
      {
        id: 'czekpoint-3d-buildings',
        source: 'openfreemap-v',
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 13,
        layout: {
          visibility: (is3dMode && show3dBuildings) ? 'visible' : 'none',
        },
        paint: {
          'fill-extrusion-color': [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
            0, '#e6dec8',
            12, '#d8b48a',
            25, '#c98a63',
          ],
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
          'fill-extrusion-opacity': 0.85,
        },
      },
    ],
  };

  return styleObj;
}

