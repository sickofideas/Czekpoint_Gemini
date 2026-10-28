/**
 * Idempotentní deník bodů a 8 ověřitelných milníků (DÁVKA 4 - Verze v1.5.0)
 * 
 * Každá bodovaná událost i každý milník má deterministický unikátní klíč:
 * - walk_${expeditionId}
 * - gps_place_${placeId}
 * - memory_${memoryId}
 * - milestone_${milestoneId}
 * 
 * Opakované vyhodnocení, reload stránky ani obnova ze zálohy nikdy nepřipíší body ani odznak dvakrát.
 * Simulované procházky se do pointsLedger ani do milníků nikdy nezapočítávají.
 */

export const MILESTONE_DEFINITIONS = Object.freeze([
  {
    id: 'first_walk',
    title: '1. První procházka (≥ 500 m)',
    shortTitle: 'První procházka',
    description: 'Dokončena první skutečná výprava s délkou alespoň 500 metrů.',
    icon: '🥾',
    points: 50,
    check: (stats) => stats.maxSingleWalkMeters >= 500,
  },
  {
    id: 'first_memory',
    title: '2. První vlastní vzpomínka',
    shortTitle: 'První vzpomínka',
    description: 'Uložena první soukromá poznámka v terénu do osobního atlasu.',
    icon: '✨',
    points: 30,
    check: (stats) => stats.personalMemoriesCount >= 1,
  },
  {
    id: 'first_nearby',
    title: '3. První místo zaznamenané poblíž',
    shortTitle: 'Zaznamenáno poblíž',
    description: 'Průchod v okolí ověřeného místa zaznamenaný podle GPS.',
    icon: '📍',
    points: 30,
    check: (stats) => stats.nearbyOrConfirmedCount >= 1,
  },
  {
    id: 'mindful_5',
    title: '4. Všímavý poutník (5 vzpomínek)',
    shortTitle: 'Všímavý poutník',
    description: 'Uloženo 5 vlastnoručních pozorování v osobním atlase.',
    icon: '🍃',
    points: 60,
    check: (stats) => stats.personalMemoriesCount >= 5,
  },
  {
    id: 'distance_10km',
    title: '5. Toulavé boty (10 km celkem)',
    shortTitle: 'Toulavé boty',
    description: 'Celková ušlá vzdálenost dosáhla 10 kilometrů.',
    icon: '👣',
    points: 100,
    check: (stats) => stats.totalMeters >= 10000,
  },
  {
    id: 'distance_50km',
    title: '6. Poutník krajem (50 km celkem)',
    shortTitle: 'Poutník krajem',
    description: 'Celková ušlá vzdálenost dosáhla 50 kilometrů.',
    icon: '🌲',
    points: 200,
    check: (stats) => stats.totalMeters >= 50000,
  },
  {
    id: 'places_10',
    title: '7. Znalec okolí (10 míst)',
    shortTitle: 'Znalec okolí',
    description: 'Navštíveno nebo zaznamenáno alespoň 10 různých míst.',
    icon: '🏛️',
    points: 150,
    check: (stats) => stats.uniquePlacesCount >= 10,
  },
  {
    id: 'fog_100',
    title: '8. Odkrytý obzor (100 polí mlhy)',
    shortTitle: 'Odkrytý obzor',
    description: 'Vlastní chůzí odhaleno alespoň 100 dílků na mapě.',
    icon: '📜',
    points: 120,
    check: (stats) => stats.cellsCount >= 100,
  },
]);

/**
 * Bezpečně sestaví statistiky ze skutečných (nesimulovaných) dat v atlase.
 */
export function extractVerifiedStats(stateObj) {
  if (!stateObj || typeof stateObj !== 'object') {
    return {
      totalMeters: 0,
      cellsCount: 0,
      personalMemoriesCount: 0,
      nearbyOrConfirmedCount: 0,
      uniquePlacesCount: 0,
      maxSingleWalkMeters: 0,
      verifiedWalksCount: 0,
    };
  }

  const cellsCount = Array.isArray(stateObj.cells) ? stateObj.cells.length : 0;
  const personalMemoriesCount = Array.isArray(stateObj.personalMemories) ? stateObj.personalMemories.length : 0;
  const totalMeters = Number.isFinite(Number(stateObj.meters)) ? Math.max(0, Number(stateObj.meters)) : 0;

  // Spočítáme skutečné unikátní body z discoveries a confirmedStopIds
  const discSet = new Set();
  if (Array.isArray(stateObj.discoveries)) {
    for (const d of stateObj.discoveries) {
      if (typeof d === 'string' && d.trim()) discSet.add(d.replace(/^catalog:/, ''));
    }
  }
  if (Array.isArray(stateObj.confirmedStopIds)) {
    for (const c of stateObj.confirmedStopIds) {
      if (typeof c === 'string' && c.trim()) discSet.add(c);
    }
  }

  // Z historie procházek vynecháme simulované / neplatné
  let maxSingleWalkMeters = 0;
  let verifiedWalksCount = 0;
  if (Array.isArray(stateObj.expeditionHistory)) {
    for (const exp of stateObj.expeditionHistory) {
      if (!exp || exp.isSimulated || exp.simulated) continue;
      verifiedWalksCount++;
      const dist = Number(exp.distanceMeters) || 0;
      if (dist > maxSingleWalkMeters) maxSingleWalkMeters = dist;
      if (Array.isArray(exp.confirmedPlaces)) {
        for (const cp of exp.confirmedPlaces) {
          const id = cp?.id || cp;
          if (typeof id === 'string') discSet.add(id);
        }
      }
      if (Array.isArray(exp.nearbyPlaces)) {
        for (const np of exp.nearbyPlaces) {
          const id = np?.id || np;
          if (typeof id === 'string') discSet.add(id);
        }
      }
    }
  }

  return {
    totalMeters,
    cellsCount,
    personalMemoriesCount,
    nearbyOrConfirmedCount: discSet.size,
    uniquePlacesCount: discSet.size,
    maxSingleWalkMeters,
    verifiedWalksCount,
  };
}

/**
 * Idempotentně zapíše událost do deníku bodů. Pokud klíč již existuje, ponechá původní záznam beze změny.
 */
export function recordLedgerEntry(ledger = {}, key, entry = {}) {
  if (!key || typeof key !== 'string') return { ...ledger };
  const cleanLedger = (ledger && typeof ledger === 'object' && !Array.isArray(ledger)) ? { ...ledger } : {};
  if (cleanLedger[key]) {
    // Již dříve připsáno — 100% idempotentní ochrana
    return cleanLedger;
  }
  cleanLedger[key] = {
    points: Math.max(0, Math.round(Number(entry.points) || 0)),
    type: String(entry.type || 'generic'),
    label: String(entry.label || key),
    timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString(),
  };
  return cleanLedger;
}

/**
 * Spočítá celkové skóre z deníku bodů.
 */
export function calculateLedgerTotalScore(ledger = {}) {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return 0;
  let total = 0;
  for (const item of Object.values(ledger)) {
    if (item && Number.isFinite(item.points) && item.points > 0) {
      total += Math.round(item.points);
    }
  }
  return total;
}

/**
 * Idempotentně vyhodnotí 8 milníků vůči reálnému stavu atlasu a vrátí aktualizovaný stav a deník.
 */
export function evaluateMilestones(stateObj = {}) {
  const stats = extractVerifiedStats(stateObj);
  let ledger = (stateObj.pointsLedger && typeof stateObj.pointsLedger === 'object' && !Array.isArray(stateObj.pointsLedger))
    ? { ...stateObj.pointsLedger }
    : {};

  const milestonesStatus = [];
  const newlyUnlocked = [];

  for (const m of MILESTONE_DEFINITIONS) {
    const ledgerKey = `milestone_${m.id}`;
    const alreadyRecorded = Boolean(ledger[ledgerKey]);
    const conditionMet = m.check(stats);
    const unlocked = alreadyRecorded || conditionMet;

    if (conditionMet && !alreadyRecorded) {
      ledger = recordLedgerEntry(ledger, ledgerKey, {
        points: m.points,
        type: 'milestone',
        label: m.title,
      });
      newlyUnlocked.push(m);
    }

    milestonesStatus.push({
      ...m,
      unlocked,
      recordedAt: ledger[ledgerKey]?.timestamp || null,
      alreadyRecorded: Boolean(ledger[ledgerKey]),
    });
  }

  return {
    milestones: milestonesStatus,
    newlyUnlocked,
    updatedLedger: ledger,
    totalLedgerScore: calculateLedgerTotalScore(ledger),
    stats,
  };
}

/**
 * Zaregistruje dokončenou procházku do deníku bodů (idempotentně).
 */
export function recordWalkInLedger(ledger = {}, expedition = {}, pointsEarned = 0) {
  if (!expedition || typeof expedition !== 'object') return ledger;
  // Simulované procházky se NIKDY nezapisují do ledgeru
  if (expedition.isSimulated || expedition.simulated) return ledger;
  const expId = expedition.id || expedition.expId;
  if (!expId || typeof expId !== 'string') return ledger;

  const key = `walk_${expId}`;
  return recordLedgerEntry(ledger, key, {
    points: pointsEarned > 0 ? pointsEarned : Math.min(100, Math.round((Number(expedition.distanceMeters) || 0) / 50)),
    type: 'walk',
    label: `Procházka ${new Date(expedition.date || Date.now()).toLocaleDateString('cs-CZ')}`,
  });
}

/**
 * Zaregistruje novou vzpomínku do deníku bodů (idempotentně).
 */
export function recordMemoryInLedger(ledger = {}, memory = {}) {
  if (!memory || !memory.id || typeof memory.id !== 'string') return ledger;
  const key = `memory_${memory.id}`;
  return recordLedgerEntry(ledger, key, {
    points: 10,
    type: 'memory',
    label: `Vzpomínka: ${memory.title || memory.symbolLabel || 'Vlastní objev'}`,
  });
}

/**
 * Zaregistruje ověřenou návštěvu místa do deníku bodů (idempotentně).
 */
export function recordGpsPlaceInLedger(ledger = {}, placeId, placeTitle = '') {
  if (!placeId || typeof placeId !== 'string') return ledger;
  const key = `gps_place_${placeId.replace(/^catalog:/, '')}`;
  return recordLedgerEntry(ledger, key, {
    points: 30,
    type: 'place',
    label: `Zastávka: ${placeTitle || placeId}`,
  });
}
