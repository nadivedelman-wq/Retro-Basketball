import { teamName } from '../sim/data';
import { teamById } from '../sim/league';
import { runCpuPicks } from '../sim/offseason';
import { fullName, stars } from '../sim/players';
import { acceptTrade, declineTrade, offerText, pickLabel } from '../sim/trades';
import type { App } from './app';
import { fmtMoney, h } from './dom';
import { badge, starsEl } from './widgets';

function offerBody(app: App) {
  const l = app.league!;
  const o = l.tradeOffer!;
  const p = l.players[o.playerId];
  const club = teamById(l, o.teamId);
  return h(
    'div',
    { class: 'col' },
    h('div', { class: 'row' }, badge(club, 32), h('p', { style: 'margin:0;flex:1' }, offerText(l, o))),
    ...(o.userGives === 'pick'
      ? [
          h('div', null, 'You give: ', h('b', null, pickLabel(l, o).replace(/^your /, ''))),
          h('div', null, 'You get: ', h('b', { class: 'gold' }, fullName(p)), ' ', starsEl(stars(p)), ` ${p.position}, age ${p.age}, ${fmtMoney(p.contract.salaryMillions)} x ${p.contract.yearsRemaining}`),
          h('div', { class: 'tiny muted' }, `Uses ${fmtMoney(p.contract.salaryMillions)} of cap space and one roster spot.`),
        ]
      : [
          h('div', null, 'You give: ', h('b', null, fullName(p)), ' ', starsEl(stars(p)), ` ${p.position}, age ${p.age}, ${fmtMoney(p.contract.salaryMillions)} x ${p.contract.yearsRemaining}`),
          h('div', null, 'You get: ', h('b', { class: 'gold' }, pickLabel(l, o).replace(/^their /, `${teamName(club)}'s `))),
          h('div', { class: 'tiny muted' }, `Frees ${fmtMoney(p.contract.salaryMillions)} of cap space. Empty lineup spots are filled by replacements.`),
        ]),
  );
}

function answerButtons(app: App, done?: () => void) {
  return [
    h('button', { class: 'btn', onclick: () => { done?.(); app.commit(declineTrade(app.league!)); } }, 'Decline'),
    h(
      'button',
      {
        class: 'btn primary',
        onclick: () => {
          done?.();
          // Trading away the pick on the clock hands the turn to the club, so the draft moves on.
          if (app.commit(acceptTrade(app.league!)) && app.league?.offseasonStep === 'draft') app.mutate((d) => runCpuPicks(d));
        },
      },
      'Accept',
    ),
  ];
}

/** Pop-up for the pending trade offer. Closing it without answering leaves the offer on Franchise Home. */
export function showTradeOffer(app: App) {
  if (!app.league?.tradeOffer) return;
  let close = () => {};
  close = app.modal('Trade offer', offerBody(app), { actions: answerButtons(app, () => close()) });
}

/** Franchise Home card for an offer that is still waiting for an answer. */
export function tradeCard(app: App) {
  if (!app.league?.tradeOffer) return null;
  return h(
    'section',
    { class: 'panel', style: 'border-color:#000;box-shadow: inset 0 0 0 2px var(--gold), 4px 4px 0 rgba(0,0,0,.45)' },
    h('h2', null, '• Trade offer'),
    offerBody(app),
    h('div', { class: 'row', style: 'margin-top:10px;justify-content:flex-end' }, answerButtons(app)),
  );
}
