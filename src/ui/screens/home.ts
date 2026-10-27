import { sfx } from '../../audio/sfx';
import type { LeagueSave } from '../../core/types';
import { resolveEvent } from '../../sim/events';
import { standings, teamById, teamRating, userTeam } from '../../sim/league';
import { fullName } from '../../sim/players';
import { advanceDay, nextUserGame, simToUserGame, userSeries, winsNeeded, withRng } from '../../sim/season';
import type { App } from '../app';
import { h } from '../dom';
import { badge, capSummary, meter, screenTitle, shell, starsEl } from '../widgets';

/** Simulate the user's next game (and everything before it). Returns the game id. */
export function simNextUserGame(app: App): string | null {
  let gameId: string | null = null;
  const ok = app.mutate(
    (d) => {
      simToUserGame(d);
      const g = nextUserGame(d);
      if (!g) throw new Error('No game to simulate.');
      if (g.day !== d.day) d.day = g.day;
      advanceDay(d);
      gameId = g.id;
    },
    { render: false },
  );
  return ok ? gameId : null;
}

export function simDays(app: App, untilEnd: boolean) {
  app.mutate((d) => {
    const startPhase = d.phase;
    for (let i = 0; i < (untilEnd ? 400 : 7); i++) {
      if (d.phase !== startPhase || d.phase === 'offseason') break;
      simToUserGame(d);
      if (!nextUserGame(d)) {
        // Season continues without the user (eliminated from playoffs): keep simming days.
        if ((d.phase as string) === 'offseason') break;
        advanceDay(d);
        continue;
      }
      advanceDay(d);
    }
    return untilEnd ? 'Simulated to the end of the phase.' : 'Simulated a week.';
  });
  if (app.league?.phase === 'offseason') app.go('offseason');
}

function eventCard(app: App, l: LeagueSave) {
  const ev = l.pendingEvent;
  if (!ev) return null;
  return h(
    'section',
    { class: 'panel', style: 'border-color:#000;box-shadow: inset 0 0 0 2px var(--gold), 4px 4px 0 rgba(0,0,0,.45)' },
    h('h2', null, `• ${ev.title}`),
    h('p', { style: 'margin-top:0' }, ev.text),
    h(
      'div',
      { class: 'col' },
      ev.options.map((o, i) =>
        h(
          'button',
          {
            class: 'btn block',
            style: 'justify-content:space-between;flex-wrap:wrap;white-space:normal;text-align:left',
            onclick: () => {
              app.mutate((d) => withRng(d, (rng) => resolveEvent(d, i, rng)));
            },
          },
          h('span', null, o.label),
          h('span', { class: 'tiny muted' }, o.effect),
        ),
      ),
    ),
  );
}

export function homeScreen(app: App) {
  const l = app.league!;
  const t = userTeam(l);
  const next = nextUserGame(l);
  const conf = standings(l, t.conference);
  const rank = conf.findIndex((r) => r.team.id === t.id) + 1;
  const roster = t.rosterIds.map((id) => l.players[id]);
  const avgMorale = roster.reduce((s, p) => s + p.morale, 0) / roster.length;
  const injured = roster.filter((p) => p.injury);

  let nextCard: HTMLElement;
  if (next) {
    const home = next.homeId === t.id;
    const opp = teamById(l, home ? next.awayId : next.homeId);
    const series = next.playoff ? userSeries(l) : undefined;
    nextCard = h(
      'section',
      { class: 'panel' },
      h('h2', null, next.playoff ? `Playoffs • Round ${next.playoff.round} • Game ${next.playoff.gameNumber}` : `Next game • Day ${next.day + 1}`),
      h(
        'div',
        { class: 'row', style: 'gap:16px' },
        badge(t, 48),
        h('div', { class: 'x3' }, home ? 'vs' : 'at'),
        badge(opp, 48),
        h('div', null, h('div', { class: 'x3' }, `${opp.city} ${opp.name}`), h('div', { class: 'muted' }, `${opp.wins}-${opp.losses} • Team `, starsEl(Math.round(teamRating(l, opp) * 2) / 2), ` • You `, starsEl(Math.round(teamRating(l, t) * 2) / 2))),
      ),
      series ? h('div', { class: 'gold', style: 'margin-top:8px' }, `Series: ${t.abbr} ${series.highSeedId === t.id ? series.highWins : series.lowWins} - ${series.highSeedId === t.id ? series.lowWins : series.highWins} ${opp.abbr} (first to ${winsNeeded(l)})`) : null,
      h(
        'div',
        { class: 'row', style: 'margin-top:12px' },
        h('button', { class: 'btn big primary', onclick: () => { sfx.unlock(); app.go('pregame'); } }, 'Play ▶'),
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
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => simDays(app, false) }, 'Sim week'),
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              if (await app.confirm('Simulate the rest?', `Simulate every remaining ${l.phase === 'playoffs' ? 'playoff' : 'regular-season'} game, including yours?`, 'Simulate')) simDays(app, true);
            },
          },
          l.phase === 'playoffs' ? 'Sim playoffs' : 'Sim season',
        ),
      ),
    );
  } else if (l.phase === 'playoffs') {
    nextCard = h(
      'section',
      { class: 'panel' },
      h('h2', null, 'Playoffs'),
      h('p', null, 'Your season is over. The playoffs continue without you.'),
      h('button', { class: 'btn primary', onclick: () => simDays(app, true) }, 'Sim to the champion'),
    );
  } else {
    nextCard = h('section', { class: 'panel' }, h('h2', null, 'Season complete'), h('button', { class: 'btn primary', onclick: () => app.go('offseason') }, 'Go to the off-season'));
  }

  const status = h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Team Status'),
    h(
      'div',
      { class: 'col', style: 'gap:8px' },
      h('div', { class: 'row' }, h('span', null, `${t.conference} rank`), h('span', { class: 'spacer' }), h('span', { class: 'gold' }, `#${rank} of ${conf.length}`)),
      h('div', { class: 'row' }, h('span', null, 'Morale'), h('span', { class: 'spacer' }), h('span', null, String(Math.round(avgMorale)))),
      meter(avgMorale),
      h('div', { class: 'row' }, h('span', null, 'Chemistry'), h('span', { class: 'spacer' }), h('span', null, String(t.chemistry))),
      meter(t.chemistry, 100, 'team'),
      h('div', { class: 'row' }, h('span', null, 'Fan support'), h('span', { class: 'spacer' }), h('span', null, String(Math.round(t.fanSupport)))),
      meter(t.fanSupport, 100, 'gold'),
      h('div', { class: 'row' }, h('span', null, 'Front-office confidence'), h('span', { class: 'spacer' }), h('span', { class: l.coach.confidence < 30 ? 'bad' : '' }, String(Math.round(l.coach.confidence)))),
      meter(l.coach.confidence),
      capSummary(l, t),
    ),
  );

  const injuries = h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Injury Report'),
    injured.length
      ? h('ul', { class: 'news' }, injured.map((p) => h('li', { class: 'bad' }, `${fullName(p)} • ${p.injury!.type} • ${p.injury!.gamesRemaining} game${p.injury!.gamesRemaining > 1 ? 's' : ''}`)))
      : h('div', { class: 'good' }, 'Everyone is healthy.'),
  );

  const objectives = h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Season Objectives'),
    h(
      'ul',
      { class: 'news' },
      l.objectives.map((o) => h('li', { class: o.done ? 'good' : 'info' }, `${o.label} • +${o.reward} credits${o.done ? ' • DONE' : ''}`)),
    ),
  );

  const news = h('section', { class: 'panel' }, h('h2', null, 'News'), h('ul', { class: 'news' }, l.news.slice(0, 30).map((n) => h('li', { class: n.kind }, n.text))));

  return shell(
    app,
    'home',
    screenTitle('Franchise Home', h('span', { class: 'muted' }, l.phase === 'playoffs' ? 'Playoffs' : `Regular season • ${l.schedule.filter((g) => !g.playoff && g.played && (g.homeId === t.id || g.awayId === t.id)).length}/${l.settings.seasonGames} played`)),
    h('div', { class: 'grid two' }, h('div', { class: 'col', style: 'gap:14px' }, nextCard, eventCard(app, l) ?? h('div'), status), h('div', { class: 'col', style: 'gap:14px' }, objectives, injuries, news)),
  );
}
