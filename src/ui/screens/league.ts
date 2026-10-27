import { teamName } from '../../sim/data';
import type { LeagueSave, Player } from '../../core/types';
import { standings, teamById, userTeam } from '../../sim/league';
import { fullName } from '../../sim/players';
import type { App } from '../app';
import { h } from '../dom';
import { badge, boxScoreView, screenTitle, shell } from '../widgets';
import { seg } from './career';
import { openPlayer } from './roster';

export function openBox(app: App, gameId: string) {
  const l = app.league!;
  const box = l.boxScores[gameId];
  if (!box) {
    app.toast('Box score not available.', true);
    return;
  }
  const close = app.modal('Box Score', boxScoreView(l, box, (id) => { close(); openPlayer(app, id); }), { wide: true });
}

function scheduleView(app: App, l: LeagueSave) {
  const t = userTeam(l);
  const games = l.schedule.filter((g) => g.homeId === t.id || g.awayId === t.id).sort((a, b) => a.day - b.day);
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 't' },
      h('thead', null, h('tr', null, ['Day', 'Opponent', 'Result', ''].map((c) => h('th', null, c)))),
      h(
        'tbody',
        null,
        games.map((g) => {
          const home = g.homeId === t.id;
          const opp = teamById(l, home ? g.awayId : g.homeId);
          const my = home ? g.homeScore : g.awayScore;
          const their = home ? g.awayScore : g.homeScore;
          const won = g.played && (my ?? 0) > (their ?? 0);
          return h(
            'tr',
            { class: g.played ? 'click' : '', onclick: g.played ? () => openBox(app, g.id) : undefined },
            h('td', null, g.playoff ? `PO R${g.playoff.round} G${g.playoff.gameNumber}` : String(g.day + 1)),
            h('td', null, badge(opp, 20), ` ${home ? 'vs' : '@'} ${teamName(opp)}`),
            h('td', { class: g.played ? (won ? 'good' : 'bad') : 'muted' }, g.played ? `${won ? 'W' : 'L'} ${my}-${their}` : '-'),
            h('td', { class: 'tiny muted' }, g.played && l.boxScores[g.id]?.played ? 'played live' : g.played ? 'simulated' : ''),
          );
        }),
      ),
    ),
  );
}

function standingsView(l: LeagueSave) {
  const t = userTeam(l);
  return h(
    'div',
    { class: 'grid two' },
    (['East', 'West'] as const).map((conf) =>
      h(
        'div',
        { class: 'col' },
        h('h3', null, `${conf}ern Conference`),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 't' },
            h('thead', null, h('tr', null, ['#', 'Team', 'W', 'L', 'Pct', 'GB', 'Diff', 'Strk'].map((c, i) => h('th', { class: i > 1 ? 'num' : '' }, c)))),
            h(
              'tbody',
              null,
              standings(l, conf).map((r, i) =>
                h(
                  'tr',
                  { class: r.team.id === t.id ? 'me' : '', style: i === l.settings.playoffTeams / 2 - 1 ? 'border-bottom:3px solid var(--gold)' : '' },
                  h('td', { class: i < l.settings.playoffTeams / 2 ? 'gold' : 'muted' }, String(i + 1)),
                  h('td', null, badge(r.team, 20), ` ${r.team.city}`),
                  h('td', { class: 'num' }, String(r.wins)),
                  h('td', { class: 'num' }, String(r.losses)),
                  h('td', { class: 'num' }, r.pct.toFixed(3).replace(/^0/, '')),
                  h('td', { class: 'num' }, r.gb ? r.gb.toFixed(1) : '-'),
                  h('td', { class: `num ${r.diff > 0 ? 'good' : r.diff < 0 ? 'bad' : ''}` }, (r.diff > 0 ? '+' : '') + r.diff),
                  h('td', { class: 'num' }, r.streak > 0 ? `W${r.streak}` : r.streak < 0 ? `L${-r.streak}` : '-'),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    h('div', { class: 'tiny muted' }, `Top ${l.settings.playoffTeams / 2} in each conference make the playoffs. Ties: win %, head-to-head, point differential.`),
  );
}

function leadersView(app: App, l: LeagueSave) {
  const minG = Math.max(1, Math.floor(Math.max(...l.teams.map((t) => t.wins + t.losses)) * 0.4));
  const pool = l.teams.flatMap((t) => t.rosterIds.map((id) => l.players[id])).filter((p) => p.seasonStats.games >= minG);
  const cats: [string, (p: Player) => number, (v: number) => string][] = [
    ['Points', (p) => p.seasonStats.points / p.seasonStats.games, (v) => v.toFixed(1)],
    ['Rebounds', (p) => p.seasonStats.rebounds / p.seasonStats.games, (v) => v.toFixed(1)],
    ['Assists', (p) => p.seasonStats.assists / p.seasonStats.games, (v) => v.toFixed(1)],
    ['Steals', (p) => p.seasonStats.steals / p.seasonStats.games, (v) => v.toFixed(1)],
    ['Blocks', (p) => p.seasonStats.blocks / p.seasonStats.games, (v) => v.toFixed(1)],
    ['3-pointers made', (p) => p.seasonStats.threePm, (v) => String(v)],
  ];
  const team = (p: Player) => l.teams.find((t) => t.rosterIds.includes(p.id))!;
  if (!pool.length) return h('div', { class: 'muted' }, 'Leaders appear once games have been played.');
  return h(
    'div',
    { class: 'grid three' },
    cats.map(([label, f, fmt]) =>
      h(
        'div',
        { class: 'panel dark' },
        h('h3', null, label),
        pool
          .slice()
          .sort((a, b) => f(b) - f(a))
          .slice(0, 5)
          .map((p, i) =>
            h(
              'div',
              { class: 'row', style: 'cursor:pointer', onclick: () => openPlayer(app, p.id) },
              h('span', { class: 'muted', style: 'width:20px' }, String(i + 1)),
              badge(team(p), 20),
              h('span', { style: 'flex:1' }, `${p.firstName[0]}. ${p.lastName}`),
              h('span', { class: 'gold' }, fmt(f(p))),
            ),
          ),
      ),
    ),
  );
}

export function bracketView(l: LeagueSave) {
  if (!l.playoffs.length) return h('div', { class: 'muted' }, 'The bracket is set when the regular season ends.');
  const rounds = Math.max(...l.playoffs.map((s) => s.round));
  return h(
    'div',
    { class: 'bracket' },
    Array.from({ length: rounds }, (_, r) =>
      h(
        'div',
        { class: 'round' },
        h('div', { class: 'gold' }, r + 1 === Math.log2(l.settings.playoffTeams) ? 'Finals' : `Round ${r + 1}`),
        l.playoffs
          .filter((s) => s.round === r + 1)
          .map((s) => {
            const hi = teamById(l, s.highSeedId);
            const lo = teamById(l, s.lowSeedId);
            return h(
              'div',
              { class: 'series' },
              h('div', { class: s.winnerId === hi.id ? 'w' : '' }, badge(hi, 16), ` ${s.highSeed} ${hi.abbr} `, h('span', { style: 'float:right' }, String(s.highWins))),
              h('div', { class: s.winnerId === lo.id ? 'w' : '' }, badge(lo, 16), ` ${s.lowSeed} ${lo.abbr} `, h('span', { style: 'float:right' }, String(s.lowWins))),
            );
          }),
      ),
    ),
  );
}

function teamStatsView(l: LeagueSave) {
  const rows = l.teams.map((t) => {
    const g = t.wins + t.losses;
    return { t, g, ppg: g ? t.pointsFor / g : 0, opp: g ? t.pointsAgainst / g : 0 };
  });
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 't' },
      h('thead', null, h('tr', null, ['Team', 'G', 'PPG', 'Opp PPG', 'Diff', 'Home', 'Conf'].map((c, i) => h('th', { class: i ? 'num' : '' }, c)))),
      h(
        'tbody',
        null,
        rows
          .sort((a, b) => b.ppg - b.opp - (a.ppg - a.opp))
          .map((r) =>
            h(
              'tr',
              { class: r.t.id === l.userTeamId ? 'me' : '' },
              h('td', null, badge(r.t, 20), ` ${teamName(r.t)}`),
              h('td', { class: 'num' }, String(r.g)),
              h('td', { class: 'num' }, r.ppg.toFixed(1)),
              h('td', { class: 'num' }, r.opp.toFixed(1)),
              h('td', { class: 'num' }, (r.ppg - r.opp).toFixed(1)),
              h('td', { class: 'num' }, `${r.t.homeWins}-${r.t.homeLosses}`),
              h('td', { class: 'num' }, `${r.t.confWins}-${r.t.confLosses}`),
            ),
          ),
      ),
    ),
  );
}

export function leagueScreen(app: App, params: Record<string, unknown>) {
  const l = app.league!;
  const tab = (params.tab as string) ?? 'standings';
  const tabs = seg(
    [
      { value: 'standings', label: 'Standings' },
      { value: 'schedule', label: 'Schedule' },
      { value: 'leaders', label: 'Leaders' },
      { value: 'teams', label: 'Team stats' },
      { value: 'playoffs', label: 'Playoffs' },
    ],
    tab,
    (v) => app.go('league', { tab: v }),
  );
  const body = tab === 'schedule' ? scheduleView(app, l) : tab === 'leaders' ? leadersView(app, l) : tab === 'playoffs' ? bracketView(l) : tab === 'teams' ? teamStatsView(l) : standingsView(l);
  return shell(app, 'league', screenTitle(l.settings.leagueName, tabs), h('section', { class: 'panel' }, body));
}

export function historyScreen(app: App) {
  const l = app.league!;
  const name = (id?: string) => (id && l.players[id] ? fullName(l.players[id]) : '-');
  const tname = (id?: string) => (id ? `${teamName(teamById(l, id))}` : '-');
  const t = userTeam(l);
  const fr = Object.values(l.players).filter((p) => p.history.some((hs) => hs.teamId === t.id) || t.rosterIds.includes(p.id));
  const franchiseTotal = (p: Player, k: 'points' | 'rebounds' | 'assists') =>
    p.history.filter((hs) => hs.teamId === t.id).reduce((s, hs) => s + hs.stats[k], 0) + (t.rosterIds.includes(p.id) ? p.seasonStats[k] : 0);
  return shell(
    app,
    'history',
    screenTitle('History & Records'),
    h(
      'div',
      { class: 'grid two' },
      h(
        'section',
        { class: 'panel' },
        h('h2', null, 'Champions & Awards'),
        l.history.length
          ? h(
              'div',
              { class: 'table-wrap' },
              h(
                'table',
                { class: 't' },
                h('thead', null, h('tr', null, ['Season', 'Champion', 'MVP', 'ROY', 'DPOY', 'Scoring', 'You'].map((c) => h('th', null, c)))),
                h(
                  'tbody',
                  null,
                  l.history
                    .slice()
                    .reverse()
                    .map((s) => h('tr', null, h('td', null, `S${s.season}`), h('td', { class: 'gold' }, tname(s.champion)), h('td', null, name(s.mvp)), h('td', null, name(s.roy)), h('td', null, name(s.dpoy)), h('td', null, name(s.scoringLeader)), h('td', null, s.userRecord ?? ''))),
                ),
              ),
            )
          : h('div', { class: 'muted' }, 'Finish a season to write history.'),
        h('h3', { style: 'margin-top:12px' }, 'Banners'),
        t.banners.length ? h('div', { class: 'gold x3' }, t.banners.map((s) => `★ S${s}`).join('  ')) : h('div', { class: 'muted' }, 'No banners yet. Go get one.'),
        h('h3', { style: 'margin-top:12px' }, 'Coach'),
        h('div', null, `${l.coach.name}: ${l.coach.wins}-${l.coach.losses}, ${l.coach.titles} title${l.coach.titles === 1 ? '' : 's'}`),
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', null, 'League Records'),
        h('h3', null, 'Single game'),
        l.records.singleGame.length ? l.records.singleGame.map((r) => h('div', { class: 'row' }, h('span', { style: 'width:120px' }, r.label), h('span', { class: 'gold', style: 'width:40px' }, String(r.value)), h('span', { class: 'muted' }, `${r.name} (S${r.season})`))) : h('div', { class: 'muted' }, 'None yet.'),
        h('h3', { style: 'margin-top:12px' }, 'Single season'),
        l.records.season.length ? l.records.season.map((r) => h('div', { class: 'row' }, h('span', { style: 'width:220px' }, r.label), h('span', { class: 'gold', style: 'width:50px' }, String(r.value)), h('span', { class: 'muted' }, `${r.name} (S${r.season})`))) : h('div', { class: 'muted' }, 'Set after the first season.'),
        h('h3', { style: 'margin-top:12px' }, `${t.name} all-time`),
        (['points', 'rebounds', 'assists'] as const).map((k) => {
          const top = fr.sort((a, b) => franchiseTotal(b, k) - franchiseTotal(a, k))[0];
          return top ? h('div', { class: 'row' }, h('span', { style: 'width:120px' }, k), h('span', { class: 'gold', style: 'width:60px' }, String(franchiseTotal(top, k))), h('span', { class: 'muted' }, fullName(top))) : null;
        }),
      ),
    ),
  );
}
