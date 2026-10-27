# Retro Basketball

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
- **Career start**: a new career begins on the last day of the regular season. Your team has the worst record in the league and one game left. After that game the playoffs are simulated without you, then the off-season begins (re-signings, draft, free agency and the market).
- 30 clubs based on the real NBA teams: city names only (no nicknames), team colours, real conferences and divisions; 20/41/82-game seasons; 8 or 16 playoff teams; best-of-1/3/5/7 series.
- **Seven-man rosters**: five active players and up to two bench players. Choose who starts, who comes off the bench and who sits, with tap-to-swap on the Lineup screen. Stars are never forced in. Empty or unavailable spots are filled on game day by generated **0.5-star replacements** (`Reserve #90`): no contract, no cap hit, no development, never on the roster. Live and simulated games both use the chosen lineup.
- **Weak start, long climb**: a new franchise gets seven cheap players rated 3.0, 2.5, 2.0, 2.0, 1.5, 1.0 and 0.5 stars. A few have real potential (up to 5 stars), most do not. Players grow toward their potential from games, training, coaches and the off-season; veterans decline.
- **Salary cap**: a fictional hard cap of $100M. Salaries follow star bands ($1-3M at 0.5-1 star up to $22-26M at 5 stars), adjusted for age, potential, morale and form. Contracts run 1-4 seasons. Payroll, cap and available cap are shown on the roster, market and contracts screens. Over-cap moves are refused with the reason.
- **Coach Coins (CC)**: +3 per win, +1 per loss, +15 for a championship, plus one-time milestones (first win, five-game streak, playoff berth, series win, a 30-point game). Coins are a separate currency from salary. Every purchase shows its cost and asks for confirmation.
- **Spending**: Fan Engagement, Training and Recovery upgrades (three levels each); Basic, Strong and Elite offensive, defensive and development coaches; team dinners; permanent cap expansions at escalating prices. All prices live in `src/sim/config.ts`.
- **Player Market**: 3-5 saved offers of 4.0, 4.5 or 5.0-star players. Offers refresh every 3 of your games and cannot be rerolled. Signing needs enough CC, enough cap room and an open roster spot.
- **Morale**: every contracted player has a 0-100 meter with a label (Excellent, Good, Frustrated, Unhappy, Disengaged) and a reason, such as "Morale -8: limited minutes in last 3 games". Stars expect more minutes and touches than reserves. Defensive specialists are not judged on touches. One rest game barely matters. Morale scales ratings within -12% to +4%.
- **Trades**: clubs offer draft picks for your players. After a regular-season game a club may make an offer on its own; it waits on Franchise Home until you accept or decline. Or press **Trade** on a player's profile and a pop-up asks whether you accept the best offer, such as "Cleveland is offering their first-round pick". Better and younger high-potential players draw first-rounders, lesser ones second-rounders, and 0.5-1 star players draw none. Each player can be shopped once per day. Trades stay open during the draft, when clubs offer picks still to be made in it (or next season's). Acquired picks are used in the draft.
- **Pass for coins**: when you are on the clock in the draft you can pass and take Coach Coins instead: 20 CC for the first pick down to 8 CC for the last first-rounder, 4 CC in the second round.
- Weekly events, rotation and playbook, injuries, two-round draft with fuzzy scouting, re-signings, awards, records and history.
- Live and simulated games feed the same `applyGameResult`, which is idempotent per game id, so a game can never pay coins twice.

**Look**: a blue-and-yellow pixel UI across every menu and the in-game HUD. Tokens live in `src/ui/palette.ts`. Stars and morale are always shown with symbols or labels, not colour alone. Team colours are kept for jerseys, logos and courts so opponents stay distinguishable.

**Saves**: older saves migrate automatically (v3 to v4). Each roster keeps its seven best players and the rest become free agents. Contracts are re-priced to the new bands, credits become Coach Coins, facilities and staff map to the new levels, and a news item explains the upgrade. Nothing is deleted.

## Defaults and assumptions

- The game clock always shows 12:00 quarters; it runs faster to fit the chosen real-time quarter length (1, 2, 3 or 5 minutes). The shot clock runs at a slower multiplier so possessions stay playable. Short quarters mean fewer possessions, so scores scale with quarter length (about 55-60 points per team with 3-minute quarters). Simulated games use the same possession count as live games at the chosen length, so league stats stay comparable.
- Backcourt, 8-second and 5-second inbound violations are not enforced yet.
- Trades are player-for-pick deals offered by CPU clubs; you cannot yet offer your own picks or build multi-player trades.
- Besides the empty starter slots, the bench is topped up to two with replacements on game day so foul trouble and fatigue can always be covered.
- Users add talent through the Player Market, the draft and re-signings. The lower-rated free-agent pool is used by CPU teams.

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
