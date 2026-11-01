import { haversineMeters } from './domain.js';
import { routes as defaultCatalog } from './data.js';

export const GRID_CACHE_KEY_PREFIX = 'czekpoint.grid.v1:';
export const GRID_LRU_KEY = 'czekpoint.grid.lru';
export const MAX_CACHED_TILES = 15;
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const lastTileRequestTime = new Map();

let lastAutoPlacesStatus = {
  failed: false,
  message: '',
  updatedAt: 0,
};

export function getLastAutoPlacesStatus() {
  return { ...lastAutoPlacesStatus };
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/**
 * Definice vizuálních kategorií bodů zájmu s unikátním tvarem, barvou a českým štítkem.
 */
export const POI_VISUAL_CATEGORIES = {
  castles: {
    key: 'castles',
    kind: 'culture',
    shape: 'shield',
    shapeLabel: 'Štít',
    label: 'Hrady, zámky a památky',
    shortLabel: 'Památka / Hrad',
    color: '#b91c1c',
    bgLight: '#fef2f2',
    borderColor: '#fde047',
    textColor: '#ffffff',
  },
  sacral: {
    key: 'sacral',
    kind: 'culture',
    shape: 'arch',
    shapeLabel: 'Klenba',
    label: 'Kapličky, kostely a křížky',
    shortLabel: 'Kaplička / Křížek',
    color: '#7e22ce',
    bgLight: '#faf5ff',
    borderColor: '#e9d5ff',
    textColor: '#ffffff',
  },
  views: {
    key: 'views',
    kind: 'view',
    shape: 'diamond',
    shapeLabel: 'Kosočtverec',
    label: 'Vyhlídky, vrcholy a skály',
    shortLabel: 'Vyhlídka / Vrchol',
    color: '#d97706',
    bgLight: '#fffbeb',
    borderColor: '#fef08a',
    textColor: '#ffffff',
  },
  water: {
    key: 'water',
    kind: 'water',
    shape: 'droplet',
    shapeLabel: 'Kapka',
    label: 'Voda, rybníky a studánky',
    shortLabel: 'Voda / Studánka',
    color: '#0284c7',
    bgLight: '#f0f9ff',
    borderColor: '#bae6fd',
    textColor: '#ffffff',
  },
  nature: {
    key: 'nature',
    kind: 'forest',
    shape: 'leaf',
    shapeLabel: 'Lístek',
    label: 'Příroda, lesy a stromy',
    shortLabel: 'Příroda / Les',
    color: '#15803d',
    bgLight: '#f0fdf4',
    borderColor: '#bbf7d0',
    textColor: '#ffffff',
  },
  'route-start': {
    key: 'route-start',
    kind: 'route-start',
    shape: 'hexagon',
    shapeLabel: 'Šestiúhelník',
    label: 'Začátek trasy / okruh',
    shortLabel: 'Start trasy',
    color: '#142f26',
    bgLight: '#f4fce3',
    borderColor: '#a3e635',
    textColor: '#e5f2bc',
  },
};

/**
 * Určí vizuální kategorii (tvar, barvu, ikonu a český popis) pro libovolný bod zájmu.
 */
export function resolvePlaceVisualCategory(place) {
  if (!place) return POI_VISUAL_CATEGORIES.nature;
  if (place.pointKind === 'route-start' || place.kind === 'route-start') {
    return POI_VISUAL_CATEGORIES['route-start'];
  }
  const rawTitle = String(place.title || '').toLowerCase();
  // Odstraníme název města „pod třemšínem“, aby např. „Zámek Rožmitál pod Třemšínem“ nebyl považován za horu Třemšín
  const title = rawTitle.replace(/rožmitál\w*\s+pod\s+třemšínem|pod\s+třemšínem/g, 'rozmital');
  const subkind = String(place.subkind || '').toLowerCase();
  const kind = String(place.kind || '').toLowerCase();
  const cat = String(place.category || '').toLowerCase();
  const tags = place.tags || {};
  const hist = String(tags.historic || '').toLowerCase();
  const amen = String(tags.amenity || '').toLowerCase();
  const mm = String(tags.man_made || '').toLowerCase();

  // 1. Sakrální památky (kapličky, kostely, křížky, boží muka, kláštery, synagogy)
  if (
    subkind === 'sacral' ||
    cat === 'sacral' ||
    /^(wayside_chapel|wayside_cross|wayside_shrine)$/.test(hist) ||
    /^(place_of_worship|monastery)$/.test(amen) ||
    mm === 'cross' ||
    mm === 'belfry' ||
    /kapl|kaplička|kostel|kříž|křížek|boží muka|klášter|synagog|svatá hora|zvonice|hrob\b|hřbitov/.test(title)
  ) {
    return POI_VISUAL_CATEGORIES.sacral;
  }

  // 2. Hrady, zámky, muzea a historické památky
  if (
    subkind === 'heritage' ||
    kind === 'culture' ||
    cat === 'castles' ||
    cat === 'museums' ||
    /^(castle|ruins|manor|memorial|monument|archaeological_site|fort|tower|milestone)$/.test(hist) ||
    /hrad\b|hrádek|zámek|zámeček|tvrz|zřícenin|muzeum|skanzen|památník|mohyl|radnic|důl\b|štol|kovárn|mlýn|most\b|socha/.test(title)
  ) {
    return POI_VISUAL_CATEGORIES.castles;
  }

  // 3. Voda, rybníky, studánky a kašny
  if (
    kind === 'water' ||
    cat === 'water' ||
    /^(spring|water|waterfall)$/.test(String(tags.natural || '')) ||
    /^(fountain|drinking_water)$/.test(amen) ||
    /rybník|rybníky|nádrž|přehrad|jezero|studánk|pramen|vodopád|jez\b|tůň|potok|říčk|kašna/.test(title)
  ) {
    return POI_VISUAL_CATEGORIES.water;
  }

  // 4. Vyhlídky, vrcholy a skály
  if (
    kind === 'view' ||
    cat === 'views' ||
    tags.tourism === 'viewpoint' ||
    /^(peak|rock|cliff|cave_entrance|stone|saddle)$/.test(String(tags.natural || '')) ||
    /rozhledn|vyhlídk|vrch\b|vrchol|hora\b|skál|skalní|hřeben|kazateln|kopec|třemšín|štěrbin/.test(title)
  ) {
    return POI_VISUAL_CATEGORIES.views;
  }

  // 5. Příroda, lesy, památné stromy, přístřešky
  return POI_VISUAL_CATEGORIES.nature;
}

/**
 * Classifies a Czech place title into Czekpoint category & kind.
 */
export function classifyCzechPlaceTitle(rawTitle = '') {
  const full = String(rawTitle || '').toLowerCase();
  const t = full.replace(/rožmitál\w*\s+pod\s+třemšínem|pod\s+třemšínem/g, 'rozmital');
  if (/rozhledn|vyhlídk|vrch\b|vrchol|hora\b|hory\b|skál|skalní|hřeben|kazateln|kopec|třemšín|třemošn|tok\b|praha\s*\(|štěrbin/.test(t) && !/svatá hora/.test(full)) {
    return { category: 'views', kind: 'view', subkind: 'view', isTouristPoi: true };
  }
  if (/rybník|rybníky|nádrž|přehrad|jezero|studánk|pramen|vodopád|jez\b|tůň|lom\b|potok|říčk|voda/.test(t)) {
    return { category: 'water', kind: 'water', subkind: 'water', isTouristPoi: true };
  }
  if (/kapl|kaplička|kostel|kříž|křížek|boží muka|klášter|synagog|poutní|svatá hora|zvonice/.test(full)) {
    return { category: 'castles', kind: 'culture', subkind: 'sacral', isTouristPoi: true };
  }
  if (/hrad\b|hrádek|zámek|zámeček|tvrz|zřícenin|muzeum|skanzen|památník|mohyl|důl\b|štol|kovárn|mlýn|most\b|socha|radnic/.test(t)) {
    return { category: 'castles', kind: 'culture', subkind: 'heritage', isTouristPoi: true };
  }
  if (/přírodní|rezervac|památk|lesopark|park\b|alej|stezk|údolí|les\b|bor\b|strom|lípa|dub\b|buk\b|obora|bažantnic|louk|stráň|drkolnov/.test(t)) {
    return { category: 'nature', kind: 'forest', subkind: 'nature', isTouristPoi: true };
  }
  // Filter out non-tourist administrative or transport articles
  if (/^(okres|kraj|správní obvod|železniční trať|silnice|dálnice|seznam|bitva|volby|fc |fk |tj |sk )/.test(full)) {
    return { category: 'nature', kind: 'forest', subkind: 'nature', isTouristPoi: false };
  }
  return { category: 'nature', kind: 'forest', subkind: 'nature', isTouristPoi: true };
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
      `&list=geosearch&gscoord=${lat}%7C${lng}&gsradius=${safeRadius}&gslimit=80` +
      `&generator=geosearch&ggscoord=${lat}%7C${lng}&ggsradius=${safeRadius}&ggslimit=80` +
      `&prop=pageimages&piprop=name|thumbnail&pithumbsize=520&format=json&origin=*`;

    const timer = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = timer ? setTimeout(() => timer.abort(), 4500) : null;
    try {
      const res = await fetchImpl(url, { signal: timer ? timer.signal : signal });
      if (!res || !res.ok) return null;
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
            subkind: cls.subkind || null,
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
    return null;
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
 * Deduplicates places by canonical ID or spatial proximity within 18 meters (ZADÁNÍ #11 Bod 2.3).
 * Slučuje jen tehdy, mají-li stejnou kategorii/druh nebo podobný název, aby křížek a kaplička na jednom náměstí nezmizely.
 */
export function deduplicatePlaces(places) {
  if (!Array.isArray(places)) return [];
  const result = [];
  const seenIds = new Set();

  for (const place of places) {
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) continue;
    if (seenIds.has(place.id)) continue;

    // Spatial duplicate check (18 m)
    const isSpatialDuplicate = result.some(existing => {
      const dist = haversineMeters(existing, place);
      if (dist == null || dist > 18) return false;
      if (existing.category === place.category || existing.kind === place.kind) return true;
      const t1 = (existing.title || '').toLowerCase().trim();
      const t2 = (place.title || '').toLowerCase().trim();
      if (t1 && t2 && (t1.includes(t2) || t2.includes(t1))) return true;
      return false;
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
      places: places.slice(0, 260),
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

/**
 * Rychlé a bohaté načtení bodů zájmu z Overpass API:
 * - Používá rychlé `node` a `way` dotazy (bez pomalých `relation`), timeout 6 s a limit 260 bodů.
 * - Paralelně osloví dostupné Overpass mirrory (`Promise.any`) s timeoutem 4800 ms, takže pomalý primární server nikdy nezdržuje načítání.
 */
async function fetchFromOverpassBbox(bbox, config = {}, signal = null, fetchImpl = null) {
  if (!fetchImpl) return [];
  const query = `[out:json][timeout:6];(
    node(${bbox})[tourism~"^(viewpoint|museum|attraction|picnic_site|artwork|gallery|information|camp_site|alpine_hut|wilderness_hut)$"];
    way(${bbox})[tourism~"^(viewpoint|museum|attraction|picnic_site|artwork|gallery)$"];
    node(${bbox})[historic~"^(castle|ruins|manor|memorial|monument|wayside_chapel|wayside_cross|wayside_shrine|archaeological_site|fort|tower|milestone|boundary_stone|bunker|tomb)$"];
    way(${bbox})[historic~"^(castle|ruins|manor|memorial|monument|wayside_chapel|archaeological_site|fort|tower)$"];
    node(${bbox})[natural~"^(peak|spring|rock|cliff|cave_entrance|stone|tree|saddle|waterfall)$"];
    node(${bbox})[amenity~"^(place_of_worship|shelter|fountain|drinking_water|monastery|hunting_stand)$"];
    way(${bbox})[amenity~"^(place_of_worship|shelter|monastery)$"];
    node(${bbox})[man_made~"^(tower|watermill|windmill|mineshaft|adit|belfry|cross|obelisk|survey_point)$"];
    node(${bbox})[waterway~"^(waterfall|weir|dam)$"];
    way(${bbox})[leisure~"^(park|nature_reserve|garden)$"];
  );out center 260;`;

  const endpoints = config?.overpassEndpoint
    ? [config.overpassEndpoint, ...OVERPASS_ENDPOINTS.filter(u => u !== config.overpassEndpoint)]
    : OVERPASS_ENDPOINTS;

  const parseElements = (elements) => {
    return elements
      .filter(el => {
        if (!['node', 'way', 'relation'].includes(el.type) || !el.tags) return false;
        if (['private', 'no'].includes(el.tags?.access)) return false;
        if (el.tags.tourism === 'information') {
          const info = el.tags.information;
          if (info === 'guidepost') return Boolean(el.tags.name);
          if (info === 'board' || info === 'map') return true;
          return false;
        }
        if (el.tags.natural === 'tree') {
          return Boolean(el.tags.name || el.tags.denotation === 'natural_monument' || el.tags.monument === 'yes');
        }
        return true;
      })
      .map(el => {
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        const rawName = el.tags?.name?.trim();
        if (!rawName && el.tags?.natural === 'water') return null;

        let title = rawName;
        if (!title) {
          if (el.tags?.tourism === 'viewpoint') title = 'Vyhlídka';
          else if (el.tags?.historic === 'castle') title = 'Hrad či zámek';
          else if (el.tags?.historic === 'ruins') title = 'Zřícenina';
          else if (el.tags?.historic === 'wayside_chapel') title = 'Výklenková kaplička';
          else if (el.tags?.historic === 'wayside_cross' || el.tags?.man_made === 'cross') title = 'Křížek u cesty';
          else if (el.tags?.historic === 'wayside_shrine') title = 'Boží muka';
          else if (el.tags?.historic === 'memorial' || el.tags?.historic === 'monument') title = 'Památník';
          else if (el.tags?.historic === 'boundary_stone' || el.tags?.historic === 'milestone') title = 'Historický mezník';
          else if (el.tags?.natural === 'spring') title = 'Studánka';
          else if (el.tags?.natural === 'peak') title = 'Vrchol';
          else if (el.tags?.natural === 'rock' || el.tags?.natural === 'cliff' || el.tags?.natural === 'stone') title = 'Skalní útvar';
          else if (el.tags?.natural === 'cave_entrance') title = 'Jeskyně / Štola';
          else if (el.tags?.natural === 'waterfall' || el.tags?.waterway === 'waterfall') title = 'Vodopád / Kaskáda';
          else if (el.tags?.waterway === 'weir' || el.tags?.waterway === 'dam') title = 'Jez / Hráz';
          else if (el.tags?.amenity === 'place_of_worship') title = 'Kostel / Kaple';
          else if (el.tags?.amenity === 'fountain') title = 'Kašna';
          else if (el.tags?.amenity === 'drinking_water') title = 'Pítko / Pramen';
          else if (el.tags?.tourism === 'information' && el.tags?.information === 'board') title = 'Naučná tabule';
          else if (el.tags?.tourism === 'information' && el.tags?.information === 'map') title = 'Turistická mapa';
          else if (el.tags?.natural === 'tree') title = 'Památný strom';
          else if (el.tags?.tourism === 'picnic_site') title = 'Odpočinkové místo';
          else if (el.tags?.amenity === 'shelter') title = 'Turistický přístřešek';
          else if (el.tags?.amenity === 'hunting_stand') title = 'Lesní posed s výhledem';
          else if (el.tags?.man_made === 'belfry') title = 'Zvonička';
          else if (el.tags?.man_made === 'watermill') title = 'Vodní mlýn';
          else if (el.tags?.man_made === 'mineshaft' || el.tags?.man_made === 'adit') title = 'Historické důlní dílo';
          else title = 'Zajímavost v okolí';
        }

        let category = 'nature';
        let kind = 'forest';
        let subkind = 'nature';
        const hist = el.tags?.historic || '';
        const tour = el.tags?.tourism || '';
        const nat = el.tags?.natural || '';
        const amen = el.tags?.amenity || '';
        const mm = el.tags?.man_made || '';
        const ww = el.tags?.waterway || '';
        const leis = el.tags?.leisure || '';

        if (/^(wayside_chapel|wayside_cross|wayside_shrine)$/.test(hist) || /^(place_of_worship|monastery)$/.test(amen) || /^(belfry|cross)$/.test(mm)) {
          category = 'castles';
          kind = 'culture';
          subkind = 'sacral';
        } else if (/^(castle|ruins|manor|memorial|monument|archaeological_site|fort|tower|milestone|boundary_stone|bunker|tomb)$/.test(hist) || tour === 'museum' || tour === 'gallery' || /^(watermill|windmill|mineshaft|adit|obelisk)$/.test(mm)) {
          category = 'castles';
          kind = 'culture';
          subkind = 'heritage';
        } else if (tour === 'viewpoint' || /^(peak|rock|cliff|cave_entrance|stone|saddle)$/.test(nat) || (mm === 'tower' && !tour) || mm === 'survey_point') {
          category = 'views';
          kind = 'view';
          subkind = 'view';
        } else if (/^(spring|water|waterfall)$/.test(nat) || /^(fountain|drinking_water)$/.test(amen) || /^(waterfall|weir|dam)$/.test(ww)) {
          category = 'water';
          kind = 'water';
          subkind = 'water';
        } else if (/^(park|nature_reserve|garden)$/.test(leis) || tour === 'picnic_site' || amen === 'shelter' || amen === 'hunting_stand') {
          category = 'nature';
          kind = 'forest';
          subkind = 'nature';
        }

        return {
          id: `osm:${el.type}:${el.id}`,
          title,
          lat,
          lng,
          category,
          kind,
          subkind,
          pointKind: 'place',
          collectible: true,
          access: { stroller: el.tags?.wheelchair === 'yes' ? 'yes' : 'unknown' },
          surface: el.tags?.surface || null,
          tags: el.tags,
          url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
        };
      })
      .filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  };

  const queryEndpoint = async (endpoint) => {
    const timer = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = timer ? setTimeout(() => timer.abort(), 4800) : null;
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams({ data: query }),
        signal: timer ? timer.signal : signal,
      });
      if (!response || !response.ok) {
        throw new Error(`HTTP ${response?.status || 0}`);
      }
      const data = await response.json();
      if (!Array.isArray(data?.elements)) {
        throw new Error('Invalid Overpass payload');
      }
      return parseElements(data.elements);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  try {
    // Paralelní závod Overpass serverů — vyhrává nejrychlejší odpověď
    return await Promise.any(endpoints.slice(0, 2).map(ep => queryEndpoint(ep)));
  } catch {
    // Záložní pokus na třetí mirror, pokud první dva selhaly
    if (endpoints[2]) {
      try {
        return await queryEndpoint(endpoints[2]);
      } catch {}
    }
    return null;
  }
}

/**
 * ZADÁNÍ #11 (Bod 2.1) & DÁVKA 2 (Bod 2.2): Zákaz vymýšlení smyšlených míst.
 * ensureRichLocalCoverage pouze pasivně vrátí předaná ověřená data bez generování náhodných názvů.
 */
export function ensureRichLocalCoverage(places) {
  return places || [];
}

/**
 * Loads places for a ~10km area around centerPos anywhere in the Czech Republic:
 * 1. Immediately includes built-in curated places within radiusM.
 * 2. Checks localStorage cache for grid tile (unless options.forceRefresh is true).
 * 3. Fetches live POIs from Overpass API (parallel mirror race) AND Czech Wikipedia GeoSearch in parallel,
 *    with progressive rendering via options.onPartialPlaces.
 * Při výpadku sítě NIKDY nevymýšlí falešná místa, ponechá ověřená data.
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
  const onPartialPlaces = typeof effectiveOptions?.onPartialPlaces === 'function' ? effectiveOptions.onPartialPlaces : null;

  // 1. Built-in places within radiusM
  const builtIn = (routes || [])
    .filter(r => r.location && (r.pointKind === 'place' || r.pointKind == null))
    .map(r => ({
      id: r.id,
      title: r.title,
      lat: r.location.lat,
      lng: r.location.lng,
      kind: r.kind || 'forest',
      subkind: r.subkind || null,
      category: r.category || (r.kind === 'culture' ? 'castles' : r.kind === 'view' ? 'views' : r.kind === 'water' ? 'water' : 'nature'),
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
  const cachedTile = getCachedGridTile(gridKey, effectiveStorage);
  if (!forceRefresh && cachedTile && cachedTile.length > 0) {
    lastAutoPlacesStatus = { failed: false, message: '', updatedAt: Date.now() };
    const combined = deduplicatePlaces([...builtIn, ...cachedTile]);
    return combined.sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
  }

  // Okamžité předání lokálních bodů (0 ms), aby uživatel nečekal na síť
  if (onPartialPlaces && builtIn.length > 0) {
    try {
      const immediateList = deduplicatePlaces([...builtIn, ...(cachedTile || [])]).sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
      onPartialPlaces(immediateList);
    } catch {}
  }

  if (!fetchImpl) {
    lastAutoPlacesStatus = {
      failed: true,
      message: 'Místa v okolí se nepodařilo načíst',
      updatedAt: Date.now(),
    };
    const fallbackValid = deduplicatePlaces([...builtIn, ...(cachedTile || [])]).sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
    fallbackValid.loadFailed = true;
    fallbackValid.statusMessage = 'Místa v okolí se nepodařilo načíst';
    return fallbackValid;
  }

  // Per-tile rate limit (4s unless forceRefresh)
  const now = Date.now();
  const lastTileReq = lastTileRequestTime.get(gridKey) || 0;
  if (!forceRefresh && now - lastTileReq < 4000 && builtIn.length >= 12) {
    return builtIn.sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
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

    const wikiPromise = fetchPlacesFromWikipediaGeo(centerPos, Math.min(10000, radiusM), signal, fetchImpl).then(res => {
      if (onPartialPlaces && Array.isArray(res) && res.length > 0) {
        try {
          const fastCombined = deduplicatePlaces([...builtIn, ...res]).sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
          onPartialPlaces(fastCombined);
        } catch {}
      }
      return res;
    });

    const [overpassRes, wikiRes] = await Promise.allSettled([
      fetchFromOverpassBbox(bbox, config, signal, fetchImpl),
      wikiPromise,
    ]);

    const overpassOk = overpassRes.status === 'fulfilled' && Array.isArray(overpassRes.value);
    const wikiOk = wikiRes.status === 'fulfilled' && Array.isArray(wikiRes.value);
    const overpassPlaces = overpassOk ? overpassRes.value : [];
    const wikiPlaces = wikiOk ? wikiRes.value : [];

    if (!overpassOk && !wikiOk) {
      lastAutoPlacesStatus = {
        failed: true,
        message: 'Místa v okolí se nepodařilo načíst',
        updatedAt: Date.now(),
      };
      const validExisting = deduplicatePlaces([...builtIn, ...(cachedTile || [])]).sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
      validExisting.loadFailed = true;
      validExisting.statusMessage = 'Místa v okolí se nepodařilo načíst';
      return validExisting;
    }

    lastAutoPlacesStatus = {
      failed: false,
      message: '',
      updatedAt: Date.now(),
    };

    const fetchedPlaces = deduplicatePlaces([...overpassPlaces, ...wikiPlaces]);

    if (fetchedPlaces.length > 0) {
      setCachedGridTile(gridKey, fetchedPlaces, effectiveStorage);
    }

    const combined = deduplicatePlaces([...builtIn, ...fetchedPlaces]);
    return combined.sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
  } catch {
    lastAutoPlacesStatus = {
      failed: true,
      message: 'Místa v okolí se nepodařilo načíst',
      updatedAt: Date.now(),
    };
    const validExisting = deduplicatePlaces([...builtIn, ...(cachedTile || [])]).sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
    validExisting.loadFailed = true;
    validExisting.statusMessage = 'Místa v okolí se nepodařilo načíst';
    return validExisting;
  }
}