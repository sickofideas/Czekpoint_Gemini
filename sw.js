// ============================================================
// CZEKPOINT v1.3 — Service Worker pro offline mapy a běh v lese bez signálu (sw.js)
// - Automaticky ukládá aplikační soubory (index.html, src/*.js, assets/**)
// - Ukládá mapové dlaždice (tile.openstreetmap.org, tile.opentopomap.org, tile.waymarkedtrails.org)
// - Poskytuje cache-first strategii s doživotním fallbackem pro dlaždice při výpadku signálu
// ============================================================

const APP_CACHE_NAME = 'czekpoint-app-shell-v5.1.0';
const ICON_CACHE_NAME = 'czekpoint-svg-icons-v5.1.0';
const TILE_CACHE_NAME = 'czekpoint-offline-tiles-v1.3';

// Všechny SVG ikony kategorií, špendlíků a avatarů na mapě pro okamžité Cache-First načtení bez signálu
const SVG_ICON_ASSETS = [
  './assets/icon.svg',
  './assets/castle.svg',
  './assets/forest.svg',
  './assets/lake.svg',
  './assets/landscape.svg',
  './assets/hero-atlas.svg',
  './assets/logo-100.svg',
  './assets/avatars/datel.svg',
  './assets/avatars/jelen.svg',
  './assets/avatars/jezek.svg',
  './assets/avatars/kapradina.svg',
  './assets/avatars/liska.svg',
  './assets/avatars/list.svg',
  './assets/avatars/medved.svg',
  './assets/avatars/rys.svg',
  './assets/avatars/sova.svg',
  './assets/avatars/veverka.svg',
  './assets/avatars/vydra.svg',
  './assets/avatars/zajic.svg',
];

// Vestavěné SVG definice špendlíků a kategorií pro 100% dostupnost i při úplné ztrátě signálu
const BUILTIN_CATEGORY_PIN_SVGS = {
  castles:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42 42" width="42" height="42"><path d="M21 2C11.6 2 4 9.6 4 19c0 11.2 17 21 17 21s17-9.8 17-21C38 9.6 30.4 2 21 2z" fill="#b45309" stroke="#ffffff" stroke-width="2.5"/><path d="M13 25V13h3v2h2v-2h6v2h2v-2h3v12H13zm6-5v5h4v-5a2 2 0 0 0-4 0z" fill="#ffffff"/></svg>',
  sacral:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42 42" width="42" height="42"><path d="M21 2C11.6 2 4 9.6 4 19c0 11.2 17 21 17 21s17-9.8 17-21C38 9.6 30.4 2 21 2z" fill="#7e22ce" stroke="#ffffff" stroke-width="2.5"/><path d="M21 8v5M18.5 10.5h5" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/><path d="M15 26V17l6-4.5 6 4.5v9H15zm4.2-5v5h3.6v-5a1.8 1.8 0 0 0-3.6 0z" fill="#ffffff"/></svg>',
  views:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42 42" width="42" height="42"><path d="M21 2C11.6 2 4 9.6 4 19c0 11.2 17 21 17 21s17-9.8 17-21C38 9.6 30.4 2 21 2z" fill="#0369a1" stroke="#ffffff" stroke-width="2.5"/><path d="M11.5 24.5l7-11 4.2 6.2 2.8-4.2 5 9h-19z" fill="#ffffff"/><circle cx="26.5" cy="12" r="2.2" fill="#fde047"/></svg>',
  water:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42 42" width="42" height="42"><path d="M21 2C11.6 2 4 9.6 4 19c0 11.2 17 21 17 21s17-9.8 17-21C38 9.6 30.4 2 21 2z" fill="#0284c7" stroke="#ffffff" stroke-width="2.5"/><path d="M12 16.5c2.2-1.8 4.5-1.8 6.7 0s4.5 1.8 6.7 0 3.4-1.4 4.6-.4M12 21.5c2.2-1.8 4.5-1.8 6.7 0s4.5 1.8 6.7 0 3.4-1.4 4.6-.4" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/></svg>',
  nature:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42 42" width="42" height="42"><path d="M21 2C11.6 2 4 9.6 4 19c0 11.2 17 21 17 21s17-9.8 17-21C38 9.6 30.4 2 21 2z" fill="#15803d" stroke="#ffffff" stroke-width="2.5"/><polygon points="21,9 15,17 18.5,17 14.5,23 27.5,23 23.5,17 27,17" fill="#ffffff"/><rect x="19.8" y="23" width="2.4" height="4" rx="1" fill="#ffffff"/></svg>',
  visited:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42 42" width="42" height="42"><path d="M21 2C11.6 2 4 9.6 4 19c0 11.2 17 21 17 21s17-9.8 17-21C38 9.6 30.4 2 21 2z" fill="#16a34a" stroke="#ffffff" stroke-width="2.5"/><path d="M14 18.5l4.5 4.5L28 13.5" fill="none" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  default:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42 42" width="42" height="42"><path d="M21 2C11.6 2 4 9.6 4 19c0 11.2 17 21 17 21s17-9.8 17-21C38 9.6 30.4 2 21 2z" fill="#193e32" stroke="#ffffff" stroke-width="2.5"/><circle cx="21" cy="18" r="5.5" fill="#f5b82e"/></svg>',
};

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './config.js',
  './data/routes.json',
  './assets/styles.css',
  './assets/walk.css',
  ...SVG_ICON_ASSETS,
  './assets/vendor/maplibre-gl/maplibre-gl.js',
  './assets/vendor/maplibre-gl/maplibre-gl.css',
  './src/app.js',
  './src/walk.js',
  './src/walk-engine.js',
  './src/walk-store.js',
  './src/planner.js',
  './src/place-photos.js',
  './src/poi-photos.js',
  './src/elevation.js',
  './src/postcards.js',
  './src/postcard.js',
  './src/offline-maps.js',
  './src/keep-alive.js',
  './src/background-keepalive.js',
  './src/gps-simulator.js',
  './src/hiking-trails.js',
  './src/natural-features.js',
  './src/nearby.js',
  './src/auto-places.js',
  './src/avatars.js',
  './src/walking-stick.js',
  './src/achievements.js',
  './src/expedition-engine.js',
  './src/pilgrims.js',
  './src/telemetry.js',
  './src/brand-logo.js',
  './src/weather.js',
  './src/media.js',
  './src/fx.js',
  './src/repository.js',
  './src/domain.js',
  './src/ui.js',
  './src/data.js',
];

function isMapTileRequest(urlStr) {
  return (
    urlStr.includes('tile.openstreetmap.org') ||
    urlStr.includes('tile.opentopomap.org') ||
    urlStr.includes('tile.waymarkedtrails.org') ||
    urlStr.includes('elevation-tiles-prod/terrarium')
  );
}

function isSvgOrPinIconRequest(req, urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.pathname.endsWith('.svg')) return true;
    if (u.pathname.includes('/assets/pins/') || u.pathname.includes('/assets/categories/') || u.pathname.includes('/assets/avatars/')) {
      return true;
    }
  } catch {}
  return req.destination === 'image' && /\.svg(\?|$)/i.test(urlStr);
}

function resolveBuiltinPinSvg(urlStr) {
  const lower = String(urlStr || '').toLowerCase();
  if (lower.includes('castle') || lower.includes('culture')) return BUILTIN_CATEGORY_PIN_SVGS.castles;
  if (lower.includes('sacral') || lower.includes('chapel')) return BUILTIN_CATEGORY_PIN_SVGS.sacral;
  if (lower.includes('view') || lower.includes('landscape')) return BUILTIN_CATEGORY_PIN_SVGS.views;
  if (lower.includes('water') || lower.includes('lake') || lower.includes('spring')) return BUILTIN_CATEGORY_PIN_SVGS.water;
  if (lower.includes('forest') || lower.includes('nature')) return BUILTIN_CATEGORY_PIN_SVGS.nature;
  if (lower.includes('visited')) return BUILTIN_CATEGORY_PIN_SVGS.visited;
  return BUILTIN_CATEGORY_PIN_SVGS.default;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(APP_CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS).catch(() => {})),
      caches.open(ICON_CACHE_NAME).then(async (iconCache) => {
        await iconCache.addAll(SVG_ICON_ASSETS).catch(() => {});
        // Předuložíme také vestavěné SVG špendlíky kategorií pro okamžité offline použití
        const pinWrites = Object.entries(BUILTIN_CATEGORY_PIN_SVGS).map(([catKey, svgMarkup]) => {
          const pinReq = new Request(new URL(`./assets/pins/pin-${catKey}.svg`, self.location.origin).href);
          const pinRes = new Response(svgMarkup, {
            status: 200,
            headers: {
              'Content-Type': 'image/svg+xml; charset=utf-8',
              'Cache-Control': 'public, max-age=31536000, immutable',
            },
          });
          return iconCache.put(pinReq, pinRes);
        });
        await Promise.all(pinWrites).catch(() => {});
      }),
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (
              key.startsWith('czekpoint-') &&
              key !== APP_CACHE_NAME &&
              key !== ICON_CACHE_NAME &&
              key !== TILE_CACHE_NAME
            ) {
              return caches.delete(key);
            }
            return Promise.resolve();
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = req.url;

  // 1. SVG ikony kategorií, špendlíků a avatarů: Cache-First (okamžité vykreslení na mapě i bez signálu)
  if (url.startsWith(self.location.origin) && isSvgOrPinIconRequest(req, url)) {
    event.respondWith(
      caches.open(ICON_CACHE_NAME).then(async (iconCache) => {
        const cachedIcon =
          (await iconCache.match(req, { ignoreSearch: true })) ||
          (await caches.match(req, { ignoreSearch: true }));
        if (cachedIcon) {
          return cachedIcon;
        }
        try {
          const networkRes = await fetch(req);
          if (networkRes && networkRes.status === 200) {
            iconCache.put(req, networkRes.clone()).catch(() => {});
            return networkRes;
          }
        } catch {}
        // Okamžitý vektorový fallback špendlíku kategorie při ztrátě signálu
        return new Response(resolveBuiltinPinSvg(url), {
          status: 200,
          headers: {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'X-Czekpoint-Offline-Pin': '1',
          },
        });
      })
    );
    return;
  }

  // 2. Mapové dlaždice: Cache-First s ukládáním na pozadí a trvalým offline fallbackem
  if (isMapTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) {
          return cached;
        }
        try {
          const networkRes = await fetch(req);
          if (networkRes && (networkRes.status === 200 || networkRes.type === 'opaque')) {
            cache.put(req, networkRes.clone()).catch(() => {});
          }
          return networkRes;
        } catch {
          // Offline fallback — prázdná průhledná SVG dlaždice, aby mapa nevyhazovala chyby
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#efe6d5"/><text x="128" y="128" text-anchor="middle" fill="#8b7355" font-family="sans-serif" font-size="11">Offline mapa</text></svg>',
            {
              status: 200,
              headers: {
                'Content-Type': 'image/svg+xml',
                'X-Czekpoint-Fallback-Tile': '1',
              },
            }
          );
        }
      })
    );
    return;
  }

  // 3. Aplikační soubory stejného původu: Network-First s uložením do cache a offline fallbackem (ignoreSearch pro ?v=...)
  if (url.startsWith(self.location.origin)) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(APP_CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return networkRes;
        })
        .catch(async () => {
          const cached = await caches.match(req, { ignoreSearch: true });
          if (cached) return cached;
          if (req.mode === 'navigate') {
            return caches.match('./index.html', { ignoreSearch: true });
          }
          return new Response('', { status: 504 });
        })
    );
  }
});

