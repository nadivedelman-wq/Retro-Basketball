import type { MatchPlayerInfo } from './types';

export type Action =
  | 'idle'
  | 'run'
  | 'dribble'
  | 'gather'
  | 'shoot'
  | 'layup'
  | 'dunk'
  | 'pass'
  | 'steal'
  | 'jump'
  | 'celebrate'
  | 'tired'
  | 'stumble'
  | 'defend'
  | 'screen'
  | 'fallen';

/** One player on (or beside) the court during a live match. */
export class Actor {
  readonly info: MatchPlayerInfo;
  readonly side: 0 | 1;
  x = 0;
  z = 0;
  h = 0;
  vx = 0;
  vz = 0;
  vh = 0;
  facing: 1 | -1 = 1;
  /** 'side' for left/right, 'up' walking away from camera, 'down' toward camera. */
  view: 'side' | 'up' | 'down' = 'side';
  action: Action = 'idle';
  actionT = 0;
  anim = 0;
  energy: number;
  fouls = 0;
  onCourt = false;
  fouledOut = false;
  injured = false;
  slot = 0;
  form: number;

  // Movement intent (set by AI or input each frame)
  tx = 0;
  tz = 0;
  wantSprint = false;
  sprinting = false;
  stealCd = 0;
  slowT = 0;
  stumbleT = 0;

  // Shooting
  charging = -1; // shot meter 0..1, -1 when not shooting
  chargeKind: 'jumper' | 'layup' | 'dunk' | 'hook' | 'freeThrow' = 'jumper';
  cpuRelease = 0;
  cpuQuality = 0.7;

  // AI state
  thinkT = 0;
  cutT = 5;
  cutting = 0;
  screenT = 0;
  screenSet = 0;
  rollT = 0;
  holdT = 0;
  driveT = 0;
  jumpDelay = -1;
  /** Position as perceived by defenders (lags reality slightly, so cuts and crossovers create space). */
  seenX = 0;
  seenZ = 0;
  assignment: Actor | null = null;

  constructor(info: MatchPlayerInfo, side: 0 | 1) {
    this.info = info;
    this.side = side;
    this.energy = info.startEnergy;
    this.form = info.form;
  }

  get id() {
    return this.info.id;
  }

  get heightFt() {
    return this.info.heightCm / 30.48;
  }

  get r() {
    return this.info.ratings;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  /** Standing reach in feet, plus the current jump height. */
  reach(): number {
    return this.heightFt * 1.32 + this.h;
  }

  setAction(a: Action, t = 0) {
    if (this.action !== a) this.anim = 0;
    this.action = a;
    this.actionT = t;
  }

  get airborne() {
    return this.h > 0.05;
  }

  get busy() {
    return this.charging >= 0 || this.stumbleT > 0 || this.action === 'layup' || this.action === 'dunk';
  }
}
