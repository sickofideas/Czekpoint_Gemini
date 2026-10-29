/**
 * Czekpoint — Turistické trasy z OpenStreetMap (route=hiking & osmc:symbol)
 * Zobrazuje značené pěší trasy jako samostatnou vrstvu, zachovává barvy podle dat OSM
 * a vykresluje vlastní vektorové značky podle osmc:symbol bez přebírání cizí grafiky.
 * Licence dat: © přispěvatelé OpenStreetMap (ODbL).
 */

export const OSMC_COLORS = Object.freeze({
  red: '#d62828',
  blue: '#1d6fd8',
  green: '#2b8a3e',
  yellow: '#e6a100',
});

export const COLOR_LABELS_CS = Object.freeze({
  red: 'Červená turistická trasa',
  blue: 'Modrá turistická trasa',
  green: 'Zelená turistická trasa',
  yellow: 'Žlutá turistická trasa',
});

/**
 * Parsuje tag `osmc:symbol` (formát: waycolor:background[:foreground[:text:textcolor]])
 * a případné záložní tagy `colour` / `kct_*` z OpenStreetMap relace.
 * Chybějící značení NIKDY nedoplňuje odhadem — vrátí known: false, pokud v datech není.
 * Podporuje volání s objektem tagů `parseOsmcSymbol(tags)` i s řetězcem `parseOsmcSymbol(osmcStr, colourStr)`.
 */
export function parseOsmcSymbol(tagsOrSymbol = {}, fallbackColour = '') {
  let tags = {};
  if (typeof tagsOrSymbol === 'string') {
    tags = {
      'osmc:symbol': tagsOrSymbol,
      colour: fallbackColour || '',
    };
  } else if (tagsOrSymbol && typeof tagsOrSymbol === 'object') {
    tags = tagsOrSymbol;
  }

  const emptyResult = {
    wayColor: null,
    colorKey: null,
    hex: '#6b796d',
    known: false,
    background: null,
    foreground: null,
    symbolType: 'unmarked',
    rawOsmc: null,
    labelCs: 'Značení neuvedeno v datech OSM',
    labelCz: 'Značení neuvedeno v datech OSM',
  };

  const rawOsmc = typeof tags['osmc:symbol'] === 'string' ? tags['osmc:symbol'].trim() : '';
  if (rawOsmc) {
    const parts = rawOsmc.split(':').map(s => s.trim().toLowerCase());
    const wayColor = parts[0] || null;
    const background = parts[1] || 'white';
    const foreground = parts[2] || '';
    const hex = OSMC_COLORS[wayColor] || null;

    let symbolType = 'bar';
    if (foreground.includes('backslash') || foreground.includes('slash')) {
      symbolType = 'learning';
    } else if (foreground.includes('triangle')) {
      symbolType = 'peak';
    } else if (foreground.includes('arch') || foreground.includes('ruin') || foreground.includes('l')) {
      symbolType = 'ruin';
    } else if (foreground.includes('bowl') || foreground.includes('spring')) {
      symbolType = 'spring';
    } else if (foreground.includes('corner') || foreground.includes('turned_t')) {
      symbolType = 'local';
    }

    if (hex) {
      const label = symbolType === 'learning'
        ? `Naučná stezka (${wayColor})`
        : (COLOR_LABELS_CS[wayColor] || `Značená trasa (${wayColor})`);
      return {
        wayColor,
        colorKey: wayColor,
        hex,
        known: true,
        background,
        foreground: foreground || `${wayColor}_bar`,
        symbolType,
        rawOsmc,
        labelCs: label,
        labelCz: label,
      };
    }
  }

  // Fallback pouze na explicitní OSM tagy kct_* nebo colour, nikdy odhadem z názvu
  for (const colorKey of ['red', 'blue', 'green', 'yellow']) {
    if (tags[`kct_${colorKey}`]) {
      const kctType = String(tags[`kct_${colorKey}`]).toLowerCase();
      const symbolType = kctType === 'learning' ? 'learning' : kctType === 'peak' ? 'peak' : 'bar';
      const label = COLOR_LABELS_CS[colorKey];
      return {
        wayColor: colorKey,
        colorKey,
        hex: OSMC_COLORS[colorKey],
        known: true,
        background: 'white',
        foreground: symbolType === 'learning' ? `${colorKey}_backslash` : `${colorKey}_bar`,
        symbolType,
        rawOsmc: `${colorKey}:white:${symbolType === 'learning' ? `${colorKey}_backslash` : `${colorKey}_bar`}`,
        labelCs: label,
        labelCz: label,
      };
    }
  }

  const rawColour = typeof (tags.colour || fallbackColour) === 'string'
    ? (tags.colour || fallbackColour).trim().toLowerCase()
    : '';
  if (rawColour && OSMC_COLORS[rawColour]) {
    const label = COLOR_LABELS_CS[rawColour];
    return {
      wayColor: rawColour,
      colorKey: rawColour,
      hex: OSMC_COLORS[rawColour],
      known: true,
      background: 'white',
      foreground: `${rawColour}_bar`,
      symbolType: 'bar',
      rawOsmc: null,
      labelCs: label,
      labelCz: label,
    };
  }

  return emptyResult;
}

/**
 * Vykreslí vlastní čisté SVG turistické značky podle rozparsovaného `osmc:symbol`
 * (bez přebírání cizích mapových podkladů či grafiky).
 */
export function renderOsmcBadgeSvg(symbolOrTags, colourOrSize = 18, options = {}) {
  let size = 18;
  let fallbackColour = '';
  if (typeof colourOrSize === 'number') {
    size = colourOrSize;
  } else if (typeof colourOrSize === 'string') {
    fallbackColour = colourOrSize;
  }
  if (options && typeof options.size === 'number') {
    size = options.size;
  }

  const sym = symbolOrTags?.wayColor !== undefined
    ? symbolOrTags
    : parseOsmcSymbol(symbolOrTags, fallbackColour);

  if (!sym.known || !sym.wayColor) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="4" fill="#f1f3ee" stroke="#6b796d" stroke-width="2" stroke-dasharray="3,2"/></svg>`;
  }

  if (sym.symbolType === 'learning') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#ffffff" stroke="#1f2922" stroke-width="1.8"/>
      <polygon points="4,4 11,4 20,20 13,20" fill="${sym.hex}"/>
    </svg>`;
  }

  if (sym.symbolType === 'peak') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#ffffff" stroke="#1f2922" stroke-width="1.8"/>
      <polygon points="12,5 20,19 4,19" fill="${sym.hex}"/>
    </svg>`;
  }

  // Standardní pásové značení (white / color_bar / white)
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="3" fill="#ffffff" stroke="#1f2922" stroke-width="1.8"/>
    <rect x="3.5" y="8.5" width="17" height="7" fill="${sym.hex}"/>
  </svg>`;
}

/**
 * Pilotní ověřená sada turistických tras z OpenStreetMap (route=hiking)
 * pro Rožmitál pod Třemšínem, Starý Rožmitál, Voltuš, Štěrbinu a Třemšín.
 * Zdroj: © přispěvatelé OpenStreetMap (ODbL), https://www.openstreetmap.org/copyright
 */
export const PILOT_HIKING_TRAILS = Object.freeze([]);


/**
 * Vrátí připravené a zvalidované turistické trasy pro vykreslení na mapě.
 * Každá trasa má rozparsovaný `parsedSymbol` podle `osmc:symbol` a nikdy nedoplňuje chybějící barvu odhadem.
 */
export async function getHikingTrails(customTrailsOrOptions = PILOT_HIKING_TRAILS) {
  const list = Array.isArray(customTrailsOrOptions)
    ? customTrailsOrOptions
    : PILOT_HIKING_TRAILS;

  return list.map(trail => {
    const parsedSymbol = parseOsmcSymbol(trail.tags || trail.osmcSymbol || {}, trail.colour);
    return {
      ...trail,
      osmcSymbol: trail.osmcSymbol || trail.tags?.['osmc:symbol'] || '',
      colour: trail.colour || trail.tags?.colour || parsedSymbol.wayColor || '',
      parsedSymbol,
    };
  });
}

/**
 * Normalizuje surovou odpověď Overpass API pro `relation["route"="hiking"]` na strukturu tras.
 * Nepřidává odhadované barvy k trasám, které v OSM nemají `osmc:symbol`, `kct_*` ani `colour`.
 */
export function normalizeOverpassHikingRelations(overpassJson) {
  if (!Array.isArray(overpassJson?.elements)) return [];
  const trails = [];
  for (const el of overpassJson.elements) {
    if (el.type !== 'relation' || el.tags?.route !== 'hiking') continue;
    const parsedSymbol = parseOsmcSymbol(el.tags);
    const segments = [];
    if (Array.isArray(el.members)) {
      for (const m of el.members) {
        if (m.type === 'way' && Array.isArray(m.geometry) && m.geometry.length >= 2) {
          segments.push(m.geometry.map(pt => [pt.lat, pt.lon]));
        }
      }
    }
    if (segments.length === 0) continue;
    trails.push({
      id: `osm:relation:${el.id}`,
      osmRelationId: el.id,
      name: el.tags?.name || parsedSymbol.labelCs,
      sectionLabel: el.tags?.from && el.tags?.to ? `${el.tags.from} → ${el.tags.to}` : (el.tags?.description || 'Trasa z OpenStreetMap'),
      osmcSymbol: el.tags?.['osmc:symbol'] || '',
      colour: el.tags?.colour || parsedSymbol.wayColor || '',
      tags: el.tags,
      parsedSymbol,
      segments,
      coordinates: segments.flat(),
    });
  }
  return trails;
}
