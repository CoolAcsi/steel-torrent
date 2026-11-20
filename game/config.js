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

  // Maximum garrison. Separate from the production threshold: production pauses at the
  // threshold, friendly reinforcements are accepted up to the capacity, and a full city can
  // always send troops out. A level may set its own `cap`; otherwise cap = mult x threshold.
  capacity: {
    mult: 3,
  },

  // A base destroyed by a nuclear strike: neutral, produces nothing, has no abilities,
  // keeps its roads. Whoever captures it may rebuild it into a level-1 base.
  ruin: {
    capacity: 30,               // garrison a ruin can hold
    cost: 10,                   // soldiers spent to start rebuilding (the same currency as upgrades)
    time: 15,                   // simulation seconds the rebuild takes
  },

  dispatch: {
    minGarrison: 0,             // soldiers that always stay behind
  },

  march: {
    speed: 60,                  // world units per second before multipliers
    arriveAt: 25,               // distance from the city centre at which an army has arrived
    maxSpeedBonus: 1.4,         // cap on stacked speed-ups
    minSlow: 0.5,               // floor on stacked slows
  },

  combat: {
    speed: 3.2,                 // global multiplier on damage per second (battle pace)
    armorK: 20,                 // damage taken = damage * (1 - armor / (armor + armorK))
    engageRadius: 16,           // road distance at which hostile armies lock in combat
    cityDefense: [0, 0, 0.1, 0.2],   // damage reduction for a garrison, by city level
    noAA: 0.6,                  // damage multiplier against airborne units for troops that cannot aim upward
  },

  // Rosters. Each subfaction fields its own three units, one per city level (tier).
  //   cls       inf | veh | air   (air units still march and are intercepted on roads like anyone else)
  //   hp, atk, interval, armor    health, damage per attack, seconds between attacks, armour
  //   move      march speed multiplier          range   road distance at which it can open fire
  //   vs        damage multiplier by target class; `city` applies to troops standing in a city
  //   prefer    how its fire is shared out: target weight by class (default 1 each)
  //   aa        can aim at airborne units (others do combat.noAA of their damage to them)
  //   pierce    treats target armour as this fraction
  // Bounded specialist traits:
  //   regen     health restored per second per unit while out of battle (never raises head count)
  //   repair    health restored per second per unit to wounded vehicles alongside it, in or out of battle
  //   arc       { min, bonus }: extra damage when the enemy fields at least `min` soldiers
  //   opening   { dur, bonus }: extra damage in the first seconds of every engagement (ambush, charge)
  //   spinup    { dur, max }: damage grows from 1x to max over `dur` seconds of continuous fighting
  //   cityArmor extra armour while garrisoning a city
  //   siphon    a city it is besieging produces nothing
  //   control   { cd, per, cap }: every `cd` seconds of battle, converts up to `per` enemy soldiers per
  //             `group` of these units (at most `cap` at once); converted troops can never be converted again
  factions: {
    iron: {
      prod: 1.0,
      subs: {
        // Soviet A: durable conventional assault.
        bastion: { units: [null,
          { id: 'conscript',  cls: 'inf', hp: 145, atk: 12, interval: 1.2,  armor: 6,  move: 0.95, range: 16 },
          { id: 'rhino',      cls: 'veh', hp: 210, atk: 16, interval: 1.2,  armor: 9,  move: 1.0,  range: 22, vs: { veh: 1.1 } },
          { id: 'apocalypse', cls: 'veh', hp: 315, atk: 23, interval: 1.3,  armor: 12, move: 0.98, range: 26, aa: true, regen: 2 },
        ] },
        // Soviet B: electrical pressure, and slow heavy airborne power.
        volt: { units: [null,
          { id: 'teslaTrooper', cls: 'inf', hp: 135, atk: 13, interval: 1.3,  armor: 7, move: 0.9, range: 18, vs: { veh: 1.3, inf: 0.9 } },
          { id: 'teslaTank',    cls: 'veh', hp: 175, atk: 18, interval: 1.25, armor: 6, move: 1.05, range: 30, arc: { min: 8, bonus: 1.2 } },
          { id: 'kirov',        cls: 'air', hp: 380, atk: 30, interval: 1.9,  armor: 9, move: 0.72, range: 16, vs: { city: 1.6, air: 0.4 } },
        ] },
      },
    },
    meridian: {
      prod: 1.0,
      subs: {
        // Allied A: mobility and precision.
        shade: { units: [null,
          { id: 'gi',      cls: 'inf', hp: 100, atk: 10.5, interval: 1.0, armor: 7, move: 1.2,  range: 18 },
          { id: 'grizzly', cls: 'veh', hp: 160, atk: 15, interval: 1.0, armor: 9, move: 1.4,  range: 22 },
          { id: 'mirage',  cls: 'veh', hp: 180, atk: 20, interval: 1.0, armor: 9, move: 1.45, range: 40, pierce: 0.7, opening: { dur: 2.5, bonus: 1.5 } },
        ] },
        // Allied B: versatility and longer-range energy attacks.
        aegis: { units: [null,
          { id: 'guardian', cls: 'inf', hp: 100, atk: 10, interval: 1.15, armor: 8, move: 1.0,  range: 22, vs: { veh: 1.35 }, cityArmor: 3 },
          { id: 'ifv',      cls: 'veh', hp: 135, atk: 15, interval: 0.9,  armor: 7, move: 1.45, range: 28, aa: true, repair: 1.5 },
          { id: 'prism',    cls: 'veh', hp: 140, atk: 26, interval: 1.25, armor: 6, move: 1.2,  range: 70, vs: { city: 1.3, veh: 1.15 }, arc: { min: 6, bonus: 1.15 } },
        ] },
      },
    },
    veil: {
      prod: 1.1,
      subs: {
        // Yuri A: direct psychic pressure and unusual assault units.
        dominion: { convert: 1, units: [null,
          { id: 'initiate', cls: 'inf', hp: 70,  atk: 10, interval: 1.0, armor: 3, move: 1.0,  range: 24, vs: { inf: 1.15, veh: 0.85 }, pierce: 0.6 },
          { id: 'shenfeng', cls: 'veh', hp: 100, atk: 14, interval: 1.0, armor: 5, move: 1.6,  range: 16, opening: { dur: 2, bonus: 1.6 } },
          { id: 'disc',     cls: 'air', hp: 145, atk: 17, interval: 1.0, armor: 7, move: 1.35, range: 20, aa: true, vs: { city: 1.2 }, siphon: true },
        ] },
        // Yuri B: specialist targeting, sustained fire and control.
        forge: { units: [null,
          { id: 'sniper',  cls: 'inf', hp: 75,  atk: 11, interval: 1.6, armor: 2, move: 0.95, range: 60, vs: { inf: 1.7, veh: 0.35, air: 0.3 }, prefer: { inf: 4 } },
          { id: 'gatling', cls: 'veh', hp: 145, atk: 8.5, interval: 0.6, armor: 6, move: 1.05, range: 26, aa: true, vs: { air: 1.5, inf: 1.15 }, spinup: { dur: 6, max: 1.6 } },
          { id: 'brain',   cls: 'veh', hp: 205, atk: 15, interval: 1.0, armor: 6, move: 1.0,  range: 30, control: { cd: 6, per: 1, group: 4, cap: 3, minSurvivors: 2 } },
        ] },
      },
    },
    // Unowned cities: plain defenders, one kind per city level.
    neutral: {
      prod: 0,
      subs: { '': { units: [null,
        { id: 'militia',  cls: 'inf', hp: 100, atk: 9,    interval: 1.0, armor: 5, move: 1.0,  range: 16 },
        { id: 'garrison', cls: 'veh', hp: 150, atk: 12.6, interval: 1.0, armor: 7, move: 1.15, range: 20 },
        { id: 'fortress', cls: 'veh', hp: 210, atk: 17.1, interval: 1.0, armor: 9, move: 1.3,  range: 24 },
      ] } },
    },
  },

  // City abilities, by the owner's faction. Level 2 unlocks the first, level 3 upgrades it.
  // A ruin has none.
  abilities: {
    range: 150,
    iron: { turretCd: 2.2, turretDmg: 70, coilDmg: 95, chainTargets: 2, chainRange: 120, chainFalloff: 0.5 },
    meridian: { slow: 0.65, shieldCd: 18, shieldHp: 180, shieldDur: 6 },
    veil: { weaken: 0.8, convertCd: 14, convertPct: 0.15, convertCap: 4, minSurvivors: 2 },
  },

  // Two basic skills and one superweapon per faction, in slot order. Basic skills work on
  // bases and routes. Targets: ownCity, edge (a point on a road), enemyCity, ownCityPair.
  //
  // Emplacements (turret, slow, psi) stand beside one of your bases for `dur` seconds and act on
  // hostile armies within `range`. They end at once if the base changes hands or is destroyed.
  // Obstacles (block, mire) sit on a road that touches one of your bases.
  skills: {
    basicInitialCd: 20,         // no skill is ready in the opening seconds
    superNeedsL3: 3,            // level-3 cities required to charge and cast a superweapon
    superInitialCharge: 120,    // seconds of eligibility before the first cast
    perCity: 2,                 // emplacements one base can hold at once (any kind; never two of the same kind)
    perPlayer: 3,               // emplacements one player can have standing at once
    obstaclesPerPlayer: 1,      // route obstacles one player can have standing at once
    obstacleClear: 34,          // an obstacle cannot be placed this close to any army or another obstacle
    edgeSpan: [0.2, 0.8],       // how far along a road (from either city) an obstacle may stand
    lastBaseImmune: true,       // superweapons cannot target a player's only remaining base
    // Modest subfaction leanings: multipliers on fields of the parent faction's skills.
    variants: {
      bastion:  { barricade: { hp: 1.25 } },
      volt:     { turret: { dmg: 1.2 } },
      shade:    { suppress: { range: 1.15 } },
      aegis:    { aegis: { hp: 1.25 } },
      dominion: { guard: { range: 1.15 } },
      forge:    { mire: { span: 1.3 } },
    },
    iron: [
      // Deploy Defense: a gun turret that shells the nearest hostile army in range.
      { id: 'turret', cd: 70, target: 'ownCity', emp: 'turret', dur: 30, range: 150, shotCd: 1.6, dmg: 55 },
      // Route Barricade: hostile armies cannot pass until they have broken it; they plan round it if they can.
      { id: 'barricade', cd: 80, target: 'edge', obst: 'block', dur: 22, hp: 4500, frontage: 30, detour: 260 },
      // Nuclear Strike: destroys the targeted base (see `ruin`); armies caught in the blast are hurt.
      { id: 'nuke', super: true, cd: 240, target: 'enemyCity', delay: 4, radius: 120, pct: 0.5, flat: 80, cap: 900, hazardDur: 6, hazardDps: 25 },
    ],
    meridian: [
      // Base Shield: soaks damage for one base; refreshed, never stacked. While it stands it also turns
      // away one superweapon aimed at that base (and is spent doing so).
      { id: 'aegis', cd: 75, target: 'ownCity', dur: 14, hp: 3000 },
      // Suppression Emplacement: slows hostile armies in range.
      { id: 'suppress', cd: 70, target: 'ownCity', emp: 'slow', dur: 30, range: 170, slow: 0.55 },
      // Chrono Wormhole: a temporary two-way link between two of your bases that your armies and
      // route planning can use. `capacity` soldiers may pass in total; `cost` is its length for planning.
      { id: 'wormhole', super: true, cd: 240, target: 'ownCityPair', dur: 30, capacity: 160, cost: 30 },
    ],
    veil: [
      // Psychic Guard: hostile armies in range hit softer.
      { id: 'guard', cd: 70, target: 'ownCity', emp: 'psi', dur: 30, range: 170, weaken: 0.7 },
      // Disruption Barrier: a stretch of road where hostile armies are slowed and hit softer.
      { id: 'mire', cd: 80, target: 'edge', obst: 'mire', dur: 22, span: 70, slow: 0.5, weaken: 0.8, detour: 120 },
      // Base Mind Control: after the warning, the targeted enemy base changes sides with its garrison.
      { id: 'dominate', super: true, cd: 270, target: 'enemyCity', delay: 5 },
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
