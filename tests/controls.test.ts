import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../src/game/engine/MatchEngine';
import { emptyInput, type InputState } from '../src/game/engine/types';
import { isThree, dist } from '../src/game/engine/geometry';
import { fixtureConfig } from './fixtures';

const STEP = 1 / 60;
function run(e: MatchEngine, secs: number, input: Partial<InputState> = {}) {
  for (let t = 0; t < secs; t += STEP) e.update(STEP, { ...emptyInput(), ...input });
}
/** Move the user's handler toward a target spot using stick input. */
function moveTo(e: MatchEngine, x: number, z: number, max = 6) {
  for (let t = 0; t < max; t += STEP) {
    const u = e.user!;
    const dx = x - u.x, dz = z - u.z, d = Math.hypot(dx, dz);
    if (d < 1) break;
    e.update(STEP, { ...emptyInput(), mx: dx / d, mz: dz / d });
  }
}
/** Hold shoot and release at the meter's sweet spot. */
function shootJumper(e: MatchEngine) {
  e.update(STEP, { ...emptyInput(), shoot: true });
  let guard = 0;
  while (e.user!.charging >= 0 && e.user!.charging < 0.78 && guard++ < 200) e.update(STEP, { ...emptyInput(), shoot: true });
  e.update(STEP, emptyInput());
}
const practice = (seed: number) => new MatchEngine(fixtureConfig(seed, { userSide: 0, mode: 'practice', difficulty: 'rookie' }));

describe('user controls (keyboard/touch produce the same InputState)', () => {
  it('scores a three-pointer and a two with timed jumpers', () => {
    let threes = 0, twos = 0;
    for (let seed = 1; seed < 40 && (threes === 0 || twos === 0); seed++) {
      const e = practice(seed);
      const rim = e.basket(0);
      const want3 = threes === 0;
      moveTo(e, rim.x - 25, 25);
      if (!want3) moveTo(e, rim.x - 15, 25);
      if (e.ball.holder !== e.user) continue;
      expect(isThree(e.user!, e.dir(0))).toBe(want3);
      const before = e.score[0];
      shootJumper(e);
      run(e, 2.5);
      const gained = e.score[0] - before;
      if (gained === 3) threes++;
      if (gained === 2) twos++;
    }
    expect(threes).toBeGreaterThan(0);
    expect(twos).toBeGreaterThan(0);
  });

  it('drives for a layup or dunk near the rim', () => {
    let made = 0;
    for (let seed = 1; seed < 30 && !made; seed++) {
      const e = practice(seed);
      const rim = e.basket(0);
      moveTo(e, rim.x - 4, 25, 8);
      if (e.ball.holder !== e.user || dist(e.user!, rim) > 6.5) continue;
      e.update(STEP, { ...emptyInput(), shoot: true });
      expect(['layup', 'dunk']).toContain(e.user!.chargeKind);
      const before = e.score[0];
      run(e, 2.5);
      if (e.score[0] - before === 2) made++;
    }
    expect(made).toBeGreaterThan(0);
  });

  it('shoots free throws with the meter and the box score reconciles', () => {
    const e = new MatchEngine(fixtureConfig(3, { userSide: 0 }));
    run(e, 3);
    const shooter = e.onCourt(0)[0];
    (e as any).startFreeThrows(shooter, 2);
    expect(e.phase).toBe('freeThrow');
    for (let k = 0; k < 2; k++) {
      run(e, 0.5);
      e.update(STEP, { ...emptyInput(), shoot: true });
      let g = 0;
      while (shooter.charging >= 0 && shooter.charging < 0.78 && g++ < 200) e.update(STEP, { ...emptyInput(), shoot: true });
      e.update(STEP, emptyInput());
      run(e, 1.6);
    }
    const line = e.box.get(shooter.id)!;
    expect(line.fta).toBe(2);
    expect(line.points).toBe(line.ftm);
    expect(e.score[0]).toBe([...e.box.values()].filter((l) => e.actor(l.playerId)!.side === 0).reduce((s, l) => s + l.points, 0));
  });

  it('passes to the targeted teammate and switches control to him', () => {
    const e = practice(5);
    run(e, 0.2);
    const first = e.user!;
    e.update(STEP, { ...emptyInput(), pass: true, switchPlayer: true });
    run(e, 1.5);
    expect(e.ball.holder).not.toBe(first);
    expect(e.ball.holder?.side).toBe(0);
    expect(e.user).toBe(e.ball.holder);
  });

  it('defender can steal or contest, and full CPU games keep reconciling at every difficulty', () => {
    for (const difficulty of ['rookie', 'legend'] as const) {
      const e = new MatchEngine(fixtureConfig(11, { difficulty, quarterMinutes: 1 }));
      e.runToEnd();
      const b = e.toBoxScore('x');
      const pts = (l: typeof b.home) => l.reduce((s, x) => s + x.points, 0);
      expect(pts(b.home)).toBe(b.homeScore);
      expect(pts(b.away)).toBe(b.awayScore);
    }
    let steals = 0;
    for (let seed = 1; seed < 40 && !steals; seed++) {
      const e = new MatchEngine(fixtureConfig(seed, { userSide: 1 }));
      for (let t = 0; t < 40 && !steals; t += STEP) {
        const h = e.ball.holder, u = e.user;
        const inp = emptyInput();
        if (h && u && h.side === 0 && e.phase === 'live') {
          const dx = h.x - u.x, dz = h.z - u.z, d = Math.hypot(dx, dz);
          if (d > 2.5) { inp.mx = dx / d; inp.mz = dz / d; } else inp.action = true;
        }
        e.update(STEP, inp);
        steals = [...e.box.values()].filter((l) => e.actor(l.playerId)!.side === 1).reduce((s, l) => s + l.steals, 0);
      }
    }
    expect(steals).toBeGreaterThan(0);
  });
});
