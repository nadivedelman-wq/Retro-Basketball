import { capSpace, deadMoney, nextSeasonCommitments, payroll, MIN_EXCEPTION_MAX } from '../../sim/economy';
import { userTeam } from '../../sim/league';
import { fullName, stars } from '../../sim/players';
import { askingContract, signFreeAgent } from '../../sim/transactions';
import type { App } from '../app';
import { fmtMoney, h } from '../dom';
import { capSummary, screenTitle, shell, starsEl } from '../widgets';
import { heightStr, openPlayer } from './roster';

export function freeAgentTable(app: App, limit = 60) {
  const l = app.league!;
  const t = userTeam(l);
  const fas = l.freeAgents
    .map((id) => l.players[id])
    .filter((p) => p && !p.retired)
    .sort((a, b) => stars(b) - stars(a))
    .slice(0, limit);
  if (!fas.length) return h('div', { class: 'muted' }, 'No free agents available.');
  const space = capSpace(l, t);
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 't' },
      h('thead', null, h('tr', null, ['Player', 'Pos', 'Age', 'Ht', 'Now', 'Pot', 'Asking', 'Yrs', ''].map((c) => h('th', null, c)))),
      h(
        'tbody',
        null,
        fas.map((p) => {
          const ask = askingContract(l, p);
          const fits = ask.salary <= space || (ask.salary <= MIN_EXCEPTION_MAX && t.rosterIds.length < 13);
          return h(
            'tr',
            null,
            h('td', { class: 'click', style: 'cursor:pointer', onclick: () => openPlayer(app, p.id) }, `${p.firstName[0]}. ${p.lastName}`, p.traits.length ? h('span', { class: 'tiny muted' }, `  ${p.traits[0]}`) : null),
            h('td', null, p.position),
            h('td', null, String(p.age)),
            h('td', null, heightStr(p.heightCm)),
            h('td', null, starsEl(stars(p))),
            h('td', null, p.scoutedPotential === null ? '?' : starsEl(p.scoutedPotential)),
            h('td', { class: fits ? '' : 'bad' }, fmtMoney(ask.salary)),
            h('td', null, String(ask.years)),
            h(
              'td',
              null,
              h(
                'button',
                {
                  class: `btn small ${fits ? 'primary' : ''}`,
                  onclick: () => app.commit(signFreeAgent(app.league!, p.id)),
                  title: fits ? 'Sign at his asking price' : 'Over your cap space: the league will explain why',
                },
                'Sign',
              ),
            ),
          );
        }),
      ),
    ),
  );
}

export function capScreen(app: App) {
  const l = app.league!;
  const t = userTeam(l);
  const players = t.rosterIds.map((id) => l.players[id]).sort((a, b) => b.contract.salaryMillions - a.contract.salaryMillions);
  const summary = h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Salary Cap'),
    capSummary(l, t),
    h(
      'div',
      { class: 'grid three', style: 'margin-top:10px;gap:8px' },
      h('div', { class: 'chip' }, 'Cap space ', h('b', null, fmtMoney(capSpace(l, t)))),
      h('div', { class: 'chip' }, 'Payroll ', h('b', null, fmtMoney(payroll(l, t)))),
      h('div', { class: 'chip' }, 'Dead money ', h('b', null, fmtMoney(deadMoney(l, t)))),
      h('div', { class: 'chip' }, 'Next season ', h('b', null, fmtMoney(nextSeasonCommitments(l, t)))),
      h('div', { class: 'chip' }, 'Roster ', h('b', null, `${t.rosterIds.length}/15`)),
      h('div', { class: 'chip' }, 'Team cap ', h('b', null, fmtMoney(t.capMillions))),
    ),
    h('h3', { style: 'margin-top:12px' }, 'League rules'),
    h(
      'ul',
      { class: 'news tiny', style: 'max-height:none' },
      h('li', { class: 'info' }, `Hard cap: payroll (salaries + dead money) must stay at or under $${t.capMillions}M to sign anyone.`),
      h('li', { class: 'info' }, `Minimum exception: with fewer than 13 players you may sign a $1.0-${MIN_EXCEPTION_MAX.toFixed(1)}M player even over the cap.`),
      h('li', { class: 'info' }, 'Rosters hold 12-15 players. Contracts run 1-4 years.'),
      h('li', { class: 'info' }, 'Releasing a player: 50% of his current salary stays on this season’s cap as dead money; later years are wiped.'),
      h('li', { class: 'info' }, 'Re-signing your own expiring players may go up to 115% of the cap (veteran rights).'),
      h('li', { class: 'info' }, 'The cap can be raised permanently from the Front Office with credits.'),
    ),
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
        h('thead', null, h('tr', null, ['Player', 'Pos', 'Age', 'Now', 'Salary', 'Years left', 'Expires'].map((c) => h('th', null, c)))),
        h(
          'tbody',
          null,
          players.map((p) =>
            h(
              'tr',
              { class: 'click', onclick: () => openPlayer(app, p.id) },
              h('td', null, fullName(p)),
              h('td', null, p.position),
              h('td', null, String(p.age)),
              h('td', null, starsEl(stars(p))),
              h('td', { class: 'gold' }, fmtMoney(p.contract.salaryMillions)),
              h('td', null, String(p.contract.yearsRemaining)),
              h('td', { class: p.contract.yearsRemaining <= 1 ? 'warn' : 'muted' }, p.contract.yearsRemaining === 0 ? 'Now' : `After S${l.season + p.contract.yearsRemaining - 1}`),
            ),
          ),
          t.deadCap
            .filter((d) => d.season === l.season)
            .map((d) => h('tr', null, h('td', { class: 'muted' }, 'Dead money (released)'), h('td', null, ''), h('td', null, ''), h('td', null, ''), h('td', { class: 'bad' }, fmtMoney(d.amount)), h('td', null, ''), h('td', null, `S${d.season}`))),
        ),
      ),
    ),
  );
  return shell(
    app,
    'cap',
    screenTitle('Contracts & Cap'),
    h('div', { class: 'grid two' }, summary, contracts),
    h('section', { class: 'panel', style: 'margin-top:14px' }, h('h2', null, 'Free Agents', h('span', { class: 'tiny muted' }, 'Players sign at their asking price')), freeAgentTable(app)),
  );
}
