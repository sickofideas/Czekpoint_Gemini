export const ALLOWED_AVATARS = Object.freeze([
  { id: 'liska', name: 'Liška' },
  { id: 'sova', name: 'Sova' },
  { id: 'jelen', name: 'Jelen' },
  { id: 'jezek', name: 'Ježek' },
  { id: 'vydra', name: 'Vydra' },
  { id: 'zajic', name: 'Zajíc' },
  { id: 'veverka', name: 'Veverka' },
  { id: 'medved', name: 'Medvěd' },
  { id: 'rys', name: 'Rys' },
  { id: 'datel', name: 'Datel' },
  { id: 'list', name: 'List' },
  { id: 'kapradina', name: 'Kapradina' },
]);

export const ALLOWED_AVATAR_IDS = new Set(ALLOWED_AVATARS.map(a => a.id));

export const AVATAR_BACKGROUNDS = Object.freeze([
  { id: 'ivory', label: 'Slonovinová', hex: '#fffdf5', isDark: false },
  { id: 'parchment', label: 'Pergamen', hex: '#f4ecd8', isDark: false },
  { id: 'moss', label: 'Lesní mech', hex: '#284733', isDark: true },
  { id: 'slate', label: 'Břidlice', hex: '#27383f', isDark: true },
  { id: 'night', label: 'Noční obloha', hex: '#162838', isDark: true },
  { id: 'terracotta', label: 'Terakota', hex: '#5c2d1e', isDark: true },
]);

export const AVATAR_RINGS = Object.freeze([
  { id: 'brass', label: 'Horská mosaz', hex: '#d4af37' },
  { id: 'bronze', label: 'Kovaný bronz', hex: '#b87333' },
  { id: 'silver', label: 'Lesní stříbro', hex: '#e2e8f0' },
  { id: 'steel', label: 'Temná ocel', hex: '#334155' },
  { id: 'emerald', label: 'Smaragdová zeleň', hex: '#15803d' },
]);

export const BG_MAP = new Map(AVATAR_BACKGROUNDS.map(b => [b.id, b]));
export const RING_MAP = new Map(AVATAR_RINGS.map(r => [r.id, r]));

/**
 * Spočítá relativní jas (luminance) hex barvy pro kontrolu kontrastu na mapě.
 */
function hexToLuminance(hex) {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return 0.5;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const a = [r, g, b].map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

/**
 * Ověří dostatečný kontrast medailonu a lemu na mapovém podkladu (WCAG >= 2.8 poměr).
 */
export function hasAccessibleContrast(bgHex = '#fffdf5', ringHex = '#d4af37') {
  const l1 = hexToLuminance(bgHex);
  const l2 = hexToLuminance(ringHex);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return ratio >= 1.45; // Dostatečné odlišení obruby od vnitřního štítku
}

export function isValidAvatarId(avatarId) {
  return typeof avatarId === 'string' && ALLOWED_AVATAR_IDS.has(avatarId.trim());
}

export function validateAvatarId(avatarId) {
  if (typeof avatarId !== 'string') return 'liska';
  const clean = avatarId.trim();
  return ALLOWED_AVATAR_IDS.has(clean) ? clean : 'liska';
}

export function validateProfile(rawProfile) {
  if (!rawProfile || typeof rawProfile !== 'object') {
    return {
      avatarId: 'liska',
      bgChoice: 'ivory',
      ringChoice: 'brass',
      bgColor: '#fffdf5',
      ringColor: '#d4af37',
    };
  }

  // Bezpečná migrace: dosavadní vybraný avatar uživatele zůstává vždy zachován!
  const avatarId = validateAvatarId(rawProfile.avatarId);
  const bgChoice = BG_MAP.has(rawProfile.bgChoice) ? rawProfile.bgChoice : 'ivory';
  const ringChoice = RING_MAP.has(rawProfile.ringChoice) ? rawProfile.ringChoice : 'brass';
  const bgMeta = BG_MAP.get(bgChoice) || AVATAR_BACKGROUNDS[0];
  const ringMeta = RING_MAP.get(ringChoice) || AVATAR_RINGS[0];

  return {
    avatarId,
    bgChoice,
    ringChoice,
    bgColor: bgMeta.hex,
    ringColor: ringMeta.hex,
    isDarkBg: bgMeta.isDark,
  };
}

export function avatarUrl(avatarId) {
  const valid = validateAvatarId(avatarId);
  return `./assets/avatars/${valid}.svg`;
}

export function migrateAvatarSelection(avatarId, bgChoice = 'ivory', ringChoice = 'brass') {
  if (typeof avatarId === 'object' && avatarId !== null) {
    return validateProfile(avatarId);
  }
  return validateProfile({ avatarId, bgChoice, ringChoice });
}