# Balance

Every number below lives in `game/config.js` (`BALANCE`). Nothing is duplicated
in the simulation, the AI or the client, so a change there is the whole change.
The values are tuned against AI-vs-AI simulations; treat them as a tested
starting point, not as proof of balance between people.

## The model

**Troops** are tracked as groups of `{ faction, subfaction, tier, soldiers, health, converted }`.
A soldier's tier is the level of the base that produced it (1, 2 or 3) and never
changes afterwards. Each subfaction has its own unit for each tier (its roster);
a unit's numbers are written out in full in `factions.<f>.subs.<sub>.units[tier]`,
not derived from multipliers.

**Damage.** One routine (`fight`) resolves road battles, sieges and ranged
exchanges. Each step, every group deals `soldiers × atk / interval × combat.speed (3.2) × dt`,
shared across hostile groups by head count (times the attacker's target
preference), scaled by its `vs` profile for the target's class, by
`combat.noAA` (0.6) against aircraft if it has no anti-air weapon, and by the
target's armour: `1 − armour / (armour + 20)`. Everything is worked out per troop
group from the group's own stats; nothing is averaged over a mixed army, and
nothing depends on how many figures an army is drawn with. Head count is
remaining health over per-soldier health, rounded up.

**Range.** Troops open fire when the road distance to a hostile army or base is
within their range, before the armies lock; only troops with the reach answer.

**Aircraft** (Kirov Airship, Flying Disc) are a damage class only. They march
on roads, are intercepted, stopped by barricades and cannot pass a base that is
not their owner's, exactly like ground troops.

**Economy.** A base produces `level.prod × faction.prod` soldiers per second
(0.5 / 0.9 / 1.4 by level; faction factors iron 1, meridian 1, veil 1.1)
until its garrison reaches the **production threshold** (20 / 40 / 70).
Upgrades cost 12 and 25 soldiers.

**Capacity.** Separately, a base holds at most `threshold × capacity.mult` (3)
soldiers: 60 / 120 / 210. Set `cap` on a level to override. Capacity limits only
friendly reinforcement. Soldiers already marching to join a base count against
it (a reservation is simply the soldiers still on the way, so it can never
leak). If only part of an order fits, that part is sent and the rest stay home;
a column that arrives to find no room waits at the gate as an army; after a
capture the victors fill the base and the rest stay outside. Nobody is ever
deleted to fit. A full base can always send troops out, and an attack is never
refused because the target is full. A ruin holds 30.

## Rosters

Rating is combat power per soldier relative to a neutral tier-1 soldier
(`sqrt(dps × health / (1 − mitigation))`); it ignores traits and matchups.

| Roster | Tier | Unit | Class | HP | DPS | Armour | Speed | Range | Rating | Traits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| iron/bastion | 1 | Conscript | inf | 145 | 10.0 | 6 | 0.95 | 16 | 1.29 | - |
| iron/bastion | 2 | Rhino Tank | veh | 210 | 13.3 | 9 | 1 | 22 | 1.90 | ×1.1 vs veh |
| iron/bastion | 3 | Apocalypse Tank | veh | 315 | 17.7 | 12 | 0.98 | 26 | 2.82 | anti-air; self-repair 2/s at rest |
| iron/volt | 1 | Tesla Trooper | inf | 135 | 10.0 | 7 | 0.9 | 18 | 1.27 | ×1.3 vs veh; ×0.9 vs inf |
| iron/volt | 2 | Tesla Tank | veh | 175 | 14.4 | 6 | 1.05 | 30 | 1.71 | ×1.2 when the enemy side has 8+ |
| iron/volt | 3 | Kirov Airship | air | 380 | 15.8 | 9 | 0.72 | 16 | 2.78 | ×1.6 vs garrisons; ×0.4 vs air |
| meridian/shade | 1 | GI | inf | 100 | 10.5 | 7 | 1.2 | 18 | 1.12 | - |
| meridian/shade | 2 | Grizzly Tank | veh | 160 | 15.0 | 9 | 1.4 | 22 | 1.76 | - |
| meridian/shade | 3 | Mirage Tank | veh | 180 | 20.0 | 9 | 1.45 | 40 | 2.15 | treats armour as 70%; ×1.5 for the first 2.5s |
| meridian/aegis | 1 | Guardian GI | inf | 100 | 8.7 | 8 | 1 | 22 | 1.04 | ×1.35 vs veh; +3 armour in a base |
| meridian/aegis | 2 | Multifunction Vehicle | veh | 135 | 16.7 | 7 | 1.45 | 28 | 1.64 | anti-air; repairs vehicles 1.5/s each |
| meridian/aegis | 3 | Prism Tank | veh | 140 | 20.8 | 6 | 1.2 | 70 | 1.83 | ×1.3 vs garrisons; ×1.15 vs veh; ×1.15 when the enemy side has 6+ |
| veil/dominion | 1 | Yuri Initiate | inf | 70 | 10.0 | 3 | 1 | 24 | 0.85 | ×1.15 vs inf; ×0.85 vs veh; treats armour as 60% |
| veil/dominion | 2 | Shenfeng Tank | veh | 100 | 14.0 | 5 | 1.6 | 16 | 1.25 | ×1.6 for the first 2s |
| veil/dominion | 3 | Flying Disc | air | 145 | 17.0 | 7 | 1.35 | 20 | 1.72 | anti-air; ×1.2 vs garrisons; besieged base stops producing |
| veil/forge | 1 | Virus Sniper | inf | 75 | 6.9 | 2 | 0.95 | 60 | 0.71 | ×1.7 vs inf; ×0.35 vs veh; ×0.3 vs air; targets inf first |
| veil/forge | 2 | Gatling Cannon Unit | veh | 145 | 14.2 | 6 | 1.05 | 26 | 1.54 | anti-air; ×1.5 vs air; ×1.15 vs inf; ramps to ×1.6 over 6s |
| veil/forge | 3 | Brain Vehicle | veh | 205 | 15.0 | 6 | 1 | 30 | 1.89 | converts 1 per 4 vehicles every 6s (max 3) |

Intended shape, each with its counter:

- **iron/bastion** is the sturdiest line and the slowest to arrive. Kite it with range (Prism, Sniper) and beat it to neutral bases.
- **iron/volt** punishes vehicles and crowds; its airship flattens garrisons but is slow and helpless against anti-air units (Apocalypse, Multifunction Vehicle, Flying Disc, Gatling).
- **meridian/shade** is the fastest roster with a strong opening volley; it loses long fights against heavier troops.
- **meridian/aegis** defends well (dug-in infantry, repairs, very long range) and is fragile when caught in the open.
- **veil/dominion** is numerous, fast and thin-skinned; its discs starve a besieged base but die to anti-air.
- **veil/forge** is a specialist kit: snipers shred infantry and do almost nothing to vehicles, Gatlings need time to spin up, Brain Vehicles win long fights by conversion and lose short ones.

## City abilities

Level-1 cities only produce. Level 2 unlocks an ability and level 3 upgrades it.
Which ability a city has depends on its *current owner's* faction, so it changes
with the city; its cooldown restarts on capture. All use one range, 150.

| | Level 2 | Level 3 |
| --- | --- | --- |
| Iron | **Heavy turret**: every 2.2 s, 70 damage to one hostile army in range. Targets armies heading for this city first, nearest first. | **Storm coil**: 95 damage, chaining to at most 2 more armies within 120 of the first at 50%. |
| Meridian | **Suppression field**: hostile armies in range march at ×0.65. | **Defence network**: keeps the field, and every 18 s (when a threat is in range) gives the garrison a 180-point shield for 6 s. |
| Veil | **Psychic disruption**: hostile armies in range attack at ×0.8. | **Psychic conversion**: keeps the disruption, and every 14 s turns 15% of one hostile army, at most 4 soldiers, leaving at least 2. |

Stacking and caps:

- Slows never stack: an army takes the strongest of all fields and Psychic
  Shock, and never moves below ×0.5 (`march.minSlow`). Speed-ups cap at ×1.4.
- Weakening never stacks: the strongest of disruption and Psychic Shock applies.
- A shield is refreshed, never added to.
- Conversion only reaches armies besieging the city or on a road that ends at
  it. Converted soldiers keep their faction, tier and health, form a new army on
  the spot marching for the city that turned them (so they usually fight their
  former comrades at once), and are flagged: **they can never be converted
  again**, which rules out ping-pong and chain reactions.

Counters: the turret is one target every 2.2 s, so several small armies beat it;
the suppression field does nothing to troops already at the walls; conversion
needs an army of at least 7 to take anything.

## Basic skills and superweapons

| Faction | Skill | Target | Cooldown | Numbers |
| --- | --- | --- | --- | --- |
| iron | turret | ownCity | 70s | dur 30, range 150, shotCd 1.6, dmg 55 |
| iron | barricade | edge | 80s | dur 22, hp 4500, frontage 30, detour 260 |
| iron | nuke (superweapon) | enemyCity | 240s | delay 4, radius 120, pct 0.5, flat 80, cap 900, hazardDur 6, hazardDps 25 |
| meridian | aegis | ownCity | 75s | dur 14, hp 3000 |
| meridian | suppress | ownCity | 70s | dur 30, range 170, slow 0.55 |
| meridian | wormhole (superweapon) | cityPair | 240s | dur 30, capacity 160, cost 30 |
| veil | guard | ownCity | 70s | dur 30, range 170, weaken 0.7 |
| veil | mire | edge | 80s | dur 22, span 70, slow 0.5, weaken 0.8, detour 120 |
| veil | dominate (superweapon) | enemyCity | 270s | delay 5 |

Subfaction adjustments (`skills.variants`): bastion: barricade hp ×1.25; volt: turret dmg ×1.2; shade: suppress range ×1.15; aegis: aegis hp ×1.25; dominion: guard range ×1.15; forge: mire span ×1.3.

Rules that keep them fair:

- Nothing is ready for the first 20s. Superweapons need 3 level-3 bases held to charge (first charge 120s) and are re-checked at the moment of the cast: losing the third level-3 base stops the charge and blocks the cast.
- At most 2 emplacements per base (one of a kind), 3 per player, 1 road obstacle per player. Obstacles go only on a road touching one of your bases, between 20% and 80% of its length, never on top of a column.
- Emplacements end when their base changes hands. A barricade has health and a `frontage`: only that many soldiers can work on it at once, so a huge column is held about as long as a small one. Routes cost `detour` more through a hostile obstacle and go round when a comparable way exists.
- A superweapon is announced to everyone and lands after `delay`. It comes to nothing if the base is shielded by a Base Shield (which is used up), has become its owner's last base, or is no longer an enemy base. A player's last base cannot be targeted (`lastBaseImmune`).
- **Nuclear strike** destroys the targeted base only: garrison dead, neutral ruin, no production or abilities, roads intact. Hostile columns within the radius take `pct` of their health plus `flat` (at most `cap`), and the ground hurts columns for `hazardDur`. A ruin is captured like any neutral base, holds 30, and is rebuilt by its holder for 10 soldiers in 15s into a level-1 base.
- **Chrono wormhole** is one extra, two-way link between any two bases, whoever holds them (ruins included), used by the caster's routing automatically. The caster's troops enter from an end the caster holds: into another of their bases they reinforce it (and obey its capacity), into anyone else's they attack it. It carries `capacity` soldiers in all, each player has one, and it closes when its time is up; losing an end does not close it, it only means nothing can enter from that end.
- **Base mind control** hands over one base as it stands: level, garrison (flagged so it can never be converted again) and permanent abilities. Marching armies are untouched. Persistent orders from that base, and the old owner's orders to it, are cancelled.

Nuclear strike versus mind control: the nuke removes a base from the map for both sides (the caster must still capture and pay to rebuild it) and kills its garrison outright; mind control gains a working base and its soldiers but charges longer (270s against 240s) and warns longer. Both are stopped by the same 75-second-cooldown Base Shield, and neither can finish a player off.

## Crates

Off unless the room enables them. First crate at 25 s, then one every 18–26 s,
at most 3 on the map, each for 60 s. They appear on roads, clear of cities, at
the candidate spot most evenly distant from two different players. A marching
army collects a crate when its path that step passes within 14; if two armies
reach it in the same step the earlier one wins, and on an exact tie the lower
army id. A crate is collected exactly once.

| Reward | Weight | Effect |
| --- | --- | --- |
| Reinforcement cache | 22 | +6 tier-1 soldiers of the collector's faction, added to that army |
| Rapid march | 18 | that army ×1.25 speed for 15 s |
| Field repairs | 16 | heals 35% of missing health, at most 150; never raises the soldier count |
| Reactive armor | 14 | that army takes ×0.8 damage for 15 s |
| Overcharged weapons | 12 | that army deals ×1.2 damage for 15 s |
| Production surge | 10 | the player's cities produce ×1.3 for 12 s (thresholds still apply) |
| Tactical recharge | 8 | basic-skill cooldowns −10 s; never the superweapon |

Timed buffs refresh instead of stacking, belong to the army that collected them,
and are lost when it joins a garrison (a besieging army keeps them until they expire). Armies never merge on the road; a contingent
converted out of a buffed army gets no buffs.

## What was tested

`npm test` runs the rule tests (capacity, rosters, skills, superweapons, routing, pause and speed) and whole AI matches with exact soldier accounting. `node test/balance.js 30` plays seeded AI-versus-AI matches with seats swapped; the full output of the run behind these numbers is in `docs/balance-run.txt`.

Two-player pairings, hard AI, 30 seeds each (60 matches per pairing):

```
│ 0       │ 'iron vs meridian' │ 60    │ '48.3%' │ '51.7%' │ 2     │ '41.4%'     │ 254          │
│ 1       │ 'iron vs veil'     │ 60    │ '43.3%' │ '56.7%' │ 0     │ '50.0%'     │ 206          │
│ 2       │ 'meridian vs veil' │ 60    │ '60.0%' │ '40.0%' │ 0     │ '50.0%'     │ 179          │
│ 0       │ 'iron vs meridian' │ 60    │ '54.2%' │ '45.8%' │ 1     │ '42.4%'     │ 224          │
│ 1       │ 'iron vs veil'     │ 60    │ '41.7%' │ '58.3%' │ 0     │ '45.0%'     │ 189          │
│ 2       │ 'meridian vs veil' │ 60    │ '61.7%' │ '38.3%' │ 0     │ '61.7%'     │ 189          │
```
(first block crates off, second crates on; columns: games, first faction's wins, second's, draws, seat-0 wins, average length in seconds)

Win rate of each roster across those matches:

```
│ 0       │ 'iron/volt'      │ 60    │ '40.0%' │ 0     │
│ 1       │ 'meridian/shade' │ 60    │ '53.3%' │ 0     │
│ 2       │ 'iron/bastion'   │ 60    │ '51.7%' │ 2     │
│ 3       │ 'meridian/aegis' │ 60    │ '58.6%' │ 2     │
│ 4       │ 'veil/dominion'  │ 60    │ '56.7%' │ 0     │
│ 5       │ 'veil/forge'     │ 60    │ '40.0%' │ 0     │
│ 0       │ 'iron/volt'      │ 60    │ '46.7%' │ 0     │
│ 1       │ 'meridian/shade' │ 60    │ '51.7%' │ 0     │
│ 2       │ 'iron/bastion'   │ 60    │ '49.2%' │ 1     │
│ 3       │ 'meridian/aegis' │ 60    │ '55.9%' │ 1     │
│ 4       │ 'veil/dominion'  │ 60    │ '58.3%' │ 0     │
│ 5       │ 'veil/forge'     │ 60    │ '38.3%' │ 0     │
```

Three-player free-for-all (90 matches per block; iron, meridian, veil, draws, average length):

```
│ 0       │ 90    │ '32.6%' │ '44.9%'  │ '22.5%' │ 1     │ 224          │
│ 0       │ 90    │ '28.1%' │ '42.7%'  │ '29.2%' │ 1     │ 219          │
```

## How the numbers were reached

1. Rosters were first written by role. A duel table (equal production time on both sides, open field, with the approach under fire) showed large per-tier gaps, which were closed by hand.
2. With duels even, AI matches were still decided by march speed and production: the first build had Veil Dominion winning 98% and Iron about 25%. Speed and production spread were narrowed (Iron infantry faster, Veil production 1.125 → 1.1).
3. A small tuner then scaled each roster's health against its win rate over all fifteen roster pairings until every roster sat between 44% and 59%, and those factors were written into the config.
4. Route Barricade and Base Shield health were raised (and barricades given frontage) after tests showed a 30-soldier column removed either in under a second.

## Re-running and tuning

- `node test/balance.js [seeds] [--level=hard|normal|both] [--quick]`
- Per-unit numbers: `factions.<f>.subs.<sub>.units`. Faction production: `factions.<f>.prod`. Capacity: `capacity.mult` or a level's `cap`. Ruins: `ruin`. Skills and limits: `skills`. Pathfinding wait: `route.waitMax`. Persistent orders: `auto`. Speeds: `speeds`.
- After a change, run `npm test`: rule tests read their expectations from the config, so they keep passing when numbers move and fail when a rule breaks.

## Remaining uncertainties

- The results above are bot against bot. The AI does not micro-manage range, retarget held columns or time shields the way a person will.
- Meridian still beats Veil about 60/40 and Veil does worst in three-player games (21–29%); Veil Forge is the weakest roster (38–40%). These are the first things to look at with real players.
- AI matches are short (about three to four minutes), so superweapons decide few of them; their balance against each other rests on the rules above and on rule tests, not on match statistics.
- Converted soldiers are drawn in their new owner's models; their real type and health are kept in the simulation.
