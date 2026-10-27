import { sfx } from '../../audio/sfx';
import type { LeagueSave } from '../../core/types';
import { payroll } from '../../sim/economy';
import { teamById, userTeam } from '../../sim/league';
import { advanceOffseason, currentPick, draftPlayer, finishDraft, finishResignings, prospectValue, runCpuPicks, runLottery, skipPick, startNewSeason } from '../../sim/offseason';
import { fullName, stars } from '../../sim/players';
import { withRng } from '../../sim/season';
import { SCOUT_COST, askingContract, letWalk, resignPlayer, scoutProspect } from '../../sim/transactions';
import type { App } from '../app';
import { fmtMoney, h } from '../dom';
import { badge, capSummary, coin, confirmPurchase, screenTitle, shell, starsEl } from '../widgets';
import { ROSTER } from '../../sim/config';
import { bracketView } from './league';
import { heightStr, openPlayer, rosterTable } from './roster';

const STEPS = [
  ['resign', 'Re-sign'],
  ['draft', 'Draft'],
  ['freeAgency', 'Market & new season'],
] as const;

function seasonSummary(l: LeagueSave) {
  const s = l.history.find((x) => x.season === l.season);
  if (!s) return null;
  const name = (id?: string) => (id && l.players[id] ? fullName(l.players[id]) : '-');
  const champ = s.champion ? teamById(l, s.champion) : null;
  return h(
    'section',
    { class: 'panel' },
    h('h2', null, `Season ${l.season} in review`),
    champ ? h('div', { class: 'row' }, badge(champ, 48), h('div', null, h('div', { class: 'muted' }, 'Champions'), h('div', { class: 'x3 gold' }, `${champ.city} ${champ.name}`))) : null,
    h(
      'div',
      { class: 'col', style: 'gap:4px;margin-top:10px' },
      [
        ['MVP', s.mvp],
        ['Finals MVP', s.finalsMvp],
        ['Rookie of the Year', s.roy],
        ['Defensive Player', s.dpoy],
        ['Scoring Title', s.scoringLeader],
      ].map(([label, id]) => h('div', { class: 'row' }, h('span', { class: 'muted', style: 'width:200px' }, label as string), h('span', { class: 'gold' }, name(id as string | undefined)))),
      h('div', { class: 'row' }, h('span', { class: 'muted', style: 'width:200px' }, 'Your record'), h('span', null, s.userRecord ?? '')),
    ),
    l.playoffs.length ? h('div', { style: 'margin-top:10px' }, bracketView(l)) : null,
  );
}

export function offseasonScreen(app: App) {
  let l = app.league!;
  if (l.phase !== 'offseason') {
    queueMicrotask(() => app.go('home'));
    return h('div');
  }
  if (l.offseasonStep === 'awards' || l.offseasonStep === 'retirements' || l.offseasonStep === 'progression') {
    app.mutate((d) => advanceOffseason(d), { render: false });
    l = app.league!;
  }
  if (l.offseasonStep === 'lottery') {
    app.mutate((d) => withRng(d, (rng) => runLottery(d, rng)), { render: false });
    l = app.league!;
  }
  if (l.offseasonStep === 'draft' && currentPick(l) && currentPick(l)!.teamId !== l.userTeamId) {
    app.mutate((d) => runCpuPicks(d), { render: false });
    l = app.league!;
  }
  const t = userTeam(l);
  const step = l.offseasonStep;
  const stepper = h(
    'div',
    { class: 'row', style: 'gap:6px;margin-bottom:12px' },
    STEPS.map(([k, label], i) => h('span', { class: `chip ${k === step ? '' : 'dim'}`, style: k === step ? 'border-color:var(--gold)' : '' }, `${i + 1}. ${label}`)),
  );

  let body: HTMLElement;
  if (step === 'resign') {
    const expiring = t.rosterIds.map((id) => l.players[id]).filter((p) => p.contract.yearsRemaining === 0);
    body = h(
      'div',
      { class: 'grid two' },
      h(
        'div',
        { class: 'col', style: 'gap:14px' },
        h(
          'section',
          { class: 'panel' },
          h('h2', null, 'Expiring contracts'),
          capSummary(l, t),
          h('div', { class: 'tiny muted', style: 'margin:6px 0' }, 'You may re-sign your own players up to 115% of the cap. Unhappy players (morale under 25) refuse to talk. Anyone not re-signed goes to free agency.'),
          expiring.length
            ? expiring.map((p) => {
                const ask = askingContract(l, p);
                return h(
                  'div',
                  { class: 'panel dark row' },
                  h('div', { style: 'flex:1;min-width:200px', class: 'click' }, h('div', { style: 'cursor:pointer', onclick: () => openPlayer(app, p.id) }, `${fullName(p)} (${p.position}, ${p.age})`), h('div', null, starsEl(stars(p)), h('span', { class: 'muted' }, ` morale ${Math.round(p.morale)} • was ${fmtMoney(p.contract.salaryMillions)}`))),
                  h('div', { class: 'gold' }, `Asks ${fmtMoney(ask.salary)} x ${ask.years}`),
                  h('button', { class: 'btn small primary', onclick: () => app.commit(resignPlayer(app.league!, p.id)) }, 'Re-sign'),
                  h('button', { class: 'btn small', onclick: () => app.commit(letWalk(app.league!, p.id)) }, 'Let go'),
                );
              })
            : h('div', { class: 'good' }, 'No expiring contracts this year.'),
          h(
            'div',
            { class: 'row', style: 'margin-top:12px;justify-content:flex-end' },
            h(
              'button',
              {
                class: 'btn primary',
                onclick: async () => {
                  const left = userTeam(app.league!).rosterIds.filter((id) => app.league!.players[id].contract.yearsRemaining === 0).length;
                  if (left && !(await app.confirm('Continue?', `${left} unsigned player${left > 1 ? 's' : ''} will become free agents.`, 'Continue'))) return;
                  app.mutate((d) => withRng(d, (rng) => finishResignings(d, rng)));
                  app.go('offseason');
                },
              },
              'Continue to the draft lottery ▶',
            ),
          ),
        ),
      ),
      seasonSummary(l) ?? h('div'),
    );
  } else if (step === 'draft' && l.draft) {
    const d = l.draft;
    const pick = currentPick(l);
    const onClock = pick && pick.teamId === l.userTeamId;
    const prospects = d.prospectIds.map((id) => l.players[id]).sort((a, b) => prospectValue(l, b, t) - prospectValue(l, a, t));
    const mine = d.order.filter((o) => o.teamId === t.id && d.order.indexOf(o) >= d.current);
    body = h(
      'div',
      { class: 'col', style: 'gap:14px' },
      h(
        'section',
        { class: 'panel' },
        h('h2', null, onClock ? `You're on the clock: pick ${pick!.round}-${pick!.pick}` : 'Draft complete'),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, `Your remaining picks: ${mine.map((o) => `${o.round}-${o.pick}`).join(', ') || 'none'}`), h('span', { class: 'spacer' }), h('span', { class: 'chip' }, coin(), h('b', null, `${t.credits} CC`)), h('span', { class: 'chip' }, 'Roster ', h('b', null, `${t.rosterIds.length}/${ROSTER.max}`))),
        d.lottery.length ? h('div', { class: 'tiny muted', style: 'margin-top:6px' }, `Lottery: ${d.lottery.slice(0, 4).map((x) => `#${x.pick} ${teamById(l, x.teamId).abbr} (odds #${x.seed})`).join(' • ')}`) : null,
        onClock
          ? h(
              'div',
              { class: 'row', style: 'margin-top:8px' },
              h('button', { class: 'btn', onclick: () => { app.mutate((dd) => { skipPick(dd); runCpuPicks(dd); }); app.go('offseason'); } }, 'Pass on this pick'),
              h('button', { class: 'btn', onclick: () => { app.mutate((dd) => { draftPlayer(dd, prospects[0].id); runCpuPicks(dd); }); sfx.confirm(); app.go('offseason'); } }, 'Auto-pick best available'),
            )
          : h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn primary', onclick: () => { app.mutate((dd) => finishDraft(dd)); app.go('offseason'); } }, 'On to free agency ▶')),
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', null, 'Big Board', h('span', { class: 'tiny muted' }, `Potential is a scouting estimate. Scout for ${SCOUT_COST} CC to sharpen it.`)),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 't' },
            h('thead', null, h('tr', null, ['Prospect', 'Pos', 'Age', 'Ht', 'Archetype', 'Now', 'Pot (est.)', 'Scouted', ''].map((c) => h('th', null, c)))),
            h(
              'tbody',
              null,
              prospects.slice(0, 40).map((p) =>
                h(
                  'tr',
                  null,
                  h('td', { style: 'cursor:pointer', onclick: () => openPlayer(app, p.id) }, fullName(p)),
                  h('td', null, p.position),
                  h('td', null, String(p.age)),
                  h('td', null, heightStr(p.heightCm)),
                  h('td', { class: 'muted' }, p.archetype),
                  h('td', null, starsEl(stars(p))),
                  h('td', null, p.scoutedPotential === null ? '?' : starsEl(p.scoutedPotential)),
                  h('td', { class: 'muted' }, '•'.repeat(p.scoutLevel) || '-'),
                  h(
                    'td',
                    null,
                    h('div', { class: 'row', style: 'gap:4px;flex-wrap:nowrap' }, h('button', { class: 'btn small', disabled: p.scoutLevel >= 3 || t.credits < SCOUT_COST, onclick: async () => { if (await confirmPurchase(app, `Scout ${fullName(p)}?`, ['A sharper estimate of his potential. Your Development Coach makes reports more accurate.'], SCOUT_COST, t.credits)) app.commit(scoutProspect(app.league!, p.id)); } }, `Scout ${SCOUT_COST} CC`), onClock ? h('button', { class: 'btn small primary', onclick: () => { if (app.mutate((dd) => { draftPlayer(dd, p.id); runCpuPicks(dd); })) { sfx.fanfare(); app.go('offseason'); } } }, 'Draft') : null),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', null, 'Draft log'),
        h(
          'div',
          { class: 'col', style: 'gap:2px;max-height:300px;overflow:auto' },
          d.log
            .slice()
            .reverse()
            .map((e) => {
              const tm = teamById(l, e.teamId);
              const p = e.playerId ? l.players[e.playerId] : null;
              return h('div', { class: `row ${e.teamId === t.id ? 'gold' : ''}`, style: 'gap:6px' }, h('span', { class: 'muted', style: 'width:50px' }, `${e.round}-${e.pick}`), badge(tm, 16), h('span', null, tm.abbr), h('span', null, p ? `${fullName(p)} (${p.position})` : 'passed'));
            }),
        ),
      ),
    );
  } else if (step === 'freeAgency') {
    body = h(
      'div',
      { class: 'col', style: 'gap:14px' },
      h(
        'section',
        { class: 'panel' },
        h('h2', null, 'Free agency'),
        capSummary(l, t),
        h('div', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'good' }, `Roster ${t.rosterIds.length}/${ROSTER.max}`), h('span', { class: 'muted' }, ` • payroll ${fmtMoney(payroll(l, t))}`), h('span', { class: 'spacer' }), h('button', { class: 'btn big primary', onclick: () => { if (app.mutate((dd) => startNewSeason(dd))) { sfx.fanfare(); app.go('home'); } } }, `Start season ${l.season + 1} ▶`)),
        h('div', { class: 'tiny muted' }, 'CPU teams sign their free agents when you start the season. Empty lineup spots are filled by 0.5-star replacements.'),
      ),
      h('section', { class: 'panel' }, h('h2', null, 'Add talent'), h('p', null, `The Player Market has ${l.market.offers.length} 4-5 star players available for Coach Coins.`), h('button', { class: 'btn primary', onclick: () => app.go('market') }, 'Open the Market \u25b6')),
      h('section', { class: 'panel' }, h('h2', null, 'Your roster'), rosterTable(app, l, t.rosterIds.map((id) => l.players[id]))),
    );
  } else {
    body = h('section', { class: 'panel' }, h('div', { class: 'muted' }, 'Preparing the off-season...'));
  }
  return shell(app, 'offseason', screenTitle('Off-Season', h('span', { class: 'muted' }, `After season ${l.season}`)), stepper, body);
}
