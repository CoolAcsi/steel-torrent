# Balance

Every number below lives in `game/config.js` (`BALANCE`). Nothing is duplicated
in the simulation, the AI or the client, so a change there is the whole change.
The values are tuned against AI-vs-AI simulations; treat them as a tested
starting point, not as proof of balance between people.

## The model

**Troops** are tracked as groups of `{ faction, subfaction, tier, soldiers, health }`.
A soldier's tier is the level of the city that produced it (1, 2 or 3) and never
changes afterwards: upgrading a city only changes what it produces next.

| Per soldier | Formula |
| --- | --- |
| Health | `faction.hp × tier.hp × sub.hp` |
| Attack | `faction.atk × tier.atk × sub.atk` |
| Armor | `faction.armor + tier.armor + sub.armor` |
| Damage per second | `attack / faction.interval` |
| March speed | `march.speed (60) × faction.move × sub.move × tierSpeed` (1 / 1.15 / 1.3), an army moves at its slowest group |

**Damage.** One routine (`fight`) resolves both road battles and sieges. Each
step, every group deals `soldiers × dps × combat.speed (3.2) × dt`, split across
all hostile groups in the battle in proportion to their head count. The target
takes `damage × (1 − armor / (armor + 20))`. All damage is computed from the
state at the start of the step and then applied, so the outcome does not depend
on processing order. A group's soldier count is its remaining health divided by
per-soldier health, rounded up; wounded survivors stay wounded.

**City battles** use the same routine with explicit modifiers on the garrison's
side only: a wall bonus (damage taken −0% / −10% / −20% at level 1 / 2 / 3) and,
for Meridian level-3 cities, a shield that soaks damage first.

**Combat power** (shown in the HUD next to the soldier count) is
`Σ (health / per-soldier health) × rating`, where
`rating = sqrt(dps × health / (1 − armor mitigation))`, normalised so a neutral
tier-1 soldier is 1.00. It follows health and tier, not head count: ten
half-dead soldiers are worth five healthy ones. It does not include situational
effects (walls, fields, tier-3 traits, buffs), which are shown separately.

| Rating | Tier 1 | Tier 2 | Tier 3 |
| --- | --- | --- | --- |
| Iron Pact (Bastion / Storm Works) | 1.19 / 1.19 | 1.79 / 1.79 | 2.55 / 2.56 |
| Meridian Alliance (Shade / Aegis) | 1.10 / 1.12 | 1.65 / 1.67 | 2.34 / 2.38 |
| Veil Collective (Dominion / Forge) | 0.95 / 0.95 | 1.44 / 1.44 | 2.05 / 2.05 |
| Neutral garrisons | 1.00 | 1.51 | 2.15 |

**Tiers.** Tier 2 = ×1.5 health, ×1.4 attack, +2 armor. Tier 3 = ×2.1 health,
×1.9 attack, +4 armor, plus one bounded trait:

- Iron: +15% damage when the enemy side has 10 or more soldiers.
- Meridian: treats the target's armor as 70%.
- Veil: enemies in the same battle deal 8% less damage (does not stack).

**Economy.** A city produces `level.prod × faction.prod` soldiers per second
(0.5 / 0.9 / 1.4 by level) until its garrison reaches the production threshold
(20 / 40 / 70). The threshold only pauses production: reinforcements, granted
troops and phase-dispatch arrivals may push a garrison above it and nothing is
ever clamped. Upgrades cost 12 and 25 soldiers. Stacked production bonuses are
capped at ×1.6.

## Factions

| | Iron Pact | Meridian Alliance | Veil Collective |
| --- | --- | --- | --- |
| Tier-1 soldier | 120 hp, 12 atk / 1.2 s, armor 5 | 100 hp, 10 atk / 1.0 s, armor 7 | 90 hp, 9 atk / 1.0 s, armor 4 |
| March speed | ×0.90 | ×1.15 | ×1.00 |
| Production | ×0.98 | ×1.00 | ×1.125 |
| Identity | durability and firepower, slow | mobility, reinforcement, defence | control and conversion, fragile |

**Iron Pact.** Strongest soldier for soldier (about 8% above Meridian and 25%
above Veil in rating) and the only faction whose cities shoot back.
*Weak to:* being out-run. It reaches neutral cities last, reinforces slowly and
cannot disengage. *Counter it by* expanding faster, hitting where its armies are
not, and slowing or weakening the one big column it relies on.

**Meridian Alliance.** Fastest (15% over Veil, 28% over Iron), best armor, and
the only faction that can add troops instantly or move them without marching.
*Weak to:* straight fights at equal numbers against Iron, and conversion (its
soldiers are valuable to steal). *Counter it by* forcing battles at its cities
rather than chasing its armies, and by keeping it below three level-3 cities.

**Veil Collective.** Weakest soldier, compensated by 12.5% faster production, by
fields that weaken attackers and by turning enemy troops. *Weak to:* early
aggression before its fields exist, and area damage on its cheap, numerous
garrisons. *Counter it by* attacking with several small armies (conversion is
capped per army and needs survivors) and by sending already-converted troops,
which can never be converted again.

### Subfactions

Modest and stat-only, so that the choice is a lean rather than a different game.

| Subfaction | Difference |
| --- | --- |
| Iron / Bastion Guard | +1.5 armor, ×0.97 speed |
| Iron / Storm Works | ×1.06 attack |
| Meridian / Shade Corps | ×1.05 speed |
| Meridian / Aegis Division | +1 armor |
| Veil / Dominion Choir | +1 to every conversion cap (+2 on the superweapon), ×1.05 attack |
| Veil / Graft Forge | ×1.05 health |

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

## Global skills

Two basic skills and one superweapon per faction. Basic skills start on a 20 s
cooldown. No skill ever harms the caster's own troops.

| Faction | Skill | Effect | Cooldown |
| --- | --- | --- | --- |
| Iron | War Mobilization | +40% production for 12 s (thresholds still apply) | 75 s |
| Iron | Artillery Barrage | After 1.6 s, each hostile army and garrison within 70 loses `25% of its health + 40`, at most 260 | 90 s |
| Iron | Superweapon strike | After 4 s, each hostile army and garrison within 120 loses `50% + 80`, at most 900; the area then deals 25/s for 6 s | 240 s |
| Meridian | Emergency Reinforcements | +10 tier-1 soldiers in one friendly city (may exceed the threshold) | 75 s |
| Meridian | Rapid March | Friendly armies ×1.25 speed for 10 s; armies sent later get the time remaining | 90 s |
| Meridian | Phase Dispatch | Instantly move up to 40 soldiers (dispatch % applies) from one friendly city to any other city. Friendly target: reinforce. Hostile target: they arrive as a besieging army and a normal city battle starts; walls, shields and abilities all apply | 240 s |
| Veil | Psychic Shock | Hostile armies within 110: ×0.6 speed and ×0.7 attack for 6 s | 75 s |
| Veil | Mind Leech | Convert 25% of one hostile marching army, at most 8, leaving at least 3 | 90 s |
| Veil | Superweapon pulse | After 3 s, within 130: convert 30% of each hostile marching army, 24 in total, leaving at least 2 each; hostile garrisons lose 30% health, at most 400, and always keep a defender | 240 s |

**Superweapons** need three level-3 cities at the moment the cast is accepted.
Charge accrues only while that holds: 120 s before the first cast, then the full
240 s. Losing a level-3 city pauses the charge; regaining it resumes from the
same point. A refused cast (not ready, bad target, too few troops) costs nothing.
None of them captures a city: they remove or turn troops, and a city still falls
only to an army that arrives and wins the battle.

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

`node test/balance.js 40` — seeded AI-vs-AI matches. Each 2-player pairing is
played twice per seed on the same map with the seats swapped, and subfactions
rotate with the seed so every sub-vs-sub combination is sampled. A match with no
winner after 1500 simulated seconds counts as a draw and is excluded from the
percentages. With 80 matches per cell the standard error is about 5.6 points,
so a result between roughly 44% and 56% is not distinguishable from even.

Final values, 40 seeds (80 matches per pairing cell, 120 per free-for-all).
Percentages are the first-named side's share of decided matches.

**Hard AI**

| Pairing | Crates off | Crates on | Draws (off / on) | Avg length |
| --- | --- | --- | --- | --- |
| Iron vs Meridian | 48.8% – 51.3% | 52.5% – 47.5% | 0 / 0 | 231 s / 240 s |
| Iron vs Veil | 57.0% – 43.0% | 52.6% – 47.4% | 1 / 2 | 286 s / 299 s |
| Meridian vs Veil | 60.0% – 40.0% | 56.3% – 43.8% | 0 / 0 | 223 s / 237 s |

**Normal AI**

| Pairing | Crates off | Crates on | Draws (off / on) | Avg length |
| --- | --- | --- | --- | --- |
| Iron vs Meridian | 40.0% – 60.0% | 48.8% – 51.3% | 0 / 0 | 304 s / 300 s |
| Iron vs Veil | 46.3% – 53.8% | 41.8% – 58.2% | 0 / 1 | 369 s / 386 s |
| Meridian vs Veil | 36.3% – 63.8% | 46.3% – 53.8% | 0 / 0 | 290 s / 308 s |

**Subfaction against subfaction, same faction (hard AI)**

| Mirror | Crates off | Crates on |
| --- | --- | --- |
| Iron: Bastion vs Storm Works | 51.3% – 48.8% | 42.5% – 57.5% |
| Meridian: Shade vs Aegis | 51.3% – 48.8% | 48.8% – 51.3% |
| Veil: Dominion vs Forge | 55.0% – 45.0% | 53.2% – 46.8% |

**3-player free-for-all, one of each faction, seats rotated (hard AI; even would be 33.3%)**

| | Iron | Meridian | Veil |
| --- | --- | --- | --- |
| Crates off | 30.8% | 40.0% | 29.2% |
| Crates on | 35.8% | 34.2% | 30.0% |

Seat 0 won 43–49% of hard-AI pairings and 35–44% of normal-AI pairings, so the
second seat has a small edge on these maps; swapping seats cancels it in the
tables above.

What the numbers do and do not show:

- **Iron vs Meridian is even** under the hard AI (48.8% and 52.5%). Under the
  normal AI with crates off Meridian leads 60–40.
- **Veil depends on who is playing it.** With the hard AI it is behind both
  others (40–47%); with the normal AI it is ahead of both (54–64%). No single
  production multiplier fixes both: 1.12 and 1.13 were also run in full and
  simply move the imbalance from one AI level to the other (see below). The
  shipped value is the midpoint.
- Of the twelve pairing cells, six fall inside 45–55% and eleven inside
  40–60% (two of those exactly on the edge: Meridian vs Veil 60–40 for the
  hard AI and Iron vs Meridian 40–60 for the normal AI, both without crates).
  One is outside: Meridian vs Veil at 36–64 for the normal AI without crates.
- **Crates** move pairings by up to 8 points and tend to pull results toward
  even; they do not consistently favour one faction.
- **Free-for-all:** Meridian wins 40% without crates, above an even 33%.
- 4 of 480 hard-AI pairing matches and 2 of 480 normal-AI matches were draws.

`node test/sim.test.js` separately covers the rules themselves (dispatch,
conservation, thresholds, interception, damage, abilities, skills, crates,
statistics, determinism).

## Adjustments from the starting values

Per-soldier stats, tier multipliers, ability and skill numbers are the proposed
starting values; only the following were changed, each after a harness run.

| Value | Start | Final | Why |
| --- | --- | --- | --- |
| `factions.iron.prod` | 0.95 | 0.98 | Iron lost to Meridian 31–38% at the starting values; a first over-correction to 1.00 (with Meridian at 0.92) gave Iron 92%, so it was walked back. |
| `factions.meridian.prod` | 1.00 | 1.00 | Tried 0.92 (Meridian 8–13%) and 0.985 (40% vs Iron, 25% vs Veil); returned to 1.00 once the others had moved. |
| `factions.veil.prod` | 1.12 | 1.125 | 1.14 and 1.13 put Veil ahead for the normal AI (54–59%); 1.12 put it far behind for the hard AI (37–39% without crates). 1.125 splits the difference. |
| `skills.meridian[0].amount` (Emergency Reinforcements) | 12 | 10 | Twelve soldiers every 75 s was worth about 24 s of a level-1 city's output and fed Meridian's early lead. |
| `factions.veil.subs.dominion` | `convert: 1` | `convert: 1, atk: 1.05` | Dominion won 38–40% of its matches against Forge's 54–56%: an extra conversion cap alone is worth much less than Forge's health. |
| `factions.veil.subs.forge.hp` | 1.06 | 1.05 | Same reason, from the other side. The mirror is now 55–45 and 53–47 in Dominion's favour, within noise. |

Starting-value results for reference (hard AI, 12 seeds, crates off / on):
Iron vs Meridian 37.5% / 25.0%, Iron vs Veil 37.5% / 52.2%, Meridian vs Veil
70.8% / 66.7%.

Production turned out to be by far the most sensitive lever: between two AIs of
equal skill, 1% of production moves a pairing by about 5 points. That is why the
final multipliers differ by so little, and why they should be re-checked after
any change to unit stats.

## Re-running and tuning

```bash
node test/sim.test.js                       # rules still hold
node test/balance.js 40                     # full report, about 3 minutes
node test/balance.js 30 --quick             # pairings only, about 50 seconds
node test/balance.js 40 --quick --level=normal
```

1. Change one number in `game/config.js`.
2. Run the quick pass; look at the three pairings with crates off and on.
3. If a faction is ahead everywhere, lower its `prod` by 0.01 (about 5 points)
   rather than touching its soldiers, which define how it feels.
4. Finish with the full report and the normal-AI pass, and update the tables here.

## Remaining uncertainties

- **AI is not a person.** Both sides use the same heuristics. It does not feint,
  bait a turret, split armies to dodge conversion, or save a superweapon for the
  decisive moment. Skills with high ceilings in human hands (Phase Dispatch,
  Mind Leech, a well-placed barrage) are probably undervalued here.
- **Free-for-alls** are noisier and reward mobility: Meridian wins 40% of
  3-player games without crates.
- **Crates** shift some pairings by a few points (faster armies reach them
  first); the with-crates tables are the ones to watch if rewards are changed.
- **Subfactions** were only tested as stat leans. Storm Works beats Bastion
  57–43 with crates on, which may be noise (it is 49–51 without them).
- **Veil's level-dependence** is the largest open issue: its control tools
  are used better by the slower, more defensive normal AI than by the hard AI,
  and people will differ from both.
- **Team play, larger maps and human reaction time** were not tested at all.
- A few AI-only matches reach the time limit without a winner (reported as
  draws); evenly matched bots can trade cities indefinitely.
