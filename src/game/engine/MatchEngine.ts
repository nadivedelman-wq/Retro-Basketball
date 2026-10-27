import { injuryTraitFactor, rollInjury } from '../../core/injuries';
import { Rng, clamp } from '../../core/rng';
import type { BoxLine, BoxScore, Injury, Position } from '../../core/types';
import { Actor } from './Actor';
import { aiBallHandler, aiDefense, aiOffBall, aiRebound, DIFFICULTY } from './ai';
import {
  COURT_LENGTH,
  COURT_WIDTH,
  HALF,
  RIM_HEIGHT,
  basketFor,
  dist,
  inBounds,
  isThree,
  segDist,
  type Vec,
} from './geometry';
import { makeProbability, releaseQuality, type ShotKind } from './shot';
import type { EngineEvent, InputState, MatchConfig, MatchTeamInfo } from './types';

export type Phase = 'jumpball' | 'inbound' | 'live' | 'freeThrow' | 'dead' | 'timeout' | 'break' | 'final';

const GRAV = 32;
const PLAYER_R = 1.2;
const POS_ORDER: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const REG_QUARTER = 720;
const OT_PERIOD = 300;

type PassInfo = { from: Actor; to: Actor; t: number; dur: number; sx: number; sz: number; ex: number; ez: number; interceptor: Actor | null };
type ShotInfo = {
  shooter: Actor;
  kind: ShotKind;
  value: 1 | 2 | 3;
  made: boolean;
  t: number;
  dur: number;
  sx: number;
  sz: number;
  sh: number;
  tx: number;
  tz: number;
  arc: number;
  airball: boolean;
  fouledBy: Actor | null;
  sinking: boolean;
};

export type Ball = {
  x: number;
  z: number;
  h: number;
  vx: number;
  vz: number;
  vh: number;
  state: 'held' | 'pass' | 'shot' | 'loose' | 'dead';
  holder: Actor | null;
  pass: PassInfo | null;
  shot: ShotInfo | null;
  lastTouch: 0 | 1;
  reboundable: boolean;
  hitRim: boolean;
  pokedBy: Actor | null;
  pokedFrom: Actor | null;
  dribblePhase: number;
};

type FtState = { shooter: Actor; remaining: number; total: number; timer: number; inFlight: boolean };
type InboundState = { side: 0 | 1; inbounder: Actor; receiver: Actor; spot: Vec; timer: number; ready: boolean; afterMake: boolean };

export class MatchEngine {
  readonly cfg: MatchConfig;
  readonly rng: Rng;
  readonly teams: [MatchTeamInfo, MatchTeamInfo];
  readonly actors: Actor[] = [];
  readonly clockScale: number;
  readonly shotScale: number;

  phase: Phase = 'jumpball';
  phaseT = 0;
  quarter = 1;
  clock = REG_QUARTER;
  shotClock = 24;
  shotClockOff = false;
  clockRunning = false;
  score: [number, number] = [0, 0];
  quarterScores: [number, number][] = [[0, 0]];
  possession: 0 | 1 = 0;
  teamFouls: [number, number] = [0, 0];
  timeouts: [number, number] = [4, 4];
  jumpWinner: 0 | 1 = 0;
  ball: Ball;
  user: Actor | null = null;
  passTarget: Actor | null = null;
  events: EngineEvent[] = [];
  message: { text: string; sub?: string; t: number } | null = null;
  box = new Map<string, BoxLine>();
  inbound: InboundState | null = null;
  ft: FtState | null = null;
  lastPass: { from: Actor; to: Actor; time: number } | null = null;
  injuries: { playerId: string; injury: Injury }[] = [];
  pendingInjury: Actor[] = [];
  buzzerPending = false;
  elapsed = 0;
  run: { side: 0 | 1; points: number } = { side: 0, points: 0 };
  awaitingUser = false;
  /** Optional diagnostics: every field-goal attempt with its inputs and probability. */
  shotLog: { side: 0 | 1; kind: ShotKind; value: number; distance: number; contestDist: number; quality: number; p: number; made: boolean; fouled: boolean }[] | null = null;
  /** When true the CPU also drives the user's team ("sim to end"). */
  autopilot = false;
  shake = 0;
  practiceMakes = 0;
  practiceShots = 0;
  private deadT = 0;
  private deadNext: (() => void) | null = null;
  private breakT = 0;
  private prevShoot = false;
  private chargeCd = 0;

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    this.rng = new Rng(cfg.seed);
    this.teams = [cfg.home, cfg.away];
    this.clockScale = 12 / cfg.quarterMinutes;
    this.shotScale = Math.min(this.clockScale, Math.max(1, Math.sqrt(this.clockScale)));
    this.ball = {
      x: HALF,
      z: COURT_WIDTH / 2,
      h: 4,
      vx: 0,
      vz: 0,
      vh: 0,
      state: 'dead',
      holder: null,
      pass: null,
      shot: null,
      lastTouch: 0,
      reboundable: false,
      hitRim: false,
      pokedBy: null,
      pokedFrom: null,
      dribblePhase: 0,
    };
    ([0, 1] as const).forEach((side) => {
      const t = this.teams[side];
      for (const p of t.players) {
        const a = new Actor(p, side);
        this.actors.push(a);
        this.box.set(p.id, {
          playerId: p.id,
          name: p.fullName,
          starter: false,
          seconds: 0,
          points: 0,
          fgm: 0,
          fga: 0,
          threePm: 0,
          threePa: 0,
          ftm: 0,
          fta: 0,
          offRebounds: 0,
          defRebounds: 0,
          assists: 0,
          steals: 0,
          blocks: 0,
          turnovers: 0,
          fouls: 0,
          plusMinus: 0,
          touches: 0,
        });
      }
      const starters = t.starters.filter((id) => t.players.some((p) => p.id === id));
      for (const p of t.players) if (starters.length < 5 && !starters.includes(p.id)) starters.push(p.id);
      for (const id of starters.slice(0, 5)) {
        const a = this.actor(id)!;
        a.onCourt = true;
        this.box.get(id)!.starter = true;
      }
      this.assignSlots(side);
    });
    this.assignDefense();
    if (cfg.mode === 'practice') {
      this.setupPractice();
    } else {
      this.setupJumpBall();
    }
  }

  // ---------------------------------------------------------------- queries

  actor(id: string) {
    return this.actors.find((a) => a.id === id);
  }

  onCourt(side: 0 | 1): Actor[] {
    return this.actors.filter((a) => a.onCourt && a.side === side);
  }

  allOnCourt(): Actor[] {
    return this.actors.filter((a) => a.onCourt);
  }

  bench(side: 0 | 1): Actor[] {
    return this.actors.filter((a) => !a.onCourt && a.side === side);
  }

  /** Direction a side attacks: home goes right in the first half. */
  dir(side: 0 | 1): 1 | -1 {
    const firstHalf = this.quarter <= 2;
    const d = side === 0 ? 1 : -1;
    return (firstHalf ? d : -d) as 1 | -1;
  }

  basket(side: 0 | 1): Vec {
    return basketFor(this.dir(side));
  }

  isUser(a: Actor) {
    return !this.autopilot && this.cfg.userSide !== null && a.side === this.cfg.userSide;
  }

  get diff() {
    return DIFFICULTY[this.cfg.difficulty];
  }

  get isClutch() {
    return this.quarter >= 4 && this.clock <= 120 && Math.abs(this.score[0] - this.score[1]) <= 5;
  }

  get over() {
    return this.phase === 'final';
  }

  nearestOpponent(a: Actor): { opp: Actor | null; d: number } {
    let best: Actor | null = null;
    let bd = Infinity;
    for (const o of this.onCourt((1 - a.side) as 0 | 1)) {
      const d = dist(a, o);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return { opp: best, d: bd };
  }

  // ---------------------------------------------------------------- setup helpers

  private assignSlots(side: 0 | 1) {
    const on = this.onCourt(side).sort(
      (a, b) => POS_ORDER.indexOf(a.info.position) - POS_ORDER.indexOf(b.info.position) || a.info.heightCm - b.info.heightCm,
    );
    on.forEach((a, i) => (a.slot = i));
  }

  /** Man-to-man matchups by lineup slot (PG guards PG, etc.). */
  assignDefense() {
    for (const side of [0, 1] as const) {
      const mine = this.onCourt(side).sort((a, b) => a.slot - b.slot);
      const theirs = this.onCourt((1 - side) as 0 | 1).sort((a, b) => a.slot - b.slot);
      mine.forEach((a, i) => (a.assignment = theirs[i] ?? theirs[0] ?? null));
    }
  }

  private place(a: Actor, x: number, z: number) {
    a.x = x;
    a.z = z;
    a.seenX = x;
    a.seenZ = z;
    a.tx = x;
    a.tz = z;
    a.vx = a.vz = 0;
    a.h = 0;
    a.vh = 0;
    a.charging = -1;
  }

  private setupJumpBall() {
    this.phase = 'jumpball';
    this.phaseT = 0;
    for (const side of [0, 1] as const) {
      const d = this.dir(side);
      const on = this.onCourt(side).sort((a, b) => a.slot - b.slot);
      const jumper = on.reduce((m, a) => (a.info.heightCm > m.info.heightCm ? a : m), on[0]);
      for (const a of on) {
        a.facing = d;
        if (a === jumper) this.place(a, HALF - d * 1.4, 25);
        else {
          const others = on.filter((o) => o !== jumper);
          const k = others.indexOf(a);
          const spots: [number, number][] = [
            [HALF + d * 7, 18],
            [HALF + d * 7, 32],
            [HALF - d * 8, 17],
            [HALF - d * 8, 33],
          ];
          this.place(a, spots[k][0], spots[k][1]);
        }
      }
    }
    this.ball.state = 'dead';
    this.ball.holder = null;
    this.ball.x = HALF;
    this.ball.z = 25;
    this.ball.h = 7;
    this.ball.vh = 21;
    this.message = { text: 'TIP-OFF', t: 1.2 };
    this.user = this.cfg.userSide !== null ? this.onCourt(this.cfg.userSide)[0] : null;
  }

  private setupPractice() {
    this.possession = this.cfg.userSide ?? 0;
    this.clockRunning = false;
    this.resetPracticePossession();
  }

  private resetPracticePossession() {
    const side = this.cfg.userSide ?? 0;
    this.possession = side;
    const d = this.dir(side);
    for (const a of this.allOnCourt()) {
      const own = a.side === side;
      const x = HALF + d * (own ? 3 : 14) + (a.slot - 2) * 1.5 * d;
      this.place(a, x, 10 + a.slot * 7.5);
      a.facing = d;
    }
    const handler = this.onCourt(side).find((a) => a.slot === 0)!;
    this.place(handler, HALF + d * 4, 25);
    this.giveBall(handler);
    if (this.cfg.userSide !== null) this.user = handler;
    this.phase = 'live';
    this.shotClock = 24;
  }

  // ---------------------------------------------------------------- main update

  update(dtIn: number, input: InputState) {
    const dt = Math.min(dtIn, 0.05);
    this.elapsed += dt;
    this.phaseT += dt;
    if (this.message) {
      this.message.t -= dt;
      if (this.message.t <= 0) this.message = null;
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
    if (this.phase === 'final' || this.phase === 'timeout') return;

    if (this.phase === 'break') {
      this.breakT -= dt;
      if (this.breakT <= 0) this.startNextPeriod();
      this.stepActors(dt, input, false);
      return;
    }

    this.handleUserInput(input, dt);

    switch (this.phase) {
      case 'jumpball':
        this.updateJumpBall(dt);
        break;
      case 'inbound':
        this.updateInbound(dt, input);
        break;
      case 'freeThrow':
        this.updateFreeThrows(dt, input);
        break;
      case 'dead':
        this.deadT -= dt;
        if (this.deadT <= 0) {
          const next = this.deadNext;
          this.deadNext = null;
          next?.();
        }
        break;
      case 'live':
        break;
    }

    this.runAI(dt);
    this.stepActors(dt, input, true);
    this.stepBall(dt);
    this.stepClock(dt);
    this.prevShoot = input.shoot;
  }

  drainEvents(): EngineEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private emit(e: EngineEvent) {
    this.events.push(e);
  }

  private say(text: string, sub?: string, t = 1.6) {
    this.message = { text, sub, t };
    this.emit({ type: 'message', text, sub });
  }

  // ---------------------------------------------------------------- clock

  private stepClock(dt: number) {
    if (this.cfg.mode === 'practice') return;
    if (!this.clockRunning) return;
    const used = Math.min(this.clock, dt * this.clockScale);
    this.clock -= used;
    for (const a of this.allOnCourt()) {
      this.box.get(a.id)!.seconds += used;
      const recovery = this.teams[a.side].staff.recovery ?? 0;
      const drain = 0.00062 * (1.3 - a.r.stamina * 0.07) * (a.info.traits.includes('High Motor') ? 0.85 : 1) * (1 - recovery * 0.06);
      a.energy = clamp(a.energy - used * drain, 0.05, 1);
      // Injury risk scales with minutes, fatigue and the durability traits.
      const risk = 0.0000045 * (2 - a.energy) * injuryTraitFactor(a.info.traits);
      if (!a.injured && this.rng.chance(risk * used)) {
        a.injured = true;
        this.pendingInjury.push(a);
      }
    }
    for (const a of this.actors) if (!a.onCourt) a.energy = clamp(a.energy + used * 0.0016 * (1 + (this.teams[a.side].staff.recovery ?? 0) * 0.15), 0, a.info.startEnergy);

    if (this.phase === 'live' && !this.shotClockOff && this.ball.state !== 'shot') {
      this.shotClock -= dt * this.shotScale;
      if (this.shotClock <= 0 && this.clock > 0.01) {
        this.shotClock = 0;
        const loose = this.ball.state === 'loose' && this.ball.hitRim;
        if (!loose) this.shotClockViolation();
      }
    } else if (this.phase === 'live' && this.ball.state === 'shot') {
      this.shotClock = Math.max(0, this.shotClock - dt * this.shotScale);
    }

    if (this.clock <= 0) {
      this.clock = 0;
      if (this.ball.state === 'shot' && this.ball.shot && this.ball.shot.kind !== 'freeThrow') {
        if (!this.buzzerPending) {
          this.buzzerPending = true;
          this.emit({ type: 'buzzer' });
        }
      } else if (this.phase === 'live' || this.phase === 'inbound') {
        this.emit({ type: 'buzzer' });
        this.endPeriod();
      }
    }
  }

  private shotClockViolation() {
    const side = this.possession;
    this.whistle();
    this.say('SHOT CLOCK', 'VIOLATION');
    const holder = this.ball.holder;
    if (holder) this.box.get(holder.id)!.turnovers++;
    const at = { x: this.ball.x, z: this.ball.z };
    this.dead(1.1, () => this.setupInbound((1 - side) as 0 | 1, this.sidelineSpot(at), false));
  }

  // ---------------------------------------------------------------- periods

  private endPeriod() {
    this.clockRunning = false;
    this.buzzerPending = false;
    this.ball.state = 'dead';
    this.ball.holder = null;
    for (const a of this.allOnCourt()) a.charging = -1;
    const q = this.quarter;
    if (q >= 4 && this.score[0] !== this.score[1]) {
      this.phase = 'final';
      this.say('FINAL', `${this.teams[0].abbr} ${this.score[0]} - ${this.score[1]} ${this.teams[1].abbr}`, 99);
      for (const a of this.allOnCourt()) {
        const won = this.score[a.side] > this.score[1 - a.side];
        a.setAction(won ? 'celebrate' : 'tired');
        a.vx = a.vz = 0;
      }
      this.resolvePendingInjuries();
      return;
    }
    this.phase = 'break';
    this.breakT = q === 2 ? 3 : 2.2;
    const label = q === 2 ? 'HALFTIME' : q >= 4 ? 'OVERTIME!' : `END OF Q${q}`;
    this.say(label, `${this.teams[0].abbr} ${this.score[0]} - ${this.score[1]} ${this.teams[1].abbr}`, this.breakT);
  }

  private startNextPeriod() {
    this.quarter++;
    this.quarterScores.push([0, 0]);
    this.clock = this.quarter <= 4 ? REG_QUARTER : OT_PERIOD;
    this.teamFouls = [0, 0];
    this.shotClock = 24;
    this.shotClockOff = false;
    for (const a of this.actors) a.energy = clamp(a.energy + 0.12, 0, a.info.startEnergy);
    this.resolvePendingInjuries();
    for (const s of [0, 1] as const) this.autoSubs(s, true);
    if (this.quarter >= 5) {
      this.setupJumpBall();
      return;
    }
    // Possession arrow: the team that lost the tip starts Q2 and Q3, the winner starts Q4.
    const loser = (1 - this.jumpWinner) as 0 | 1;
    const side = this.quarter === 4 ? this.jumpWinner : loser;
    const d = this.dir(side);
    const ownBaseline = d === 1 ? -1.2 : COURT_LENGTH + 1.2;
    this.positionForInbound(side);
    this.setupInbound(side, { x: ownBaseline, z: 22 }, false);
  }

  /** Spread both teams out sensibly before a restart. */
  private positionForInbound(side: 0 | 1) {
    for (const a of this.allOnCourt()) {
      const d = this.dir(side);
      const own = a.side === side;
      const x = own ? HALF - d * (16 - a.slot * 2) : HALF - d * (24 - a.slot * 2);
      this.place(a, x, 8 + a.slot * 8.5);
    }
  }

  // ---------------------------------------------------------------- dead balls & restarts

  private whistle() {
    this.emit({ type: 'whistle' });
    this.clockRunning = false;
  }

  private dead(t: number, next: () => void) {
    this.phase = 'dead';
    this.deadT = t;
    this.deadNext = next;
    this.ball.state = this.ball.state === 'shot' ? 'shot' : 'dead';
    for (const a of this.allOnCourt()) a.charging = -1;
  }

  private sidelineSpot(at: Vec): Vec {
    const x = clamp(at.x, 4, COURT_LENGTH - 4);
    return { x, z: at.z < COURT_WIDTH / 2 ? -1.2 : COURT_WIDTH + 1.2 };
  }

  private setupInbound(side: 0 | 1, spot: Vec, afterMake: boolean) {
    if (this.clock <= 0 && this.cfg.mode !== 'practice') {
      this.endPeriod();
      return;
    }
    this.resolvePendingInjuries();
    if (!afterMake) {
      for (const s of [0, 1] as const) this.autoSubs(s, false);
      this.maybeCpuTimeout(side);
    }
    this.phase = 'inbound';
    this.phaseT = 0;
    this.possession = side;
    this.shotClockOff = false;
    this.shotClock = 24;
    if (!afterMake) this.clockRunning = false;
    else if (this.quarter >= 4 && this.clock <= 120) this.clockRunning = false;
    const on = this.onCourt(side);
    const handler = on.find((a) => a.slot === 0) ?? on[0];
    const inbounder =
      on.filter((a) => a !== handler).sort((a, b) => dist(a, spot) - dist(b, spot))[0] ?? handler;
    this.inbound = { side, inbounder, receiver: handler, spot, timer: 0, ready: false, afterMake };
    this.ball.state = 'dead';
    this.ball.holder = null;
    this.ball.reboundable = false;
    this.ball.hitRim = false;
    this.ball.pokedBy = null;
    this.lastPass = null;
    if (this.cfg.userSide === side) this.user = handler;
    else if (this.cfg.userSide !== null) this.selectDefender();
  }

  private updateInbound(dt: number, input: InputState) {
    const ib = this.inbound!;
    const { inbounder, receiver, spot } = ib;
    inbounder.tx = spot.x;
    inbounder.tz = spot.z;
    inbounder.wantSprint = true;
    ib.timer += dt;
    if (!ib.ready) {
      if (dist(inbounder, spot) < 1 || ib.timer > 2.2) {
        this.place(inbounder, spot.x, spot.z);
        inbounder.facing = spot.x < HALF ? 1 : -1;
        if (spot.z < 0 || spot.z > COURT_WIDTH) inbounder.view = spot.z < 0 ? 'down' : 'up';
        this.ball.state = 'held';
        this.ball.holder = inbounder;
        ib.ready = true;
        ib.timer = 0;
      }
      return;
    }
    const d = this.dir(ib.side);
    const target = {
      x: clamp(spot.x + (spot.x < 0 ? 7 : spot.x > COURT_LENGTH ? -7 : d * 3), 3, COURT_LENGTH - 3),
      z: clamp(spot.z < 0 ? 7 : spot.z > COURT_WIDTH ? COURT_WIDTH - 7 : spot.z + 4, 3, COURT_WIDTH - 3),
    };
    if (!this.isUser(receiver)) {
      receiver.tx = target.x;
      receiver.tz = target.z;
    }
    if (this.ball.state !== 'held' || this.ball.holder !== inbounder) return;
    const userGo = this.isUser(receiver) && (input.pass || (input.shoot && !this.prevShoot));
    if (userGo || ib.timer > (this.isUser(receiver) ? 1.6 : 0.9)) {
      this.passTo(inbounder, receiver);
    }
  }

  // ---------------------------------------------------------------- jump ball

  private updateJumpBall(dt: number) {
    const b = this.ball;
    if (b.state !== 'dead') return;
    b.vh -= GRAV * dt;
    b.h += b.vh * dt;
    const jumpers = [0, 1].map((s) =>
      this.onCourt(s as 0 | 1).reduce((m, a) => (Math.abs(a.x - HALF) < Math.abs(m.x - HALF) ? a : m)),
    );
    if (b.vh < 4 && b.vh > 3) for (const j of jumpers) this.jump(j);
    if (b.vh < -2 && b.h < 11.5) {
      const w = jumpers.map((j) => j.info.heightCm / 10 + j.r.athleticism * 2 + this.rng.range(0, 12));
      const winSide = (w[0] >= w[1] ? 0 : 1) as 0 | 1;
      this.jumpWinner = winSide;
      const tipper = jumpers[winSide];
      const mates = this.onCourt(winSide).filter((a) => a !== tipper);
      const to = mates.sort((a, b2) => dist(a, tipper) - dist(b2, tipper))[0];
      this.possession = winSide;
      this.ball.x = tipper.x;
      this.ball.z = tipper.z;
      this.passTo(tipper, to, true);
      this.ball.h = 10;
      this.clockRunning = true;
    }
  }

  // ---------------------------------------------------------------- input

  private handleUserInput(input: InputState, dt: number) {
    const side = this.cfg.userSide;
    if (side === null || this.autopilot) return;
    this.chargeCd -= dt;
    const offense = this.possession === side;
    const u = this.user;

    if (this.phase === 'freeThrow') return;

    if (offense) {
      const holder = this.ball.holder;
      if (this.ball.state === 'held' && holder && holder.side === side && this.phase === 'live') {
        this.user = holder;
      }
      if (this.phase === 'live' && u && this.ball.holder === u) {
        this.updatePassTarget(u, input);
        if (u.charging < 0 && !u.busy) {
          if (input.shoot && !this.prevShoot && this.chargeCd <= 0) this.beginShot(u);
          else if (input.pass && this.passTarget) this.passTo(u, this.passTarget);
          else if (input.passTarget) {
            const t = this.actor(input.passTarget);
            if (t && t.side === side && t.onCourt && t !== u) this.passTo(u, t);
          } else if (input.screen) this.callScreen(u);
        } else if (u.charging >= 0 && !input.shoot && u.chargeKind !== 'layup' && u.chargeKind !== 'dunk') {
          this.releaseShot(u, Math.min(1, releaseQuality(u.charging, u.r.shooting, u.chargeKind) + this.teams[u.side].staff.offense * 0.02));
        }
      } else if (this.phase === 'live' && u && !this.ball.holder) {
        // Loose ball or pass in flight on offense: control the intended receiver or nearest player.
        if (this.ball.state === 'pass' && this.ball.pass?.to.side === side) this.user = this.ball.pass.to;
        if (input.switchPlayer) this.selectNearestToBall(side);
        if ((input.action || (input.shoot && !this.prevShoot)) && u) this.jump(u);
      }
      this.passTarget = this.ball.holder === this.user ? this.passTarget : null;
    } else {
      this.passTarget = null;
      if (!u || !u.onCourt) this.selectDefender();
      if (input.switchPlayer) this.selectNearestToBall(side);
      const me = this.user;
      if (me && this.phase === 'live') {
        if (input.action) {
          const h = this.ball.holder;
          if (h && h.side !== side && dist(me, h) < 4.2) this.attemptSteal(me);
          else this.jump(me);
        }
        if (input.shoot && !this.prevShoot) this.jump(me);
      }
    }
    if (input.timeout) this.requestTimeout(side);
  }

  private updatePassTarget(u: Actor, input: InputState) {
    const mates = this.onCourt(u.side).filter((a) => a !== u);
    const mag = Math.hypot(input.mx, input.mz);
    if (mag > 0.3) {
      let best: Actor | null = null;
      let bs = -Infinity;
      for (const m of mates) {
        const dx = m.x - u.x;
        const dz = (m.z - u.z) * 2.2; // compensate for the squashed depth axis on screen
        const dl = Math.hypot(dx, dz) || 1;
        const cos = (dx * input.mx + dz * input.mz) / (dl * mag);
        const s = cos * 2 - dl / 60;
        if (s > bs) {
          bs = s;
          best = m;
        }
      }
      if (best && bs > 0.4) this.passTarget = best;
    }
    if (!this.passTarget || !mates.includes(this.passTarget)) {
      this.passTarget = mates.sort((a, b) => this.openness(b) - dist(b, u) * 0.1 - (this.openness(a) - dist(a, u) * 0.1))[0] ?? null;
    }
  }

  openness(a: Actor): number {
    return this.nearestOpponent(a).d;
  }

  selectDefender() {
    const side = this.cfg.userSide;
    if (side === null) return;
    const holder = this.ball.holder ?? this.inbound?.receiver;
    const mine = this.onCourt(side);
    const guard = holder ? mine.find((a) => a.assignment === holder) : null;
    this.user = guard ?? mine[0] ?? null;
  }

  private selectNearestToBall(side: 0 | 1) {
    const mine = this.onCourt(side).filter((a) => a !== this.user);
    const b = this.ball;
    const next = mine.sort((a, c) => dist(a, b) - dist(c, b))[0];
    if (next) this.user = next;
  }

  // ---------------------------------------------------------------- timeouts & subs

  requestTimeout(side: 0 | 1): boolean {
    if (this.cfg.mode === 'practice') return false;
    if (this.timeouts[side] <= 0) return false;
    const deadBall = this.phase === 'dead' || this.phase === 'inbound';
    const hasBall = this.possession === side && (this.ball.state === 'held' || deadBall);
    if (!hasBall && !deadBall) return false;
    if (this.ball.holder?.charging !== undefined && this.ball.holder.charging >= 0) return false;
    this.timeouts[side]--;
    this.whistle();
    this.say('TIMEOUT', this.teams[side].abbr, 1.5);
    const at = { x: this.ball.x, z: this.ball.z };
    const poss = this.possession;
    const keepShotClock = Math.max(this.shotClock, 1);
    this.deadNext = null;
    for (const a of this.actors) a.energy = clamp(a.energy + 0.08, 0, a.info.startEnergy);
    this.pendingRestart = () => {
      const d = this.dir(poss);
      const frontX = clamp(at.x, d === 1 ? HALF + 4 : 6, d === 1 ? COURT_LENGTH - 6 : HALF - 4);
      this.setupInbound(poss, this.sidelineSpot({ x: frontX, z: at.z }), false);
      this.shotClock = keepShotClock;
    };
    this.ball.holder = null;
    this.ball.state = 'dead';
    if (this.cfg.userSide === side) {
      this.phase = 'timeout';
      this.awaitingUser = true;
    } else {
      this.autoSubs(side, true);
      this.dead(1.6, () => this.pendingRestart?.());
    }
    return true;
  }

  private pendingRestart: (() => void) | null = null;

  resumeFromTimeout() {
    if (this.phase !== 'timeout') return;
    this.awaitingUser = false;
    this.autoSubs((1 - (this.cfg.userSide ?? 0)) as 0 | 1, true);
    const r = this.pendingRestart;
    this.pendingRestart = null;
    if (r) r();
    else this.phase = 'live';
  }

  private maybeCpuTimeout(inboundSide: 0 | 1) {
    for (const side of [0, 1] as const) {
      if (this.cfg.userSide === side) continue;
      if (this.timeouts[side] <= 1 || inboundSide !== side) continue;
      if (this.run.side !== side && this.run.points >= 9) {
        this.timeouts[side]--;
        this.run.points = 0;
        this.say('TIMEOUT', this.teams[side].abbr, 1.4);
        for (const a of this.actors) a.energy = clamp(a.energy + 0.08, 0, a.info.startEnergy);
        this.autoSubs(side, true);
      }
    }
  }

  canSubstitute() {
    return this.phase !== 'live' && this.phase !== 'jumpball' && this.phase !== 'final';
  }

  /** Swap a bench player in. Returns an error message when the swap is not allowed. */
  substitute(side: 0 | 1, outId: string, inId: string): string | null {
    if (!this.canSubstitute()) return 'Substitutions only during a dead ball or timeout.';
    const out = this.actor(outId);
    const inn = this.actor(inId);
    if (!out || !inn || out.side !== side || inn.side !== side) return 'Unknown player.';
    if (!out.onCourt) return `${out.info.name} is not on the court.`;
    if (inn.onCourt) return `${inn.info.name} is already on the court.`;
    if (inn.fouledOut) return `${inn.info.name} has fouled out.`;
    if (inn.injured) return `${inn.info.name} is injured.`;
    if (this.ft && this.ft.shooter === out) return 'The free-throw shooter must stay in.';
    this.swap(out, inn);
    return null;
  }

  private swap(out: Actor, inn: Actor) {
    out.onCourt = false;
    inn.onCourt = true;
    this.place(inn, out.x, out.z);
    inn.facing = out.facing;
    if (this.ball.holder === out) this.ball.holder = inn;
    if (this.user === out) this.user = inn;
    if (this.inbound?.inbounder === out) this.inbound.inbounder = inn;
    if (this.inbound?.receiver === out) this.inbound.receiver = inn;
    this.assignSlots(out.side);
    this.assignDefense();
  }

  /** Coach logic for automatic substitutions at a dead ball. */
  autoSubs(side: 0 | 1, timeoutOrBreak: boolean) {
    const userTeam = this.cfg.userSide === side;
    const voluntary = !userTeam || this.cfg.autoSubs;
    const team = this.teams[side];
    const priority = [...team.starters, ...team.rotation];
    const rank = (a: Actor) => {
      const i = priority.indexOf(a.id);
      return i < 0 ? 99 : i;
    };
    for (const out of this.onCourt(side)) {
      const forced = out.fouledOut || out.injured;
      const tired = out.energy < (timeoutOrBreak ? 0.7 : 0.62);
      if (!forced && !(voluntary && tired)) continue;
      if (this.ft && this.ft.shooter === out && !forced) continue;
      const cands = this.bench(side).filter((b) => !b.fouledOut && !b.injured);
      if (!cands.length) continue;
      const score = (b: Actor) =>
        b.energy * 3 - rank(b) * 0.08 + (b.info.position === out.info.position ? 0.6 : 0) - Math.abs(POS_ORDER.indexOf(b.info.position) - POS_ORDER.indexOf(out.info.position)) * 0.25;
      const best = cands.sort((a, b) => score(b) - score(a))[0];
      if (forced || best.energy > out.energy + 0.18) this.swap(out, best);
    }
    // Rested higher-priority players come back in.
    if (voluntary) {
      for (const b of this.bench(side)) {
        if (b.fouledOut || b.injured || b.energy < 0.86) continue;
        const weakest = this.onCourt(side)
          .filter((o) => rank(o) > rank(b) && o.info.position === b.info.position && !(this.ft && this.ft.shooter === o))
          .sort((a, c) => rank(c) - rank(a))[0];
        if (weakest && weakest.energy < b.energy - 0.1) this.swap(weakest, b);
      }
    }
  }

  private resolvePendingInjuries() {
    for (const a of this.pendingInjury) {
      const injury = rollInjury(this.rng);
      this.injuries.push({ playerId: a.id, injury });
      if (a.onCourt) {
        a.setAction('fallen');
        this.say('INJURY', `${a.info.name} - ${injury.type}`, 1.8);
      }
    }
    this.pendingInjury = [];
  }

  // ---------------------------------------------------------------- actions

  giveBall(a: Actor) {
    const b = this.ball;
    b.holder = a;
    b.state = 'held';
    b.pass = null;
    b.shot = null;
    b.lastTouch = a.side;
    b.pokedBy = null;
    a.holdT = 0;
    a.driveT = 0;
  }

  private gainPossession(a: Actor, how: 'rebound' | 'catch' | 'steal' | 'loose') {
    const b = this.ball;
    const changed = a.side !== this.possession;
    if (how === 'rebound' && b.reboundable) {
      const line = this.box.get(a.id)!;
      if (changed) line.defRebounds++;
      else line.offRebounds++;
    }
    const touchLine = this.box.get(a.id)!;
    touchLine.touches = (touchLine.touches ?? 0) + 1;
    if (b.pokedBy && b.pokedFrom && a.side === b.pokedBy.side) {
      this.box.get(b.pokedBy.id)!.steals++;
      this.box.get(b.pokedFrom.id)!.turnovers++;
      this.emit({ type: 'steal' });
    }
    if (changed) {
      this.possession = a.side;
      this.shotClock = 24;
    } else if (b.hitRim) {
      this.shotClock = Math.max(this.shotClock, 14);
    }
    this.shotClockOff = false;
    b.reboundable = false;
    b.hitRim = false;
    this.giveBall(a);
    if (this.cfg.userSide !== null) {
      if (a.side === this.cfg.userSide) this.user = a;
      else if (changed) this.selectDefender();
    }
    if (this.cfg.mode === 'practice' && a.side !== this.cfg.userSide) {
      this.dead(0.6, () => this.resetPracticePossession());
    }
  }

  passTo(from: Actor, to: Actor, tip = false) {
    const b = this.ball;
    if (from.charging >= 0) return;
    const speed = 40 + from.r.passing * 2.2;
    const d0 = dist(from, to);
    const lead = Math.min(0.6, d0 / speed);
    const ex = clamp(to.x + to.vx * lead, 0.5, COURT_LENGTH - 0.5);
    const ez = clamp(to.z + to.vz * lead, 0.5, COURT_WIDTH - 0.5);
    const d = Math.hypot(ex - from.x, ez - from.z);
    let interceptor: Actor | null = null;
    let ix = ex;
    let iz = ez;
    if (!tip && this.phase === 'live') {
      const passerSkill = (from.r.passing - 5) * 0.035 + (from.info.traits.includes('Floor General') ? 0.04 : 0);
      for (const o of this.onCourt((1 - from.side) as 0 | 1)) {
        const s = segDist(o, from, { x: ex, z: ez });
        if (s.d > 2.4 || s.t < 0.12 || s.t > 0.95) continue;
        const dm = this.isUser(o) ? 1 : this.cfg.userSide === null || o.side === this.cfg.userSide ? 1 : this.diff.intercept;
        let p = (0.3 + (o.r.defense - 5) * 0.035 - passerSkill) * (1 - s.d / 2.4) * dm;
        if (d > 30) p += 0.08;
        if (this.rng.chance(clamp(p, 0, 0.6))) {
          interceptor = o;
          ix = from.x + (ex - from.x) * s.t;
          iz = from.z + (ez - from.z) * s.t;
          break;
        }
      }
    }
    const fx = interceptor ? ix : ex;
    const fz = interceptor ? iz : ez;
    const dur = Math.max(0.12, Math.hypot(fx - from.x, fz - from.z) / speed);
    b.state = 'pass';
    b.holder = null;
    b.pass = { from, to, t: 0, dur, sx: from.x + from.facing * 0.6, sz: from.z, ex: fx, ez: fz, interceptor };
    b.lastTouch = from.side;
    b.reboundable = false;
    if (!tip) {
      from.setAction('pass', 0.25);
      this.emit({ type: 'pass' });
    }
    from.facing = ex >= from.x ? 1 : -1;
    if (this.phase === 'live' || tip) this.lastPass = { from, to, time: this.elapsed };
  }

  callScreen(handler: Actor) {
    const mates = this.onCourt(handler.side).filter((a) => a !== handler && a.screenT <= 0);
    const screener = mates.sort(
      (a, b) =>
        POS_ORDER.indexOf(b.info.position) - POS_ORDER.indexOf(a.info.position) + (dist(a, handler) - dist(b, handler)) * 0.05,
    )[0];
    if (!screener) return;
    screener.screenT = 3.2;
    screener.screenSet = 0;
    screener.cutting = 0;
    if (this.isUser(handler)) this.say('SCREEN!', screener.info.name, 0.8);
  }

  jump(a: Actor) {
    if (a.airborne || a.busy) return;
    const height = 1.9 + a.r.athleticism * 0.17;
    a.vh = Math.sqrt(2 * GRAV * height);
    a.h = 0.06;
    a.setAction('jump');
  }

  attemptSteal(def: Actor) {
    if (def.stealCd > 0 || def.busy) return;
    def.stealCd = 0.9;
    def.setAction('steal', 0.3);
    const holder = this.ball.holder;
    if (!holder || holder.side === def.side || this.ball.state !== 'held' || this.phase !== 'live' || dist(def, holder) > 4.2) {
      def.stumbleT = 0.2;
      return;
    }
    const aggression = this.teams[def.side].tactics.defAggression;
    let p = 0.13 + (def.r.defense - holder.r.dribbling) * 0.025;
    if (holder.sprinting) p += 0.06;
    if (holder.charging >= 0) p -= 0.05;
    if (holder.info.traits.includes('Floor General')) p -= 0.02;
    const cpu = !this.isUser(def) && this.cfg.userSide !== null && def.side !== this.cfg.userSide;
    if (cpu) p *= this.diff.stealSkill;
    const foulP = 0.09 + aggression * 0.018 - def.r.defense * 0.007;
    if (this.rng.chance(clamp(foulP, 0.02, 0.25))) {
      this.commitFoul(def, holder, false);
      return;
    }
    if (this.rng.chance(clamp(p, 0.03, 0.45))) {
      const b = this.ball;
      b.state = 'loose';
      b.holder = null;
      b.pokedBy = def;
      b.pokedFrom = holder;
      b.reboundable = false;
      b.lastTouch = def.side;
      const ang = Math.atan2(def.z - holder.z, def.x - holder.x) + this.rng.range(-0.6, 0.6);
      b.vx = Math.cos(ang) * 9;
      b.vz = Math.sin(ang) * 9;
      b.vh = 4;
      b.h = 2.5;
      holder.stumbleT = 0.35;
      holder.setAction('stumble', 0.35);
    } else {
      def.stumbleT = 0.4;
      def.slowT = 0.5;
    }
  }

  /** Start a shot. Close to the rim it becomes a layup or dunk; otherwise the meter starts filling. */
  beginShot(a: Actor) {
    if (this.ball.holder !== a || a.charging >= 0 || a.busy) return;
    const rim = this.basket(a.side);
    const d = dist(a, rim);
    let kind: ShotKind = 'jumper';
    const big = a.info.position === 'C' || a.info.position === 'PF';
    if (d < 6.5) {
      const canDunk = (a.r.athleticism >= 6 || a.heightFt >= 6.75) && d < 5.5;
      const contested = this.nearestOpponent(a).d < 2.5;
      kind = canDunk && this.rng.chance(contested ? 0.4 : 0.85) ? 'dunk' : 'layup';
    } else if (big && d < 11) {
      kind = 'hook';
    }
    a.charging = 0;
    a.chargeKind = kind;
    a.facing = rim.x >= a.x ? 1 : -1;
    a.view = 'side';
    if (kind === 'layup' || kind === 'dunk') {
      a.setAction(kind);
      a.cpuRelease = 0.28;
      a.cpuQuality = this.isUser(a) ? 0.85 : this.cpuQuality(a);
      const height = kind === 'dunk' ? 2.6 + a.r.athleticism * 0.12 : 1.8 + a.r.athleticism * 0.1;
      a.vh = Math.sqrt(2 * GRAV * height);
      a.h = 0.06;
      const step = Math.min(d - 1.2, 4.5);
      const ux = (rim.x - a.x) / (d || 1);
      const uz = (rim.z - a.z) / (d || 1);
      a.vx = (ux * step) / 0.5;
      a.vz = (uz * step) / 0.5;
    } else {
      a.setAction('gather');
      a.cpuQuality = this.cpuQuality(a);
      a.cpuRelease = 0.42 + this.rng.range(0, 0.1);
    }
    this.emit({ type: 'crowd', level: 0.4 });
  }

  /** Timing quality for CPU (and user teammates) — the main lever difficulty pulls on. */
  private cpuQuality(a: Actor) {
    const userTeam = this.cfg.userSide !== null && a.side === this.cfg.userSide;
    const mean = userTeam ? 0.74 : this.cfg.userSide === null ? 0.74 : this.diff.quality;
    return clamp(this.rng.normal(mean, 0.16) + this.teams[a.side].staff.offense * 0.02, 0, 1);
  }

  releaseShot(a: Actor, quality: number) {
    if (a.charging < 0 || this.ball.holder !== a) return;
    const kind = a.chargeKind;
    a.charging = -1;
    this.chargeCd = 0.25;
    const rim = this.basket(a.side);
    const d = dist(a, rim);
    const value: 2 | 3 = isThree(a, this.dir(a.side)) ? 3 : 2;
    if (kind === 'jumper' || kind === 'hook') {
      a.setAction('shoot', 0.5);
      if (!a.airborne) {
        const height = 1.2 + a.r.athleticism * 0.07;
        a.vh = Math.sqrt(2 * GRAV * height);
        a.h = 0.06;
      }
    }

    // Defence at the moment of release.
    let contestDist = Infinity;
    let contestInFront = false;
    let contestJumping = false;
    let closest: Actor | null = null;
    for (const o of this.onCourt((1 - a.side) as 0 | 1)) {
      const od = dist(a, o);
      if (od < contestDist) {
        contestDist = od / (1 + this.teams[o.side].staff.defense * 0.04);
        closest = o;
        contestInFront = dist(o, rim) < d + 0.5;
        contestJumping = o.airborne;
      }
    }

    // Blocks
    let blocker: Actor | null = null;
    for (const o of this.onCourt((1 - a.side) as 0 | 1)) {
      const od = dist(a, o);
      const range = kind === 'jumper' ? 3.6 : 4.4;
      if (od > range || !o.airborne || o.vh < -6) continue;
      let p = 0.17 + (o.r.defense - 5) * 0.025 + (o.r.athleticism - 5) * 0.015 + (o.heightFt - a.heightFt) * 0.05 - (od - 1.5) * 0.06;
      if (o.info.traits.includes('Defensive Anchor')) p += 0.06;
      if (kind === 'dunk') p *= 0.45;
      if (kind === 'jumper') p *= 0.35;
      if (dist(o, rim) > d + 1) p *= 0.4;
      if (this.rng.chance(clamp(p, 0, 0.55))) {
        blocker = o;
        break;
      }
    }

    const shotLine = this.box.get(a.id)!;
    const b = this.ball;
    b.holder = null;
    b.lastTouch = a.side;
    b.pokedBy = null;
    b.hitRim = false;
    if (this.cfg.mode === 'practice') this.practiceShots++;

    if (blocker) {
      shotLine.fga++;
      if (value === 3) shotLine.threePa++;
      this.box.get(blocker.id)!.blocks++;
      b.state = 'loose';
      b.reboundable = true;
      b.lastTouch = blocker.side;
      b.x = a.x + a.facing * 1;
      b.z = a.z;
      b.h = Math.max(b.h, 8);
      const away = rim.x > a.x ? -1 : 1;
      b.vx = away * this.rng.range(8, 16);
      b.vz = this.rng.range(-9, 9);
      b.vh = this.rng.range(2, 8);
      this.emit({ type: 'block' });
      this.say('BLOCKED!', blocker.info.name, 1);
      this.shake = 0.15;
      return;
    }

    // Shooting fouls
    let fouledBy: Actor | null = null;
    if (closest && contestDist < 3.2 && kind !== 'freeThrow') {
      const agg = this.teams[closest.side].tactics.defAggression;
      let fp = 0.05 + agg * 0.012 + (contestJumping ? 0.03 : 0) - closest.r.defense * 0.004;
      if (kind === 'layup' || kind === 'dunk' || kind === 'hook') fp += 0.07;
      if (contestDist < 1.8) fp += 0.04;
      if (this.rng.chance(clamp(fp, 0.01, 0.3))) fouledBy = closest;
    }

    const p = makeProbability({
      kind,
      distance: d,
      ratings: a.r,
      heightCm: a.info.heightCm,
      traits: a.info.traits,
      contestDist,
      contestInFront,
      contestJumping,
      energy: a.energy,
      form: a.form,
      quality,
      clutch: this.isClutch,
      fouled: !!fouledBy,
    });
    const made = this.rng.chance(p);
    this.shotLog?.push({ side: a.side, kind, value, distance: d, contestDist, quality, p, made, fouled: !!fouledBy });
    const airball = !made && quality < 0.15 && kind === 'jumper' && this.rng.chance(0.5);
    this.launchShot(a, kind, value, made, airball, fouledBy);
    if (fouledBy) {
      this.emit({ type: 'whistle' });
      this.say('FOUL', `#${fouledBy.info.number} ${fouledBy.info.name}`, 0.9);
    }
  }

  private launchShot(a: Actor, kind: ShotKind, value: 1 | 2 | 3, made: boolean, airball: boolean, fouledBy: Actor | null) {
    const b = this.ball;
    const rim = this.basket(a.side);
    const d = dist(a, rim);
    let tx = rim.x;
    let tz = rim.z;
    if (!made) {
      const ang = this.rng.range(0, Math.PI * 2);
      const off = airball ? this.rng.range(2.2, 3.5) : this.rng.range(0.7, 1.2);
      tx += Math.cos(ang) * off;
      tz += Math.sin(ang) * off * 0.8;
    }
    const sh = kind === 'dunk' ? 9.5 : kind === 'layup' ? 8.5 : a.heightFt + 1.2 + a.h;
    const dur = kind === 'dunk' ? 0.18 : kind === 'layup' ? 0.45 : kind === 'freeThrow' ? 0.85 : 0.6 + d * 0.022;
    const arc = kind === 'dunk' ? 0.3 : kind === 'layup' ? 1.5 : 3 + d * 0.2;
    b.state = 'shot';
    b.shot = { shooter: a, kind, value, made, t: 0, dur, sx: a.x + a.facing * 0.5, sz: a.z, sh, tx, tz, arc, airball, fouledBy, sinking: false };
    b.x = a.x;
    b.z = a.z;
    b.h = sh;
    if (kind !== 'freeThrow') {
      const line = this.box.get(a.id)!;
      if (!fouledBy || made) {
        line.fga++;
        if (value === 3) line.threePa++;
      }
    }
    if (kind === 'dunk') this.emit({ type: 'dunk', x: rim.x, z: rim.z });
    else this.emit({ type: 'shot', three: value === 3 });
  }

  /** A foul with no shot attempt. */
  private commitFoul(fouler: Actor, victim: Actor, offensive: boolean) {
    this.whistle();
    this.box.get(fouler.id)!.fouls++;
    fouler.fouls++;
    const side = fouler.side;
    if (fouler.fouls >= 6) {
      fouler.fouledOut = true;
      this.say('FOULED OUT', `#${fouler.info.number} ${fouler.info.name}`, 1.6);
    } else {
      this.say(offensive ? 'OFFENSIVE FOUL' : 'FOUL', `#${fouler.info.number} ${fouler.info.name}`, 1.2);
    }
    const at = { x: victim.x, z: victim.z };
    this.ball.holder = null;
    this.ball.state = 'dead';
    if (offensive) {
      this.box.get(fouler.id)!.turnovers++;
      this.dead(1.1, () => this.setupInbound(victim.side, this.sidelineSpot(at), false));
      return;
    }
    this.teamFouls[side]++;
    if (this.teamFouls[side] >= 5) {
      this.dead(1.0, () => this.startFreeThrows(victim, 2));
    } else {
      if (this.shotClock < 14) this.shotClock = 14;
      const keep = this.shotClock;
      this.dead(1.1, () => {
        this.setupInbound(victim.side, this.sidelineSpot(at), false);
        this.shotClock = keep;
      });
    }
  }

  private shootingFoul(fouler: Actor, shooter: Actor, made: boolean, value: number) {
    this.box.get(fouler.id)!.fouls++;
    fouler.fouls++;
    this.teamFouls[fouler.side]++;
    if (fouler.fouls >= 6) fouler.fouledOut = true;
    this.clockRunning = false;
    const n = made ? 1 : value;
    this.dead(made ? 1.3 : 1.0, () => this.startFreeThrows(shooter, n));
  }

  // ---------------------------------------------------------------- free throws

  private startFreeThrows(shooter: Actor, n: number) {
    this.resolvePendingInjuries();
    for (const s of [0, 1] as const) this.autoSubs(s, false);
    if (!shooter.onCourt) {
      // Injured shooter: the best shooter on the floor takes them.
      shooter = this.onCourt(shooter.side).sort((a, b) => b.r.shooting - a.r.shooting)[0];
    }
    this.phase = 'freeThrow';
    this.phaseT = 0;
    this.clockRunning = false;
    this.possession = shooter.side;
    this.ft = { shooter, remaining: n, total: n, timer: 0, inFlight: false };
    this.positionForFreeThrow(shooter);
    this.ball.state = 'held';
    this.ball.holder = shooter;
    this.ball.reboundable = false;
    if (this.cfg.userSide === shooter.side) this.user = shooter;
  }

  private positionForFreeThrow(shooter: Actor) {
    const d = this.dir(shooter.side);
    const rim = this.basket(shooter.side);
    const ftx = rim.x - d * 15;
    this.place(shooter, ftx, 25);
    shooter.facing = d;
    shooter.view = 'side';
    const laneX = [rim.x - d * 7, rim.x - d * 11];
    const def = this.onCourt((1 - shooter.side) as 0 | 1);
    const off = this.onCourt(shooter.side).filter((a) => a !== shooter);
    const lane: [number, number][] = [
      [laneX[0], 16],
      [laneX[0], 34],
      [laneX[1], 16],
      [laneX[1], 34],
    ];
    def.slice(0, 2).forEach((a, i) => this.place(a, lane[i][0], lane[i][1]));
    off.slice(0, 2).forEach((a, i) => this.place(a, lane[i + 2][0], lane[i + 2][1]));
    const rest = [...def.slice(2), ...off.slice(2)];
    rest.forEach((a, i) => this.place(a, ftx - d * (6 + (i % 3) * 3), 12 + i * 6));
    for (const a of this.allOnCourt()) {
      if (a !== shooter) a.facing = (rim.x > a.x ? 1 : -1) as 1 | -1;
      a.setAction(a.energy < 0.35 ? 'tired' : 'idle');
    }
  }

  private updateFreeThrows(dt: number, input: InputState) {
    const ft = this.ft!;
    const s = ft.shooter;
    if (ft.inFlight) return;
    ft.timer += dt;
    if (this.ball.holder !== s) {
      this.ball.holder = s;
      this.ball.state = 'held';
    }
    const userShooter = this.isUser(s);
    if (userShooter) {
      if (s.charging < 0 && ft.timer > 0.4 && input.shoot && !this.prevShoot) {
        s.charging = 0;
        s.chargeKind = 'freeThrow';
        s.setAction('gather');
      } else if (s.charging >= 0 && !input.shoot) {
        this.shootFreeThrow(releaseQuality(s.charging, s.r.shooting, 'freeThrow'));
      } else if (s.charging < 0 && ft.timer > 8) {
        this.shootFreeThrow(0.5);
      }
    } else if (ft.timer > 1.1) {
      this.shootFreeThrow(this.cpuQuality(s));
    }
  }

  private shootFreeThrow(quality: number) {
    const ft = this.ft!;
    const s = ft.shooter;
    s.charging = -1;
    s.setAction('shoot', 0.5);
    const p = makeProbability({
      kind: 'freeThrow',
      distance: 15,
      ratings: s.r,
      heightCm: s.info.heightCm,
      traits: s.info.traits,
      contestDist: 99,
      contestInFront: false,
      contestJumping: false,
      energy: s.energy,
      form: s.form,
      quality,
      clutch: this.isClutch,
      fouled: false,
    });
    const made = this.rng.chance(p);
    ft.inFlight = true;
    this.box.get(s.id)!.fta++;
    this.ball.holder = null;
    this.launchShot(s, 'freeThrow', 1, made, false, null);
  }

  private afterFreeThrow(made: boolean) {
    const ft = this.ft!;
    ft.remaining--;
    ft.inFlight = false;
    ft.timer = 0;
    const s = ft.shooter;
    if (ft.remaining > 0) {
      this.ball.state = 'held';
      this.ball.holder = s;
      this.ball.shot = null;
      return;
    }
    this.ft = null;
    if (made) {
      const other = (1 - s.side) as 0 | 1;
      this.dead(0.6, () => this.setupInbound(other, this.baselineSpot(other), true));
    } else {
      this.phase = 'live';
    }
  }

  // ---------------------------------------------------------------- AI

  private runAI(dt: number) {
    for (const a of this.allOnCourt()) {
      a.stealCd -= dt;
      if (a.stumbleT > 0) a.stumbleT -= dt;
      if (a.slowT > 0) a.slowT -= dt;
      if (a.screenT > 0) a.screenT -= dt;
      if (a.cutting > 0) a.cutting -= dt;
      a.wantSprint = false;
      const k = Math.min(1, dt / 0.25);
      a.seenX += (a.x - a.seenX) * k;
      a.seenZ += (a.z - a.seenZ) * k;
    }
    if (this.phase === 'freeThrow' || this.phase === 'jumpball') {
      for (const a of this.allOnCourt()) {
        a.tx = a.x;
        a.tz = a.z;
      }
      return;
    }
    const b = this.ball;
    const offSide = this.possession;
    for (const a of this.allOnCourt()) {
      if (a === this.user && this.phase !== 'dead' && !this.autopilot) continue;
      if (this.inbound && this.phase === 'inbound' && (a === this.inbound.inbounder || (a === this.inbound.receiver && !this.isUser(a)))) continue;
      if (this.phase === 'dead' && this.deadNext) {
        // Players drift to sensible spots during stoppages.
        a.tx = a.x;
        a.tz = a.z;
        continue;
      }
      if (b.state === 'shot' || (b.state === 'loose' && (b.reboundable || b.pokedBy)) || (b.state === 'loose' && !b.holder)) {
        aiRebound(this, a, dt);
      } else if (a.side === offSide) {
        if (b.holder === a) {
          if (this.phase === 'live' && (a !== this.user || this.autopilot)) aiBallHandler(this, a, dt);
        } else aiOffBall(this, a, dt);
      } else {
        aiDefense(this, a, dt);
      }
    }
  }

  // ---------------------------------------------------------------- physics

  private stepActors(dt: number, input: InputState, live: boolean) {
    const on = this.allOnCourt();
    for (const a of on) {
      a.anim += dt;
      if (a.actionT > 0) {
        a.actionT -= dt;
        if (a.actionT <= 0 && (a.action === 'pass' || a.action === 'steal' || a.action === 'shoot' || a.action === 'stumble' || a.action === 'celebrate')) {
          a.setAction('idle');
        }
      }
      const isUser = a === this.user && live && this.phase !== 'dead' && !this.autopilot;
      let dvx = 0;
      let dvz = 0;
      const sprintOk = a.energy > 0.12;
      let sprint = (isUser ? input.sprint : a.wantSprint) && sprintOk;
      const base = 12 + a.r.athleticism * 0.6;
      let sp = base * (0.72 + 0.28 * a.energy);
      const cpu = this.cfg.userSide !== null && a.side !== this.cfg.userSide;
      if (cpu) sp *= this.diff.speed;
      if (this.ball.holder === a) sp *= 0.93;
      if (a.slowT > 0) sp *= 0.5;
      if (a.stumbleT > 0) sp *= 0.25;
      if (this.phase === 'freeThrow' || this.phase === 'break' || this.phase === 'final') sp = 0;

      if (a.charging >= 0 && a.chargeKind !== 'layup' && a.chargeKind !== 'dunk') {
        sp = 0;
        sprint = false;
      }
      if (sprint) sp *= 1.32;
      a.sprinting = sprint && sp > 0;
      if (a.sprinting) a.energy = clamp(a.energy - dt * 0.01 * (1.2 - a.r.stamina * 0.05), 0.05, 1);

      if (isUser) {
        const mag = Math.hypot(input.mx, input.mz);
        if (mag > 0.15) {
          dvx = (input.mx / Math.max(1, mag)) * sp;
          dvz = (input.mz / Math.max(1, mag)) * sp;
        }
      } else {
        const dx = a.tx - a.x;
        const dz = a.tz - a.z;
        const dd = Math.hypot(dx, dz);
        if (dd > 0.25) {
          const s = Math.min(sp, dd * 4);
          dvx = (dx / dd) * s;
          dvz = (dz / dd) * s;
        }
      }
      const airborne = a.airborne;
      const layup = a.action === 'layup' || a.action === 'dunk';
      if (!airborne && !layup) {
        const accel = (40 + a.r.athleticism * 4) * dt;
        a.vx += clamp(dvx - a.vx, -accel, accel);
        a.vz += clamp(dvz - a.vz, -accel, accel);
      }
      a.x += a.vx * dt;
      a.z += a.vz * dt;
      if (airborne || a.vh > 0) {
        a.vh -= GRAV * dt;
        a.h += a.vh * dt;
        if (a.h <= 0) {
          a.h = 0;
          a.vh = 0;
          if (a.action === 'jump' || a.action === 'shoot') a.setAction('idle');
          if (layup) {
            a.vx *= 0.3;
            a.vz *= 0.3;
            a.setAction('idle');
          }
        }
      }

      // Facing & view
      const spd = a.speed;
      const holder = this.ball.holder;
      if (a.charging < 0 && !layup) {
        if (a.side !== this.possession && holder && this.phase === 'live') {
          a.facing = holder.x >= a.x ? 1 : -1;
        } else if (Math.abs(a.vx) > 1.5) a.facing = a.vx > 0 ? 1 : -1;
        if (spd > 2 && Math.abs(a.vz) * 2.4 > Math.abs(a.vx)) a.view = a.vz < 0 ? 'up' : 'down';
        else if (spd > 1.5 || a.side !== this.possession) a.view = 'side';
      }

      // Animation state
      if (!airborne && !layup && a.charging < 0 && a.actionT <= 0 && a.action !== 'fallen') {
        const hasBall = holder === a;
        if (this.phase === 'final') {
          /* keep celebrate / tired */
        } else if (hasBall) a.setAction(spd > 1 ? 'dribble' : this.ball.state === 'held' && this.phase === 'live' ? 'dribble' : 'idle');
        else if (spd > 1.2) a.setAction(a.side !== this.possession && spd < 7 && this.phase === 'live' ? 'defend' : 'run');
        else if (a.screenSet > 0) a.setAction('screen');
        else if (a.side !== this.possession && this.phase === 'live') a.setAction('defend');
        else a.setAction(a.energy < 0.33 && this.phase !== 'live' ? 'tired' : 'idle');
      }
      if (a.action === 'fallen' && this.phase !== 'live') {
        /* stays down until subbed */
      } else if (a.action === 'fallen' && a.anim > 1.2) a.setAction('idle');

      // Shot meter / CPU release timing
      if (a.charging >= 0) {
        const fill = a.chargeKind === 'freeThrow' ? 0.95 : 0.8;
        a.charging += dt / fill;
        if (a.chargeKind === 'layup' || a.chargeKind === 'dunk') {
          if (a.charging * 0.8 >= a.cpuRelease || (a.vh < 0 && a.h < 3)) this.releaseShot(a, a.cpuQuality);
        } else if (!this.isUser(a) && a.chargeKind !== 'freeThrow') {
          if (a.charging * 0.8 >= a.cpuRelease) this.releaseShot(a, a.cpuQuality);
        } else if (a.charging > 1.08) {
          if (a.chargeKind === 'freeThrow') this.shootFreeThrow(0.1);
          else this.releaseShot(a, 0.1);
        }
      }
    }

    // Collisions: bodies can't pass through each other; set screens and set defenders hold ground.
    for (let i = 0; i < on.length; i++) {
      for (let j = i + 1; j < on.length; j++) {
        const a = on[i];
        const c = on[j];
        if (a.airborne && c.airborne) continue;
        const dx = c.x - a.x;
        const dz = c.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = PLAYER_R * 2;
        if (d >= min || d < 1e-4) continue;
        const wa = this.bodyWeight(a);
        const wc = this.bodyWeight(c);
        const overlap = min - d;
        const nx = dx / d;
        const nz = dz / d;
        a.x -= nx * overlap * (wc / (wa + wc));
        a.z -= nz * overlap * (wc / (wa + wc));
        c.x += nx * overlap * (wa / (wa + wc));
        c.z += nz * overlap * (wa / (wa + wc));
        // Kill the velocity component driving into the other body.
        const relA = a.vx * nx + a.vz * nz;
        if (relA > 0) {
          a.vx -= relA * nx * 0.8;
          a.vz -= relA * nz * 0.8;
        }
        const relC = c.vx * nx + c.vz * nz;
        if (relC < 0) {
          c.vx -= relC * nx * 0.8;
          c.vz -= relC * nz * 0.8;
        }
        if (a.side !== c.side && this.phase === 'live') {
          for (const [s, o] of [
            [a, c],
            [c, a],
          ] as const) {
            if (s.screenSet > 0 && o.side !== s.side && o.slowT <= 0) o.slowT = 0.55;
          }
          this.checkCharge(a, c);
          this.checkCharge(c, a);
        }
      }
    }
    // Live-ball out of bounds for the dribbler.
    for (const a of on) {
      if (this.phase === 'inbound' && this.inbound?.inbounder === a) continue;
      const m = 4;
      a.x = clamp(a.x, -m, COURT_LENGTH + m);
      a.z = clamp(a.z, -m, COURT_WIDTH + m);
      if (this.phase === 'live' && this.ball.holder === a && this.ball.state === 'held' && !inBounds(a, 0.05) && !a.airborne) {
        this.outOfBoundsTurnover(a);
      }
    }
  }

  private bodyWeight(a: Actor) {
    if (a.screenSet > 0) return 5;
    if (a.airborne) return 0.6;
    if (this.ball.holder === a) return 1;
    if (a.side !== this.possession && a.speed < 4) return 2.6;
    return 1.6;
  }

  private chargeCdT = 0;
  private checkCharge(h: Actor, d: Actor) {
    if (this.ball.holder !== h || this.elapsed < this.chargeCdT) return;
    if (h.speed < 10 || d.speed > 3 || !h.sprinting) return;
    const rim = this.basket(h.side);
    if (dist(d, rim) < 4) return;
    this.chargeCdT = this.elapsed + 1.5;
    if (this.rng.chance(0.1)) {
      this.commitFoul(h, d, true);
    }
  }

  private outOfBoundsTurnover(a: Actor) {
    this.whistle();
    this.say('STEPPED OUT', a.info.name, 1.2);
    this.box.get(a.id)!.turnovers++;
    const at = { x: a.x, z: a.z };
    this.ball.holder = null;
    this.ball.state = 'dead';
    this.dead(1.1, () => this.setupInbound((1 - a.side) as 0 | 1, this.sidelineSpot(at), false));
  }

  private baselineSpot(side: 0 | 1): Vec {
    // Inbound from behind the basket this side is defending.
    const d = this.dir(side);
    return { x: d === 1 ? -1.2 : COURT_LENGTH + 1.2, z: 22 };
  }

  private stepBall(dt: number) {
    const b = this.ball;
    if (b.state === 'held' && b.holder) {
      const a = b.holder;
      const dribbling = this.phase === 'live' && a.charging < 0 && !a.airborne && a.action !== 'pass';
      b.x = a.x + a.facing * 0.9;
      b.z = a.z + 0.3;
      if (a.charging >= 0 || a.airborne) {
        b.h = a.heightFt * 0.85 + a.h + (a.action === 'dunk' ? 2 : 0);
        b.x = a.x + a.facing * 0.4;
      } else if (dribbling) {
        const rate = a.sprinting ? 2.8 : 2.2;
        const prev = Math.sin(b.dribblePhase);
        b.dribblePhase += dt * Math.PI * rate;
        const s = Math.sin(b.dribblePhase);
        if (Math.sign(prev) !== Math.sign(s)) this.emit({ type: 'dribble' });
        b.h = 0.3 + Math.abs(s) * 2.8;
      } else {
        b.h = 3.5;
      }
      a.holdT += dt;
      return;
    }
    if (b.state === 'pass' && b.pass) {
      const p = b.pass;
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      b.x = p.sx + (p.ex - p.sx) * k;
      b.z = p.sz + (p.ez - p.sz) * k;
      b.h = 4.5 + Math.sin(k * Math.PI) * Math.min(3, p.dur * 3);
      if (k >= 1) {
        const r = p.interceptor ?? p.to;
        if (p.interceptor) {
          this.box.get(p.interceptor.id)!.steals++;
          this.box.get(p.from.id)!.turnovers++;
          this.emit({ type: 'steal' });
          this.say('STOLEN!', p.interceptor.info.name, 0.9);
          this.gainPossession(p.interceptor, 'steal');
          this.lastPass = null;
          if (this.phase === 'jumpball' || this.phase === 'inbound') {
            this.phase = 'live';
            this.clockRunning = true;
          }
        } else if (dist(r, b) < 3.6 && r.onCourt) {
          this.emit({ type: 'catch' });
          const wasInbound = this.phase === 'inbound' || this.phase === 'jumpball';
          this.gainPossession(r, 'catch');
          if (wasInbound) {
            this.phase = 'live';
            this.inbound = null;
            this.clockRunning = true;
          }
          if (this.lastPass) this.lastPass.time = this.elapsed;
        } else {
          b.state = 'loose';
          b.vx = (p.ex - p.sx) / p.dur * 0.4;
          b.vz = (p.ez - p.sz) / p.dur * 0.4;
          b.vh = 0;
          b.pokedBy = null;
          if (this.phase !== 'live') {
            this.phase = 'live';
            this.inbound = null;
            this.clockRunning = true;
          }
        }
      }
      return;
    }
    if (b.state === 'shot' && b.shot) {
      this.stepShot(dt);
      return;
    }
    if (b.state === 'loose') {
      b.vh -= GRAV * dt;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.h += b.vh * dt;
      if (b.h <= 0) {
        b.h = 0;
        if (b.vh < -4) {
          b.vh = -b.vh * 0.55;
          this.emit({ type: 'dribble' });
        } else b.vh = 0;
        b.vx *= 0.82;
        b.vz *= 0.82;
      }
      const fr = Math.exp(-0.8 * dt);
      b.vx *= fr;
      b.vz *= fr;
      if (this.phase === 'live' && !inBounds(b, 0) && b.h < 12) {
        this.looseOutOfBounds();
        return;
      }
      if (this.phase === 'live') this.tryGrabLoose(dt);
      return;
    }
    if (b.state === 'dead' && this.phase !== 'jumpball') {
      // Ball settles after a make or stoppage.
      if (b.h > 0 || b.vh > 0) {
        b.vh -= GRAV * dt;
        b.h += b.vh * dt;
        if (b.h <= 0) {
          b.h = 0;
          b.vh = b.vh < -5 ? -b.vh * 0.5 : 0;
        }
      }
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.vx *= Math.exp(-2 * dt);
      b.vz *= Math.exp(-2 * dt);
    }
  }

  private looseOutOfBounds() {
    const b = this.ball;
    const side = (1 - b.lastTouch) as 0 | 1;
    this.whistle();
    this.say('OUT OF BOUNDS', `${this.teams[side].abbr} BALL`, 1);
    if (b.pokedBy && b.pokedFrom && b.pokedBy.side === side) {
      this.box.get(b.pokedBy.id)!.steals++;
      this.box.get(b.pokedFrom.id)!.turnovers++;
    } else if (b.lastTouch === this.possession && !b.reboundable) {
      // The offence lost it out of bounds (fumble, errant pass).
      const culprit = this.lastPass?.from;
      if (culprit) this.box.get(culprit.id)!.turnovers++;
    }
    const at = { x: b.x, z: b.z };
    b.state = 'dead';
    b.vx = b.vz = 0;
    this.dead(1, () => {
      const spot =
        at.x < 0 || at.x > COURT_LENGTH
          ? { x: at.x < 0 ? -1.2 : COURT_LENGTH + 1.2, z: clamp(at.z, 4, COURT_WIDTH - 4) }
          : this.sidelineSpot(at);
      this.setupInbound(side, spot, false);
    });
  }

  private tryGrabLoose(dt: number) {
    const b = this.ball;
    const cands: Actor[] = [];
    for (const a of this.allOnCourt()) {
      if (a.stumbleT > 0 || a.busy) continue;
      if (b.pokedFrom === a && b.pokedBy && this.elapsed < 0) continue;
      const hd = Math.hypot(a.x - b.x, a.z - b.z);
      if (hd < 2.4 && b.h <= a.reach() + 0.6) cands.push(a);
    }
    if (!cands.length) return;
    if (!this.rng.chance(1 - Math.exp(-dt * 12))) return;
    const rim = this.basket(this.possession);
    const w = (a: Actor) => {
      let s = a.r.rebounding + 2;
      if (a.side !== this.possession) s *= 1.15; // defensive position advantage
      if (a.info.traits.includes('High Motor')) s *= 1.15;
      if (a.airborne) s *= 1.3;
      if (dist(a, rim) < dist(b, rim)) s *= 1.15;
      if (this.isUser(a)) s *= 1.15;
      return s;
    };
    const g = this.rng.weighted(cands, w);
    this.gainPossession(g, b.reboundable ? 'rebound' : 'loose');
  }

  private stepShot(dt: number) {
    const b = this.ball;
    const s = b.shot!;
    s.t += dt;
    if (s.sinking) {
      // Through the net and down to the floor.
      b.vh -= GRAV * dt;
      b.h += b.vh * dt;
      if (b.h <= 0) {
        b.h = 0;
        b.state = 'dead';
        b.vh = 3;
        b.shot = null;
      }
      return;
    }
    const k = Math.min(1, s.t / s.dur);
    b.x = s.sx + (s.tx - s.sx) * k;
    b.z = s.sz + (s.tz - s.sz) * k;
    b.h = s.sh + (RIM_HEIGHT - s.sh) * k + s.arc * 4 * k * (1 - k);
    if (k < 1) return;

    const shooter = s.shooter;
    const line = this.box.get(shooter.id)!;
    if (s.made) {
      const pts = s.value;
      this.addPoints(shooter.side, pts);
      line.points += pts;
      if (s.kind === 'freeThrow') line.ftm++;
      else {
        line.fgm++;
        if (pts === 3) line.threePm++;
        if (this.lastPass && this.lastPass.to === shooter && this.lastPass.from.side === shooter.side && this.elapsed - this.lastPass.time < 3.2) {
          this.box.get(this.lastPass.from.id)!.assists++;
        }
      }
      this.lastPass = null;
      shooter.form = clamp(shooter.form + 0.15, -1, 1);
      if (this.cfg.mode === 'practice' && s.kind !== 'freeThrow') this.practiceMakes++;
      const label = s.kind === 'dunk' ? 'SLAM!' : s.kind === 'freeThrow' ? '+1' : `+${pts}`;
      this.emit({ type: 'score', side: shooter.side, points: pts, x: s.tx, z: s.tz, label });
      this.emit({ type: s.kind === 'dunk' ? 'rim' : 'swish' });
      if (s.kind === 'dunk') this.shake = 0.3;
      if (s.kind === 'dunk' || pts === 3) shooter.setAction('celebrate', 1);
      s.sinking = true;
      b.vh = -6;
      b.x = s.tx;
      b.z = s.tz;
      b.h = RIM_HEIGHT - 0.2;
      this.afterShot(s, true);
      return;
    }

    shooter.form = clamp(shooter.form - 0.08, -1, 1);
    // Miss: off the rim (or nothing but air) into a live rebound.
    b.state = 'loose';
    b.shot = null;
    b.reboundable = true;
    if (!s.airball) {
      b.hitRim = true;
      this.shotClockOff = true;
      this.emit({ type: this.rng.chance(0.25) ? 'backboard' : 'rim' });
      const rim = this.basket(shooter.side);
      // Bounce off the rim, mostly back toward the floor rather than out of bounds behind the backboard.
      let ang = Math.atan2(s.tz - rim.z, s.tx - rim.x) + this.rng.range(-0.9, 0.9);
      const towardCourt = rim.x < HALF ? 1 : -1;
      if (Math.cos(ang) * towardCourt < 0.2) ang = Math.atan2(Math.sin(ang), Math.abs(Math.cos(ang)) * towardCourt + 0.3 * towardCourt);
      const sp = this.rng.range(3, 9);
      b.vx = Math.cos(ang) * sp;
      b.vz = Math.sin(ang) * sp * 0.9;
      b.vh = this.rng.range(4, 10);
    } else {
      b.vx = (s.tx - s.sx) / s.dur * 0.5;
      b.vz = (s.tz - s.sz) / s.dur * 0.5;
      b.vh = -4;
      this.say('AIRBALL', undefined, 0.8);
    }
    this.afterShot(s, false);
  }

  private afterShot(s: ShotInfo, made: boolean) {
    const shooter = s.shooter;
    if (s.kind === 'freeThrow') {
      if (!made) {
        // Missed free throws: only the last one is live.
        if (this.ft && this.ft.remaining > 1) {
          this.ball.state = 'dead';
          this.ball.reboundable = false;
          this.ball.vx = this.ball.vz = 0;
        } else {
          this.clockRunning = true;
        }
      }
      if (this.ft) this.afterFreeThrow(made);
      if (this.buzzerPending || (this.clock <= 0 && this.phase !== 'freeThrow' && !made && this.ft === null && this.phase !== 'live')) {
        /* handled below */
      }
      return;
    }
    if (s.fouledBy) {
      this.ball.reboundable = false;
      this.ball.state = made ? 'dead' : 'dead';
      this.ball.vx *= 0.3;
      this.ball.vz *= 0.3;
      if (made) this.say('AND ONE!', shooter.info.name, 1.2);
      if (this.buzzerPending && !made) {
        // Fouled at the buzzer: free throws still happen with no time left.
      }
      this.buzzerPending = false;
      this.shootingFoul(s.fouledBy, shooter, made, s.value);
      return;
    }
    if (this.buzzerPending) {
      this.buzzerPending = false;
      if (made && this.isClutch) this.say('BUZZER BEATER!', shooter.info.name, 2);
      this.endPeriod();
      return;
    }
    if (made) {
      const other = (1 - shooter.side) as 0 | 1;
      if (this.cfg.mode === 'practice') {
        this.dead(0.9, () => this.resetPracticePossession());
        return;
      }
      this.phase = 'dead';
      this.deadT = 0.7;
      this.deadNext = () => this.setupInbound(other, this.baselineSpot(other), true);
    }
  }

  private addPoints(side: 0 | 1, pts: number) {
    if (this.cfg.mode === 'practice') {
      this.score[side] += pts;
      return;
    }
    this.score[side] += pts;
    this.quarterScores[this.quarterScores.length - 1][side] += pts;
    for (const a of this.allOnCourt()) this.box.get(a.id)!.plusMinus += a.side === side ? pts : -pts;
    if (this.run.side === side) this.run.points += pts;
    else this.run = { side, points: pts };
    this.emit({ type: 'crowd', level: pts >= 3 ? 1 : 0.7 });
  }

  // ---------------------------------------------------------------- results

  toBoxScore(gameId: string): BoxScore {
    const lines = (side: 0 | 1) =>
      this.teams[side].players.map((p) => ({ ...this.box.get(p.id)! }));
    return {
      gameId,
      homeId: this.teams[0].id,
      awayId: this.teams[1].id,
      homeScore: this.score[0],
      awayScore: this.score[1],
      quarterScores: this.quarterScores.map((q) => [q[0], q[1]] as [number, number]),
      overtimes: Math.max(0, this.quarter - 4),
      home: lines(0),
      away: lines(1),
      injuries: this.injuries.slice(),
      played: this.cfg.userSide !== null,
    };
  }

  /** Remaining form values so hot/cold streaks carry between games. */
  formById(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const a of this.actors) out[a.id] = a.form;
    return out;
  }

  /** Simulate to the end with CPU control of both teams (used for "sim rest" and tests). */
  runToEnd(maxSeconds = 60 * 60) {
    this.autopilot = true;
    const noInput: InputState = { mx: 0, mz: 0, sprint: false, shoot: false, pass: false, switchPlayer: false, screen: false, action: false, timeout: false };
    let t = 0;
    while (!this.over && t < maxSeconds) {
      if (this.phase === 'timeout') this.resumeFromTimeout();
      this.update(1 / 30, noInput);
      t += 1 / 30;
    }
  }
}
