import { SALARY_BANDS } from '../../sim/config';
import { deadMoney, nextSeasonCommitments } from '../../sim/economy';
import { userTeam } from '../../sim/league';
import { fullName, stars } from '../../sim/players';
import type { App } from '../app';
import { fmtMoney, h } from '../dom';
import { capStrip, roleOf, roleTag, screenTitle, shell, starsEl } from '../widgets';
import { openPlayer } from './roster';

export function capScreen(app: App) {
  const l = app.league!;
  const t = userTeam(l);
  const players = t.rosterIds.map((id) => l.players[id]).sort((a, b) => b.contract.salaryMillions - a.contract.salaryMillions);
  let lo = 0.5;
  const bands = SALARY_BANDS.map((b) => {
    const label = lo === b.maxStars ? `${b.maxStars.toFixed(1)}` : `${lo.toFixed(1)}-${b.maxStars.toFixed(1)}`;
    lo = b.maxStars + 0.5;
    return h('tr', null, h('td', null, starsEl(b.maxStars), ` ${label}`), h('td', { class: 'num' }, `$${b.min}M - $${b.max}M`));
  });
  const rules = h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Cap rules'),
    h(
      'ul',
      { class: 'news', style: 'max-height:none' },
      h('li', { class: 'info' }, `Hard cap: contracted salaries plus dead money must stay at or under $${t.capMillions}M. Any signing that would break it is refused with the reason.`),
      h('li', { class: 'info' }, 'Seven contracted players at most: five active, two bench. Empty lineup spots are filled by 0.5-star replacements with no salary and no cap hit.'),
      h('li', { class: 'info' }, 'Contracts run 1-4 seasons. Price follows star rating, nudged by age, potential, morale and recent form.'),
      h('li', { class: 'info' }, 'Releasing a player leaves 50% of his salary as dead money for the rest of this season only.'),
      h('li', { class: 'info' }, 'Coach Coins (CC) are a separate currency. They pay market signing fees and upgrades, never salary.'),
      h('li', { class: 'info' }, 'The cap can be raised permanently in the Front Office for a high, escalating CC price.'),
    ),
    h('h3', { style: 'margin-top:10px' }, 'Salary bands'),
    h('table', { class: 't' }, h('tbody', null, bands)),
  );
  const contracts = h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Contracts'),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 't' },
        h('thead', null, h('tr', null, ['Player', 'Role', 'Now', 'Salary', 'Years', 'Expires'].map((c) => h('th', null, c)))),
        h(
          'tbody',
          null,
          players.map((p) =>
            h(
              'tr',
              { class: 'click', onclick: () => openPlayer(app, p.id) },
              h('td', null, fullName(p)),
              h('td', null, roleTag(roleOf(t, p))),
              h('td', null, starsEl(stars(p))),
              h('td', { class: 'gold' }, fmtMoney(p.contract.salaryMillions)),
              h('td', null, String(p.contract.yearsRemaining)),
              h('td', { class: p.contract.yearsRemaining <= 1 ? 'warn' : 'muted' }, p.contract.yearsRemaining === 0 ? 'Now' : `After S${l.season + p.contract.yearsRemaining - 1}`),
            ),
          ),
          t.deadCap
            .filter((d) => d.season === l.season)
            .map((d) => h('tr', null, h('td', { class: 'muted' }, 'Dead money (released)'), h('td', null, ''), h('td', null, ''), h('td', { class: 'bad' }, fmtMoney(d.amount)), h('td', null, ''), h('td', null, `S${d.season}`))),
        ),
      ),
    ),
    h('div', { class: 'row', style: 'margin-top:10px' }, h('span', { class: 'chip' }, 'Dead money ', h('b', null, fmtMoney(deadMoney(l, t)))), h('span', { class: 'chip' }, 'Committed next season ', h('b', null, fmtMoney(nextSeasonCommitments(l, t))))),
  );
  return shell(app, 'cap', screenTitle('Contracts & Cap'), capStrip(l, t), h('div', { class: 'grid two' }, contracts, rules));
}
