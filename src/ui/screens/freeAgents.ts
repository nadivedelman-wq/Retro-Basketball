import { sfx } from '../../audio/sfx';
import { FREE_AGENTS, ROSTER } from '../../sim/config';
import { buyFreeAgentRefresh, freeAgentBoard, freeAgentCheck, freeAgentFee, signFreeAgentForCoins } from '../../sim/freeAgents';
import { userTeam } from '../../sim/league';
import { fullName, stars } from '../../sim/players';
import { askingContract } from '../../sim/transactions';
import type { App } from '../app';
import { fmtMoney, h } from '../dom';
import { capStrip, coin, confirmPurchase, screenTitle, shell, starsEl } from '../widgets';
import { heightStr, openPlayer } from './roster';

let page = 0;

export function freeAgentsScreen(app: App) {
  const l = app.league!;
  const t = userTeam(l);
  const board = freeAgentBoard(l);
  const pages = Math.max(1, Math.ceil(board.length / FREE_AGENTS.perPage));
  page = Math.min(page, pages - 1);
  const shown = board.slice(page * FREE_AGENTS.perPage, (page + 1) * FREE_AGENTS.perPage);
  const left = l.freeAgentRefreshIn ?? FREE_AGENTS.refreshEveryGames;

  const sign = async (id: string) => {
    const p = l.players[id];
    const ask = askingContract(l, p);
    const fee = freeAgentFee(p);
    const ok = await confirmPurchase(
      app,
      `Sign ${fullName(p)}?`,
      [
        `${stars(p).toFixed(1)}-star ${p.position}, age ${p.age}.`,
        `Contract: ${fmtMoney(ask.salary)} a year for ${ask.years} season${ask.years > 1 ? 's' : ''}. This counts against your $${t.capMillions}M cap every season.`,
        'Coach Coins are a one-time signing fee; salary is paid from cap space.',
      ],
      fee,
      t.credits,
    );
    if (ok && app.commit(signFreeAgentForCoins(app.league!, id))) sfx.fanfare();
  };

  const refresh = async () => {
    const ok = await confirmPurchase(app, 'Refresh free agents?', ['Every unsigned free agent leaves and a new group arrives.', `The board also refreshes by itself in ${left} game${left === 1 ? '' : 's'}.`], FREE_AGENTS.refreshCost, t.credits);
    if (ok && app.commit(buyFreeAgentRefresh(app.league!))) page = 0;
  };

  const go = (n: number) => {
    page = n;
    app.refresh();
  };
  const pager = h(
    'div',
    { class: 'row', style: 'justify-content:center;margin-top:10px' },
    h('button', { class: 'btn small', disabled: page === 0, onclick: () => go(page - 1) }, '◀ Prev'),
    Array.from({ length: pages }, (_, i) => h('button', { class: `btn small ${i === page ? 'active' : ''}`, 'aria-current': i === page ? 'page' : undefined, onclick: () => go(i) }, String(i + 1))),
    h('button', { class: 'btn small', disabled: page >= pages - 1, onclick: () => go(page + 1) }, 'Next ▶'),
  );

  const table = h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 't' },
      h('thead', null, h('tr', null, ['Player', 'Pos', 'Age', 'Ht', 'Now', 'Pot', 'Asks', 'Yrs', 'Fee', ''].map((c) => h('th', null, c)))),
      h(
        'tbody',
        null,
        shown.map((p) => {
          const ask = askingContract(l, p);
          const fee = freeAgentFee(p);
          const check = freeAgentCheck(l, p.id);
          return h(
            'tr',
            null,
            h('td', { class: 'gold', style: 'cursor:pointer', onclick: () => openPlayer(app, p.id) }, fullName(p)),
            h('td', null, p.position),
            h('td', null, String(p.age)),
            h('td', null, heightStr(p.heightCm)),
            h('td', null, starsEl(stars(p))),
            h('td', null, starsEl(p.scoutedPotential ?? p.potential)),
            h('td', { class: 'num' }, fmtMoney(ask.salary)),
            h('td', { class: 'num' }, String(ask.years)),
            h('td', { class: 'num' }, `${fee} CC`),
            h('td', null, h('button', { class: 'btn small primary', disabled: !check.ok, title: check.ok ? '' : check.reasons.join(' '), onclick: () => void sign(p.id) }, 'Sign')),
          );
        }),
      ),
    ),
  );

  return shell(
    app,
    'freeAgents',
    screenTitle(
      'Free Agents',
      h('span', { class: 'chip' }, coin(), h('b', null, `${t.credits} CC`)),
      l.phase === 'regular' ? h('span', { class: 'muted' }, `New free agents in ${left} game${left === 1 ? '' : 's'}`) : null,
    ),
    capStrip(l, t),
    h(
      'div',
      { class: 'panel dark', style: 'margin-bottom:14px' },
      h('div', null, `Sign 0.5 to 3.5-star players for a Coach Coin fee (${FREE_AGENTS.signFee[0.5]} CC at 0.5 stars up to ${FREE_AGENTS.signFee[3.5]} CC at 3.5 stars) plus cap room and an open roster spot (${t.rosterIds.length}/${ROSTER.max} used). 4 and 5-star players are on the Market.`),
      h(
        'div',
        { class: 'row', style: 'margin-top:8px' },
        h('span', { class: 'muted' }, `${board.length} free agents • page ${page + 1} of ${pages}`),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', disabled: t.credits < FREE_AGENTS.refreshCost, onclick: () => void refresh() }, `Refresh now • ${FREE_AGENTS.refreshCost} CC`),
      ),
      t.rosterIds.length >= ROSTER.max ? h('div', { class: 'warn', style: 'margin-top:4px' }, '▲ Roster full: release or trade a player to open a spot.') : null,
    ),
    h('section', { class: 'panel' }, board.length ? table : h('div', null, 'No free agents right now.'), board.length ? pager : null),
  );
}
