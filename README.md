# Pixel Hardwood

A browser-based pixel-art basketball game: arcade 5-on-5 games you control, plus an endless franchise mode (rosters, contracts, salary cap, staff, facilities, draft, playoffs, history).

Everything here is original: code, sprites (generated procedurally from code), the "Hardwood" pixel typeface, team names and logos, sound effects and music (synthesised with WebAudio at runtime). The game borrows design ideas from arcade sports-management games, not their assets, layouts or branding.

## Run it

Requires Node.js 20+.

```bash
cd retro-basketball
npm install
npm run dev        # http://localhost:5173
npm test           # engine, simulation and franchise tests
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

`dist/` is a static site (relative paths), so it can be dropped on any static host or opened from a sub-folder. No server, accounts or paid APIs are needed. Saves stay in the browser (IndexedDB, falling back to localStorage) and can be exported/imported as JSON from **Load Career**.

`npm run gen:font` rebuilds `public/fonts/hardwood.otf` from the glyph table in `src/art/font.ts` (the generated font is committed).

## Controls

| Action | Keyboard | Touch | Gamepad |
| --- | --- | --- | --- |
| Move | WASD / arrows | left stick | left stick |
| Shoot (hold, release in the green zone) | Space or J | SHOOT (hold) | A |
| Pass / switch defender | E or K | PASS | B |
| Sprint | Shift | SPRINT (hold) | RB / RT |
| Call a screen | Q | SCREEN | Y |
| Steal / block / jump | F or L | STEAL | X |
| Timeout (substitutions) | T | T/O | |
| Pause | Esc or P | II | |

Keys can be rebound in **Settings**. With a mouse, click a teammate to pass to him and hold/release on the court to shoot. Near the rim the shoot button becomes a layup or dunk.

## What is in the game

**Live games (Phaser 3, 480x270 virtual resolution, nearest-neighbour scaling)**
- Broadcast-style side view with a fixed gentle perspective, scrolling camera, animated crowd, scorer's rail, hoops and nets that swish or rattle, screen shake on dunks, confetti on wins.
- 5-on-5 with CPU teammates and opponents: spacing, cuts, pick-and-roll, drives, post-ups, kick-outs, late-clock shots, man-to-man defence with help rotations, closeouts, rim protection, box-outs, transition defence.
- Jump ball, possession arrow, inbounds, 24-second shot clock with 14-second offensive-rebound reset, 2s and 3s from the drawn geometry, shooting and reach-in fouls, bonus free throws, and-ones, foul-outs, out of bounds, offensive fouls, steals, interceptions, blocks, rebounds, timeouts, substitutions, injuries, four quarters and overtime.
- Shot outcome = shooter rating + distance + defender contest + fatigue + hot/cold form + clutch trait + release timing. Nothing is scripted.
- Box score tracked live; totals always reconcile with the scoreboard.
- Modes: franchise games, quick (exhibition) games, practice, and "simulate to the final buzzer".

**Franchise**
- 30 fictional clubs, two conferences, six divisions; 20/41/82-game seasons; 8 or 16 playoff teams; best-of-1/3/5/7 series.
- 13-15 man rosters with positions, archetypes, 1-10 ratings, half-star current/potential ratings, traits with gameplay effects, morale, condition, injuries, contracts, season and career stats.
- Simplified fictional cap ($100M default, hard cap, minimum-salary exception, 50% dead money on release, 115% re-sign limit) with readable explanations for every rejected move.
- Coaching credits from wins, home games, playoffs and objectives; facilities (training, medical, arena), staff (offence, defence, scouting), team dinners and permanent cap expansions.
- Rotation editor (starters, bench order, minutes plan), playbook sliders that change the AI, weekly events with consequences.
- Off-season: awards (MVP, ROY, DPOY, scoring title, Finals MVP), records, retirements, aging and development, re-signings, weighted draft lottery, 2-round draft with fuzzy scouting, free agency, new season.
- Live and simulated games feed the same `applyGameResult`, which is idempotent per game id.

## Defaults and assumptions

- The game clock always shows 12:00 quarters; it runs faster to fit the chosen real-time quarter length (1, 2, 3 or 5 minutes). The shot clock runs at a slower multiplier so possessions stay playable. Short quarters mean fewer possessions, so scores scale with quarter length (about 55-60 points per team with 3-minute quarters). Simulated games use the same possession count as live games at the chosen length, so league stats stay comparable.
- Backcourt, 8-second and 5-second inbound violations are not enforced yet.
- Trades are not implemented (listed as v2 in the spec). Draft pick ownership is tracked so trades can slot in later.

## Code map

```
src/core        shared types, seeded RNG, injuries
src/game/engine match engine (pure TypeScript, runs headless): rules, physics, AI, shot model
src/game/render Phaser scene, projection, bitmap font
src/game/input  keyboard/touch/gamepad -> InputState
src/art         procedural sprites, arena, logos, pixel font
src/audio       WebAudio synthesised sound and music
src/sim         league generation, possession simulator, season/playoffs, off-season, economy, events, transactions
src/persist     IndexedDB/localStorage saves, migrations, export/import, device settings
src/ui          DOM menu screens
tests           vitest suites for the engine and franchise systems
tools           dev-only preview pages (sprite sheet, match harness)
```
