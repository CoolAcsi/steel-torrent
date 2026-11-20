'use strict';
// Central balance configuration. Every tunable number in the game lives here;
// the simulation, the AI, the tests and (via the match-start message) the
// client all read from this one object. Values are starting points, tuned with
// `node test/balance.js` — see docs/BALANCE.md.

const BALANCE = {
  nodeR: 36,                    // city radius, world units
  maxPlayers: 8,
  maxLevel: 3,
  startUnits: 15,

  // A city: `threshold` pauses passive production (it is NOT a garrison limit —
  // reinforcements may push a city above it), `prod` soldiers per second,
  // `upCost` soldiers spent to reach the next level.
  levels: [
    null,
    { id: 'barracks', threshold: 20, prod: 0.5, upCost: 12 },
    { id: 'depot',    threshold: 40, prod: 0.9, upCost: 25 },
    { id: 'lab',      threshold: 70, prod: 1.4, upCost: 0 },
  ],

  dispatch: {
    minGarrison: 0,             // soldiers that always stay behind
  },

  march: {
    speed: 60,                  // world units per second before multipliers
    tierSpeed: [0, 1, 1.15, 1.3],
    arriveAt: 25,               // distance from the city centre at which an army has arrived
    maxSpeedBonus: 1.4,         // cap on stacked speed-ups
    minSlow: 0.5,               // floor on stacked slows
  },

  combat: {
    speed: 3.2,                 // global multiplier on damage per second (battle pace)
    armorK: 20,                 // damage taken = damage * (1 - armor / (armor + armorK))
    engageRadius: 16,           // road distance at which hostile armies lock in combat
    cityDefense: [0, 0, 0.1, 0.2],   // damage reduction for a garrison, by city level
  },

  // Level-1 soldier of each faction. `interval` = seconds between attacks,
  // `move` multiplies march speed, `prod` multiplies city production.
  factions: {
    iron:     { hp: 120, atk: 12, armor: 5, interval: 1.2, move: 0.9,  prod: 0.98, subs: { bastion: { armor: 1.5, move: 0.97 }, volt: { atk: 1.06 } } },
    meridian: { hp: 100, atk: 10, armor: 7, interval: 1.0, move: 1.15, prod: 1.0,  subs: { shade: { move: 1.05 }, aegis: { armor: 1 } } },
    veil:     { hp: 90,  atk: 9,  armor: 4, interval: 1.0, move: 1.0,  prod: 1.125, subs: { dominion: { convert: 1, atk: 1.05 }, forge: { hp: 1.05 } } },
    neutral:  { hp: 100, atk: 9,  armor: 5, interval: 1.0, move: 1.0,  prod: 0,    subs: {} },
  },

  // Tier = level of the city that produced the soldier.
  tiers: [
    null,
    { hp: 1,   atk: 1,   armor: 0 },
    { hp: 1.5, atk: 1.4, armor: 2 },
    { hp: 2.1, atk: 1.9, armor: 4 },
  ],

  // One bounded trait per faction for tier-3 troops.
  traits: {
    ironSplash: { bonus: 1.15, minTargets: 10 },   // more damage into large groups
    meridianPierce: { armor: 0.7 },                // treats target armor as 70%
    veilDread: { enemyAtk: 0.92 },                 // enemies in the same battle hit softer (does not stack)
  },

  // City abilities, by the owner's faction. Level 2 unlocks the first, level 3 upgrades it.
  abilities: {
    range: 150,
    iron: { turretCd: 2.2, turretDmg: 70, coilDmg: 95, chainTargets: 2, chainRange: 120, chainFalloff: 0.5 },
    meridian: { slow: 0.65, shieldCd: 18, shieldHp: 180, shieldDur: 6 },
    veil: { weaken: 0.8, convertCd: 14, convertPct: 0.15, convertCap: 4, minSurvivors: 2 },
  },

  // Two basic skills and one superweapon per faction, in slot order.
  skills: {
    basicInitialCd: 20,         // no skill is ready in the opening seconds
    superNeedsL3: 3,            // level-3 cities required to charge and cast a superweapon
    superInitialCharge: 120,    // seconds of eligibility before the first cast
    iron: [
      { id: 'mobilize', cd: 75, target: 'none', dur: 12, prodMult: 1.4 },
      { id: 'barrage', cd: 90, target: 'point', delay: 1.6, radius: 70, pct: 0.25, flat: 40, cap: 260 },
      { id: 'nuke', super: true, cd: 240, target: 'point', delay: 4, radius: 120, pct: 0.5, flat: 80, cap: 900, hazardDur: 6, hazardDps: 25 },
    ],
    meridian: [
      { id: 'reinforce', cd: 75, target: 'ownCity', amount: 10 },
      { id: 'rapid', cd: 90, target: 'none', dur: 10, speedMult: 1.25 },
      { id: 'phase', super: true, cd: 240, target: 'cityPair', limit: 40 },
    ],
    veil: [
      { id: 'shock', cd: 75, target: 'point', radius: 110, dur: 6, slow: 0.6, weaken: 0.7 },
      { id: 'leech', cd: 90, target: 'army', pct: 0.25, cap: 8, minSurvivors: 3 },
      { id: 'dominion', super: true, cd: 240, target: 'point', delay: 3, radius: 130, pct: 0.3, cap: 24, minSurvivors: 2, garrisonPct: 0.3, garrisonCap: 400 },
    ],
  },
  prodBonusCap: 1.6,            // cap on stacked production bonuses

  // Routed orders.
  route: {
    waitMax: 20,                // seconds a blocked army waits on its road for a route to return before its order ends
  },

  // Persistent orders: a city keeps sending to one destination until told to stop.
  auto: {
    interval: 6,                // seconds between departures from one city
    retry: 1,                   // seconds before a city that could not send looks again (no backlog builds up)
    minDispatch: 3,             // a departure smaller than this waits for more troops
  },

  // Match controls. All times in the simulation are simulation seconds: at 2x a
  // 60-second cooldown takes 30 real seconds, at 0.5x it takes 120.
  speeds: [0.5, 0.75, 1, 1.5, 2],
  defaultSpeed: 1,
  control: {
    hostOnly: true,             // only the room's host may pause, resume or change speed
  },

  // Optional random crates (room setting).
  crates: {
    firstAt: 25,                // seconds before the first crate
    interval: [18, 26],         // seconds between spawns
    maxActive: 3,
    pickupRadius: 14,
    lifetime: 60,
    rewards: {                  // weight = relative spawn chance
      cache:    { weight: 22, soldiers: 6 },
      rapid:    { weight: 18, dur: 15, speedMult: 1.25 },
      repairs:  { weight: 16, pct: 0.35, cap: 150 },
      armor:    { weight: 14, dur: 15, taken: 0.8 },
      weapons:  { weight: 12, dur: 15, atk: 1.2 },
      surge:    { weight: 10, dur: 12, prodMult: 1.3 },
      recharge: { weight: 8, seconds: 10 },
    },
  },
};

// Faction -> subfaction ids. Must match public/js/factions.js.
const FACTIONS = {};
for (const [f, def] of Object.entries(BALANCE.factions)) if (f !== 'neutral') FACTIONS[f] = Object.keys(def.subs);

module.exports = {
  BALANCE,
  FACTIONS,
  LEVELS: BALANCE.levels,
  NODE_R: BALANCE.nodeR,
  MAX_LEVEL: BALANCE.maxLevel,
  MAX_PLAYERS: BALANCE.maxPlayers,
  START_UNITS: BALANCE.startUnits,
};
