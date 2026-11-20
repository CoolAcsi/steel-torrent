// Faction -> subfaction registry. Purely cosmetic: it selects models, materials
// and weapon effects. Stats live on the server and are identical for everyone.
//
// A faction owns the *materials* (hull, dark, lite, metal, glow). The player's
// team colour is passed to the models separately and only ever paints the
// reserved marking areas, so two players can field the same faction.
//
// To add a subfaction: add it here and in game/config.js, give it a branch in
// units.js / buildings.js where it should differ, and add its strings under
// factions.<id>.subs.<sub> in every locale.

export const FACTIONS = {
  // Heavy industry: broad, angular, thick armour, exposed machinery.
  iron: {
    accent: '#c8322f',
    mat: { hull: '#66635c', dark: '#3d3b37', lite: '#8f8b81', metal: '#25272a', glow: '#ff9a3c' },
    subs: {
      bastion: { accent2: '#d6a23a', weapons: ['bullet', 'shell', 'siege'] },   // conscript, rhino, apocalypse
      volt:    { accent2: '#7fd8ff', weapons: ['arc', 'arc', 'siege'] },        // tesla trooper, tesla tank, airship bombs
    },
  },
  // Precision engineering: clean plates, balanced proportions, sensors.
  meridian: {
    accent: '#2f7fe8',
    mat: { hull: '#98a2aa', dark: '#5b656d', lite: '#c9d1d7', metal: '#394047', glow: '#c9f1ff' },
    subs: {
      shade: { accent2: '#3ad1c4', weapons: ['bullet', 'shell', 'lance'] },     // GI, grizzly, mirage
      aegis: { accent2: '#eaf6ff', weapons: ['tracer', 'pulse', 'beam'] },      // guardian GI, multifunction vehicle, prism
    },
  },
  // Psychic technology: curved shells, asymmetry, antennae, hovering.
  veil: {
    accent: '#8d5fe6',
    mat: { hull: '#4b4358', dark: '#2a2531', lite: '#72678a', metal: '#1b181f', glow: '#d9a4ff' },
    subs: {
      dominion: { accent2: '#ff7ad9', weapons: ['wave', 'shell', 'pulse'] },     // initiate, shenfeng, flying disc
      forge:    { accent2: '#7dffb0', weapons: ['tracer', 'bullet', 'wave'] },  // virus sniper, gatling, brain vehicle
    },
  },
};

export const FACTION_IDS = Object.keys(FACTIONS);

export function subIds(f) {
  return Object.keys(FACTIONS[f].subs);
}

/** Coerce anything into a valid [faction, sub] pair. */
export function normalize(f, sub) {
  if (!FACTIONS[f]) f = FACTION_IDS[0];
  if (!FACTIONS[f].subs[sub]) sub = subIds(f)[0];
  return [f, sub];
}

export function weaponOf(f, sub, level) {
  return FACTIONS[f].subs[sub].weapons[level - 1];
}

/** Every faction/sub pair, in display order. */
export function allVariants() {
  return FACTION_IDS.flatMap(f => subIds(f).map(sub => ({ f, sub })));
}
