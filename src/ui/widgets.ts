import { coinIcon, portraitUrl, teamBadge } from '../art/logo';
import { RATING_KEYS, type BoxLine, type BoxScore, type LeagueSave, type Player, type Team } from '../core/types';
import { capSpace, payroll } from '../sim/economy';
import { PALETTE } from './palette';
import { teamById, userTeam } from '../sim/league';
import { moraleBand, stars } from '../sim/players';
import { nextUserGame } from '../sim/season';
import type { App, Screen } from './app';
import { fmtMoney, h, pct, starText } from './dom';

export function teamOfPlayer(league: LeagueSave, id: string): Team | undefined {
  return league.teams.find((t) => t.rosterIds.includes(id));
}

export function portrait(league: LeagueSave, p: Player, cls = 'portrait') {
  const t = teamOfPlayer(league, p.id);
  const colors = t ? t.colors : [PALETTE.royal, PALETTE.skySoft];
  return h('img', {
    class: cls,
    alt: '',
    src: portraitUrl({ appearance: p.appearance, heightCm: p.heightCm, jersey: colors[0], trim: colors[1], number: p.jerseyNumber }),
  });
}

export function badge(team: Team, size = 32, cls = '') {
  return h('img', { class: cls, alt: team.abbr, width: size, height: size, src: teamBadge(team, size >= 48 ? 48 : 32), style: `width:${size}px;height:${size}px` });
}

export function starsEl(s: number) {
  return h('span', { class: 'stars', title: `${s.toFixed(1)} stars` }, starText(s) || '☆');
}

export function ratingRow(label: string, v: number) {
  const cls = v <= 3 ? 'lo' : v <= 5 ? 'mid' : '';
  return h(
    'div',
    { class: 'rating' },
    h('span', { class: 'muted' }, label),
    h('div', { class: `ratbar ${cls}`, role: 'meter', 'aria-valuenow': v, 'aria-valuemin': 1, 'aria-valuemax': 10, 'aria-label': label }, Array.from({ length: 10 }, (_, i) => h('i', { class: i < v ? 'on' : '' }))),
    h('span', null, String(v)),
  );
}

export function ratingBars(p: Player) {
  return h('div', { class: 'col', style: 'gap:6px' }, RATING_KEYS.map((k) => ratingRow(k, p.ratings[k])));
}

export function meter(value: number, max = 100, cls = '') {
  return h('div', { class: `bar ${cls}`, title: `${Math.round(value)} / ${max}` }, h('i', { style: `width:${Math.max(0, Math.min(100, (value / max) * 100))}%` }));
}

const NAV: [Screen, string][] = [
  ['home', 'Home'],
  ['roster', 'Roster'],
  ['lineup', 'Lineup'],
  ['market', 'Market'],
  ['cap', 'Contracts'],
  ['office', 'Front Office'],
  ['league', 'League'],
  ['history', 'History'],
  ['settings', 'Settings'],
];

export function coin(cls = 'coin') {
  return h('img', { class: cls, src: coinIcon(), alt: '' });
}

/** Coach Coins amount with the coin icon (the icon is decorative; the text says CC). */
export function ccEl(n: number) {
  return h('span', { class: 'cc' }, coin(), ` ${n} CC`);
}

/** Current payroll / salary cap / available cap, shown on roster and market screens. */
export function capStrip(league: LeagueSave, team: Team) {
  const pay = payroll(league, team);
  const space = capSpace(league, team);
  return h(
    'div',
    { class: 'capstrip', role: 'group', 'aria-label': 'Salary cap' },
    h('div', null, h('span', { class: 'muted' }, 'Current payroll'), h('b', null, fmtMoney(pay))),
    h('div', null, h('span', { class: 'muted' }, 'Salary cap'), h('b', null, fmtMoney(team.capMillions))),
    h('div', { class: space < 0 ? 'over' : '' }, h('span', { class: 'muted' }, 'Available cap'), h('b', null, fmtMoney(space))),
  );
}

export type Role = 'starter' | 'reserve' | 'sitting' | 'injured';

export function roleOf(team: Team, p: Player): Role {
  if (p.injury) return 'injured';
  if (team.starters.includes(p.id)) return 'starter';
  if (team.rotation.includes(p.id)) return 'reserve';
  return 'sitting';
}

export function roleTag(role: Role) {
  const label = { starter: 'Starter', reserve: 'Bench', sitting: 'Sitting', injured: 'Injured' }[role];
  return h('span', { class: `role ${role}` }, label);
}

/** Morale meter with its text label (never colour alone) and the latest reason. */
export function moraleEl(p: Player, withNote = true) {
  const band = moraleBand(p.morale);
  const mod = Math.round(band.mod * 100);
  return h(
    'div',
    { class: 'morale-row' },
    meter(p.morale, 100, p.morale >= 60 ? '' : p.morale >= 40 ? 'gold' : 'bad'),
    h('span', { class: 'tiny' }, `${Math.round(p.morale)} ${band.label}${mod ? ` (${mod > 0 ? '+' : ''}${mod}%)` : ''}`),
    withNote && p.moraleNote ? h('span', { class: 'morale-note' }, p.moraleNote) : null,
  );
}

/** Topbar + navigation used by every franchise screen. */
export function shell(app: App, active: Screen, ...content: HTMLElement[]) {
  const l = app.league!;
  const t = userTeam(l);
  const next = nextUserGame(l);
  const nav = NAV.slice();
  if (l.phase === 'offseason') nav.splice(1, 0, ['offseason', 'Off-Season']);
  const space = capSpace(l, t);
  return h(
    'div',
    { class: 'shell' },
    h(
      'header',
      { class: 'topbar' },
      badge(t, 48, 'badge'),
      h('div', null, h('div', { class: 'teamname' }, `${t.city} ${t.name}`), h('div', { class: 'muted' }, `Season ${l.season} \u2022 Coach ${l.coach.name}`)),
      h('div', { class: 'spacer' }),
      h('span', { class: 'chip' }, 'Record ', h('b', null, `${t.wins}-${t.losses}`)),
      h('span', { class: 'chip', title: 'Coach Coins' }, coin(), h('b', null, `${t.credits} CC`)),
      h('span', { class: 'chip', title: 'Current payroll / salary cap / available cap' }, h('b', null, `${fmtMoney(payroll(l, t))} / ${fmtMoney(t.capMillions)}`), h('span', { class: space < 0 ? 'bad' : 'muted' }, ` ${fmtMoney(space)} free`)),
      l.phase !== 'offseason' && next
        ? h('button', { class: 'btn primary', onclick: () => app.go('pregame') }, 'Next game \u25b6')
        : l.phase === 'offseason'
          ? h('button', { class: 'btn primary', onclick: () => app.go('offseason') }, 'Off-season \u25b6')
          : null,
    ),
    h(
      'nav',
      { class: 'nav', 'aria-label': 'Franchise' },
      nav.map(([s, label]) => h('button', { class: `btn ${s === active ? 'active' : ''}`, 'aria-current': s === active ? 'page' : undefined, onclick: () => app.go(s) }, label)),
      h('div', { class: 'spacer hide-mobile' }),
      h('button', { class: 'btn', onclick: () => { void app.save(); app.league = null; app.go('title'); } }, 'Main Menu'),
    ),
    h('main', { class: 'main' }, content),
  );
}

/** Confirmation dialog for anything that spends Coach Coins. Resolves true when confirmed. */
export function confirmPurchase(app: App, title: string, lines: (string | HTMLElement)[], cost: number, balance: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      close();
      resolve(v);
    };
    const enough = balance >= cost;
    const close = app.modal(
      title,
      h(
        'div',
        { class: 'col' },
        lines.map((l) => (typeof l === 'string' ? h('p', { style: 'margin:0' }, l) : l)),
        h('div', { class: 'reward', style: 'border-color:var(--yellow)' }, coin('coin big'), h('div', null, h('div', { class: 'x3 gold' }, `Cost: ${cost} CC`), h('div', { class: enough ? 'muted' : 'bad' }, `You have ${balance} CC${enough ? ` \u2022 ${balance - cost} CC after` : ' \u2022 not enough'}`))),
      ),
      {
        actions: [h('button', { class: 'btn', onclick: () => finish(false) }, 'Cancel'), h('button', { class: 'btn primary', disabled: !enough, onclick: () => finish(true) }, `Spend ${cost} CC`)],
        onClose: () => finish(false),
      },
    );
  });
}

export function screenTitle(title: string, ...extra: (HTMLElement | string | null)[]) {
  return h('div', { class: 'screen-title' }, h('h1', null, title), extra);
}

export function boxTable(league: LeagueSave, lines: BoxLine[], team: Team, onPlayer?: (id: string) => void) {
  const shown = lines.filter((l) => l.seconds > 0).sort((a, b) => Number(b.starter) - Number(a.starter) || b.seconds - a.seconds);
  const dnp = lines.filter((l) => l.seconds <= 0);
  const tot = shown.reduce(
    (s, l) => {
      for (const k of ['points', 'fgm', 'fga', 'threePm', 'threePa', 'ftm', 'fta', 'offRebounds', 'defRebounds', 'assists', 'steals', 'blocks', 'turnovers', 'fouls'] as const) s[k] += l[k];
      return s;
    },
    { points: 0, fgm: 0, fga: 0, threePm: 0, threePa: 0, ftm: 0, fta: 0, offRebounds: 0, defRebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fouls: 0 },
  );
  const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 't' },
      h('thead', null, h('tr', null, ['Player', 'Min', 'Pts', 'FG', '3P', 'FT', 'Reb', 'Ast', 'Stl', 'Blk', 'TO', 'PF', '+/-'].map((c, i) => h('th', { class: i ? 'num' : '' }, c)))),
      h(
        'tbody',
        null,
        shown.map((l) =>
          h(
            'tr',
            { class: onPlayer ? 'click' : '', onclick: onPlayer ? () => onPlayer(l.playerId) : undefined },
            h('td', null, l.starter ? h('span', { class: 'gold' }, '• ') : '  ', league.players[l.playerId] ? `${league.players[l.playerId].firstName[0]}. ${league.players[l.playerId].lastName}` : l.name),
            h('td', { class: 'num' }, mins(l.seconds)),
            h('td', { class: 'num gold' }, String(l.points)),
            h('td', { class: 'num' }, `${l.fgm}-${l.fga}`),
            h('td', { class: 'num' }, `${l.threePm}-${l.threePa}`),
            h('td', { class: 'num' }, `${l.ftm}-${l.fta}`),
            h('td', { class: 'num' }, String(l.offRebounds + l.defRebounds)),
            h('td', { class: 'num' }, String(l.assists)),
            h('td', { class: 'num' }, String(l.steals)),
            h('td', { class: 'num' }, String(l.blocks)),
            h('td', { class: 'num' }, String(l.turnovers)),
            h('td', { class: 'num' }, String(l.fouls)),
            h('td', { class: 'num' }, (l.plusMinus > 0 ? '+' : '') + l.plusMinus),
          ),
        ),
        h(
          'tr',
          null,
          h('td', { class: 'gold' }, `${team.abbr} totals`),
          h('td', { class: 'num' }, ''),
          h('td', { class: 'num gold' }, String(tot.points)),
          h('td', { class: 'num' }, `${tot.fgm}-${tot.fga} (${pct(tot.fgm, tot.fga)}%)`),
          h('td', { class: 'num' }, `${tot.threePm}-${tot.threePa}`),
          h('td', { class: 'num' }, `${tot.ftm}-${tot.fta}`),
          h('td', { class: 'num' }, String(tot.offRebounds + tot.defRebounds)),
          h('td', { class: 'num' }, String(tot.assists)),
          h('td', { class: 'num' }, String(tot.steals)),
          h('td', { class: 'num' }, String(tot.blocks)),
          h('td', { class: 'num' }, String(tot.turnovers)),
          h('td', { class: 'num' }, String(tot.fouls)),
          h('td', { class: 'num' }, ''),
        ),
      ),
    ),
    dnp.length ? h('div', { class: 'muted', style: 'margin-top:4px' }, `DNP: ${dnp.map((l) => league.players[l.playerId]?.lastName ?? l.name).join(', ')}`) : null,
  );
}

export function boxScoreView(league: LeagueSave, box: BoxScore, onPlayer?: (id: string) => void) {
  const home = teamById(league, box.homeId);
  const away = teamById(league, box.awayId);
  const qs = box.quarterScores;
  return h(
    'div',
    { class: 'col' },
    h(
      'div',
      { class: 'row', style: 'justify-content:center;gap:24px' },
      h('div', { class: 'row' }, badge(away, 48), h('div', null, h('div', null, away.abbr), h('div', { class: 'lcd' }, String(box.awayScore)))),
      h('div', { class: 'muted' }, box.overtimes ? `Final/${box.overtimes > 1 ? box.overtimes : ''}OT` : 'Final'),
      h('div', { class: 'row' }, h('div', { style: 'text-align:right' }, h('div', null, home.abbr), h('div', { class: 'lcd' }, String(box.homeScore))), badge(home, 48)),
    ),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 't', style: 'max-width:520px;margin:0 auto' },
        h('thead', null, h('tr', null, h('th', null, ''), qs.map((_, i) => h('th', { class: 'num' }, i < 4 ? `Q${i + 1}` : `OT${i - 3}`)), h('th', { class: 'num' }, 'T'))),
        h(
          'tbody',
          null,
          h('tr', null, h('td', null, away.abbr), qs.map((q) => h('td', { class: 'num' }, String(q[1]))), h('td', { class: 'num gold' }, String(box.awayScore))),
          h('tr', null, h('td', null, home.abbr), qs.map((q) => h('td', { class: 'num' }, String(q[0]))), h('td', { class: 'num gold' }, String(box.homeScore))),
        ),
      ),
    ),
    h('h3', null, `${away.city} ${away.name}`),
    boxTable(league, box.away, away, onPlayer),
    h('h3', null, `${home.city} ${home.name}`),
    boxTable(league, box.home, home, onPlayer),
    box.injuries.length ? h('div', { class: 'bad' }, `Injuries: ${box.injuries.map((i) => `${league.players[i.playerId]?.lastName} (${i.injury.type})`).join(', ')}`) : null,
  );
}

export function capSummary(league: LeagueSave, team: Team) {
  const pay = payroll(league, team);
  return h(
    'div',
    { class: 'col', style: 'gap:4px' },
    h('div', { class: 'row' }, h('span', null, 'Payroll'), h('span', { class: 'spacer' }), h('span', { class: pay > team.capMillions ? 'bad' : 'gold' }, `${fmtMoney(pay)} / ${fmtMoney(team.capMillions)}`)),
    meter(pay, team.capMillions, pay > team.capMillions ? '' : 'gold'),
  );
}

export function playerStatus(p: Player) {
  if (p.injury) return h('span', { class: 'bad' }, `INJ ${p.injury.gamesRemaining}g`);
  if (p.condition < 60) return h('span', { class: 'warn' }, 'Tired');
  if (p.morale < 35) return h('span', { class: 'warn' }, 'Unhappy');
  return h('span', { class: 'good' }, 'OK');
}

export { stars };
