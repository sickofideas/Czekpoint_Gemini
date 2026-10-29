# Czekpoint — Osobní atlas procházek a objevování krajiny (`v2.0-final`)

Czekpoint je česká webová aplikace (PWA) pro plánování pěších procházek, objevování okolí s geograficky ukotvenou mlhou na 2D/3D terénu (MapLibre GL JS), sbírání ověřených GPS razítek, ukládání vlastních soukromých vzpomínek a generování ilustrovaných pohlednic.

---

## 1. Přehled poskytovatelů mapových dat, licencí a limitů

Aplikace využívá následující mapové a datové zdroje:

| Služba / vrstva | Poskytovatel a URL zdroje | Licenční podmínky a povinná atribuce | Limity bezplatného provozu, komerční nasazení a offline pravidla |
| :--- | :--- | :--- | :--- |
| **Základní mapový podklad (2D/3D)** | **OpenStreetMap Foundation**<br>`https://tile.openstreetmap.org/{z}/{x}/{y}.png` | **ODbL 1.0** (Open Database License). Povinné viditelné uvedení: `© přispěvatelé OpenStreetMap (ODbL)`. | Veřejný tile server OSM je určen pro nekomerční projekty s nízkou zátěží (platí [OSM Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) — zákaz hromadného stahování rozsáhlých oblastí). Pro vyšší návštěvnost nebo komerční nasazení nastavte v `config.js` placený nebo freemium tile server (např. MapTiler, Mapy.cz API, Stadia Maps). Offline ukládání je v aplikaci omezeno jen na malou výseč aktuální procházky (max. 45 dlaždic). |
| **Vrstevnicový podklad (volitelný)** | **OpenTopoMap**<br>`https://tile.opentopomap.org/{z}/{x}/{y}.png` | **CC-BY-SA 3.0** (data © OpenStreetMap contributors, SRTM). Povinné uvedení: `© OpenTopoMap (CC-BY-SA), © přispěvatelé OpenStreetMap`. | Veřejný komunitní server bez garance SLA; při výpadku aplikace automaticky přepne na základní podklad OpenStreetMap. Pro komerční nasazení nutný vlastní hosting nebo komerční poskytovatel. |
| **Značené turistické trasy (KČT / OSM)** | **Waymarked Trails**<br>`https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png` | **CC-BY-SA 3.0 / ODbL** (trasy z OpenStreetMap). Povinné uvedení: `Trasy: © Waymarked Trails, © OpenStreetMap (ODbL)`. | Určeno pro osobní a nekomerční využití s přiměřeným počtem požadavků. Pro komerční nasazení použijte vlastní vektorové/rastrové dlaždice vygenerované z OSM dat. |
| **3D výškový model terénu (DEM)** | **AWS Terrain Tiles (Mapzen Terrarium)**<br>`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`<br>*(nebo volitelně MapTiler `terrain-rgb-v2`)* | Veřejná datová sada na AWS Open Data (zdroje: SRTM, GMTED, NED, ETOPO1). | Bezplatný veřejný přístup pro čtení dlaždic (zoom 0–15). Při nedostupnosti DEM aplikace automaticky přepne do 2D pohledu shora. S vlastním klíčem MapTileru v `config.js` se použije `https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp`. |
| **Výpočet pěší trasy (Routing)** | **OSRM (Project OSRM Demo)**<br>`https://router.project-osrm.org/route/v1/foot` | **BSD 2-Clause** (software), data **© OpenStreetMap (ODbL)**. | Demo server je určen pro testování a nízkou zátěž (~1 požadavek/s, bez garance dostupnosti). Při výpadku aplikace automaticky použije lokální orientační spojnice. Pro produkční/komerční provoz nastavte v `config.js` vlastní instanci OSRM, GraphHopper nebo MapTiler/OpenRouteService. |
| **Body zájmu a turistické relace v okolí** | **Overpass API**<br>`https://overpass-api.de/api/interpreter` | Data **© přispěvatelé OpenStreetMap (ODbL)**. | Veřejná instance má fair-use limity (cca 10 000 dotazů/den a omezení souběžných dotazů). Aplikace ukládá načtené oblasti do `localStorage` cache a při posunu mapy uplatňuje debounce 700 ms (posun ≥ 1,2 km). |
| **Vyhledávání obcí a míst (Geokódování)** | **Nominatim (OpenStreetMap)**<br>`https://nominatim.openstreetmap.org/search` | Data **© přispěvatelé OpenStreetMap (ODbL)**. | Přísný limit max. 1 požadavek za sekundu ([Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)). Aplikace nejprve prohledává lokální katalog a české presety. |
| **Nadmořská výška a počasí (60 min)** | **Open-Meteo API**<br>`https://api.open-meteo.com/v1/elevation`<br>`https://api.open-meteo.com/v1/forecast` | **CC BY 4.0** (Open-Meteo.com; výšková data Copernicus DEM). | Bezplatné pro nekomerční použití (do 10 000 volání/den). Pro komerční nasazení vyžaduje komerční tarif Open-Meteo API. Souřadnice pro počasí se zaokrouhlují na ~1 km a dotazují max. jednou za 15 minut. |
| **Fotografie a popisy památek** | **Wikipedie & Wikimedia Commons**<br>`https://cs.wikipedia.org/w/api.php`<br>`https://commons.wikimedia.org/w/api.php` | Texty **CC BY-SA 4.0**, fotografie dle licence uvedené u snímku (**CC BY / CC BY-SA / Public Domain**). | Veřejné API nadace Wikimedia. V aplikaci lze externí fotografie kdykoliv vypnout přepínačem *„🖼️ Zobrazovat externí fotografie míst (Wikipedie)“* (pak se zobrazují pouze lokální vektorové ilustrace). |

---

## 2. Jak nastavit vlastní klíč poskytovatele (např. MapTiler) v `config.js`

Ve výchozím stavu je `maptilerApiKey: ''` prázdný, takže aplikace funguje **ihned po otevření bez jakékoliv registrace a bez API klíčů** (využívá veřejné dlaždice OpenStreetMap a AWS Terrarium DEM).

Pokud chcete pro vyšší limity nebo komerční provoz zapnout vlastní dlaždice a 3D terén **MapTiler**:

1. Otevřete soubor `config.js` v kořenové složce projektu.
2. Najděte položku `maptilerApiKey` a vložte svůj klíč (případně upravte URL mapových dlaždic):
   ```js
   export const config = {
     maptilerApiKey: 'VAS_MAPTILER_API_KLIC',
     tileUrl: 'https://api.maptiler.com/maps/outdoor-v2/256/{z}/{x}/{y}.png?key=VAS_MAPTILER_API_KLIC',
     tileAttribution: '© MapTiler © přispěvatelé OpenStreetMap (ODbL)',
     // ...
   };
   ```
3. **Bezpečnostní pravidlo:** Vlastní API klíč v ve veřejné klientské aplikaci vždy v administraci MapTileru omezte na povolenou doménu (`Allowed HTTP Referers`, např. `https://vase-jmeno.github.io/*`). Do JSON záloh uživatele (`exportStateJson`) se žádné klíče nikdy neukládají.

---

## 3. Nasazení na GitHub Pages (které soubory nahrát)

Aplikace používá nativní ES moduly (`<script type="module" src="./src/app.js"></script>`) a lokálně přibalený MapLibre GL JS (`4.7.1`), takže ji lze nasadit na **GitHub Pages** buď přímo jako statické soubory, nebo přes sestavení `npm run build` (složka `dist/`):

Pro přímé statické nasazení na GitHub Pages nahrajte do repozitáře tyto soubory a složky:
- `index.html` — hlavní vstupní stránka aplikace
- `config.js` — konfigurace mapových zdrojů, DEM terénu a OSRM/Overpass endpointů
- `manifest.webmanifest` — PWA manifest pro instalaci na plochu telefonu
- `sw.js` — Service Worker pro offline mezipaměť aplikačního jádra a dlaždic
- `src/` — veškeré aplikační ES moduly (`app.js`, `walk.js`, `walk-engine.js`, `walk-store.js`, `planner.js`, `postcards.js`, `postcard.js`, `auto-places.js`, `natural-features.js`, `hiking-trails.js`, `elevation.js`, `weather.js`, `telemetry.js`, `keep-alive.js`, `background-keepalive.js`, `gps-simulator.js`, `walking-stick.js`, `achievements.js`, `avatars.js`, `pilgrims.js`, `place-photos.js`, `poi-photos.js`, `nearby.js`, `offline-maps.js`, `fx.js`, `brand-logo.js`, `ui.js`, `domain.js`, `data.js`)
- `assets/` — styly (`styles.css`, `walk.css`), ikony (`icon.svg`), katalog (`routes.json`) a lokální knihovna `assets/vendor/maplibre-gl/` (`maplibre-gl.js`, `maplibre-gl.css`)

---

## 4. Soukromí a záloha dat uživatele

- **100% lokální úložiště:** Profil, avatar, historie procházek, ušlé metry, buňky mlhy (`cells`), prošlé segmenty (`walkSegments`), odhalené přírodní plochy (`revealedFeatures`), potvrzené zastávky a vlastní soukromé vzpomínky (`personalMemories`) jsou uloženy výhradně v `localStorage` prohlížeče pod klíčem `czekpoint.state.v2`.
- **Záloha s náhledem před obnovou:** V sekci `🎒 Můj pas` i `O datech a soukromí` lze celý atlas exportovat do `.json` souboru (bez jakýchkoliv tajných klíčů) a před obnovou ze souboru se vždy zobrazí kontrolní náhled (počet dílků, kilometrů, razítek, výprav a vlastních vzpomínek).
- **Dvoustupňová ochrana soukromí na pohlednici:**
  1. **🔒 Skrýt začátek a konec trasy (±150 m)** — ve výchozím stavu zapnuto; ořízne prvních a posledních 150 m trasy a skryje přesný čas.
  2. **🛡️ Maximální soukromí (Bez mapy)** — zcela skryje zákres trasy i souřadnice a na pohlednici ponechá pouze koláž, statistiky a počet nově odkrytých dílků.
