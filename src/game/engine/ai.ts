import { clamp } from '../../core/rng';
import type { Difficulty } from '../../core/types';
import type { Actor } from './Actor';
import { COURT_LENGTH, COURT_WIDTH, HALF, dist, inFrontcourt, isThree, segDist, spot, type Vec } from './geometry';
import type { MatchEngine } from './MatchEngine';
import { makeProbability } from './shot';

export type Skill = {
  /** Seconds between ball-handler decisions. */
  think: number;
  /** Mean release-timing quality for CPU shots. */
  quality: number;
  /** Noise on the CPU's read of shot and pass values. */
  noise: number;
  stealSkill: number;
  stealRate: number;
  /** Defensive reaction delay before contesting. */
  react: number;
  intercept: number;
  speed: number;
};

/** Difficulty changes the CPU's decisions and execution only; it never adds points. */
export const DIFFICULTY: Record<Difficulty, Skill> = {
  rookie: { think: 0.5, quality: 0.58, noise: 0.32, stealSkill: 0.6, stealRate: 0.45, react: 0.45, intercept: 0.65, speed: 0.92 },
  pro: { think: 0.34, quality: 0.7, noise: 0.18, stealSkill: 0.85, stealRate: 0.75, react: 0.3, intercept: 0.9, speed: 0.97 },
  allstar: { think: 0.25, quality: 0.78, noise: 0.1, stealSkill: 1, stealRate: 1, react: 0.2, intercept: 1, speed: 1 },
  legend: { think: 0.18, quality: 0.85, noise: 0.05, stealSkill: 1.15, stealRate: 1.2, react: 0.12, intercept: 1.15, speed: 1.03 },
};

const NEUTRAL: Skill = { think: 0.28, quality: 0.74, noise: 0.12, stealSkill: 1, stealRate: 0.85, react: 0.22, intercept: 1, speed: 1 };

function skill(e: MatchEngine, a: Actor): Skill {
  if (e.cfg.userSide === null || a.side === e.cfg.userSide) return NEUTRAL;
  return DIFFICULTY[e.cfg.difficulty];
}

function clampTarget(a: Actor) {
  a.tx = clamp(a.tx, 1.2, COURT_LENGTH - 1.2);
  a.tz = clamp(a.tz, 1.2, COURT_WIDTH - 1.2);
}

function unit(from: Vec, to: Vec): Vec {
  const d = dist(from, to) || 1;
  return { x: (to.x - from.x) / d, z: (to.z - from.z) / d };
}

/** Expected points if player a shot from position `at` right now. */
export function shotEP(e: MatchEngine, a: Actor, at: Vec = a): number {
  const dir = e.dir(a.side);
  const rim = e.basket(a.side);
  const d = dist(at, rim);
  const big = a.info.position === 'C' || a.info.position === 'PF';
  const kind = d < 5.5 ? (a.r.athleticism >= 6 || a.heightFt >= 6.75 ? 'dunk' : 'layup') : big && d < 11 ? 'hook' : 'jumper';
  let cd = Infinity;
  let inFront = false;
  for (const o of e.onCourt((1 - a.side) as 0 | 1)) {
    const od = dist(at, o);
    if (od < cd) {
      cd = od;
      inFront = dist(o, rim) < d;
    }
  }
  const p = makeProbability({
    kind,
    distance: d,
    ratings: a.r,
    heightCm: a.info.heightCm,
    traits: a.info.traits,
    contestDist: cd,
    contestInFront: inFront,
    contestJumping: false,
    energy: a.energy,
    form: a.form,
    quality: 0.74,
    clutch: e.isClutch,
    fouled: false,
  });
  return p * (isThree(at, dir) ? 3 : 2);
}

/** 0..1 risk that a pass from `from` to `to` is picked off. */
function laneRisk(e: MatchEngine, from: Actor, to: Actor): number {
  let risk = 0;
  for (const o of e.onCourt((1 - from.side) as 0 | 1)) {
    const s = segDist(o, from, to);
    if (s.t < 0.1 || s.t > 0.95) continue;
    risk = Math.max(risk, clamp(1 - s.d / 2.6, 0, 1));
  }
  return risk + (dist(from, to) > 30 ? 0.2 : 0);
}

function laneOpen(e: MatchEngine, a: Actor): boolean {
  const rim = e.basket(a.side);
  for (const o of e.onCourt((1 - a.side) as 0 | 1)) {
    const s = segDist(o, a, rim);
    if (s.d < 2.6 && s.t > 0.05) return false;
  }
  return true;
}

/** Spacing spot for an offensive player by lineup slot and team tactics. */
export function offenseSpot(e: MatchEngine, a: Actor): Vec {
  const dir = e.dir(a.side);
  const t = e.teams[a.side].tactics;
  let s: Vec;
  switch (a.slot) {
    case 0:
      s = spot(dir, 25, -8);
      break;
    case 1:
      s = spot(dir, 24.3, 62);
      break;
    case 2:
      s = spot(dir, 22.6, -86);
      break;
    case 3:
      s = a.r.shooting >= 6 || t.threeRate >= 4 ? spot(dir, 24, -48) : spot(dir, 15, -60);
      break;
    default:
      if (a.r.shooting >= 7 && t.threeRate >= 4) s = spot(dir, 23.4, 86);
      else s = t.postUps >= 3 ? spot(dir, 10, 52) : spot(dir, 6.5, 78);
  }
  return s;
}

export function aiBallHandler(e: MatchEngine, a: Actor, dt: number) {
  if (a.charging >= 0 || a.busy) return;
  const sk = skill(e, a);
  const t = e.teams[a.side].tactics;
  const dir = e.dir(a.side);
  const rim = e.basket(a.side);
  const dRim = dist(a, rim);
  const front = inFrontcourt(a, dir);
  const rng = e.rng;

  if (a.driveT > 0) {
    a.driveT -= dt;
    a.tx = rim.x - dir * 1.5;
    a.tz = rim.z;
    a.wantSprint = true;
    if (dRim < 4.8) {
      e.beginShot(a);
      return;
    }
  }

  a.thinkT -= dt;
  if (a.thinkT > 0) {
    clampTarget(a);
    return;
  }
  a.thinkT = sk.think * rng.range(0.8, 1.25);
  const mates = e.onCourt(a.side).filter((m) => m !== a);
  const noisy = (v: number) => v * (1 + rng.normal(0, sk.noise));
  const gameClockLeft = e.clock / e.clockScale * e.shotScale; // game-clock in shot-clock seconds
  const timeLeft = Math.min(e.shotClock, e.quarter >= 1 ? gameClockLeft : 99);
  const late = timeLeft < 3.5;

  if (late && timeLeft < 2 && dRim < 40) {
    e.beginShot(a);
    return;
  }
  if (!front) {
    a.tx = rim.x - dir * 24;
    a.tz = clamp(a.z + rng.range(-6, 6), 12, 38);
    const defendersBack = e.onCourt((1 - a.side) as 0 | 1).filter((o) => dist(o, rim) < dist(a, rim)).length;
    a.wantSprint = t.pace >= 4 || defendersBack <= 2;
    const ahead = mates
      .filter((m) => inFrontcourt(m, dir) && dist(m, rim) + 12 < dRim && e.openness(m) > 7)
      .sort((m, n) => dist(m, rim) - dist(n, rim))[0];
    if (ahead && laneRisk(e, a, ahead) < 0.3 && rng.chance(0.5)) e.passTo(a, ahead);
    clampTarget(a);
    return;
  }

  let own = noisy(shotEP(e, a));
  if (isThree(a, dir)) own *= 0.88 + t.threeRate * 0.04;
  const lateFactor = clamp(timeLeft / 16, 0.35, 1);
  const thresh = (0.92 - (t.pace - 3) * 0.03) * lateFactor;

  let best: Actor | null = null;
  let bestVal = -Infinity;
  for (const m of mates) {
    let v = noisy(shotEP(e, m));
    if (m.cutting > 0) v += 0.08;
    if (isThree(m, dir)) v *= 0.88 + t.threeRate * 0.04;
    if (m.info.position === 'C' && t.postUps >= 4 && dist(m, rim) < 12) v += 0.08;
    v -= laneRisk(e, a, m) * 1.4;
    if (v > bestVal) {
      bestVal = v;
      best = m;
    }
  }

  if (dRim < 5) {
    if (best && bestVal > own + 0.45) e.passTo(a, best);
    else e.beginShot(a);
    return;
  }
  if (late) {
    if (dRim < 26 || timeLeft < 1.6) e.beginShot(a);
    else {
      a.tx = rim.x - dir * 20;
      a.tz = rim.z;
      a.wantSprint = true;
    }
    return;
  }
  if (own >= thresh && a.holdT > 0.45) {
    e.beginShot(a);
    return;
  }
  if (best && bestVal > Math.max(own, thresh * 0.85) + 0.05 && a.holdT > 0.35) {
    e.passTo(a, best);
    return;
  }
  if (best && a.holdT > 4.5 && bestVal > 0.6) {
    e.passTo(a, best);
    return;
  }
  const driveSkill = (a.r.finishing + a.r.dribbling + a.r.athleticism - 15) * 0.03;
  if (dRim > 7 && laneOpen(e, a) && rng.chance(clamp(0.3 + driveSkill, 0.1, 0.7))) {
    a.driveT = 1.6;
    return;
  }
  if (rng.chance(t.pickAndRoll * 0.06) && !mates.some((m) => m.screenT > 0)) {
    e.callScreen(a);
    return;
  }
  const big = a.info.position === 'C' || a.info.position === 'PF';
  if (big && t.postUps >= 3 && dRim < 18) {
    const u = unit(a, rim);
    a.tx = a.x + u.x * 3;
    a.tz = a.z + u.z * 3;
    clampTarget(a);
    return;
  }
  // Probe: shooters relocate beyond the arc, others attack the paint, then read the defence again.
  const shooter = a.r.shooting >= 6 || t.threeRate >= 4;
  const p = shooter && rng.chance(0.6) ? spot(dir, rng.range(24.5, 26), rng.range(-75, 75)) : spot(dir, rng.range(9, 16), rng.range(-60, 60));
  a.tx = p.x;
  a.tz = p.z;
  clampTarget(a);
}

export function aiOffBall(e: MatchEngine, a: Actor, dt: number) {
  const dir = e.dir(a.side);
  const b = e.ball;
  const holder = b.holder;
  if (b.state === 'pass' && b.pass && b.pass.to === a) {
    a.tx = b.pass.ex;
    a.tz = b.pass.ez;
    a.wantSprint = true;
    return;
  }
  if (e.phase === 'inbound' && e.inbound?.receiver === a) return;

  if (a.screenT > 0 && holder && holder.side === a.side && holder !== a) {
    const def = e.onCourt((1 - a.side) as 0 | 1).find((o) => o.assignment === holder) ?? e.nearestOpponent(holder).opp;
    if (a.screenSet > 0) {
      a.screenSet -= dt;
      a.tx = a.x;
      a.tz = a.z;
      a.vx = a.vz = 0;
      if (a.screenSet <= 0) {
        a.screenT = 0;
        a.cutting = 1.8; // roll to the rim
      }
      return;
    }
    const toward = def ? unit(holder, def) : unit(holder, e.basket(a.side));
    a.tx = holder.x + toward.x * 2.6;
    a.tz = holder.z + toward.z * 2.6;
    a.wantSprint = true;
    if (Math.hypot(a.x - a.tx, a.z - a.tz) < 1.3) a.screenSet = 1.1;
    clampTarget(a);
    return;
  }
  a.screenSet = 0;

  if (a.cutting > 0) {
    const rim = e.basket(a.side);
    a.tx = rim.x - dir * 3.5;
    a.tz = rim.z + (a.slot % 2 ? 3 : -3);
    a.wantSprint = true;
    clampTarget(a);
    return;
  }

  const s = offenseSpot(e, a);
  a.cutT -= dt;
  if (a.cutT <= 0) {
    const pace = e.teams[a.side].tactics.pace;
    a.cutT = e.rng.range(5, 10) / (0.7 + pace * 0.1);
    if (holder && holder.side === a.side && inFrontcourt(holder, dir) && a.slot !== 4 && e.rng.chance(0.55)) {
      a.cutting = 1.7;
    }
  }
  // Don't crowd the ball handler.
  if (holder && holder !== a && dist(s, holder) < 7) {
    const away = unit(holder, s);
    s.x = holder.x + away.x * 9;
    s.z = holder.z + (away.z || 1) * 9;
  }
  a.tx = s.x;
  a.tz = s.z;
  a.wantSprint = dist(a, s) > 14;
  clampTarget(a);
}

export function aiDefense(e: MatchEngine, a: Actor, dt: number) {
  const sk = skill(e, a);
  const offSide = (1 - a.side) as 0 | 1;
  const rim = e.basket(offSide);
  const b = e.ball;
  const t = e.teams[a.side].tactics;
  let man = a.assignment;
  if (!man || !man.onCourt) {
    e.assignDefense();
    man = a.assignment;
  }
  if (!man) return;
  const holder = b.holder && b.holder.side === offSide ? b.holder : b.state === 'pass' && b.pass ? b.pass.to : null;
  const manHasBall = holder === man;
  const backcourt = holder ? !inFrontcourt(holder, e.dir(offSide)) : false;
  const manRim = dist(man, rim);

  let gap: number;
  if (manHasBall) {
    gap = 3.7 - t.defAggression * 0.15 + (man.r.shooting <= 4 ? 1.8 : 0) + (manRim > 30 ? 3 : 0);
  } else {
    gap = 4 + Math.min(8, dist(man, b) * 0.22);
  }
  gap = Math.min(gap, Math.max(1, manRim - 1));
  const seen = { x: man.seenX, z: man.seenZ };
  const u = unit(seen, rim);
  let target: Vec = { x: seen.x + u.x * gap, z: seen.z + u.z * gap };
  if (backcourt && !manHasBall) {
    const dToRim = Math.min(dist(target, rim), 30);
    const ru = unit(rim, target);
    target = { x: rim.x + ru.x * dToRim, z: rim.z + ru.z * dToRim };
  }

  // Help defence: when a driver beats his man, the nearest big rotates over.
  if (holder && !manHasBall && dist(holder, rim) < 13) {
    const hDef = e.onCourt(a.side).find((d) => d.assignment === holder);
    const beaten = !hDef || dist(hDef, rim) > dist(holder, rim) + 1;
    if (beaten) {
      const helpers = e
        .onCourt(a.side)
        .filter((d) => d !== hDef)
        .sort((p, q) => helpScore(p, holder, rim) - helpScore(q, holder, rim));
      if (helpers[0] === a) {
        const hu = unit(holder, rim);
        target = { x: holder.x + hu.x * 2.5, z: holder.z + hu.z * 2.5 };
      }
    }
  }

  a.tx = target.x;
  a.tz = target.z;
  a.wantSprint = dist(a, target) > 5;
  clampTarget(a);

  // Contest shots: close out and jump after a short reaction delay.
  const shooter = holder && holder.charging >= 0 ? holder : null;
  if (shooter && dist(a, shooter) < 7 && (shooter === man || dist(a, shooter) < 4.5)) {
    const close = shooter === man ? Math.max(2.6, gap - 0.8) : 2.2;
    a.tx = shooter.x + u.x * close;
    a.tz = shooter.z + u.z * close;
    a.wantSprint = true;
    if (a.jumpDelay < 0) a.jumpDelay = sk.react * e.rng.range(0.7, 1.4) + (shooter.chargeKind === 'jumper' ? 0.15 : 0);
  }
  if (a.jumpDelay >= 0) {
    a.jumpDelay -= dt;
    if (a.jumpDelay < 0) {
      if (shooter && dist(a, shooter) < 5) e.jump(a);
      a.jumpDelay = -1;
    }
  }

  // On-ball pressure.
  if (manHasBall && b.holder === man && dist(a, man) < 3.6 && a.stealCd <= 0) {
    a.thinkT -= dt;
    if (a.thinkT <= 0) {
      a.thinkT = 0.45;
      if (e.rng.chance(sk.stealRate * (0.035 + t.defAggression * 0.012))) e.attemptSteal(a);
    }
  }
}

function helpScore(d: Actor, holder: Actor, rim: Vec) {
  const big = d.info.position === 'C' ? -4 : d.info.position === 'PF' ? -2 : 0;
  return segDist(d, holder, rim).d + big - d.r.defense * 0.3;
}

export function aiRebound(e: MatchEngine, a: Actor, _dt: number) {
  const b = e.ball;
  const shootingSide = b.state === 'shot' && b.shot ? b.shot.shooter.side : e.possession;
  const dir = e.dir(shootingSide);
  const rim = e.basket(shootingSide);
  const t = e.teams[a.side].tactics;
  if (b.state === 'shot') {
    if (a.side === shootingSide) {
      const crash = a.slot >= 3 || (t.rebounding >= 4 && a.slot >= 2) || a.info.traits.includes('High Motor');
      if (crash) {
        const u = unit(rim, a);
        a.tx = rim.x + u.x * 4.5;
        a.tz = rim.z + u.z * 4.5;
        a.wantSprint = true;
      } else if (a.slot <= 1 && t.rebounding <= 3) {
        a.tx = HALF - dir * 6;
        a.tz = 25 + (a.slot ? 8 : -8);
      }
    } else {
      const man = a.assignment;
      if (man) {
        const u = unit(rim, man);
        const d = clamp(dist(man, rim) - 2.2, 3.5, 13);
        a.tx = rim.x + u.x * d;
        a.tz = rim.z + u.z * d;
        a.wantSprint = dist(a, { x: a.tx, z: a.tz }) > 4;
      }
    }
    clampTarget(a);
    return;
  }
  // Loose ball: the two nearest players on each side chase the landing spot.
  const fallT = (b.vh + Math.sqrt(Math.max(0, b.vh * b.vh + 2 * 32 * Math.max(0, b.h - 7)))) / 32;
  const land = { x: b.x + b.vx * fallT, z: b.z + b.vz * fallT };
  const mates = e.onCourt(a.side).sort((p, q) => dist(p, land) - dist(q, land));
  const rank = mates.indexOf(a);
  if (rank <= 1) {
    a.tx = land.x;
    a.tz = land.z;
    a.wantSprint = true;
    const hd = Math.hypot(a.x - b.x, a.z - b.z);
    if (hd < 3 && b.h > a.reach() && b.h < a.reach() + 3 && b.vh < 2) e.jump(a);
  } else if (a.side === shootingSide && a.slot <= 1) {
    a.tx = HALF - dir * 4;
    a.tz = 25;
  } else {
    a.tx = a.x;
    a.tz = a.z;
  }
  clampTarget(a);
}
