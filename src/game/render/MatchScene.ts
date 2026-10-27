import Phaser from 'phaser';
import { buildBall, buildCrowd, buildFloor, buildRimFront, buildShadow, type ArenaSpec } from '../../art/arena';
import { FH, FRAME, FRAME_COUNT, FW, buildPlayerSheet } from '../../art/playerSprite';
import { sfx } from '../../audio/sfx';
import type { Actor } from '../engine/Actor';
import { METER_TARGET, meterWindow } from '../engine/shot';
import type { MatchEngine } from '../engine/MatchEngine';
import type { EngineEvent } from '../engine/types';
import type { InputController } from '../input';
import { PixText, registerBitmapFont } from './bitmapFont';
import { VIEW_H, VIEW_W, WORLD_W, projX, projY } from './projection';

export type MatchHooks = {
  onPause: () => void;
  onTimeout: () => void;
  onFinal: () => void;
};

export type MatchSceneData = {
  engine: MatchEngine;
  input: InputController;
  arena: ArenaSpec;
  hooks: MatchHooks;
  showHints: boolean;
  reduceShake?: boolean;
};

const hexNum = (h: string) => parseInt(h.replace('#', ''), 16);
const STEP = 1 / 60;

type PlayerView = { actor: Actor; sprite: Phaser.GameObjects.Sprite; shadow: Phaser.GameObjects.Image };

export class MatchScene extends Phaser.Scene {
  private e!: MatchEngine;
  private input2!: InputController;
  private hooks!: MatchHooks;
  private arena!: ArenaSpec;
  private views: PlayerView[] = [];
  private ball!: Phaser.GameObjects.Image;
  private ballShadow!: Phaser.GameObjects.Image;
  private rims: Phaser.GameObjects.Sprite[] = [];
  private rimFx = [0, 0];
  private rimKind = [0, 0];
  private crowd!: Phaser.GameObjects.Image;
  private crowdHype = 0;
  private crowdT = 0;
  private fx!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private texts: Record<string, PixText> = {};
  private floaters: { t: PixText; life: number }[] = [];
  private acc = 0;
  private camX = 0;
  paused = false;
  private finalT = -1;
  private timeoutNotified = false;
  private showHints = true;
  private reduceShake = false;
  private uniforms: [[string, string], [string, string]] = [['#fff', '#000'], ['#000', '#fff']];
  private confetti: { x: number; y: number; vx: number; vy: number; c: number; life: number }[] = [];

  constructor() {
    super('match');
  }

  init(data: MatchSceneData) {
    this.e = data.engine;
    this.input2 = data.input;
    this.hooks = data.hooks;
    this.arena = data.arena;
    this.showHints = data.showHints;
    this.reduceShake = !!data.reduceShake;
    this.views = [];
    this.rims = [];
    this.texts = {};
    this.floaters = [];
    this.paused = false;
    this.finalT = -1;
    this.timeoutNotified = false;
    this.acc = 0;
  }

  create() {
    registerBitmapFont(this);
    const tex = this.textures;
    const key = (k: string) => `${k}_${this.arena.seed}`;
    if (!tex.exists(key('floor'))) {
      tex.addCanvas(key('floor'), buildFloor(this.arena));
      for (const f of [0, 1, 2] as const) tex.addCanvas(key('crowd' + f), buildCrowd(this.arena, f));
    }
    if (!tex.exists('ball')) {
      tex.addCanvas('ball', buildBall());
      tex.addCanvas('shadow', buildShadow(12, 4));
      tex.addCanvas('ballShadow', buildShadow(6, 2));
      const rf = buildRimFront();
      const t = tex.addCanvas('rimFront', rf.canvas)!;
      for (let i = 0; i < 4; i++) t.add(i, 0, i * rf.fw, 0, rf.fw, rf.fh);
    }
    this.add.image(0, 0, key('floor')).setOrigin(0, 0).setDepth(0);
    this.crowd = this.add.image(0, 0, key('crowd0')).setOrigin(0, 0).setDepth(1);

    this.uniforms = uniforms(this.e.teams[0].colors, this.e.teams[1].colors);
    for (const a of this.e.actors) {
      const [jersey, trim] = this.uniforms[a.side];
      const k = `p_${a.id}_${jersey}_${trim}`;
      if (!tex.exists(k)) {
        const sheet = buildPlayerSheet({ appearance: a.info.appearance, heightCm: a.info.heightCm, jersey, trim, number: a.info.number });
        const t = tex.addCanvas(k, sheet)!;
        for (let i = 0; i < FRAME_COUNT; i++) t.add(i, 0, i * FW, 0, FW, FH);
      }
      const shadow = this.add.image(0, 0, 'shadow').setOrigin(0.5, 0.5).setDepth(2);
      const sprite = this.add.sprite(0, 0, k, 0).setOrigin(0.5, 1);
      this.views.push({ actor: a, sprite, shadow });
    }
    this.ballShadow = this.add.image(0, 0, 'ballShadow').setDepth(2);
    this.ball = this.add.image(0, 0, 'ball').setOrigin(0.5, 0.5);
    for (const side of [0, 1]) {
      const rx = side === 0 ? 5.25 : 88.75;
      const r = this.add.sprite(Math.round(projX(rx, 25)), Math.round(projY(25, 10)), 'rimFront', 0).setOrigin(8 / 16, 3 / 16);
      r.setDepth(100 + 25 * 10 + 0.2);
      this.rims.push(r);
    }
    this.fx = this.add.graphics().setDepth(900);
    this.hud = this.add.graphics().setDepth(1000).setScrollFactor(0);
    this.buildHudText();

    this.cameras.main.setBounds(0, 0, WORLD_W, VIEW_H);
    this.cameras.main.setRoundPixels(true);
    this.camX = projX(47, 25) - VIEW_W / 2;
    this.cameras.main.scrollX = this.camX;

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on('pointerup', () => (this.input2.pointerShoot = false));
    sfx.startCrowd();
    this.events.once('shutdown', () => sfx.stopCrowd());
    this.syncSprites();
  }

  private onPointerDown(p: Phaser.Input.Pointer) {
    if (this.paused) return;
    const side = this.e.cfg.userSide;
    const wx = p.worldX;
    const wy = p.worldY;
    if (side !== null && this.e.ball.holder === this.e.user && this.e.possession === side) {
      for (const v of this.views) {
        const a = v.actor;
        if (!a.onCourt || a.side !== side || a === this.e.user) continue;
        const sx = v.sprite.x;
        const sy = v.sprite.y;
        if (Math.abs(wx - sx) < 9 && wy < sy + 3 && wy > sy - 32) {
          this.input2.pointerPassTarget = a.id;
          return;
        }
      }
    }
    // Touch devices have dedicated buttons; a tap on the court only shoots with a mouse.
    if (!p.wasTouch) this.input2.pointerShoot = true;
  }

  private buildHudText() {
    const T = (k: string, x: number, y: number, color = 0xffffff, scale = 1) => {
      const t = new PixText(this, x, y, '', color, scale).setScrollFactor(0).setDepth(1001);
      this.texts[k] = t;
      return t;
    };
    T('awayAbbr', 0, 3);
    T('awayScore', 0, 3, 0xffe066);
    T('homeAbbr', 0, 3);
    T('homeScore', 0, 3, 0xffe066);
    T('clock', 0, 3);
    T('shot', 0, 3, 0xff6b4a);
    T('awayInfo', 0, 13, 0xc8c0d8);
    T('homeInfo', 0, 13, 0xc8c0d8);
    T('msg', VIEW_W / 2, 52, 0xffffff, 2).setOrigin(0.5, 0);
    T('msgSub', VIEW_W / 2, 70, 0xffe066).setOrigin(0.5, 0);
    T('player', 6, 4, 0xffffff);
    T('hint', VIEW_W - 6, VIEW_H - 10, 0xb8b0c8).setOrigin(1, 0);
    T('practice', VIEW_W / 2, 24, 0xffe066).setOrigin(0.5, 0);
  }

  update(_time: number, deltaMs: number) {
    const dt = Math.min(0.1, deltaMs / 1000);
    if (this.input2.pauseRequested() && !this.paused && !this.e.over) {
      this.input2.read();
      this.paused = true;
      this.hooks.onPause();
    }
    if (!this.paused) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 6) {
        const input = this.input2.read();
        this.e.update(STEP, input);
        this.acc -= STEP;
        steps++;
        this.handleEvents(this.e.drainEvents());
      }
    }
    if (this.e.phase === 'timeout' && this.e.awaitingUser && !this.timeoutNotified) {
      this.timeoutNotified = true;
      this.hooks.onTimeout();
    }
    if (this.e.phase !== 'timeout') this.timeoutNotified = false;
    if (this.e.over) {
      if (this.finalT < 0) {
        this.finalT = 0;
        const userSide = this.e.cfg.userSide;
        if (userSide !== null && this.e.score[userSide] > this.e.score[1 - userSide]) this.spawnConfetti(40);
      }
      this.finalT += dt;
      if (this.finalT > 2.6 && this.finalT - dt <= 2.6) this.hooks.onFinal();
    }
    this.syncSprites(dt);
    this.drawHud();
  }

  private handleEvents(evts: EngineEvent[]) {
    for (const ev of evts) {
      switch (ev.type) {
        case 'dribble':
          sfx.dribble();
          break;
        case 'pass':
          sfx.pass();
          break;
        case 'catch':
          sfx.catch();
          break;
        case 'shot':
          sfx.shot();
          break;
        case 'swish': {
          sfx.swish();
          const side = this.e.ball.x < 47 ? 0 : 1;
          this.rimFx[side] = 0.45;
          this.rimKind[side] = 1;
          break;
        }
        case 'rim': {
          sfx.rim();
          const side = this.e.ball.x < 47 ? 0 : 1;
          this.rimFx[side] = 0.3;
          this.rimKind[side] = 3;
          break;
        }
        case 'backboard':
          sfx.backboard();
          break;
        case 'dunk':
          sfx.dunk();
          if (!this.reduceShake) this.cameras.main.shake(220, 0.006);
          this.crowdHype = 2.5;
          break;
        case 'block':
          sfx.block();
          if (!this.reduceShake) this.cameras.main.shake(120, 0.003);
          this.crowdHype = 1.5;
          break;
        case 'steal':
          sfx.steal();
          break;
        case 'whistle':
          sfx.whistle();
          break;
        case 'buzzer':
          sfx.buzzer();
          break;
        case 'crowd':
          if (ev.level >= 0.7) sfx.crowd(ev.level);
          break;
        case 'score': {
          const x = projX(ev.x, ev.z);
          const y = projY(ev.z, 11);
          const t = new PixText(this, x, y, ev.label, ev.points >= 3 || ev.label === 'SLAM!' ? 0xffe066 : 0xffffff).setOrigin(0.5, 1).setDepth(950);
          this.floaters.push({ t, life: 1.1 });
          this.crowdHype = Math.max(this.crowdHype, ev.points >= 3 ? 2.2 : 1.4);
          if (ev.side === this.e.cfg.userSide && ev.label === 'SLAM!') this.spawnConfetti(8);
          break;
        }
        case 'message':
          break;
      }
    }
  }

  private spawnConfetti(n: number) {
    const colors = [this.e.teams[0].colors[0], this.e.teams[0].colors[1], '#ffe066', '#ffffff'].map(hexNum);
    for (let i = 0; i < n * 3; i++) {
      this.confetti.push({
        x: this.cameras.main.scrollX + Math.random() * VIEW_W,
        y: -Math.random() * 60,
        vx: (Math.random() - 0.5) * 30,
        vy: 30 + Math.random() * 40,
        c: colors[i % colors.length],
        life: 4 + Math.random() * 2,
      });
    }
  }

  private frameFor(a: Actor): { frame: number; flip: boolean } {
    const flip = a.facing === -1;
    const t = a.anim;
    const e = this.e;
    const hasBall = e.ball.holder === a;
    const spd = a.speed;
    const cyc = (n: number, rate: number) => Math.floor(t * rate) % n;
    switch (a.action) {
      case 'fallen':
        return { frame: FRAME.fallen, flip };
      case 'gather':
        return { frame: FRAME.gather, flip };
      case 'shoot':
        return { frame: FRAME.shoot, flip };
      case 'jump':
        return { frame: FRAME.jump, flip };
      case 'layup':
        return { frame: FRAME.layup, flip };
      case 'dunk':
        return { frame: FRAME.dunk, flip };
      case 'pass':
        return { frame: FRAME.pass, flip };
      case 'steal':
        return { frame: FRAME.steal, flip };
      case 'celebrate':
        return { frame: cyc(2, 4) ? FRAME.celebrate1 : FRAME.celebrate0, flip };
      case 'tired':
        return { frame: FRAME.tired, flip };
      case 'screen':
        return { frame: FRAME.screen, flip };
      case 'stumble':
        return { frame: FRAME.idle1, flip };
      case 'defend':
        return { frame: spd > 1 ? (cyc(2, 6) ? FRAME.defend1 : FRAME.defend0) : FRAME.defend0, flip };
    }
    const rate = 6 + spd * 0.45;
    if (a.view !== 'side' && spd > 1) {
      const p = a.view === 'down' ? 'f_' : 'b_';
      return { frame: FRAME[p + 'run' + cyc(4, rate)], flip: false };
    }
    if (hasBall) {
      if (spd > 1) return { frame: FRAME['dribRun' + cyc(4, rate)], flip };
      return { frame: e.ball.h < 1.6 ? FRAME.drib0 : FRAME.drib1, flip };
    }
    if (spd > 1) return { frame: FRAME['run' + cyc(4, rate)], flip };
    if (a.view === 'down') return { frame: FRAME.f_idle, flip: false };
    if (a.view === 'up') return { frame: FRAME.b_idle, flip: false };
    return { frame: cyc(2, 1.6) ? FRAME.idle1 : FRAME.idle0, flip };
  }

  private syncSprites(dt = 0) {
    const e = this.e;
    for (const v of this.views) {
      const a = v.actor;
      const visible = a.onCourt;
      v.sprite.setVisible(visible);
      v.shadow.setVisible(visible);
      if (!visible) continue;
      const x = Math.round(projX(a.x, a.z));
      const y = Math.round(projY(a.z, a.h));
      const fy = Math.round(projY(a.z, 0));
      v.sprite.setPosition(x, y + 1);
      const f = this.frameFor(a);
      v.sprite.setFrame(f.frame);
      v.sprite.setFlipX(f.flip);
      v.sprite.setDepth(100 + a.z * 10);
      v.shadow.setPosition(x, fy);
      v.shadow.setScale(a.h > 0.5 ? 0.75 : 1);
      // Fatigue and injury tint cues
      v.sprite.setTint(a.injured ? 0xffb0b0 : 0xffffff);
    }

    // Ball
    const b = e.ball;
    const bx = Math.round(projX(b.x, b.z));
    const by = Math.round(projY(b.z, b.h));
    this.ball.setPosition(bx, by);
    this.ballShadow.setPosition(bx, Math.round(projY(b.z, 0)));
    this.ballShadow.setVisible(b.h > 0.3);
    let depth = 100 + b.z * 10 + 0.5;
    for (const rx of [5.25, 88.75]) {
      if (Math.abs(b.x - rx) < 1.6 && Math.abs(b.z - 25) < 1.6 && b.h < 10.3 && b.h > 6) depth = 100 + 25 * 10;
    }
    this.ball.setDepth(depth);

    // Rims & nets
    for (const side of [0, 1]) {
      if (this.rimFx[side] > 0) {
        this.rimFx[side] -= dt;
        const k = this.rimKind[side];
        const frame = k === 1 ? (this.rimFx[side] > 0.22 ? 1 : 2) : this.rimFx[side] % 0.1 > 0.05 ? 3 : 0;
        this.rims[side].setFrame(frame);
      } else this.rims[side].setFrame(0);
    }

    // Crowd animation
    this.crowdT += dt;
    if (this.crowdHype > 0) this.crowdHype -= dt;
    const crowdFrame = this.crowdHype > 0 ? (Math.floor(this.crowdT * 6) % 2 ? 2 : 1) : Math.floor(this.crowdT * 1.5) % 2;
    this.crowd.setTexture(`crowd${crowdFrame}_${this.arena.seed}`);

    // Camera follows the play, leaning toward the basket being attacked.
    const focusSide = e.possession;
    const dir = e.dir(focusSide);
    let fx = projX(b.x, b.z) + dir * 40;
    if (e.phase === 'freeThrow' && e.ft) fx = projX(e.basket(e.ft.shooter.side).x, 25) - dir * 90;
    const target = Phaser.Math.Clamp(fx - VIEW_W / 2, 0, WORLD_W - VIEW_W);
    this.camX += (target - this.camX) * Math.min(1, dt * 3.2);
    this.cameras.main.scrollX = Math.round(this.camX);
    this.cameras.main.scrollY = 0;

    // World-space effects: markers, meter, confetti
    const g = this.fx;
    g.clear();
    const user = e.user;
    const userSide = e.cfg.userSide;
    if (user && user.onCourt && userSide !== null && !e.over && !e.autopilot) {
      const ux = Math.round(projX(user.x, user.z));
      const uy = Math.round(projY(user.z, 0));
      const col = 0xffe066;
      g.fillStyle(col, 1);
      // Bracket marker under the controlled player
      g.fillRect(ux - 7, uy + 1, 3, 1);
      g.fillRect(ux + 5, uy + 1, 3, 1);
      g.fillRect(ux - 7, uy, 1, 1);
      g.fillRect(ux + 7, uy, 1, 1);
      // Arrow above head
      const hy = Math.round(projY(user.z, user.h)) - this.spriteHeight(user) - 4;
      g.fillRect(ux - 2, hy, 5, 1);
      g.fillRect(ux - 1, hy + 1, 3, 1);
      g.fillRect(ux, hy + 2, 1, 1);
      // Shot meter
      if (user.charging >= 0 && user.chargeKind !== 'layup' && user.chargeKind !== 'dunk') this.drawMeter(g, user, ux, hy);
    }
    const pt = e.passTarget;
    if (pt && pt.onCourt && !e.autopilot && Math.floor(this.time.now / 180) % 3 !== 0) {
      const px = Math.round(projX(pt.x, pt.z));
      const py = Math.round(projY(pt.z, pt.h)) - this.spriteHeight(pt) - 4;
      g.fillStyle(0x7ee0ff, 1);
      g.fillRect(px - 1, py, 3, 1);
      g.fillRect(px, py + 1, 1, 1);
      g.fillRect(px - 2, py - 1, 5, 1);
    }
    for (const c of this.confetti) {
      c.life -= dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.vx += Math.sin(c.life * 5) * 10 * dt;
      g.fillStyle(c.c, 1);
      g.fillRect(Math.round(c.x), Math.round(c.y), 2, 1 + (Math.floor(c.life * 8) % 2));
    }
    this.confetti = this.confetti.filter((c) => c.life > 0 && c.y < VIEW_H);

    for (const f of this.floaters) {
      f.life -= dt;
      f.t.setPosition(f.t.main.x, f.t.main.y - dt * 14);
      f.t.setAlpha(Math.min(1, f.life * 2));
    }
    this.floaters = this.floaters.filter((f) => {
      if (f.life <= 0) f.t.destroy();
      return f.life > 0;
    });
  }

  private spriteHeight(a: Actor) {
    return Math.max(21, Math.min(30, Math.round(21 + (a.info.heightCm - 178) / 5))) + 2;
  }

  private drawMeter(g: Phaser.GameObjects.Graphics, a: Actor, x: number, headY: number) {
    const h = 22;
    const x0 = x + 9;
    const y0 = headY - 2;
    g.fillStyle(0x140f1c, 1);
    g.fillRect(x0 - 1, y0 - 1, 5, h + 2);
    g.fillStyle(0x3a3046, 1);
    g.fillRect(x0, y0, 3, h);
    const w = meterWindow(a.r.shooting, a.chargeKind);
    const gy0 = y0 + Math.round((1 - (METER_TARGET + w)) * h);
    const gy1 = y0 + Math.round((1 - (METER_TARGET - w)) * h);
    g.fillStyle(0x3ccf6e, 1);
    g.fillRect(x0, gy0, 3, Math.max(1, gy1 - gy0));
    const m = Math.min(1.05, a.charging);
    const fy = y0 + Math.round((1 - Math.min(1, m)) * h);
    g.fillStyle(m > METER_TARGET + w ? 0xff5a3c : 0xffe066, 1);
    g.fillRect(x0 - 1, fy, 5, 1);
  }

  private drawHud() {
    const e = this.e;
    const g = this.hud;
    g.clear();
    const [home, away] = e.teams;
    // Scorebug
    const W = 236;
    const x0 = Math.round(VIEW_W / 2 - W / 2);
    g.fillStyle(0x140f1c, 0.92);
    g.fillRect(x0, 1, W, 21);
    g.fillStyle(hexNum(this.uniforms[1][0]), 1);
    g.fillRect(x0 + 2, 3, 4, 11);
    g.fillStyle(hexNum(this.uniforms[0][0]), 1);
    g.fillRect(x0 + 126, 3, 4, 11);
    g.fillStyle(0x2a2236, 1);
    g.fillRect(x0 + 62, 3, 62, 11);
    g.fillRect(x0 + 186, 3, 48, 11);
    const fmt = (s: number) => {
      const t = Math.max(0, s);
      if (t < 60) return t.toFixed(1);
      return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    };
    const q = e.quarter <= 4 ? `Q${e.quarter}` : e.quarter === 5 ? 'OT' : `${e.quarter - 4}OT`;
    const T = this.texts;
    const practice = e.cfg.mode === 'practice';
    T.awayAbbr.setText(away.abbr).setPosition(x0 + 9, 5);
    T.awayScore.setText(String(e.score[1])).setPosition(x0 + 58 - T.awayScore.width, 5);
    T.homeAbbr.setText(home.abbr).setPosition(x0 + 133, 5);
    T.homeScore.setText(String(e.score[0])).setPosition(x0 + 182 - T.homeScore.width, 5);
    T.clock.setText(practice ? 'PRACTICE' : `${q} ${fmt(e.clock)}`).setPosition(x0 + 93 - T.clock.width / 2, 5);
    const sc = Math.ceil(e.shotClock);
    T.shot.setText(practice ? '--' : e.shotClockOff ? '--' : String(Math.max(0, sc))).setPosition(x0 + 210 - T.shot.width / 2, 5);
    T.shot.setTint(sc <= 5 ? 0xff3c2c : 0xff9a4a);
    const info = (side: 0 | 1) => {
      const fouls = e.teamFouls[side];
      const bonus = fouls >= 5 ? ' BONUS' : '';
      return `TO ${'•'.repeat(e.timeouts[side])}${bonus}`;
    };
    T.awayInfo.setText(practice ? '' : info(1)).setPosition(x0 + 9, 14);
    T.homeInfo.setText(practice ? '' : info(0)).setPosition(x0 + 133, 14);
    // Possession arrow
    if (!e.over && !practice) {
      g.fillStyle(0xffe066, 1);
      const ax = e.possession === 1 ? x0 + 60 : x0 + 184;
      g.fillRect(ax, 7, 1, 3);
      g.fillRect(ax + (e.possession === 1 ? 1 : -1), 8, 1, 1);
    }

    // Messages
    const m = e.message;
    T.msg.setVisible(!!m).setText(m?.text ?? '');
    T.msgSub.setVisible(!!m?.sub).setText(m?.sub ?? '');
    if (m) {
      const w = Math.max(T.msg.width * 2, T.msgSub.width) + 16;
      g.fillStyle(0x140f1c, 0.8);
      g.fillRect(Math.round(VIEW_W / 2 - w / 2), 48, Math.round(w), m.sub ? 34 : 22);
    }

    // Controlled player card
    const u = e.user;
    if (u && e.cfg.userSide !== null && !e.autopilot) {
      T.player.setVisible(true).setText(`#${u.info.number} ${u.info.name} ${u.info.position}`);
      g.fillStyle(0x140f1c, 0.85);
      g.fillRect(2, 1, Math.max(56, T.player.width + 8), 18);
      g.fillStyle(0x3a3046, 1);
      g.fillRect(6, 13, 46, 3);
      g.fillStyle(u.energy > 0.6 ? 0x3ccf6e : u.energy > 0.35 ? 0xffc23c : 0xff5a3c, 1);
      g.fillRect(6, 13, Math.round(46 * u.energy), 3);
    } else T.player.setVisible(false);

    if (this.showHints && e.cfg.userSide !== null && !e.autopilot) {
      const off = e.possession === e.cfg.userSide;
      T.hint.setVisible(true).setText(off ? 'SPACE SHOOT  E PASS  Q SCREEN  SHIFT SPRINT  ESC MENU' : 'F STEAL/BLOCK  SPACE JUMP  E SWITCH  SHIFT SPRINT');
    } else T.hint.setVisible(false);

    T.practice.setVisible(practice).setText(practice ? `MAKES ${e.practiceMakes} / ${e.practiceShots}` : '');
  }

  /** Called by the UI when the timeout screen closes. */
  resumeAfterTimeout() {
    this.e.resumeFromTimeout();
    this.timeoutNotified = false;
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.acc = 0;
  }
}

/** Home wears its primary colour; the away side switches to its alternate when the two clash. */
export function uniforms(home: [string, string], away: [string, string]): [[string, string], [string, string]] {
  const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const dist = (a: string, b: string) => {
    const [x, y] = [rgb(a), rgb(b)];
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  };
  let awayKit: [string, string] = [away[0], away[1]];
  if (dist(home[0], away[0]) < 110) awayKit = [away[1], away[0]];
  if (dist(home[0], awayKit[0]) < 110) awayKit = dist(home[0], '#f2f2f2') > 140 ? ['#f2f2f2', away[0]] : ['#1c1c28', away[0]];
  return [[home[0], home[1]], awayKit];
}

export function makeGame(parent: HTMLElement, data: MatchSceneData): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: VIEW_W,
    height: VIEW_H,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: '#120e18',
    banner: false,
    audio: { noAudio: true },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    input: { gamepad: false },
    callbacks: {
      postBoot: (g) => {
        g.scene.add('match', MatchScene, true, data);
      },
    },
  });
  return game;
}

