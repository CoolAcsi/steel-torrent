'use strict';
// Real time -> simulation steps.
//
// The simulation only ever advances in fixed steps of `dt` simulation seconds.
// Game speed changes how many of those steps fit into a second of real time,
// never the size of a step, so movement, interception, combat and timers behave
// identically at every speed: a faster game is the same game, played sooner.
// Pausing accrues nothing, so there is nothing to catch up on afterwards.

class Pace {
  /** @param dt simulation seconds per step  @param speed simulation seconds per real second */
  constructor(dt, speed = 1) {
    this.dt = dt;
    this.speed = speed;
    this.acc = 0;               // simulation time owed but not yet stepped (always less than one step)
  }

  /** Change speed. Time already owed is kept, so no step is lost or repeated. */
  setSpeed(speed) { this.speed = speed; }

  /**
   * How many steps to run for `real` seconds of wall-clock time.
   * A long gap (a stalled process, a suspended laptop) is capped rather than replayed.
   */
  advance(real, paused = false) {
    if (paused || !(real > 0)) return 0;
    this.acc += Math.min(real, 0.25) * this.speed;
    const n = Math.floor(this.acc / this.dt + 1e-9);
    this.acc -= n * this.dt;
    return n;
  }
}

module.exports = { Pace };
