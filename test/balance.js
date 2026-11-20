'use strict';
// Balance harness: seeded AI-vs-AI matches, with starting positions swapped.
//
//   node test/balance.js                 30 seeds, hard AI
//   node test/balance.js 60              60 seeds
//   node test/balance.js 40 --level=normal
//   node test/balance.js 20 --level=both --quick     (skip 3-player and mirror passes)
//
// Every 2-player pairing is played twice per seed on the same map: once with
// each faction in each seat, so a lucky start cancels out. Subfactions rotate
// with the seed so every sub-vs-sub combination is sampled. A match that has
// no winner after LIMIT simulated seconds counts as a draw.
//
// Read the result as a diagnostic, not proof: both sides are driven by the
// same AI, which does not play like a person (see docs/BALANCE.md).
const { Game } = require('../game/sim');
const { FACTIONS } = require('../game/config');

const args = process.argv.slice(2);
const SEEDS = parseInt(args.find(a => /^\d+$/.test(a)) || '30', 10);
const LEVEL = (args.find(a => a.startsWith('--level=')) || '--level=hard').split('=')[1];
const QUICK = args.includes('--quick');
const LIMIT = 1500;
const DT = 0.05;
const IDS = Object.keys(FACTIONS);

function play(players, seed, crates, level) {
  const g = new Game(players.map(p => ({ ai: level, faction: p.f, sub: p.sub })), seed, { crates });
  while (g.winner === null && g.t < LIMIT) g.tick(DT);
  return { winner: g.winner === null ? -1 : g.winner, t: g.t, report: g.winner === null ? null : g.report() };
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
const subOf = (f, k) => FACTIONS[f][k % FACTIONS[f].length];

function pairings(level, crates) {
  const rows = [], bySub = {};
  const note = (key, won, drawn) => {
    const s = bySub[key] || (bySub[key] = { games: 0, wins: 0, draws: 0 });
    s.games++;
    if (won) s.wins++;
    if (drawn) s.draws++;
  };
  for (let i = 0; i < IDS.length; i++) {
    for (let j = i + 1; j < IDS.length; j++) {
      const X = IDS[i], Y = IDS[j];
      let wx = 0, wy = 0, draws = 0, time = 0, seat0 = 0, n = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const px = { f: X, sub: subOf(X, seed) }, py = { f: Y, sub: subOf(Y, seed >> 1) };
        for (const order of [[px, py], [py, px]]) {
          const r = play(order, 1000 + seed * 7919, crates, level);
          n++;
          time += r.t;
          const w = r.winner < 0 ? null : order[r.winner];
          if (!w) draws++; else if (w === px) wx++; else wy++;
          if (r.winner === 0) seat0++;
          note(`${px.f}/${px.sub}`, w === px, !w);
          note(`${py.f}/${py.sub}`, w === py, !w);
        }
      }
      rows.push({
        matchup: `${X} vs ${Y}`, games: n, [X]: 0, first: pct(wx, n - draws), second: pct(wy, n - draws),
        draws, 'seat-0 wins': pct(seat0, n - draws), 'avg length s': Math.round(time / n),
      });
      delete rows[rows.length - 1][X];
    }
  }
  return { rows, bySub };
}

function mirrors(level, crates) {
  const rows = [];
  for (const f of IDS) {
    const [a, b] = FACTIONS[f];
    let wa = 0, wb = 0, draws = 0, n = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const pa = { f, sub: a }, pb = { f, sub: b };
      for (const order of [[pa, pb], [pb, pa]]) {
        const r = play(order, 5000 + seed * 104729, crates, level);
        n++;
        if (r.winner < 0) draws++; else if (order[r.winner] === pa) wa++; else wb++;
      }
    }
    rows.push({ mirror: `${f}: ${a} vs ${b}`, games: n, first: pct(wa, n - draws), second: pct(wb, n - draws), draws });
  }
  return rows;
}

function freeForAll(level, crates) {
  const wins = Object.fromEntries(IDS.map(f => [f, 0]));
  let draws = 0, n = 0, time = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    for (let rot = 0; rot < IDS.length; rot++) {
      const order = IDS.map((_, k) => IDS[(k + rot) % IDS.length]).map(f => ({ f, sub: subOf(f, seed + rot) }));
      const r = play(order, 9000 + seed * 15485863, crates, level);
      n++;
      time += r.t;
      if (r.winner < 0) draws++; else wins[order[r.winner].f]++;
    }
  }
  return { games: n, ...Object.fromEntries(IDS.map(f => [f, pct(wins[f], n - draws)])), draws, 'avg length s': Math.round(time / n) };
}

const started = Date.now();
for (const level of LEVEL === 'both' ? ['hard', 'normal'] : [LEVEL]) {
  for (const crates of [false, true]) {
    const tag = `${level} AI, crates ${crates ? 'on' : 'off'}, ${SEEDS} seeds`;
    const { rows, bySub } = pairings(level, crates);
    console.log(`\n== 2-player pairings, seats swapped (${tag}) ==`);
    console.table(rows);
    console.log('   win rate of each subfaction across those matches');
    console.table(Object.entries(bySub).map(([sub, s]) => ({ subfaction: sub, games: s.games, wins: pct(s.wins, s.games - s.draws), draws: s.draws })));
    if (QUICK) continue;
    console.log(`== same faction, subfaction vs subfaction (${tag}) ==`);
    console.table(mirrors(level, crates));
    console.log(`== 3-player free-for-all, one of each faction, seats rotated (${tag}) ==`);
    console.table([freeForAll(level, crates)]);
  }
}
console.log(`\n${((Date.now() - started) / 1000).toFixed(1)} s`);
