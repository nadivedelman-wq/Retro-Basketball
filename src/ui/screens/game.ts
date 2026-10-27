import type Phaser from 'phaser';
import { sfx } from '../../audio/sfx';
import { hashString } from '../../core/rng';
import type { BoxScore, LeagueSave } from '../../core/types';
import { MatchEngine } from '../../game/engine/MatchEngine';
import type { MatchConfig } from '../../game/engine/types';
import { InputController, keyLabel, type ControlAction } from '../../game/input';
import { makeGame, type MatchScene } from '../../game/render/MatchScene';
import { createLeague, DEFAULT_SETTINGS, teamById, teamRating, userTeam } from '../../sim/league';
import { matchConfig } from '../../sim/matchSetup';
import { fullName, stars } from '../../sim/players';
import { advanceDay, gameById, nextUserGame, simToUserGame } from '../../sim/season';
import type { App } from '../app';
import { h } from '../dom';
import { badge, boxScoreView, portrait, starsEl } from '../widgets';
import { simNextUserGame } from './home';
import { TEAM_SEEDS } from '../../sim/data';
import { seg } from './career';

function useTouch(app: App) {
  const s = app.settings.touchControls;
  if (s === 'on') return true;
  if (s === 'off') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export function pregameScreen(app: App) {
  const l0 = app.league!;
  const g0 = nextUserGame(l0);
  if (g0 && g0.day !== l0.day) app.mutate((d) => simToUserGame(d), { render: false });
  const l = app.league!;
  const g = nextUserGame(l);
  if (!g) {
    queueMicrotask(() => app.go('home'));
    return h('div');
  }
  const home = teamById(l, g.homeId);
  const away = teamById(l, g.awayId);
  const side = (t: typeof home) =>
    h(
      'section',
      { class: 'panel', style: `border-top:6px solid ${t.colors[0]}` },
      h('div', { class: 'row' }, badge(t, 48), h('div', null, h('div', { class: 'x3' }, `${t.city} ${t.name}`), h('div', { class: 'muted' }, `${t.wins}-${t.losses} • Team `, starsEl(Math.round(teamRating(l, t) * 2) / 2)))),
      h('h3', { style: 'margin-top:10px' }, 'Starters'),
      t.starters.map((id) => {
        const p = l.players[id];
        return h('div', { class: 'row', style: 'margin:4px 0' }, portrait(l, p), h('div', { style: 'flex:1' }, h('div', null, `#${p.jerseyNumber} ${fullName(p)}`), h('div', { class: 'tiny muted' }, `${p.position} • ${p.archetype} • ${(p.seasonStats.points / Math.max(1, p.seasonStats.games)).toFixed(1)} ppg`)), starsEl(stars(p)));
      }),
      (() => {
        const inj = t.rosterIds.map((id) => l.players[id]).filter((p) => p.injury);
        return inj.length ? h('div', { class: 'bad tiny', style: 'margin-top:6px' }, `Out: ${inj.map((p) => p.lastName).join(', ')}`) : null;
      })(),
    );
  const keys = app.settings.bindings;
  const k = (a: ControlAction) => h('span', { class: 'key' }, keyLabel(keys[a][0]));
  return h(
    'div',
    { class: 'main', style: 'margin:0 auto' },
    h('div', { class: 'screen-title' }, h('button', { class: 'btn', onclick: () => app.go('home') }, '◀ Back'), h('h1', null, g.playoff ? `Playoffs • Game ${g.playoff.gameNumber}` : `Game Day ${g.day + 1}`)),
    h('div', { class: 'grid two' }, side(away), side(home)),
    h(
      'section',
      { class: 'panel', style: 'margin-top:14px' },
      h('h2', null, 'Controls'),
      h(
        'div',
        { class: 'grid three', style: 'gap:6px' },
        h('div', null, k('up'), k('left'), k('down'), k('right'), ' move'),
        h('div', null, k('shoot'), ' hold & release to shoot (green zone!). Near the rim: layup/dunk'),
        h('div', null, k('pass'), ' pass to the marked teammate (aim with move keys) / switch on D'),
        h('div', null, k('sprint'), ' sprint (drains energy)'),
        h('div', null, k('screen'), ' call a screen'),
        h('div', null, k('action'), ' steal / block / jump for rebounds'),
        h('div', null, k('timeout'), ' timeout (substitutions)  ', k('pause'), ' pause'),
        h('div', { class: 'muted' }, 'Mouse: click a teammate to pass; hold/release on the court to shoot.'),
      ),
    ),
    h(
      'div',
      { class: 'row', style: 'margin:16px 0 40px;justify-content:flex-end' },
      h('span', { class: 'muted' }, `${l.settings.quarterMinutes}-minute quarters • ${l.settings.difficulty}`),
      h(
        'button',
        {
          class: 'btn big',
          onclick: () => {
            const id = simNextUserGame(app);
            if (id) app.go('postgame', { gameId: id, simulated: true });
          },
        },
        'Simulate',
      ),
      h('button', { class: 'btn big primary', onclick: () => { sfx.unlock(); app.go('game', { gameId: g.id }); } }, 'Tip Off ▶'),
    ),
  );
}

type LiveParams = { gameId?: string; quick?: { cfg: MatchConfig; league: LeagueSave } };

export function liveGameScreen(app: App, params: Record<string, unknown>) {
  const p = params as LiveParams;
  const franchise = !p.quick;
  const league = p.quick ? p.quick.league : app.league!;
  let cfg: MatchConfig;
  let gameId = 'quick';
  if (p.quick) cfg = p.quick.cfg;
  else {
    const g = gameById(league, p.gameId!);
    if (!g || g.played) {
      queueMicrotask(() => app.go('home'));
      return h('div');
    }
    gameId = g.id;
    cfg = matchConfig(league, g.homeId, g.awayId, { gameId: g.id });
  }
  const engine = new MatchEngine(cfg);
  (window as unknown as { __engine?: MatchEngine }).__engine = engine; // handy for debugging and automated play-tests
  const input = new InputController(app.settings.bindings);
  const stage = h('div', { class: 'stage' });
  const root = h('div', { class: 'game-root' }, stage);
  let game: Phaser.Game | null = null;
  let overlay: HTMLElement | null = null;
  const scene = () => game?.scene.getScene('match') as MatchScene | undefined;
  const homeTeam = league.teams.find((t) => t.id === cfg.home.id)!;

  const closeOverlay = () => {
    overlay?.remove();
    overlay = null;
  };

  const finish = () => {
    const box = engine.toBoxScore(gameId);
    if (!franchise) {
      app.go('postgame', { quickBox: box, quickLeague: league });
      return;
    }
    const form = engine.formById();
    const ok = app.mutate(
      (d) => {
        for (const [id, f] of Object.entries(form)) if (d.players[id]) d.players[id].form = f * 0.6;
        advanceDay(d, box);
      },
      { render: false },
    );
    if (ok) app.go('postgame', { gameId });
    else app.go('home');
  };

  const subsPanel = (onDone: () => void, title: string) => {
    const side = engine.cfg.userSide ?? 0;
    let picked: string | null = null;
    const body = h('div', { class: 'col' });
    const draw = () => {
      const on = engine.onCourt(side);
      const bench = engine.bench(side);
      const can = engine.canSubstitute();
      const row = (a: (typeof on)[number], onCourt: boolean) =>
        h(
          'button',
          {
            class: `btn block ${picked === a.id ? 'primary' : ''}`,
            style: 'justify-content:space-between',
            disabled: !can || a.fouledOut || a.injured,
            onclick: () => {
              if (onCourt) picked = picked === a.id ? null : a.id;
              else if (picked) {
                const err = engine.substitute(side, picked, a.id);
                if (err) app.toast(err, true);
                else sfx.select();
                picked = null;
              } else app.toast('Pick a player on the court first, then his replacement.');
              draw();
            },
          },
          h('span', null, `#${a.info.number} ${a.info.name} ${a.info.position}`),
          h('span', { class: 'tiny' }, `${a.fouledOut ? 'FOULED OUT ' : a.injured ? 'INJURED ' : ''}PF ${a.fouls} • ${Math.round(a.energy * 100)}%`),
        );
      body.replaceChildren(
        can ? h('div', { class: 'muted' }, 'Tap a player on the court, then the bench player to bring in.') : h('div', { class: 'warn' }, 'Substitutions are only allowed at a dead ball or in a timeout.'),
        h('div', { class: 'grid two' }, h('div', { class: 'col', style: 'gap:6px' }, h('h3', null, 'On court'), on.map((a) => row(a, true))), h('div', { class: 'col', style: 'gap:6px' }, h('h3', null, 'Bench'), bench.map((a) => row(a, false)))),
      );
    };
    draw();
    return h('div', { class: 'overlay-menu' }, h('div', { class: 'panel' }, h('h2', null, title), body, h('div', { class: 'row', style: 'margin-top:12px;justify-content:flex-end' }, h('button', { class: 'btn primary', onclick: onDone }, 'Back to the game'))));
  };

  const showPause = () => {
    closeOverlay();
    const s = scene();
    s?.setPaused(true);
    const resume = () => {
      closeOverlay();
      s?.setPaused(false);
    };
    const panel = h(
      'div',
      { class: 'panel', style: 'max-width:640px' },
      h('h2', null, 'Paused'),
      h(
        'div',
        { class: 'col' },
        h('button', { class: 'btn big primary', onclick: resume }, 'Resume'),
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              const box = engine.toBoxScore(gameId);
              const v = boxScoreView(league, box);
              overlay?.remove();
              overlay = h('div', { class: 'overlay-menu' }, h('div', { class: 'panel' }, h('h2', null, 'Box Score'), v, h('div', { class: 'row', style: 'margin-top:10px;justify-content:flex-end' }, h('button', { class: 'btn primary', onclick: showPause }, 'Back'))));
              root.appendChild(overlay);
            },
          },
          'Box score',
        ),
        h(
          'button',
          {
            class: 'btn',
            disabled: engine.cfg.mode === 'practice',
            onclick: () => {
              overlay?.remove();
              overlay = subsPanel(showPause, 'Substitutions');
              root.appendChild(overlay);
            },
          },
          'Substitutions',
        ),
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              app.settings.muted = !app.settings.muted;
              app.saveSettings();
              showPause();
            },
          },
          app.settings.muted ? 'Sound: OFF' : 'Sound: ON',
        ),
        engine.cfg.mode === 'practice'
          ? null
          : h(
              'button',
              {
                class: 'btn',
                onclick: () => {
                  engine.runToEnd();
                  closeOverlay();
                  finish();
                },
              },
              'Simulate to the final buzzer',
            ),
        h(
          'button',
          {
            class: 'btn danger',
            onclick: async () => {
              if (!franchise || (await app.confirm('Leave game?', 'Leave now? This game will not count and will be waiting for you on the schedule.', 'Leave'))) {
                app.go(franchise ? 'home' : 'title');
              }
            },
          },
          franchise ? 'Abandon game' : 'Quit to menu',
        ),
      ),
    );
    overlay = h('div', { class: 'overlay-menu' }, panel);
    root.appendChild(overlay);
  };

  const showTimeout = () => {
    closeOverlay();
    overlay = subsPanel(() => {
      closeOverlay();
      scene()?.resumeAfterTimeout();
    }, 'Timeout');
    root.appendChild(overlay);
  };

  const pauseBtn = h('button', { class: 'btn small', onclick: () => showPause(), 'aria-label': 'Pause' }, 'II');
  const toBtn = h('button', { class: 'btn small', onclick: () => input.touch.pressed.add('timeout') }, 'T/O');
  root.appendChild(h('div', { class: 'game-top' }, engine.cfg.mode === 'practice' ? null : toBtn, pauseBtn));

  if (useTouch(app)) root.appendChild(touchOverlay(input));

  queueMicrotask(() => {
    sfx.unlock();
    game = makeGame(stage, {
      engine,
      input,
      arena: {
        primary: homeTeam.colors[0],
        secondary: homeTeam.colors[1],
        abbr: homeTeam.abbr,
        city: homeTeam.city,
        awayPrimary: cfg.away.colors[0],
        leagueName: league.settings.leagueName,
        seed: hashString(homeTeam.id) % 1000,
      },
      hooks: {
        onPause: showPause,
        onTimeout: showTimeout,
        onFinal: finish,
      },
      showHints: app.settings.showHints && !useTouch(app),
      reduceShake: app.settings.reduceShake,
    });
  });

  app.onLeave(() => {
    input.destroy();
    game?.destroy(true);
    game = null;
  });
  return root;
}

/** Pointer capture keeps a held button pressed when the finger slides off; harmless if unavailable. */
function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* pointer already released */
  }
}

function touchOverlay(input: InputController) {
  const knob = h('div', { class: 'knob' });
  const stick = h('div', { class: 'stick' }, knob);
  let sid: number | null = null;
  const moveStick = (e: PointerEvent) => {
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width / 2);
    let dy = (e.clientY - cy) / (r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    input.touch.mx = Math.abs(dx) < 0.2 ? 0 : dx;
    input.touch.mz = Math.abs(dy) < 0.2 ? 0 : dy;
    knob.style.transform = `translate(${dx * 45}px, ${dy * 45}px)`;
  };
  stick.addEventListener('pointerdown', (e) => {
    sid = e.pointerId;
    capture(stick, e.pointerId);
    moveStick(e);
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId === sid) moveStick(e);
  });
  const endStick = (e: PointerEvent) => {
    if (e.pointerId !== sid) return;
    sid = null;
    input.touch.mx = input.touch.mz = 0;
    knob.style.transform = '';
  };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

  const hold = (label: string, cls: string, set: (v: boolean) => void) => {
    const b = h('div', { class: `tb ${cls}`, role: 'button', 'aria-label': label }, label);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(b, e.pointerId);
      b.classList.add('on');
      set(true);
    });
    const up = () => {
      b.classList.remove('on');
      set(false);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    return b;
  };
  const tap = (label: string, action: ControlAction) => {
    const b = h('div', { class: 'tb', role: 'button', 'aria-label': label }, label);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.touch.pressed.add(action);
      b.classList.add('on');
      setTimeout(() => b.classList.remove('on'), 120);
    });
    return b;
  };
  const buttons = h(
    'div',
    { class: 'buttons' },
    tap('SCREEN', 'screen'),
    tap('STEAL BLOCK', 'action'),
    hold('SPRINT', '', (v) => (input.touch.sprint = v)),
    tap('PASS SWITCH', 'pass'),
    h('div'),
    hold('SHOOT', 'shoot', (v) => (input.touch.shoot = v)),
  );
  return h('div', { class: 'touch' }, stick, buttons);
}

export function postgameScreen(app: App, params: Record<string, unknown>) {
  if (params.quickBox) {
    const league = params.quickLeague as LeagueSave;
    const box = params.quickBox as BoxScore;
    return h(
      'div',
      { class: 'main', style: 'margin:0 auto' },
      h('div', { class: 'screen-title' }, h('h1', null, 'Final'), h('span', { class: 'muted' }, 'Exhibition • does not count')),
      h('section', { class: 'panel' }, boxScoreView(league, box)),
      h('div', { class: 'row', style: 'margin:16px 0 40px;justify-content:flex-end' }, h('button', { class: 'btn', onclick: () => app.go('quick', { mode: 'game' }) }, 'Play again'), h('button', { class: 'btn primary', onclick: () => app.go('title') }, 'Main menu')),
    );
  }
  const l = app.league!;
  const box = l.boxScores[params.gameId as string];
  if (!box) {
    queueMicrotask(() => app.go('home'));
    return h('div');
  }
  const t = userTeam(l);
  const mine = box.homeId === t.id ? box.home : box.away;
  const myScore = box.homeId === t.id ? box.homeScore : box.awayScore;
  const theirScore = box.homeId === t.id ? box.awayScore : box.homeScore;
  const won = myScore > theirScore;
  const pog = mine.slice().sort((a, b) => b.points + 1.2 * (b.offRebounds + b.defRebounds) + 1.5 * b.assists - (a.points + 1.2 * (a.offRebounds + a.defRebounds) + 1.5 * a.assists))[0];
  const pogPlayer = pog ? l.players[pog.playerId] : null;
  if (won) sfx.fanfare();
  return h(
    'div',
    { class: 'main', style: 'margin:0 auto' },
    h('div', { class: 'screen-title' }, h('h1', { class: won ? 'good' : 'bad' }, won ? 'Victory!' : 'Defeat'), h('span', { class: 'muted' }, params.simulated ? 'Simulated' : 'Played live')),
    h(
      'div',
      { class: 'grid two' },
      h('section', { class: 'panel' }, h('h2', null, 'Box Score'), boxScoreView(l, box)),
      h(
        'div',
        { class: 'col', style: 'gap:14px' },
        pogPlayer
          ? h(
              'section',
              { class: 'panel' },
              h('h2', null, 'Player of the Game'),
              h('div', { class: 'row' }, portrait(l, pogPlayer, 'portrait lg'), h('div', null, h('div', { class: 'x3' }, fullName(pogPlayer)), h('div', { class: 'gold' }, `${pog!.points} pts • ${pog!.offRebounds + pog!.defRebounds} reb • ${pog!.assists} ast`), h('div', { class: 'muted' }, `${pog!.fgm}-${pog!.fga} FG • ${pog!.threePm}-${pog!.threePa} 3P`))),
            )
          : null,
        h(
          'section',
          { class: 'panel' },
          h('h2', null, 'Around the league'),
          h('ul', { class: 'news' }, l.news.slice(0, 10).map((n) => h('li', { class: n.kind }, n.text))),
        ),
        h(
          'section',
          { class: 'panel' },
          h('h2', null, 'Development'),
          h(
            'div',
            { class: 'col', style: 'gap:4px' },
            mine
              .filter((x) => x.seconds > 0)
              .map((x) => l.players[x.playerId])
              .filter(Boolean)
              .map((pl) => h('div', { class: 'row' }, h('span', { style: 'flex:1' }, `${pl.firstName[0]}. ${pl.lastName}`), h('div', { style: 'width:120px' }, h('div', { class: 'bar team' }, h('i', { style: `width:${Math.min(100, pl.xp)}%` }))), h('span', { class: 'tiny muted', style: 'width:70px;text-align:right' }, `${Math.floor(pl.xp)} XP`))),
          ),
        ),
      ),
    ),
    h('div', { class: 'row', style: 'margin:16px 0 40px;justify-content:flex-end' }, h('button', { class: 'btn big primary', onclick: () => app.go(l.phase === 'offseason' ? 'offseason' : 'home') }, 'Continue ▶')),
  );
}

/** Exhibition and practice: pick two teams from a throwaway league. */
export function quickScreen(app: App, params: Record<string, unknown>) {
  const mode = (params.mode as 'game' | 'practice') ?? 'game';
  const seed = (params.seed as number) ?? 12345;
  const league = createLeague({ seed, userTeamId: TEAM_SEEDS[0].abbr.toLowerCase(), coachName: 'Guest', settings: { ...DEFAULT_SETTINGS }, slot: 'quick' });
  let mine = (params.mine as string) ?? league.teams[0].id;
  let opp = (params.opp as string) ?? league.teams[15].id;
  let qm = (params.qm as 1 | 2 | 3 | 5) ?? 2;
  let diff = (params.diff as typeof league.settings.difficulty) ?? 'pro';
  const picker = (label: string, cur: string, set: (id: string) => void) =>
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'muted' }, label),
      h(
        'select',
        { onchange: (e: Event) => set((e.target as HTMLSelectElement).value) },
        league.teams.map((t) => h('option', { value: t.id, selected: t.id === cur }, `${t.city} ${t.name} (${(Math.round(teamRating(league, t) * 2) / 2).toFixed(1)}★)`)),
      ),
    );
  const start = () => {
    league.settings.quarterMinutes = qm;
    league.settings.difficulty = diff;
    const cfg = matchConfig(league, mine, opp, { gameId: `quick${Date.now()}`, mode, userTeamId: mine });
    app.go('game', { quick: { cfg, league } });
  };
  return h(
    'div',
    { class: 'main', style: 'margin:0 auto;max-width:860px' },
    h('div', { class: 'screen-title' }, h('button', { class: 'btn', onclick: () => app.go('title') }, '◀ Back'), h('h1', null, mode === 'practice' ? 'Practice' : 'Quick Game')),
    h(
      'section',
      { class: 'panel' },
      h('h2', null, 'Setup'),
      h(
        'div',
        { class: 'col' },
        picker('Your team (home)', mine, (v) => (mine = v)),
        mode === 'game' ? picker('Opponent', opp, (v) => (opp = v)) : h('div', { class: 'muted' }, 'Practice: unlimited possessions on offence against a light defence. No clock.'),
        mode === 'game' ? h('label', { class: 'field' }, h('span', { class: 'muted' }, 'Quarter length'), seg([1, 2, 3, 5].map((n) => ({ value: n, label: `${n} min` })), qm, (v) => (qm = v as 1 | 2 | 3 | 5))) : null,
        h('label', { class: 'field' }, h('span', { class: 'muted' }, 'Difficulty'), seg((['rookie', 'pro', 'allstar', 'legend'] as const).map((d) => ({ value: d, label: d })), diff, (v) => (diff = v))),
      ),
    ),
    h('div', { class: 'row', style: 'margin:16px 0;justify-content:flex-end' }, h('button', { class: 'btn big primary', onclick: () => { sfx.unlock(); start(); } }, mode === 'practice' ? 'Hit the court ▶' : 'Tip Off ▶')),
  );
}
