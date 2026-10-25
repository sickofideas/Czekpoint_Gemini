import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyWalk,
  acceptFix,
  MAX_GPS_ACCURACY_M,
  FOG_REVEAL_RADIUS_M,
  STOP_CONFIRM_RADIUS_M,
  evaluateStopConfirmation,
  reorderPlannedStops,
  replacePlannedStop,
  removePlannedStop,
  cellsAlongSegment,
  totalScore,
  expeditionPointsDelta,
  appendToWalkSegments,
  computeFootprintPlacements,
  appendTrail,
  pruneTrail,
  discoverNearby,
} from './walk-engine.js';
import {
  STATE_KEY,
  CORRUPTED_BACKUP_KEY,
  loadState,
  saveState,
  previewImportState,
  importStateJson,
  exportStateJson,
} from './walk-store.js';
import {
  analyzePlannedRoute,
  autoSuggestTrip,
  encodeRouteShareCode,
  decodeRouteShareCode,
  validateDecodedRoutePlan,
  optimizeRouteOrder,
  buildLocalRoutedGeometry,
  computeRemainingFromSharedRoute,
  computeActiveTurnInstruction,
  searchPlaceNominatim,
  buildReturnToOriginRoute,
} from './planner.js';
import {
  renderBootFootprintSvg,
  renderPlayerAvatarMarkerHtml,
} from './walk.js';
import {
  SPEED_PRESETS,
  ACCURACY_PRESETS,
  simulateWalkPlayback,
  GpsSimulator,
} from './gps-simulator.js';
import { routes as PILOT_ROUTES } from './data.js';
import {
  parseOsmcSymbol,
  renderOsmcBadgeSvg,
  PILOT_HIKING_TRAILS,
} from './hiking-trails.js';
import {
  computeVisibleMapCenterForPlayer,
  createTelemetryState,
  updateTelemetryFromFix,
  computeTouristStatsSummary,
} from './telemetry.js';
import {
  roundWeatherCoords,
  shouldFetchWeather,
  buildWeatherSentence,
  parseOpenMeteoForecast,
} from './weather.js';
import {
  BUILTIN_NATURAL_FEATURES,
  resolveAccessibleStopLocation,
  evaluateNaturalFeatureReveals,
} from './natural-features.js';

describe('Czekpoint revize 1–24 — Unit testy', () => {
  it('2 & 3. Ukládání výprav synchronizuje revizi a obnova dat brání ztrátě postupu i záporným bodům', () => {
    // Mock localStorage pro Node.js test
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
    };

    const s0 = loadState();
    assert.equal(s0.revision, 1);

    // Opakované uložení v jediné záložce nikdy nevyhodí falešnou chybu revize
    s0.meters = 450;
    const s1 = saveState(s0);
    assert.equal(s1.revision, 2);
    assert.equal(s0.revision, 2);

    s0.meters = 920;
    const s2 = saveState(s0);
    assert.equal(s2.revision, 3);

    // Záloha vytvořená před další chůzí lze bez chyby revize obnovit
    const backupJson = exportStateJson(s2);
    s2.meters = 1500;
    saveState(s2);

    const preview = previewImportState(backupJson);
    assert.equal(preview.valid, true);

    const restored = importStateJson(backupJson);
    assert.equal(restored.meters, 920);

    // Záporná vzdálenost nebo poškozená data nikdy nevytvoří záporné skóre
    const negScore = totalScore({ cells: [], discoveries: [], meters: -5000 });
    assert.equal(negScore, 0);

    // Poškozený JSON v úložišti se zazálohuje a označí příznakem storageCorrupted
    store.set(STATE_KEY, '{neplatny-json');
    const corruptedLoad = loadState();
    assert.equal(corruptedLoad.storageCorrupted, true);
    assert.equal(store.get(CORRUPTED_BACKUP_KEY), '{neplatny-json');
  });

  it('5. Automatický návrh výletu počítá plný okruh včetně návratu na start a neslibuje falešný okruh mimo toleranci', () => {
    const origin = { id: 'rozmital-namesti', label: 'Rožmitál — náměstí', lat: 49.6014, lng: 13.8644 };
    const places = PILOT_ROUTES.filter(r => r.pointKind === 'place').map(r => ({
      id: r.id,
      title: r.title,
      lat: r.location.lat,
      lng: r.location.lng,
      pointKind: r.pointKind,
      surface: r.surface,
      elevationGainM: r.elevationGainM,
      access: r.access,
    }));

    const trip5 = autoSuggestTrip({
      origin,
      targetKm: 5,
      companionMode: 'solo',
      availablePlaces: places,
      discoveries: [],
    });
    assert.equal(trip5.found, true);
    assert.equal(trip5.returnToOrigin, true);
    assert.ok(trip5.selectedPlaceIds.length >= 2);
    assert.ok(trip5.analysis.estimatedWalkDistanceM >= 5000 * 0.65 && trip5.analysis.estimatedWalkDistanceM <= 5000 * 1.35);

    // Pokud v okolí nejsou body pro 10km okruh, vrátí found: false s vysvětlením
    const tinyPool = places.slice(0, 1);
    const impossible = autoSuggestTrip({
      origin,
      targetKm: 10,
      companionMode: 'solo',
      availablePlaces: tinyPool,
      discoveries: [],
    });
    assert.equal(impossible.found, false);
    assert.match(impossible.reason, /nebyl v okolí nalezen dostatek vhodných zastávek|Nepodařilo se sestavit okruh/);
  });

  it('7. Sjednocuje body ve shrnutí výpravy s přírůstkem v pasu a nezdvojuje bonus za staré razítko', () => {
    const startProgress = { cells: ['55110:10870'], meters: 500, discoveries: ['zamek-rozmital'] };
    const scoreBefore = totalScore(startProgress);

    const endProgress = {
      cells: ['55110:10870', '55111:10870', '55112:10870'],
      meters: 1500,
      // Staré razítko zamek-rozmital se nezdvojuje, přibylo jen jedno nové razítko podbrdske-muzeum
      discoveries: ['zamek-rozmital', 'podbrdske-muzeum'],
    };

    const delta = expeditionPointsDelta(
      {
        startCells: startProgress.cells.length,
        startMeters: startProgress.meters,
        startDiscoveries: startProgress.discoveries.length,
      },
      endProgress
    );
    assert.equal(totalScore(endProgress) - scoreBefore, delta);
  });

  it('8. Zpracování GPS rozlišuje čerstvý záznam způsobilý pro návštěvu (eligibleForVisit)', () => {
    const w0 = emptyWalk();
    const freshFix = { lat: 49.6014, lng: 13.8644, accuracy: 10, timestamp: 5000 };
    const resFresh = acceptFix(w0, null, freshFix, 5000);
    assert.equal(resFresh.accepted, true);
    assert.equal(resFresh.eligibleForVisit, true);

    const staleFix = { lat: 49.6015, lng: 13.8644, accuracy: 10, timestamp: 1000 };
    const resStale = acceptFix(resFresh.progress, freshFix, staleFix, 50000);
    assert.equal(resStale.accepted, false);
    assert.equal(resStale.eligibleForVisit, false);
  });

  it('9. Ověřuje úplnost sdílené trasy před importem včetně vložených zastávek', () => {
    const stops = [
      { id: 'zamek-rozmital', title: 'Zámek Rožmitál', lat: 49.6024, lng: 13.8636, kind: 'heritage' },
      { id: 'vlastni-bod-99', title: 'Lesní studánka', lat: 49.595, lng: 13.855, kind: 'water' },
    ];
    const plan = {
      origin: { lat: 49.6014, lng: 13.8644 },
      radiusKm: 5,
      categories: [],
      selectedPlaceIds: ['zamek-rozmital', 'vlastni-bod-99'],
      companionMode: 'solo',
      explorationMode: 'focus',
      returnToOrigin: true,
    };
    const code = encodeRouteShareCode(plan, stops);
    const catalogOnly = [{ id: 'zamek-rozmital', title: 'Zámek Rožmitál', lat: 49.6024, lng: 13.8636 }];

    const decoded = decodeRouteShareCode(code, catalogOnly);
    assert.ok(decoded);
    assert.equal(decoded.embeddedStops.length, 2);
    assert.equal(validateDecodedRoutePlan(decoded, catalogOnly), true);

    // Kód s neznámým ID bez vložených souřadnic musí být odmítnut
    const incompleteCode = encodeRouteShareCode(
      { ...plan, selectedPlaceIds: ['neexistujici-id'] },
      []
    );
    assert.throws(
      () => decodeRouteShareCode(incompleteCode, catalogOnly),
      /Sdílená trasa je neúplná/
    );
  });

  it('16. Odděluje nepřesnost GPS (limit 40 m) od dosahu odkrývání (65 m) a vysvětluje pozastavení', () => {
    assert.equal(MAX_GPS_ACCURACY_M, 40);
    assert.equal(FOG_REVEAL_RADIUS_M, 65);

    const w0 = emptyWalk();
    const badFix = { lat: 49.6014, lng: 13.8644, accuracy: 55, timestamp: 1000 };
    const resBad = acceptFix(w0, null, badFix, 1000);
    assert.equal(resBad.accepted, false);
    assert.equal(resBad.pausedByAccuracy, true);
    assert.match(resBad.reason, /55 m/);
    assert.match(resBad.reason, /40 m/);
    assert.match(resBad.reason, /65 m/);
    assert.equal(resBad.progress.cells.length, 0);

    const goodFix = { lat: 49.6014, lng: 13.8644, accuracy: 8, timestamp: 2000 };
    const resGood = acceptFix(w0, null, goodFix, 2000);
    assert.equal(resGood.accepted, true);
    assert.ok(resGood.progress.cells.length >= 1);
  });

  it('16. Souvisle odkrývá buňky podél úseku bez děr', () => {
    const a = { lat: 49.6014, lng: 13.8644 };
    const b = { lat: 49.6034, lng: 13.8644 };
    const cells = cellsAlongSegment(a, b);
    assert.ok(cells.length >= 3, 'Mělo by pokrýt všechny buňky mezi body A a B');
  });

  it('17. Obsahuje testovací rychlosti 100 a 1 000 km/h a při zrychleném přehrání dává 1:1 stejný průzkum i zastávky', () => {
    const has100 = SPEED_PRESETS.some(p => p.kmh === 100);
    const has1000 = SPEED_PRESETS.some(p => p.kmh === 1000);
    assert.equal(has100, true, 'Chybí předvolba 100 km/h');
    assert.equal(has1000, true, 'Chybí předvolba 1 000 km/h');

    const waypoints = [
      { id: 'zamek-rozmital', title: 'Zámek Rožmitál', lat: 49.60208, lng: 13.86361, collectible: true, pointKind: 'place' },
      { id: 'podbrdske-muzeum', title: 'Podbrdské muzeum', lat: 49.59932, lng: 13.86262, collectible: true, pointKind: 'place' },
      { id: 'kostel-jan-nepomucky', title: 'Kostel sv. Jana Nepomuckého', lat: 49.60141, lng: 13.86441, collectible: true, pointKind: 'place' },
    ];

    const runNormal = simulateWalkPlayback(waypoints, 5, waypoints, { playbackMode: 'accelerated' });
    const run100 = simulateWalkPlayback(waypoints, 100, waypoints, { playbackMode: 'accelerated' });
    const run1000 = simulateWalkPlayback(waypoints, 1000, waypoints, { playbackMode: 'accelerated' });

    assert.deepEqual(run100.confirmedStops, ['zamek-rozmital', 'podbrdske-muzeum', 'kostel-jan-nepomucky']);
    assert.deepEqual(run1000.confirmedStops, runNormal.confirmedStops);
    assert.deepEqual(run100.progress.cells, runNormal.progress.cells);
    assert.deepEqual(run1000.progress.cells, runNormal.progress.cells);
    assert.deepEqual(run1000.progress.discoveries, runNormal.progress.discoveries);
  });

  it('17. Odmítá skutečnou vysokou rychlost (> 3,5 m/s) při testu ochrany proti jízdě autem', () => {
    const waypoints = [
      { id: 'start', title: 'Start', lat: 49.6014, lng: 13.8644 },
      { id: 'end', title: 'Cíl', lat: 49.6050, lng: 13.8644 },
    ];
    const overspeedRun = simulateWalkPlayback(waypoints, 100, waypoints, { playbackMode: 'overspeed_test' });
    assert.ok(overspeedRun.rejectedReasons.some(r => /Příliš (rychlý pohyb|vysoká rychlost)/.test(r)));
  });

  it('18. Ověřené souřadnice míst v databázi odpovídají skutečnému umístění', () => {
    const zamek = PILOT_ROUTES.find(r => r.id === 'zamek-rozmital');
    const mohyla = PILOT_ROUTES.find(r => r.id === 'mohyla-jj-ryby');
    const tremsin = PILOT_ROUTES.find(r => r.id === 'vrch-tremsin');
    const synagoga = PILOT_ROUTES.find(r => r.id === 'synagoga-loksany');

    assert.ok(zamek && Math.abs(zamek.location.lat - 49.60240) < 0.001);
    assert.ok(mohyla && Math.abs(mohyla.location.lat - 49.58714) < 0.001);
    assert.ok(tremsin && Math.abs(tremsin.location.lat - 49.56728) < 0.001);
    assert.ok(synagoga && Math.abs(synagoga.location.lat - 49.55832) < 0.001);
  });

  it('19. Zastávky lze posouvat (Nahoru/Dolů), nahrazovat a odebírat a potvrzují se pod 20 m opakovaným měřením', () => {
    assert.equal(STOP_CONFIRM_RADIUS_M, 20);

    const initial = ['a', 'b', 'c'];
    assert.deepEqual(reorderPlannedStops(initial, 1, 0), ['b', 'a', 'c']);
    assert.deepEqual(reorderPlannedStops(initial, 1, 2), ['a', 'c', 'b']);
    assert.deepEqual(replacePlannedStop(initial, 1, 'd'), ['a', 'd', 'c']);
    assert.deepEqual(removePlannedStop(initial, 1), ['a', 'c']);

    const stops = [{ id: 'stop-1', title: 'Zastávka 1', lat: 49.60141, lng: 13.86441 }];
    const tracker = {};
    const confirmed = new Set();

    // 1. První přesný fix (< 20 m) — jeden skok ještě nestačí
    const fix1 = { lat: 49.60145, lng: 13.86441, accuracy: 8, timestamp: 10000 };
    const eval1 = evaluateStopConfirmation(fix1, stops, tracker, confirmed, 10000);
    assert.equal(eval1.newlyConfirmedIds.length, 0);

    // 2. Druhý čerstvý a přesný fix (< 20 m) po 4 sekundách — zastávka se potvrdí
    const fix2 = { lat: 49.60143, lng: 13.86441, accuracy: 8, timestamp: 14000 };
    const eval2 = evaluateStopConfirmation(fix2, stops, tracker, confirmed, 14000);
    assert.deepEqual(eval2.newlyConfirmedIds, ['stop-1']);
  });

  it('24. Turistické trasy z OSM zachovávají barvu značení osmc:symbol a negenerují falešné barvy', () => {
    assert.ok(PILOT_HIKING_TRAILS.length >= 4);
    const redParsed = parseOsmcSymbol('red:white:red_bar', 'red');
    assert.equal(redParsed.colorKey, 'red');
    assert.equal(redParsed.known, true);

    const unknownParsed = parseOsmcSymbol('', '');
    assert.equal(unknownParsed.known, false);

    const svg = renderOsmcBadgeSvg('blue:white:blue_bar', 'blue');
    assert.match(svg, /<svg/);
    assert.match(svg, /#1d6fd8/);
  });

  it('25. Centrování mapy při chůzi počítá posun nad spodní panel a zachovává hráčovu polohu ve viditelné části', () => {
    const player = { lat: 49.6014, lng: 13.8644 };
    const noPanel = computeVisibleMapCenterForPlayer(player, { width: 390, height: 800 }, 0, 0, 16);
    assert.equal(noPanel.lat, player.lat);

    const withBottomPanel = computeVisibleMapCenterForPlayer(player, { width: 390, height: 800 }, 280, 0, 16);
    // Aby byl hráč nad spodním panelem, střed mapy musí být posunut mírně na jih (nižší lat)
    assert.ok(withBottomPanel.lat < player.lat, 'Střed mapy má být posunut jižně, aby hráč zůstal v horní viditelné části nad panelem');
    assert.equal(withBottomPanel.lng, player.lng);
  });

  it('26 & 27. Plánovač a simulátor používají stejnou pěší trasu kolem rybníka a přes most; simulátor se pozastaví při přímé vzdušné spojnici', () => {
    // 1. Bod uprostřed rybníka Podzámecký se přesměruje na přístupný bod na břehu
    const pondCenter = { id: 'rybnik-stred', title: 'Podzámecký rybník', lat: 49.6042, lng: 13.8570 };
    const accessible = resolveAccessibleStopLocation(pondCenter);
    assert.equal(accessible?.isShoreAccess, true);
    assert.ok(Math.abs(accessible!.lat - 49.60373) < 0.001, 'Cíl chůze u rybníka musí být na přístupném břehu');

    // 2. Řazení zastávek přes řeku s jediným mostem (řeka Vlčava mezi [49.60265, 13.86175] a [49.60150, 13.86650])
    const origin = { lat: 49.6018, lng: 13.8642 }; // Jižní břeh Vlčavy
    const stopsAcrossRiver = [
      { id: 'sever-za-rekou', title: 'Severní břeh za řekou', lat: 49.6029, lng: 13.8642 }, // Vzdušnou čarou jen ~120 m, ale přes řeku bez mostu!
      { id: 'u-mostu-jih', title: 'U mostu u zámku', lat: 49.6024, lng: 13.8620 }, // Cestou k jedinému mostu [49.60265, 13.86175]
    ];
    const ordered = optimizeRouteOrder(origin, stopsAcrossRiver, { returnToOrigin: false });
    assert.equal(ordered[0].id, 'u-mostu-jih', 'Řazení podle pěší trasy musí vybrat zastávku cestou k mostu před bodem za řekou');

    // 3. Úprava během chůze zachová navštívené zastávky na začátku a přeuspořádá jen zbývající
    const inWalkStops = [
      { id: 'visited-1', title: 'Navštívená 1', lat: 49.6014, lng: 13.8644 },
      { id: 'rem-far', title: 'Vzdálená', lat: 49.5871, lng: 13.8447 },
      { id: 'rem-near', title: 'Blízká', lat: 49.6020, lng: 13.8636 },
    ];
    const reorderedInWalk = optimizeRouteOrder(
      { lat: 49.6014, lng: 13.8644 },
      inWalkStops,
      { visitedStopIds: new Set(['visited-1']), currentPosition: { lat: 49.6018, lng: 13.8640 } }
    );
    assert.equal(reorderedInWalk[0].id, 'visited-1');
    assert.equal(reorderedInWalk[1].id, 'rem-near');
    assert.equal(reorderedInWalk[2].id, 'rem-far');

    // 4. Simulace kolem rybníka kopíruje břehovou pěší trasu a při 100 i 1000 km/h potvrdí zastávky
    const shoreStops = [
      { id: 'jz-breh', title: 'Jihozápadní břeh Podzámeckého rybníka', lat: 49.6038, lng: 13.8552, collectible: true, pointKind: 'place' },
      { id: 'sv-breh', title: 'Severovýchodní břeh Podzámeckého rybníka', lat: 49.6050, lng: 13.8573, collectible: true, pointKind: 'place' },
    ];
    const localRouted = buildLocalRoutedGeometry(shoreStops);
    assert.ok(localRouted.coordinates.length > 3, 'Lokální pěší trasa kolem rybníka musí obsahovat lomové body břehové cesty');

    const sim1000 = simulateWalkPlayback(shoreStops, 1000, shoreStops, {
      playbackMode: 'accelerated',
      sharedRoute: { ...localRouted, isFallback: false },
    });
    assert.deepEqual(sim1000.confirmedStops, ['jz-breh', 'sv-breh']);

    // 5. Pokud je k dispozici pouze vzdušná čára (isFallback: true), autopilot se pozastaví a vysvětlí důvod
    const pausedSim = simulateWalkPlayback(shoreStops, 25, shoreStops, {
      playbackMode: 'accelerated',
      sharedRoute: { coordinates: shoreStops.map(s => [s.lat, s.lng]), isFallback: true },
    });
    assert.ok(pausedSim.pausedReason);
    assert.match(pausedSim.pausedReason, /Autopilot pozastaven/);
  });

  it('28. Turistické údaje: klidová rychlost 0,0 km/h, neznámá výška "—" (nikdy 0) a 10 minut stání na místě nepřičte falešné stoupání', () => {
    let telemetry = createTelemetryState(1000);

    // Fix bez nadmořské výšky a v klidu
    telemetry = updateTelemetryFromFix(telemetry, {
      lat: 49.6014,
      lng: 13.8644,
      accuracy: 8,
      altitude: null,
      altitudeAccuracy: null,
      timestamp: 1000,
    }, { accepted: false, metersAdded: 0 }, 1000);

    const statsNoAlt = computeTouristStatsSummary({ telemetry, walkedMeters: 0, now: 1000 });
    assert.equal(statsNoAlt.currentSpeedFormatted, '0,0 km/h');
    assert.equal(statsNoAlt.altitudeLabel, '—', 'Chybějící nadmořská výška musí být "—", nikdy 0');

    // 10 minut stání na místě s běžným šumem výškoměru (±3 m kolem 525 m n. m.)
    for (let i = 1; i <= 120; i++) {
      const nowMs = 1000 + i * 5000;
      const noisyAlt = 525 + Math.sin(i * 0.7) * 3.1; // kmitání ±3,1 m
      telemetry = updateTelemetryFromFix(telemetry, {
        lat: 49.6014,
        lng: 13.8644,
        accuracy: 8,
        altitude: noisyAlt,
        altitudeAccuracy: 10,
        timestamp: nowMs,
      }, { accepted: false, metersAdded: 0 }, nowMs);
    }

    const statsAfterStand = computeTouristStatsSummary({ telemetry, walkedMeters: 15, now: 601000 });
    assert.equal(statsAfterStand.currentSpeedFormatted, '0,0 km/h', 'Na místě má ukazovat 0,0 km/h');
    assert.equal(telemetry.elevationGainM, 0, '10 minut stání s šumem výšky nesmí přičíst žádné falešné stoupání');
    assert.equal(telemetry.elevationLossM, 0, '10 minut stání s šumem výšky nesmí přičíst žádné falešné klesání');
  });

  it('29. Počasí na příštích 60 minut zaokrouhluje souřadnice, omezuje dotazy (15 min / 3 km) a čerpá z mezipaměti', () => {
    const rounded = roundWeatherCoords({ lat: 49.60149, lng: 13.86449 });
    assert.equal(rounded.lat, 49.6);
    assert.equal(rounded.lng, 13.86);

    const cachedEntry = {
      coords: { lat: 49.6, lng: 13.86 },
      fetchedAtMs: 100_000,
    };
    // Po 5 minutách na stejném místě se síťový dotaz neposílá
    assert.equal(shouldFetchWeather({ lat: 49.601, lng: 13.862 }, cachedEntry, 100_000 + 5 * 60_000), false);
    // Po 16 minutách se povolí obnova
    assert.equal(shouldFetchWeather({ lat: 49.601, lng: 13.862 }, cachedEntry, 100_000 + 16 * 60_000), true);
    // Při posunu o více než 3 km se povolí obnova ihned
    assert.equal(shouldFetchWeather({ lat: 49.635, lng: 13.862 }, cachedEntry, 100_000 + 2 * 60_000), true);

    const parsed = parseOpenMeteoForecast({
      current: { temperature_2m: 14.2, precipitation: 0, weather_code: 2, wind_speed_10m: 11.4 },
      minutely_15: { precipitation: [0, 0, 0.35, 0.5] },
    }, { lat: 49.601, lng: 13.864 }, 'Rožmitál', 500_000);
    assert.match(parsed.sentence, /14 °C/);
    assert.match(parsed.sentence, /přeháňky/);
    assert.match(parsed.sourceLabel, /Open-Meteo\.com/);
  });

  it('30. Stopy na mapě střídají levou a pravou botu, natáčejí se ve směru chůze a přerušují se při výpadku GPS', () => {
    let segments: any[] = [];
    // První souvislý úsek směrem na sever
    segments = appendToWalkSegments(segments, { lat: 49.6000, lng: 13.8640, timestamp: 1000 }, false);
    segments = appendToWalkSegments(segments, { lat: 49.6005, lng: 13.8640, timestamp: 15000 }, false);
    segments = appendToWalkSegments(segments, { lat: 49.6010, lng: 13.8640, timestamp: 30000 }, false);
    // Výpadek GPS / nová sekce -> nový nespojený úsek
    segments = appendToWalkSegments(segments, { lat: 49.6030, lng: 13.8660, timestamp: 120000 }, true);
    segments = appendToWalkSegments(segments, { lat: 49.6035, lng: 13.8660, timestamp: 135000 }, false);

    assert.equal(segments.length, 2, 'Výpadek GPS musí rozdělit záznam na 2 samostatné úseky bez falešné přímky mezi nimi');

    const footprints = computeFootprintPlacements(segments, 16);
    assert.ok(footprints.length >= 4, 'Na projité trase se mají rozmístit stopy');
    assert.equal(footprints[0].side, 'L');
    assert.equal(footprints[1].side, 'R');
    assert.equal(footprints[2].side, 'L');
    // Směr na sever má azimut ~0°
    assert.ok(footprints[0].bearingDeg < 15 || footprints[0].bearingDeg > 345, 'Stopy na sever mají mít azimut blízký 0°');
  });

  it('31 & 32. Malý rybník se po příchodu ke břehu odhalí celý, les a velká vodní plocha odhalí jen rozšířený lokální průhled a nepotvrdí zastávku na protějším břehu', () => {
    const revealedFeatures: string[] = [];
    // Příchod ke břehu Podzámeckého rybníka (<= 35 m od břehu)
    const shoreFix = { lat: 49.60373, lng: 13.85891, accuracy: 8, timestamp: 1000 };
    const resSmall = evaluateNaturalFeatureReveals(shoreFix, revealedFeatures);
    assert.ok(resSmall.revealedFeatureIds.includes('water:podzamecky-rybnik'), 'Malý rybník se po příchodu ke břehu odhalí celý');

    // Příchod k okraji lesa Štěrbina a Voltuš -> odhalí jen lokální průhled (135 m), nikoli celý les v revealedFeatureIds
    const forestEdgeFix = { lat: 49.59750, lng: 13.84950, accuracy: 8, timestamp: 2000 };
    const resForest = evaluateNaturalFeatureReveals(forestEdgeFix, revealedFeatures);
    assert.equal(resForest.revealedFeatureIds.includes('forest:sterbina-voltus'), false, 'Rozsáhlý les se nesmí trvale odhalit celý');
    assert.ok(
      resForest.activeLocalReveals.some((r: any) => r.id === 'forest:sterbina-voltus' && r.radiusM === 135),
      'Les poskytne rozšířený lokální průhled (135 m) oříznutý hranicí prvku'
    );

    // Zastávka na opačném (západním) břehu Podzámeckého rybníka se NEPOTVRDÍ z východního břehu, přestože je rybník vizuálně odhalený
    const oppositeShoreStop = [{ id: 'opp-shore', title: 'Západní břeh', lat: 49.60610, lng: 13.85480 }];
    const tracker = {};
    const confirmed = new Set();
    const evalOpp1 = evaluateStopConfirmation(shoreFix, oppositeShoreStop, tracker, confirmed, 1000);
    const evalOpp2 = evaluateStopConfirmation(shoreFix, oppositeShoreStop, tracker, confirmed, 5000);
    assert.equal(evalOpp1.newlyConfirmedIds.length, 0);
    assert.equal(evalOpp2.newlyConfirmedIds.length, 0, 'Odhalení vodní plochy nesmí potvrdit zastávku na protějším břehu');
  });

  it('v1.0 (ZADÁNÍ #08 — Bod 1 & 2): Průvodce výpravou filtruje náročnost terénu (easy / medium / hard), vyhledá města v ČR a vykreslí živého Avatara s orbitální šipkou', async () => {
    const origin = { id: 'namesti', label: 'Rožmitál — náměstí', lat: 49.6018, lng: 13.8635 };
    const candidatePlaces = [
      { id: 'rybnik-stop', title: 'Podzámecký rybník — nábřeží', lat: 49.6036, lng: 13.8594, category: 'water', kind: 'water', collectible: true },
      { id: 'zamek-stop', title: 'Zámek Rožmitál', lat: 49.6024, lng: 13.8621, category: 'castles', kind: 'castle', collectible: true },
      { id: 'tremsin-vrchol', title: 'Vrch Třemšín — skalní vyhlídka (827 m)', lat: 49.5672, lng: 13.7775, category: 'views', kind: 'peak', elevationGainM: 280, collectible: true },
      { id: 'studanka-stop', title: 'Králova studánka', lat: 49.5960, lng: 13.8480, category: 'water', kind: 'spring', collectible: true },
    ];

    const easyTrip = autoSuggestTrip({
      origin,
      targetKm: 5,
      companionMode: 'solo',
      terrainDifficulty: 'easy',
      availablePlaces: candidatePlaces,
      discoveries: [],
    });
    assert.equal(easyTrip.found, true);
    assert.equal(
      easyTrip.selectedPlaceIds.includes('tremsin-vrchol'),
      false,
      'Lehká rovinka (easy) musí vynechat strmé vrcholy a skály s velkým převýšením'
    );

    // Offline / lokální vyhledání města v ČR pro scénář „Plánuji dopředu z domova“
    const pisekResults = await searchPlaceNominatim('Písek');
    assert.ok(pisekResults.length >= 1);
    assert.match(pisekResults[0].label, /Písek/i);

    // Vykreslení živého Avatara se zlatou směrovou šipkou
    const avatarHtml = renderPlayerAvatarMarkerHtml({ avatarId: 'liska', bearingDeg: 135, isWalking: true });
    assert.match(avatarHtml, /player-avatar-marker is-walking/);
    assert.match(avatarHtml, /avatar-direction-pointer/);
    assert.match(avatarHtml, /rotate\(135deg\)/);
  });

  it('v1.0 (ZADÁNÍ #08 — Bod 3 & 5): Stopy pohorek střídají L/R a blednou podle stáří; odbočovací navigace a návrat na start fungují ze společné pěší trasy', async () => {
    let trail: any[] = [];
    trail = appendTrail(trail, { lat: 49.6010, lng: 13.8630 }, 1000);
    trail = appendTrail(trail, { lat: 49.6014, lng: 13.8630 }, 5000);
    trail = appendTrail(trail, { lat: 49.6018, lng: 13.8630 }, 9000);
    assert.equal(trail.length, 3);
    assert.equal(trail[0].isLeft, true);
    assert.equal(trail[1].isLeft, false);
    assert.equal(trail[2].isLeft, true);
    assert.ok(trail[2].opacity >= trail[0].opacity, 'Nejnovější stopa má vyšší krytí než starší stopy');

    const bootSvgLeft = renderBootFootprintSvg('L', 45, 0.75);
    const bootSvgRight = renderBootFootprintSvg('R', 45, 0.40);
    assert.match(bootSvgLeft, /footprint-marker/);
    assert.match(bootSvgRight, /scaleX\(-1\)/);

    const origin = { id: 'namesti', label: 'Rožmitál — náměstí', lat: 49.6018, lng: 13.8635 };
    const stopA = { id: 'stop-a', title: 'Alej Johanky z Rožmitálu', lat: 49.5991, lng: 13.8518 };
    const sharedRoute = buildLocalRoutedGeometry([origin, stopA]);
    assert.ok(Array.isArray(sharedRoute.steps) && sharedRoute.steps.length >= 1, 'Pěší trasa musí obsahovat odbočovací kroky (steps)');

    const turnInfo = computeActiveTurnInstruction(sharedRoute, origin, [stopA], new Set());
    assert.ok(turnInfo.icon.length >= 1);
    assert.match(turnInfo.text, /Směr: Alej Johanky z Rožmitálu/);

    const returnRoute = await buildReturnToOriginRoute(stopA, origin);
    assert.ok(returnRoute.distanceM > 500, 'Trasa návratu na start musí mít reálnou pěší délku');
    assert.ok(returnRoute.coordinates.length >= 2);
  });
});


