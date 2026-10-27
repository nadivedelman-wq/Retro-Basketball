/**
 * Weekly franchise events for the user's team: short dilemmas with 2-3 options and
 * concrete consequences on morale, condition, credits, fans, chemistry or development.
 */
import { Rng, clamp } from '../core/rng';
import type { LeagueSave, PendingEvent, Player, Team } from '../core/types';
import { addNews, userTeam } from './league';
import { fullName, stars } from './players';

type Ctx = { league: LeagueSave; team: Team; player?: Player };
type Template = {
  id: string;
  title: string;
  pick?: (c: Ctx, rng: Rng) => Player | undefined;
  text: (c: Ctx) => string;
  options: { label: string; effect: string; apply: (c: Ctx, rng: Rng) => string }[];
};

const roster = (c: Ctx) => c.team.rosterIds.map((id) => c.league.players[id]).filter(Boolean);
const bump = (p: Player, k: 'morale' | 'condition', d: number) => (p[k] = clamp(p[k] + d, 0, 100));

const TEMPLATES: Template[] = [
  {
    id: 'minutes',
    title: 'Minutes Complaint',
    pick: (c, rng) => {
      const bench = roster(c).filter((p) => !c.team.starters.includes(p.id) && stars(p) >= 2 && !p.injury);
      return bench.length ? rng.pick(bench) : undefined;
    },
    text: (c) => `${fullName(c.player!)} wants a bigger role and has gone to the media about his minutes.`,
    options: [
      { label: 'Promise more minutes', effect: '+15 morale; moves to first off the bench', apply: (c) => { bump(c.player!, 'morale', 15); c.team.rotation = [c.player!.id, ...c.team.rotation.filter((id) => id !== c.player!.id)]; return `${c.player!.lastName} moves up the rotation.`; } },
      { label: 'Tell him to earn it', effect: '-10 morale; +5 front-office confidence', apply: (c) => { bump(c.player!, 'morale', -10); c.league.coach.confidence = clamp(c.league.coach.confidence + 5, 0, 100); return 'The front office likes your stance.'; } },
      { label: 'Team meeting (4 credits)', effect: '+6 morale for everyone', apply: (c) => { if (c.team.credits < 4) return 'Not enough credits — the meeting never happened.'; c.team.credits -= 4; roster(c).forEach((p) => bump(p, 'morale', 6)); return 'The air is cleared.'; } },
    ],
  },
  {
    id: 'sponsor',
    title: 'Sponsor Offer',
    text: (c) => `A local mattress store wants its jingle played at every ${c.team.city} home timeout.`,
    options: [
      { label: 'Take the money', effect: '+12 credits, -4 fan support', apply: (c) => { c.team.credits += 12; c.team.fanSupport = clamp(c.team.fanSupport - 4, 0, 100); return 'The jingle is catchy. Fans are not amused.'; } },
      { label: 'Decline', effect: '+3 fan support', apply: (c) => { c.team.fanSupport = clamp(c.team.fanSupport + 3, 0, 100); return 'Fans appreciate the quiet timeouts.'; } },
    ],
  },
  {
    id: 'practice',
    title: 'Two-a-Days?',
    text: () => 'Your assistants propose doubling up practice this week.',
    options: [
      { label: 'Go hard', effect: '+25 XP to everyone, -15 condition', apply: (c) => { roster(c).forEach((p) => { p.xp += 25; bump(p, 'condition', -15); }); return 'Legs are heavy, but the team is sharper.'; } },
      { label: 'Rest and recover', effect: '+15 condition, +3 morale', apply: (c) => { roster(c).forEach((p) => { bump(p, 'condition', 15); bump(p, 'morale', 3); }); return 'A well-rested squad.'; } },
    ],
  },
  {
    id: 'owner',
    title: 'Owner Wants Buzz',
    text: () => 'The owner wants a splashy fan promotion: free jerseys for the next home game.',
    options: [
      { label: 'Fund it (6 credits)', effect: '+8 fan support, +4 confidence', apply: (c) => { if (c.team.credits < 6) { c.league.coach.confidence = clamp(c.league.coach.confidence - 4, 0, 100); return 'You could not afford it. The owner noticed.'; } c.team.credits -= 6; c.team.fanSupport = clamp(c.team.fanSupport + 8, 0, 100); c.league.coach.confidence = clamp(c.league.coach.confidence + 4, 0, 100); return 'Jerseys everywhere!'; } },
      { label: 'Push back', effect: '-6 front-office confidence', apply: (c) => { c.league.coach.confidence = clamp(c.league.coach.confidence - 6, 0, 100); return 'The owner is unhappy.'; } },
    ],
  },
  {
    id: 'mentor',
    title: 'Mentorship',
    pick: (c, rng) => {
      const young = roster(c).filter((p) => p.age <= 23);
      return young.length ? rng.pick(young) : undefined;
    },
    text: (c) => `A veteran offers to take ${fullName(c.player!)} under his wing for extra film sessions.`,
    options: [
      { label: 'Approve it', effect: '+60 XP for the youngster, -3 veteran morale', apply: (c) => { c.player!.xp += 60; roster(c).filter((p) => p.age >= 29).forEach((p) => bump(p, 'morale', -3)); return `${c.player!.lastName} soaks it all in.`; } },
      { label: 'Keep routines', effect: '+2 morale for everyone', apply: (c) => { roster(c).forEach((p) => bump(p, 'morale', 2)); return 'Business as usual.'; } },
    ],
  },
  {
    id: 'curfew',
    title: 'Missed Curfew',
    pick: (c, rng) => rng.pick(roster(c)),
    text: (c) => `${fullName(c.player!)} missed curfew on the road trip.`,
    options: [
      { label: 'Fine him', effect: '-12 his morale, +6 chemistry', apply: (c) => { bump(c.player!, 'morale', -12); c.team.chemistry = clamp(c.team.chemistry + 6, 0, 100); return 'Message sent.'; } },
      { label: 'Let it slide', effect: '+5 his morale, -6 chemistry', apply: (c) => { bump(c.player!, 'morale', 5); c.team.chemistry = clamp(c.team.chemistry - 6, 0, 100); return 'Some teammates grumble.'; } },
    ],
  },
  {
    id: 'charity',
    title: 'Community Night',
    text: (c) => `${c.team.city} youth clinics asked for players to run a skills camp.`,
    options: [
      { label: 'Send the starters', effect: '+6 fan support, -8 starter condition', apply: (c) => { c.team.fanSupport = clamp(c.team.fanSupport + 6, 0, 100); c.team.starters.forEach((id) => c.league.players[id] && bump(c.league.players[id], 'condition', -8)); return 'Great photos, tired legs.'; } },
      { label: 'Send the bench', effect: '+3 fan support, +4 bench morale', apply: (c) => { c.team.fanSupport = clamp(c.team.fanSupport + 3, 0, 100); c.team.rotation.forEach((id) => c.league.players[id] && bump(c.league.players[id], 'morale', 4)); return 'The bench enjoyed the spotlight.'; } },
      { label: 'Skip it', effect: '-3 fan support', apply: (c) => { c.team.fanSupport = clamp(c.team.fanSupport - 3, 0, 100); return 'Local radio is not happy.'; } },
    ],
  },
  {
    id: 'media',
    title: 'Tough Questions',
    text: () => 'After a rough stretch, reporters ask if your players are giving full effort.',
    options: [
      { label: 'Defend the players', effect: '+5 morale for all, -4 confidence', apply: (c) => { roster(c).forEach((p) => bump(p, 'morale', 5)); c.league.coach.confidence = clamp(c.league.coach.confidence - 4, 0, 100); return 'The locker room has your back.'; } },
      { label: 'Call them out', effect: '-6 morale for all, +5 confidence', apply: (c) => { roster(c).forEach((p) => bump(p, 'morale', -6)); c.league.coach.confidence = clamp(c.league.coach.confidence + 5, 0, 100); return 'The owner nods. The players do not.'; } },
    ],
  },
  {
    id: 'analytics',
    title: 'Shot Doctor',
    text: () => 'A shooting consultant offers a one-week clinic.',
    options: [
      { label: 'Hire (8 credits)', effect: '+40 XP to your three best shooters', apply: (c) => { if (c.team.credits < 8) return 'Not enough credits.'; c.team.credits -= 8; roster(c).sort((a, b) => b.ratings.shooting - a.ratings.shooting).slice(0, 3).forEach((p) => (p.xp += 40)); return 'Form looks smoother already.'; } },
      { label: 'No thanks', effect: 'Nothing happens', apply: () => 'You trust your staff.' },
    ],
  },
  {
    id: 'extension',
    title: 'Extension Talk',
    pick: (c, rng) => {
      const exp = roster(c).filter((p) => p.contract.yearsRemaining === 1 && stars(p) >= 2.5);
      return exp.length ? rng.pick(exp) : undefined;
    },
    text: (c) => `${fullName(c.player!)} (${c.player!.contract.yearsRemaining} yr left) wants to know if he is part of your plans.`,
    options: [
      { label: 'Promise a new deal', effect: '+12 morale (re-sign him in the off-season)', apply: (c) => { bump(c.player!, 'morale', 12); return 'He is all in.'; } },
      { label: 'Stay non-committal', effect: '-10 morale', apply: (c) => { bump(c.player!, 'morale', -10); return 'He is weighing his options.'; } },
    ],
  },
];

export function maybeTriggerEvent(league: LeagueSave, rng: Rng) {
  if (league.pendingEvent || league.phase !== 'regular') return;
  if (league.day < 2 || !rng.chance(0.3)) return;
  const team = userTeam(league);
  for (let tries = 0; tries < 6; tries++) {
    const t = rng.pick(TEMPLATES);
    const ctx: Ctx = { league, team };
    if (t.pick) {
      ctx.player = t.pick(ctx, rng);
      if (!ctx.player) continue;
    }
    const ev: PendingEvent = {
      id: `ev${league.nextId++}`,
      templateId: t.id,
      title: t.title,
      text: t.text(ctx),
      playerId: ctx.player?.id,
      options: t.options.map((o) => ({ label: o.label, effect: o.effect })),
    };
    league.pendingEvent = ev;
    return;
  }
}

export function resolveEvent(league: LeagueSave, option: number, rng: Rng): string {
  const ev = league.pendingEvent;
  if (!ev) throw new Error('No event to resolve.');
  const t = TEMPLATES.find((x) => x.id === ev.templateId);
  if (!t || !t.options[option]) throw new Error('Unknown event option.');
  const ctx: Ctx = { league, team: userTeam(league), player: ev.playerId ? league.players[ev.playerId] : undefined };
  const msg = t.options[option].apply(ctx, rng);
  league.pendingEvent = undefined;
  addNews(league, `${ev.title}: ${msg}`, 'event');
  return msg;
}
