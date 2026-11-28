# Build log

One short entry per spec chunk: what was built, what was improvised, and what the pace runner said (`docs/spec/00-overview.md`).

## Chunk 01: Foundation

Issues #15–#21 (parent #14), on `integration/spec-01-foundation`.

### Deleted

- The retired engine and UI, about 93 000 lines across three commits: chords and the chord layer, allocation, capacity, drafts, rarity, merges, scrap, forge, mutators, world and world combat, catalog, achievements, the old `App` and every surface it rendered (render, hex detail, inventory, library, encyclopedia, world, focus), and their tests.
- The recorders, evidence captures and balance and playthrough tooling in `tools/`.
- The docs the remaining code no longer reads, plus `CONTEXT.md`, moved to `docs/archive/`. So did the old agent process docs (review workflow, verification, recordings, visual evidence, briefs).
- The kept modules were trimmed to practice facts: `trust`, `clock`, `habits`, `goals` (now `intentions`), `notes`, `records`, `apps`, the save layer and `shared-save`. The bucket nous, the offline/suspension split, breather gap handling and the economy constants are gone.

### Built

- `num.ts` wraps `break_eternity` with `D()`, arithmetic, comparison and `fmt()`, and every `fmt` case is tested. The fault guard is a no-NaN-Decimal check at the `apply`/`advance` boundary.
- `GameState` is split into `records` (real life: habits, practice log, sessions, Notes, Intentions, class credit) and `game` (nous, mode, session, open classes, legacy line). All mutation goes through `apply`, and time goes through `advance(state, seconds, 'flow' | 'breather' | 'upgrade')`. Both are pure: they return the next state and never touch the one given. `'upgrade'` and `'breather'` are no-ops for now.
- Save v16 writes the nested state exactly, Decimals included. It keeps the stale-tab guard (ADR-0032), the explicit lost-money recovery (ADR-0082), and a newer build's save is never overwritten.
- The v15 → v16 migration keeps the real-life records. Every habit waits for its class, and the game starts fresh apart from `Legacy era · <n> modules · archived`. The original v15 text is kept under `flowsynth.save.original.pre-v16`.
- `npm run pace` is the pace runner skeleton. It runs a scripted player through `apply` and `advance` and prints milestones beside `progression-map.md`.
- The Preact shell (`src/ui/shell/`). Opening the app loads, migrates and saves. It shows the recovery choice when a load requires it, and asks each habit awaiting a class for one, offering only open classes. A choice credits the habit's live credited flow seconds through `apply`'s `chooseClass`, which refuses closed classes and repeats. A unit test (`src/ui/copy.test.ts`) scans every UI source string for the banned words and exclamation marks.

### Improvised

- **The fixture scrub.** No exported v15 save existed on this machine, so `src/engine/fixtures/saves/v15-migration.json` was generated with the retired engine at `424a224`. It covers 8 sessions over about 8 days, 3 habits (one archived), live and manual logs, honesty events, 9 Notes, 3 Intentions and 4 modules. All its text is placeholder, so no scrub was needed. The generator script is in the fixture's README.
- **The pre-v15 refusal.** v10–v14 saves are refused rather than chained. The message is now one plain sentence, and the original is kept under the same pre-v16 key as a v15 save.
- **The legacy count.** `n` counts every module in the v15 `modules` array, placed or unplaced, excluding the retired `mutatorForge`. Banked roll offers aren't counted.
- **Class credit is live time only.** The spec says a migrated habit's "credited time is credited to that class". `classCredit` is defined as live credited flow, so the choice credits the habit's `live` practice-log seconds, not `Habit.seconds`, which includes manual logs. For the fixture that's 6 301 s, 3 901 s and 3 601 s against 7 501 s, 6 601 s and 3 601 s.
- **The shell's scope.** It shows only what first load owes: the recovery choice, the class choice, and a one-line notice for an unreadable or refused save. Once nothing is owed, the page is empty until chunk 02. Archived habits are asked too, marked `· archived`, so their live time reaches a class. The recovery offers `Recover`, `Download original` and `Not now`. `Not now` leaves the save untouched and unwritten, and the next load asks again.
- **A carried-over session and the class choice.** A v15 save with a running session migrates with that session: it is the player's real session. `chooseClass` changes records only, never the board, so it is open in any mode and the first load asks for classes even mid-session. The choice credits the live seconds logged so far; flow after it accrues to the class through `advance`; ending the session credits nothing twice, because class credit never comes from the session's log entry. The running session's seconds from before the choice don't reach the class. The fixture has no running session; `save-v15-migration.test.ts` builds one.
- **Which lost v15 figures ask for recovery.** Only figures the migration keeps: a running session's accounting and its provisional bucket nous. A null `nous`, `world.frontier`, `forge.progress`, `scrap`, `arete` or module reserve is discarded with the retired game and loads ordinarily.
- **The dev JSX transform is off for builds** (`vite.config.ts`). Under vitest the build-purity test's build picked Preact's development JSX, which writes absolute source paths into `dist/`.

### Review fixes

- `apply` and `advance` became pure through one shared `transact` step (clone, run, refuse or NaN-check). Tests that walk one held state use the fixtures' `applyIn`/`advanceIn`, which write the returned state back in place.
- `serialize` takes `savedAt` from its caller; the engine reads no clock.
- `numeric.ts` is gone: `requireFinite` lives in `num.ts` and throws its one `NumFault`.
- Version 15 reads only as the real pre-reset save. The readers for the two interim shapes that never left the branch (#15's flat one, #17's nested one under v15) are gone.
- Goal became Intention inside the engine (`intentions.ts`, `Intention`, `createIntention`…). GLOSSARY.md keeps Goal for the board's signpost line. Saved field names (`goalId`, `goal`, `goalsAdvanced`, `goalSeconds`) keep their spelling so v15 and v16 read the same keys.
- The banned-word test scans the engine's strings too; nothing needed changing.
- The class choice lost its explanatory line. The recovery shows only what ADR-0082 asks, as readouts: `Unreadable · <paths> · start at 0` and `Kept · your habits, sessions, Notes and Intentions, and the original save`.
- Removed the banking experiment, the old-UI `.impeccable` critiques and reviews, and pointed ADR-0074, 0081, 0082, 0088 and 0089 at `docs/archive/`.

### Pace runner

The first output, unchanged at the end of the chunk:

```
Pace run: 300 sessions, 250.0h credited

Milestone                         Reached       Target
--------------------------------  ------------  -------------------------------------------
Engineer opens                    0.0h          at the start (0h)
Producer opens                    0.0h          at the start (0h)
Roadie opens                      not reached   first contact with Flint (Sketch, 0–15h)
Mixer opens                       not reached   conquering the marked Schist (Demo, 15–60h)
First Shale conquered             not reached*  Sketch, 0–15h (ring 1)
...
Master finished (Encore opens)    not reached*  250h

* the engine has no such fact yet

DRY 0.0h–250.0h: 250.0h with no new milestone
```

As expected: there is no board yet, so nothing past the two starting classes can be reached. The whole 250 h stretch is flagged dry.

## Chunk 02: Board

Issues #24–#28 (parent #23), on `integration/spec-02-board`.

### Built

- `hex.ts`: pure axial geometry (distance, rings, neighbours in one fixed direction order, rotation and mirroring of offsets, the 91-cell lifetime board, flat-top pixel layout). `board.ts` derives each cell's kind (open, wall, dark) from the owned cells and the arc, and `map.ts` is the placeholder authored map: Shale at (−1,1), Flint at (2,−1) opening Roadie.
- `game.board` holds the owned cells, the arc (Sketch, radius 2) and the placements. `game.allowance` (2 oscillators) and `game.arrived` (Sine, Triangle) are plain facts chunk 04 will grant. Save v16 reads them additively; an older v16 save loads the opening board.
- `apply` gains `placeModule`, `moveModule` and `removeModule` (`placement.ts`), refused outside upgrade mode, onto walls, dark or occupied cells, beyond allowance, or for a type that hasn't arrived.
- Patterns as data in `modules.ts`, tested in all six rotations and their mirrors (`resonance.ts`). `rates.ts` computes `BoardRates` once per layout change and on load, with identity legs for charge, faders and pressure. Flow credits `rates.total` per second through the trust layer.
- The board in SVG (`src/ui/board/`): flat-top plates, walls as unlit stone with Shale's initial and Flint's Roadie mark, dark cells as broken outlines, modules with hue and glyph, the tray, drag and click-to-pick with keyboard, and engraved resonance outlines that pulse in flow.
- The Hex detail panel (#27): a fixed panel under the board, empty until a cell is clicked, at most five lines read from the cached `BoardRates`, opened by click, keyboard or touch and dismissed by Escape or a tap away.
- The pace runner's placement hook (#28): `placeAllowanceGreedily` fills the allowance through `apply`, and the report prints the board's layout, ν/s and the era's ν.

### Improvised

- **The tray (#25).** Until chunk 04's allowance chips, the tray beside the board shows one entry per arrived type (`Sine`, `Triangle`). Any arrived type can be placed while oscillator allowance remains. Once allowance is spent the entries stay, muted, rather than disappearing.
- **Move onto an occupied cell swaps (#25).** Moving a placed module onto another occupied open cell swaps the two in one action.
- **Removing (#25).** A placed module returns to unplaced by picking it and clicking (or dropping on) the tray.
- **Invalid saved placements (#25).** A placement whose type is unknown, whose cell isn't an owned open cell, or whose cell already holds a module returns to unplaced instead of failing the load. A save without allowance or arrived types loads the opening's (2 oscillators; Sine and Triangle).
- **Refusal copy (#25).** A refused placement keeps the pick and shows its reason in one quiet line under the board (`That cell is a wall.`, `Oscillator allowance is full.`, `The board is locked while a session runs.`).
- **Patterns as direction paths (#26).** Each partner cell in a pattern is a path of steps through the six directions, relative to the oscillator, and every step asks one adjacency function (`adjacent` in `engine/resonance.ts`). Chunk 08's Sync cables extend that function. Square's threshold is the same data: all six sides, with `atLeast: 4`, and its partners are the occupied sides.
- **Rates are not persisted (#26).** `game.rates` is left out of the save text. The reader recomputes it once from the loaded layout, and the v15 migration computes it once from the opening board. A fresh state carries empty rates, since the opening board holds no module.
- **The acceptance hour (#26).** The ticket gives one trusted hour on the acceptance layout as 3.5 × 3600 ν. That figure is the two Triangles' share. The Sine makes its base 1 ν/s too, so the board totals 4.5 ν/s and the hour yields 4.5 × 3600. The test asserts both.
- **One outline per set of cells (#26).** Instances that cover the same cells, such as the acceptance layout's two Triangles, draw one outline, since two would coincide. The outline is the union's boundary, drawn in the gutter between plates with a dark undercut for the engraving. It pulses by stroke opacity over 3.2 s in flow, and holds still under `prefers-reduced-motion`.
- **No flow clock in the shell yet (#26).** Nothing in this chunk starts a session from the page, so the shell has no flow ticker. The ν readout and the outlines read the state signal, so they rise and pulse as soon as flow time passes through `advance`. Chunk 04's flow screen adds the clock.
- **Hex detail placement and clicks (#27).** The Hex detail sits under the board, full stage width, with its five-line lane reserved, so it never moves the board and draws nothing until the first click. Every cell click (and Enter or Space on a focused cell) reads that cell. In upgrade mode the same click still picks or places, and after a placement the panel reads the cell the module landed on. In flow, pause and breathers it only reads. Escape and a tap away empty it and cancel any pick together. A tap inside the panel keeps both.
- **Keyboard reach (#27).** The board is one tab stop (roving focus), starting at (0,0) and then wherever focus last sat. The arrow keys move between cells, dark ones included, so every cell reads from the keyboard without 91 tab stops. Up and down step along a column. Flat-top hexes have no straight left or right neighbour, so left and right zig-zag along a drawn row (from an even column east steps down-right, from an odd column up-right), and a step left undoes a step right. Focus stops at the lifetime board's edge.
- **Dark cells as targets (#25).** During a pick, dark cells carry the muted invalid-target outline like walls.
- **The board keeps the touch floor (#24).** The board scales with its width only, so on a desktop width every cell stays at least 44px across its flats and a short window scrolls. Below 680px the tray drops under the board; at phone width the board only has to fit.
- **Hex detail copy (#27).** Each oscillator type says what closes its resonance (Sine `between`, Triangle `closes`, Square `held by`, Saw `ends`) and what it needs when it isn't resonating. A placeholder wall reads `Wall`, a dark cell `Dark cell · beyond this arc`, and a Release `No resonance pattern`. Rates and factors show two decimals with at least one (`1.0`, `1.75`), truncated like every shown figure. The inspected cell keeps a thin ink outline.
- **Placeholder walls carry no initial (#24).** Only Shale and Flint are named in this chunk, so only they carry an initial (and Flint the Roadie mark). Every other wall inside Sketch's radius is nameless unlit stone until chunk 05 authors the map.
- **The pace runner's greedy placement (#28).** In upgrade mode before the first session, and again after each session, the scripted player fills its remaining allowance one oscillator at a time. Each candidate (every arrived type on every owned cell) is tried through `apply`, which is pure, and the one that most raises `rates.total` is applied. Ties keep the first candidate in arrived-type, then owned-cell order, so on the opening's allowance of 2, where nothing can resonate, it places two Sines at (0,0) and (1,0). It never moves a placed oscillator. With allowance 3 the third oscillator closes a resonance (`pace.test.ts`). `runPace` takes an optional `start` state so tests can grant what chunk 04 will. ν/s prints as the Hex detail shows it (`fmtRate` in `num.ts`: two decimals with at least one, truncated like every shown figure).

### Review fixes

- **A Producer class choice recomputes the rates.** `chooseClass` credited banked live seconds to Producer without recomputing, so the Flywheel's output went stale until the next layout change. `apply` now recomputes once when the choice changes Producer credit.
- **The plug leaves the target's centre to the cell.** The plug's 52-unit (about 46px) hit circle sits 24 units from the target's centre and covered it, so a centre click on a patched target picked the cable. Any 44px circle near the target's edge reaches one of the two centres beside it, so the circle stays and is clipped (`clip-path`, evenodd) to leave a 24-unit disc (about 21px) on the target's centre. Browsers hit-test the clipped shape, so a click there falls through to the cell and inspects or picks it, while the rest of the circle, the plug itself included, stays the plug's.
- The cable-crossing test moved into `hex.ts` with the geometry. `cableFrom` and the layout lock live once in `placement.ts`; `takesCharge` (`modules.ts`) is the one rule for which deliveries charge. `num.ts` gained `ln`, so no Decimal method is called outside it. The saved-cable reader returns the cables it keeps without changing the board it reads.
- The Hex detail's patched-target line handles each target kind exhaustively: a wall reads by name, and a dark target, which the rules refuse, is no longer read as a wall.

### Pace runner

At the end of the chunk, `npm run pace` (250 credited hours):

```
Pace run: 300 sessions, 250.0h credited
Board: 2 oscillators, 2.0 ν/s — Sine (0,0), Sine (1,0)
Era ν: 1.8e6

Milestone                         Reached       Target
--------------------------------  ------------  -------------------------------------------
Engineer opens                    0.0h          at the start (0h)
Producer opens                    0.0h          at the start (0h)
Roadie opens                      not reached   first contact with Flint (Sketch, 0–15h)
Mixer opens                       not reached   conquering the marked Schist (Demo, 15–60h)
First Shale conquered             not reached*  Sketch, 0–15h (ring 1)
...
Master finished (Encore opens)    not reached*  250h

* the engine has no such fact yet

DRY 0.0h–250.0h: 250.0h with no new milestone
```

The board makes nous now: the player lays out the two Sines before the first session, so 2 ν/s over every credited second, 2 × 250 h × 3600 = 1.8e6 ν. The allowance never grows (chunk 04 grants it), so the opening layout can't resonate and the rate stays flat. Nothing spends nous and no wall can be conquered yet, so no further milestone is reachable and the whole run is still flagged dry.

## Chunk 03: Charge and cables

Issues #31–#35 (parent #30), on `integration/spec-03-charge`.

### Built

- The Modulator category (#31): `game.allowance` gains `modulator: 1` and the Flywheel arrives at the start. A modulator carries a facing (`hex.ts`: six facings named NE, SE, S, SW, NW, N), and `apply`'s `rotateModule` turns it a step either way in upgrade mode. The faceplate draws a pointer and a jack, and `r` / `Shift+R` turn the inspected or picked module.
- Reach and the charge factor (#32). Output and reach are catalogue data (`modules.ts`): the Flywheel makes 1 charge/s plus 0.1 per lifetime Producer hour, up to 3, into a faced reach of two cells in a line. The Pulsewell's data is there too, but it hasn't arrived (chunk 04). `computeBoardRates` runs modulators first: every oscillator in reach receives the full output, deliveries sum, and the oscillator's charge leg is `1 + ln(1 + charge/s received)`. Rates are recomputed after a layout or facing change, on load, and when a flow session ends. The board outlines a shown modulator's reach, and the Hex detail adds its effect line.
- Patch cables (#33): `board.cables`, `game.cableAllowance` (1) and `game.arrivedCables` (Patch). `apply` gains `patchCable`, `repatchCable` and `unplugCable` (`cables.ts`), refused onto dark cells, onto the source's own cell, beyond length 3, beyond the allowance, or across another cable. A patched modulator delivers its whole output to the target in place of its reach. The board draws cords from the jack to a plug that sags below the line, with beads in flow. The tray holds a cable entry.
- Patching into walls (#34): a wall inside the arc is a Patch target. A patched modulator's output into a wall is that wall's damage/s at 1:1, beside its authored regen (Shale 0.1/s, Flint 10/s) and net, in `rates.walls`. Nothing applies it to HP yet (chunk 05). The Hex detail reads `Taking 1.0/s · regen 0.1/s` on a patched wall and `patched → Shale` on its modulator.
- The pace runner tends modulators and cables (#35). After the oscillator allowance, `placeAllowanceGreedily` places the modulator allowance one modulator at a time, trying every owned cell in all six facings, then the cable allowance one Patch at a time from each placed modulator to each cell of the lifetime board. Each step keeps the candidate that most raises total ν/s. The board line adds charge/s and each patched wall's damage/s.

### Improvised

- **Turning (#31).** Clicking the picked modulator again turns it clockwise, `Shift+R` turns it counter-clockwise, and a new placement faces NE. The pointer is drawn in ink over the nameplate. A saved facing that is missing or invalid reads as NE, and a type without facing drops it.
- **The Modulator hue (#31).** The Modulator category takes the old generator green (`hue-generator` became `hue-modulator`).
- **Per-target output (#32).** Every module in reach, or at a Patch's target, receives the full output; it isn't split. The Pulsewell's patched output is left to chunk 04.
- **Reach is a fixed shape (#32).** Walls don't block it, and reach charge that lands on a wall is wasted. Only a Patch damages a wall (#34).
- **The Flywheel's output through a session (#32).** Output is read from lifetime Producer credit when rates are recomputed, so it holds still through a session and updates when the session ends. A class choice that credits a habit's banked live seconds to Producer recomputes the rates once, so the readout never disagrees with the board (story 69); a choice that adds no Producer credit, or is refused, recomputes nothing.
- **Patch targets (#33).** Any open cell is a target, empty ones included, so a cable can be laid before its target is filled.
- **Unplugging (#33).** Moving, swapping or removing a patched modulator unplugs its cable. A target cell emptying leaves the cable where it is.
- **The patch gesture (#33).** Three clicks: the tray's cable entry, the modulator's jack, then the target. The plug is the placed cable's pick handle; picked, it re-aims on the next target or unplugs on the tray.
- **Crossing (#33).** Two cables cross when their straight segments between cell centres meet anywhere but a shared endpoint. Collinear overlap and running through the other's endpoint count. The test runs exactly on the integer axial cells.
- **Invalid saved cables (#33).** A saved cable is read through the same patch rules, in saved order, and one that fails them is unplugged instead of failing the load. A chunk-02 save gains the opening's cable allowance and Patch.
- **Wall damage as a rate only (#34).** `rates.walls` lists the walls in the order a Patch first targets them. `regen` is null for a placeholder wall, so its readout leaves the regen leg out. Flint's regen reads `regen 10.0/s` through `fmtRate`, like every rate. A patched Flint keeps `opens Roadie` on its name line, and the `Taking …` line becomes its one effect line.
- **The Hex detail copy (#32–#34).** A modulator reads `Flywheel · Modulator · facing NE`, then `1.0 charge/s · reach → Triangle, Sine` (nearest first, oscillators only), `1.0 charge/s · no module in reach`, `patched → Sine`, `patched → Open cell` or `patched → Shale` (`Wall` for a placeholder). An oscillator's legs line adds its charge leg once it receives charge.
- **The pace runner's modulator and cable pass (#35).** A modulator candidate is a placement followed by up to five clockwise turns, and a cable candidate a `patchCable` to any of the 91 lifetime cells. Each candidate runs through `apply`, which is pure, and a refused one is dropped. A modulator is placed even when it raises nothing, as an oscillator is. A cable is placed only when it raises total ν/s, so wall targets are never chosen (they lower ν/s). Ties keep the first candidate in arrived-type, owned-cell, facing, then target order. Nothing placed is moved, turned or unplugged afterwards. The report's placements carry facing, and it gains `cables`, `charge` and `walls`. The board line reads `<n> oscillators, <n> modulator(s), <ν/s>, <charge/s>[, <Wall> <damage/s>…] — <layout>[, Patch (a) → (b)]`. `pace.test.ts` grants a pre-placed Flywheel that faces off the board, to show a Patch is taken when it raises ν/s, and a pre-patched Shale for the damage figure.

### Review fixes

- **A Producer class choice recomputes the rates.** `chooseClass` credited banked live seconds to Producer without recomputing, so the Flywheel's output went stale until the next layout change. `apply` now recomputes once when the choice changes Producer credit.
- **The plug leaves the target's centre to the cell.** The plug's 52-unit (about 46px) hit circle sits 24 units from the target's centre and covered it, so a centre click on a patched target picked the cable. Any 44px circle near the target's edge reaches one of the two centres beside it, so the circle stays and is clipped (`clip-path`, evenodd) to leave a 24-unit disc (about 21px) on the target's centre. Browsers hit-test the clipped shape, so a click there falls through to the cell and inspects or picks it, while the rest of the circle, the plug itself included, stays the plug's.
- The cable-crossing test moved into `hex.ts` with the geometry. `cableFrom` and the layout lock live once in `placement.ts`; `takesCharge` (`modules.ts`) is the one rule for which deliveries charge. `num.ts` gained `ln`, so no Decimal method is called outside it. The saved-cable reader returns the cables it keeps without changing the board it reads.
- The Hex detail's patched-target line handles each target kind exhaustively: a wall reads by name, and a dark target, which the rules refuse, is no longer read as a wall.

### Pace runner

At the end of the chunk, `npm run pace` (250 credited hours):

```
Pace run: 300 sessions, 250.0h credited
Board: 2 oscillators, 1 modulator, 3.38 ν/s, 3.0 charge/s — Sine (0,0), Sine (1,0), Flywheel (0,1) facing NE
Era ν: 3e6

Milestone                         Reached       Target
--------------------------------  ------------  -------------------------------------------
Engineer opens                    0.0h          at the start (0h)
Producer opens                    0.0h          at the start (0h)
Roadie opens                      not reached   first contact with Flint (Sketch, 0–15h)
Mixer opens                       not reached   conquering the marked Schist (Demo, 15–60h)
First Shale conquered             not reached*  Sketch, 0–15h (ring 1)
...
Master finished (Encore opens)    not reached*  250h

* the engine has no such fact yet

DRY 0.0h–250.0h: 250.0h with no new milestone
```

The opening owns four cells. The two Sines take (0,0) and (1,0), and from either cell left the Flywheel's two-cell reach meets one Sine. The player keeps the first, (0,1) facing NE, which reaches (1,0) and then Flint. That Sine's charge factor starts at 1 + ln 2, so the board makes 2.69 ν/s before the first session. Sessions alternate Engineer and Producer, so the Flywheel reaches its 3 charge/s cap at 20 Producer hours, about 40 credited hours in, and the board holds 2 + ln 4 = 3.38 ν/s from there. The era's ν rises from 1.8e6 to 3e6. A Patch would deliver to that one Sine in place of the reach, which raises nothing, so the cable stays unused. Patching into Shale would cost ν/s and leads to no milestone until chunk 05 lets it fall, so no further milestone is reachable and the run is still flagged dry.

## Chunk 04: Cadence

Issues #38–#45 (parent #37), on `integration/spec-04-cadence`.

### Built

- **Class levels and grants (#38).** `levels.ts` owns the thresholds (0.5, 1.5, 3, 5, 8, 12, 17, 23, 30 h, then each step 1 h longer: 38, 47, 57, 68…) and the grant ladders as data. `classLevel` gives a class's level and its current and next thresholds. `grantsOf` is the one derivation of the allowance per category, the cable allowance and the arrived module and cable types, from `records.classCredit` and `game.openClasses`. The four old `game` fields are gone: the save no longer writes them and ignores them on read. Placement, cables, the saved-cable reader, the tray and the pace runner all read `grantsOf`.
- **The tray's chips (#38).** Each category group is headed by its unplaced allowance (`Oscillators 1`), muted at 0, once a session has completed. The cable entry's count is the cables' chip.
- **Begin flow and the flow screen (#39).** `startSession` takes `{ habitId, target, now }`: it selects the habit and starts, refused without a known, unarchived, classed habit (`Choose a habit first.`) or outside 10–180 minutes (`Choose a length from 10 to 180 minutes.`, null included). `Shell.boundary(presence)` advances flow or paused by the wall gap and drift step since the last boundary, marks the target once, and saves; `main.tsx` calls it every second and on `visibilitychange` (and `pagehide`). The flow screen shows the board, ν, the class line, `Ready · N`, the ported clock, Pause/Resume, End and the Notes door.
- **End of session (#40).** `Shell.end()` flushes a visible boundary; with provisional time owed it shows the ported honesty report (its three answers and copy), whose answer settles the pool and then ends. Otherwise it ends directly. The session tracks `nousMade` (trusted flow ν, plus provisional ν on a non-missed answer). The summary gains `nous`, `habitClass`, `classSeconds`, `levelBefore` and `levelAfter`, all defaulting on read, and reads as one line (`+8 100 ν · Engineer +30 min`, ` → Lv 1` when crossed) with one `Continue` control; dismissed, it leads to upgrade mode.

- **The Goal and the first screen (#42).** `goal.ts` holds each arc's priority list as data (label, `shown`, `done`); `goalOf` returns the first entry shown and not done. Sketch: `Place a third oscillator`, `Conquer Shale`, then `Conquer Basalt`, `Reach Flint`, `Prestige` declared with `shown` false. `disclosureOf` gives the chips, class levels and doors from the first completed session on. Upgrade mode draws the Goal under ν; the flow screen doesn't. A fresh start renders exactly the nine first-screen things.
- **The Almanac (#43).** `reattuneHabit {habitId, habitClass}` changes only `habitClass`, upgrade mode only; it refuses an unknown or archived habit (`Habit not found.`), a habit awaiting its class (`Choose this habit's class first.`), a closed class and the same class (`Piano is already Engineer.`), each leaving the state deep-equal. `almanac.ts` `dayStrip(state, habitId, days, now)` buckets the practice log by the local day `intentions.localDayStart` gives (now exported), walking back by calendar date; `almanac.test.ts` joins `npm run test:calendar`. The door sits in `nav.shell-doors`; `Shell.openAlmanac()` opens it only in upgrade mode once the doors show, and rolls Intentions to today first. Four surface files (`AlmanacHabits`, `AlmanacIntentions`, `Notes`, `AlmanacHistory`) under `Almanac.tsx`, styled in `almanac.css`.

- **The breather (#41).** `endSession` banks `{ seconds: clamp(credited ÷ 5, 300, 900) }` from 600 credited seconds, replacing any bank, and the summary carries `breather` (seconds or null) as its second line, `Breather banked · 10 min`. `Mode` gains `breather`; `game.breather` holds `banked`, `running` and `result`. `takeBreather`, `endBreatherEarly` and `dismissBreatherResult` live in `engine/breather.ts`. `advance(…, 'breather')` moves `running.elapsed` by the wall gap and, at the length, pays `rates.breatherTotal × seconds` once and lands in upgrade mode; in any other mode it changes nothing. Each `OscillatorRate` gains `breatherRate` (Release's breather base 6 in `modules.ts`), and `BoardRates` gains `breatherTotal`, in the same `computeBoardRates` call. The Shell's boundary runs breather time; upgrade mode shows `Take breather · N min` beside `Begin flow`, the calm screen shows only its line and `End early`, and `Breather complete · +… ν` shows with `Continue` until dismissed. The spec's full loop is `src/ui/shell/breather.test.ts`.

- **The Encyclopedia (#44).** `engine/encyclopedia.ts` holds the thirteen entries as data (id, title, readout lines, reveal predicate). `game.encyclopedia = { revealed, seen }`: id lists that only grow. `revealEntries` runs inside every accepted `apply` commit, every flow and breather `advance` commit, `createInitialState` and both save readers, so a fresh start reveals Walls, Sine and Triangle. `readEntry {id}` marks a revealed entry seen and refuses an unrevealed one. The save reads each set as known ids once each (seen kept within revealed), empty when missing, then reveals from the loaded state. A v15 save's retired encyclopedia is dropped. The door sits beside the Almanac's in `nav.shell-doors` with one 6 px `[data-unseen]` dot while `hasUnseen`. `Encyclopedia.tsx` (list → entry view, `‹ Entries` back) is opened by `Shell.openEncyclopedia()` (upgrade mode, doors shown) and closes on Close, Escape, or a pointerdown outside the panel. The copy test checks every entry's title and lines.
- **The pace runner's cadence (#45).** Each session starts through `startSession` with the round-robin habit. Tending after it follows ADR-0095, upgrade mode first: place the allowance (which grows with levels, the arrived types as candidates), the patch pass, buy faders (still empty), then `takeBreatherInFull`: `takeBreather`, `advance(length, 'breather')`, `dismissBreatherResult`. The `class-level-5` probes read `classLevel`. The report adds `Classes: Engineer Lv n, Producer Lv n` (open classes) and `Breathers taken: n`.

### Improvised

- **Arrival order (#38).** Credit history isn't kept, so a derived type arrives in the order of the threshold (in hours on its class) that brought it, ties by class order (Engineer, Producer, Mixer, Roadie). Start types come first.
- **Roadie and Mixer ladders (#38).** Declared empty: their types (Blade, Guard Plate) don't exist yet, and a closed class grants nothing. Chunk 05 fills Roadie's.
- **The Pulsewell's patched output (#38).** Per target, as chunk 03's outputs are: patched, it delivers its 0.5 charge/s to its one target, and unpatched 0.5 to each of its six neighbours.
- **Test fixtures (#38).** `giveOscillators` and `giveProducer` set class credit at the lowest level that grants what a test asks for. Producer credit also raises the Flywheel's output, so chunk 03's charge and wall tests that needed a second modulator or cable now read Producer Lv 1 or 2 figures (1.05 or 1.15 charge/s).
- **Reload mid-session (#39).** On boot, a flow session's wall gap since `savedAt` goes to `advance` as an `offline` absence, then a visible zero-second boundary settles it, as the old console's resume-from-save did. A paused session moves nothing. The old console opened the honesty report here; it doesn't any more (that's #40's End).
- **Unclassed and open-ended test sessions (#39).** The engine starts neither now. The `begin` fixture stands in for a migrated save: a null target starts a planned session and clears its plan, and a habit still awaiting its class is lent a class for the start only. One records test makes an unstructured session by clearing `activeHabitId` after the start.
- **The Begin flow panel's extras (#39).** A quiet `Back` closes the panel, and the custom length is a minutes field (10–180). The new habit's class buttons create it on click, and the panel selects it.
- **Notes in flow (#39).** Ported with its CAPTURE/LOGGED faces, composer copy, live tag and stamp, as a panel under the console rather than a modal. The old chime, Notification, and tab-title flip are not ported: the spec asks only that the target be marked once, and nothing asks for notification permission.
- **`End` with provisional time owed (#39).** `endSession` still refuses, and the flow screen shows that refusal as its one quiet line. #40 puts the honesty report there.
- **The summary's class figures (#40).** `classSeconds` is the session's credited seconds when the session habit has a class at End (accrueLivePractice credits all live time to it), else 0. `levelBefore` is derived as the level of `classCredit − classSeconds`, not captured at start. A migrated habit that chose its class mid-session would overstate both; the case is rare. A classless summary reads `+N ν · +M min`. Minutes truncate, like every shown figure.
- **Honesty report state (#40).** "Ending" is a Shell signal, not saved: a reload with the report open lands back on the flow screen, and End asks again. Answering from a paused session resumes it first (the report settles only in flow), with no time passing between.
- **The dismiss control (#40).** `Continue`, the old summary's dismissal word. The honesty report keeps its eyebrow `BEFORE YOU WRAP UP` and its `Practiced the whole time away` label.
- **v15 summaries (#40).** The retired game's `earned` isn't carried into the summary's `nous`; it defaults to 0.
- **The Goal past Shale (#42).** With Shale's cell open and every later entry inert until chunks 05 and 06, `goalOf` returns null and no Goal line is drawn. The spec's "always exactly one Goal" holds again once chunk 05 fills `Conquer Basalt` and `Reach Flint`.
- **First-session disclosure (#42).** Read off `records.sessionsCompleted > 0`, which a migrated save already carries; no new field. The doors' place is an empty `nav.shell-doors[data-doors]` at the start of the transport row, drawn only then; #43 and #44 put the Almanac and Encyclopedia doors inside it.
- **The calm screen's clock (#41).** `9:41`: the ported `formatClock` with the leading minute zero dropped, counting the time left rounded up. Its line and clock sit centred with no board drawn, as the spec's "shows only" reads.
- **Reload mid-breather (#41).** On boot, a running breather advances by the wall gap since `savedAt` at once, so the calm screen opens with the right time left, and a breather whose deadline passed while closed opens straight to its result. That boot step is the "first boundary after load".
- **End early (#41).** It flushes a boundary first, so ending at or past the deadline completes the breather and pays rather than re-banking.
- **The full loop's board (#41).** A fresh start places nothing, so its breather would pay 0 ν. The acceptance test places Sine, Triangle, Triangle (Engineer Lv 1's third oscillator) after dismissing the summary, so ν = `breatherTotal × 360` = 3 240 is a real figure.
- **Breather save reads (#41).** Each part defaults to none when missing. A `breather` mode without a readable running breather loads as upgrade, and a running breather outside breather mode is dropped. A v15 summary's retired breather allowance banks nothing. An unreadable result ν drops the result: the ν was already paid into `game.nous`.
- **Refusal copy (#41).** `takeBreather` refuses with `A breather is taken between sessions.`, `A breather is already running.`, `No breather is banked.` or `Read the session summary first.` No surface shows them: the button only appears when taking is allowed.
- **Re-attune refusal order (#43).** Upgrade mode, then the habit, then awaiting-class, then the class's openness, then sameness: a closed class is named before "already". Re-attuning recomputes no rates, since no credit moves.
- **Intention line figures (#43).** Progress minutes truncate and hold at the target once met, so an over-target week reads `40 / 40 min this week`, engraved. A migrated `once` Intention reads with no period (`Habit C · 45 / 45 min`); the form offers only today and this week, plus `once` when editing one that already is. Carried-over migration rows keep the old `Keep` choice.
- **Strip scale (#43).** Each strip's bars scale to its own busiest day; an empty day is a hairline. No figures, no colours, no tooltips: the habit line carries the hours.
- **Almanac surfaces (#43).** Habits awaiting a class and archived habits aren't listed (the class screen asks first; archived habits keep their history). The Notes surface reuses the flow screen's `Notes` panel, flat and without its own Close. History drops the old `Earned`, `Breather` and `Unlocked` rows (no data on main; `Unlocked` is banned) and renames `Goals advanced` to `Intentions advanced`. The legacy line heads the history list.
- **Encyclopedia reveal predicates (#44).** Resonance: some oscillator rate has an instance. Charge: some oscillator's `chargeReceived` > 0. Patterns: `grantsOf(...).arrived`. Breather: a banked, running or result breather, so a save holding only a running one still reveals it. Pressure and Prestige stay `false` until chunks 05 and 06. Reveals are appended in authored order within one commit, and the list draws in authored order.
- **Entry copy (#44).** These are readout lines built from each type's data in `modules.ts` and the chunk-04 rules. Walls name HP, regen and pressure ahead of chunk 05. Pressure's and Prestige's text is written now but stays unrevealed. `readEntry` also works during a session, but only upgrade mode has a door.
- **Test expectations touched (#44).** The v15 load tests now expect `classes` revealed, because the fixture has completed sessions. The rates-cache test's "no rates in the save" regex now matches keys only, because `"resonance"` can be a revealed entry id.
- **The pace runner's wall clock (#45).** `PaceTurn` gains `now`, and every `advance` through the turn moves it by its seconds (flow, the upgrade visit and the breather alike), so `takeBreather` gets a real `now`. The player takes the breather after its upgrade-mode visit, then rests before the next session. Breathers are counted as `takeBreather` actions the engine accepted.
- **The pace tests' opening board (#45).** The hand-worked opening figures (`Era ν: 32 562`) take no breather, so they stay flow ν alone; the breather step has its own tests.

### Flagged readings

Decided where the spec is silent or self-contradictory, by philosophy.md (#37's Further Notes):

- **The Producer ladder.** Agreed with the maintainer: the non-milestone levels alternate +1 Modulator and +1 cable, starting with a Modulator, and skip the milestone. Lv 1 +1 Modulator, Lv 2 +1 cable, Lv 3 Pulsewell, Lv 4 +1 Modulator, Lv 5 +1 cable, then alternating. This matches "Patch +1 at Lv 2 and 5"; mechanics-sketch.md's "odd / even levels" line is corrected to it.
- **Levels start at Lv 0**, following Roadie's "Lv 0 Blade". The flow screen sketch's `Lv 2 · 1.1h / 1.5h` reads as Lv 1 under these thresholds, and the class line shows the current level.
- **"No other controls"** on the flow screen means besides `Pause`, `End` and the ported focus apps (the clock and Notes), which the spec keeps.
- **The honesty report shows only at End**, never on return mid-session, so flow never prompts.
- **An early-ended breather** pays nothing and returns to the bank (ADR-0073 allows early exit; the glossary says it pays only if completed).
- **The summary marks a crossed level** (` → Lv 2`).
- **Habit colours stay in the records but aren't drawn.** Hue means category only.
- **The `Place a third oscillator` Goal** is state-derived, so it comes back if a player drops below three placed oscillators with allowance for three.
- **The Pulsewell's patched output is 0.5 charge/s per target**: patched, all of it goes to its one target, as chunk 03's per-target outputs do; unpatched, 0.5 to each of its six neighbours.
- **One dot, not one per entry (#44).** The spec says "one quiet unseen-dot", so only the door carries it. List rows aren't marked, and the old `Title · Unseen` rows aren't ported. The dot clears once every revealed entry has been opened.
- **Tap away (#44).** The panel stands in place of the board, as the Almanac does, and a `pointerdown` anywhere outside it closes it. Opening the Encyclopedia closes the Almanac, and the other way round.

### Review fixes

- **The honesty report freezes the session clock.** Once End shows the report, each boundary takes a fresh reading and moves nothing, so time spent reading it credits no practice, class credit or breather length. The clock boundary moved out of `shell.ts` into `clock.ts` (`SessionClock`, with `catchUpSinceSave` and `markTargetIfPassed`, formerly `reconciled` and `marked`). The Begin, Almanac and Encyclopedia panels share one `panel` signal over a `Panel` union, so only one is ever open. `unplacedOf` (`placement.ts`, beside `placedCount`, which `levels.ts` can't import without a cycle) is the tray's and the Ready count's one unplaced-allowance reading, and `wholeMinutes` (`readouts.ts`) is the one truncating minutes formatter. `disclosureOf` dropped its unread `classLevels` flag.

### Pace runner

At the end of the chunk, `npm run pace` (250 credited hours):

```
Pace run: 300 sessions, 250.0h credited
Board: 3 oscillators, 1 modulator, 6.17 ν/s, 3.0 charge/s — Sine (0,0), Sine (1,0), Flywheel (0,1) facing NE, Triangle (1,-1), Patch (0,1) → (1,-1)
Era ν: 7.66e6
Classes: Engineer Lv 17, Producer Lv 17
Breathers taken: 300

Milestone                         Reached       Target
--------------------------------  ------------  -------------------------------------------
Engineer opens                    0.0h          at the start (0h)
Producer opens                    0.0h          at the start (0h)
...
Engineer level 5                  15.8h         8h on the class
Producer level 5                  16.7h         8h on the class
Roadie level 5                    not reached   8h on the class
Mixer level 5                     not reached   8h on the class
...

DRY 0.0h–15.8h: 15.8h with no new milestone
DRY 16.7h–250.0h: 233.3h with no new milestone
```

- **The first resonance.** The first session is Engineer's: 50 minutes pass 0.5 h, so Engineer Lv 1 grants the third oscillator at 0.8 credited hours, and the greedy player resonates in that same tending visit, laying a Triangle at (1,-1) beside both Sines.
- **Levels.** Sessions alternate Engineer and Producer, so each class gets half the credit: Lv 5 (8 h on the class) at 15.8 h (Engineer's 10th session, the run's 19th) and 16.7 h (Producer's), both about twice the progression map's 8 h, which counts hours on the class. Both end at Lv 17 (125 h each). The Pulsewell arrives at Producer Lv 3, 6.7 credited hours in.
- **The board is cell-bound.** The opening's four owned cells fill with the two Sines, the Flywheel and the Triangle at 0.8 h, so every later grant (more oscillators and modulators, the Pulsewell, Square, Saw, Release) stays unplaced until the board owns more cells. The player patches the Flywheel into the Triangle, since that raises ν/s more than its reach into the Sine did. The Flywheel caps at 3 charge/s, and the board holds 6.17 ν/s.
- **Breathers.** Every 50-minute session banks a 10-minute breather, and the player takes all 300, in full. They raise the era's ν from 5.47e6 (none taken) to 7.66e6, about 40%: the board runs ×2 for a fifth of the flow time.
- Still no wall falls and nothing spends nous, so outside the two Lv 5 probes the run stays dry; chunk 05 is the next milestone.

## Chunk 05: Walls and Arms

Issues #48–#55 (parent #47), on `integration/spec-05-walls`.

### Built

- **The authored map (#48).** `map.ts` is one table of the 87 walls, keyed by cell, each `[kind, modifier, mark]`, plus the nine kinds' HP, regen and pressure as data. `wallAt` returns the kind's name, full HP and regen (`Num`), pressure, modifier and mark, or null on an opening cell. The placeholder wall and its nullable name and regen are gone, so `WallRate.regen` is never null. A Patch or re-aim into an `Only Arm damage` wall is refused with `Only Arm damage.` in `cables.ts`'s route rule, so the board's target outline, the saved-cable reader and `apply` all agree. On the board every wall inside the arc shows its initial, Flint the Roadie mark, the marked Schist a new Mixer mark, and a modified wall an engraved glyph. The wall Hex detail shows its static lines.
- **Wall HP and conquest in flow (#49).** `board.walls` lists `{ cell, hp }` for each wall below full HP. Trusted flow time runs through the wall step (`conquest.ts`): closed-form `hp(t) = min(full, hp₀ − (damage − regen) × t)`, split at the earliest instant a wall reaches 0. Each piece pays ν and credits practice at the rate that held through it; the fallen walls (ties together) join `board.open`, drop their entry, and the rates recompute once. Provisional, paused, upgrade and breather time move no wall. `Conquer Basalt` is shown from the start and done once either Basalt is open. The wall Hex detail's HP line reads the board's live HP. The save reads `board.walls` (default `[]`) and drops invalid entries.
- **The fought wall on the flow screen and in the summary (#50).** `foughtWall(board, rates)` (`fought.ts`) picks the wall being fought: among walls with net > 0 the soonest to fall (HP ÷ net), else the most damaged, else none, ties in authored order (`authoredIndex` in `map.ts`). The flow screen shows its HP row, `Shale ▕███████░░░▏ 412 / 600 HP`, in a row with `Ready · N`. The running session's `walls` tallies each fought wall's net HP lost and whether it fell. At close the summary copies it as `walls`, marking the wall still fought at the end, and the summary line appends ` · <Wall> conquered` per conquest, then ` · <Wall> −<n> HP`. Both lists default to `[]` in the save.
- **Pressure (#52).** `computeBoardRates` fills each oscillator's pressure leg: the sum over its bordering cells whose derived kind is `wall` (so a dark cell presses on nothing, and a cell a conquest opens stops pressing in the same recompute), each wall's kind pressure doubled for `Pressure ×2`, capped at 60%. Flow and breather rates share it; modulator output and wall damage don't read it. The oscillator Hex detail's legs line gains ` · −<p>% pressure`, the wall's pressure line ` on <n> modules`, and the Encyclopedia reveals **Pressure** on the first pressured oscillator. The Walls entry gains `Some walls carry a rule · Pressure ×2 · Only Arm damage`, built from the modifiers' names.
- **Away time and breathers fight walls (#51).** Provisional flow time holds its seconds in `accounting.wallSeconds`, beside the provisional ν. A `full` or `planned` answer runs them through the wall step, and `missed` drops them. A completed breather runs its whole length through the wall step at 2× damage, regen ×1, paying ν at each piece's `breatherTotal`. The breather result gains `walls`, and its line appends the summary's walls segment: `Breather complete · +31 400 ν · Shale −220 HP`. `mechanics-sketch.md`'s breather line now says walls take double damage and regen doesn't double.
- **Roadie opens, and the Blade (#53).** The wall step opens Roadie the moment a conquest leaves an open cell bordering the marked Flint (0,−2), so it can open mid-flow. Roadie's ladder brings the Blade and 1 Arm at Lv 0, +1 Arm at Lv 1, and +1 Arm a level from Lv 3. The Blade is an `arm` module with a facing, turned by the same `rotateModule` as the Flywheel. It takes charge from reach and Patches, and `rates.arms` gives each Arm the charge it receives, the cell it faces, whether that cell is a wall, and its damage (10 × charge). Blade damage joins Patch damage in `rates.walls`, so the wall step, the wall's `Taking` line and conquest read it unchanged. The Goal gains `Reach Flint`, `Conquer Flint` and `Conquer Schist`, all shown from the start. The Encyclopedia gains Arms, revealed when Roadie opens. The tray's `Arms <n>` group follows the cables entry once an Arm type has arrived.
- **The Guard Plate (#54).** Roadie Lv 2 brings the Guard Plate, an `arm` module with no facing. While it borders a wall inside the arc it is active, and every oscillator beside it takes 0 pressure. `rates.arms` gives it `active` and `shields`. A conquest that leaves it bordering no wall turns it inactive in the same recompute, and its neighbours take pressure again from the walls still bordering them. Its Hex detail reads `Guard Plate · Arm`, then `Cancels pressure on <n> modules` or `No wall in reach`.

- **The pace runner fights walls (#55).** The default tending step is now `followGoal`. While the Goal names a wall (`Conquer Shale`, `Conquer Basalt`, `Reach Flint`, `Conquer Flint`, `Conquer Schist`), the player rebuilds the board from empty in three passes. First it puts Blades on the cells bordering the wall, facing it. Then it adds modulators and Patches one at a time, each time the one that most shortens the fall. Last it runs the ν/s greedy on what's left, which may not slow the fall. It keeps the rebuild only if it brings the wall down sooner than the board it has. Otherwise, and whenever the Goal names no wall, it lays out for ν/s. The run opens a Roadie habit as soon as Roadie opens, so sessions rotate Engineer, Producer, Roadie. Every wall kind's first conquest is now a tracked milestone, and two new ones join them: `Marked Flint conquered` and `Marked Schist conquered`. Shale, Roadie and the marked Schist carry the spec's targets.

### Improvised

- **Rings 3–5 (#48).** Each ring is walked clockwise from its upper-left cell (`ringCells` order, index 0 at (−n,0)).
  - Ring 3 (18): the six corner cells (index 0, 3, 6…) are Obsidian, and the twelve edge cells are Gneiss.
  - Ring 4 (24): the corners (index 0, 4, 8…) are Corundum, the middle of each side (index 2, 6, 10…) is Quartz, and the rest are Granite.
  - Ring 5 (30): all Corundum.
  - So every ring is tougher than the one inside it (ring 3 tops out at Obsidian, 1e9; ring 4 starts at Granite, 1e11), and every kind sits inside both `mechanics-sketch.md`'s band and `progression-map.md`'s.
- **Modifiers outside Sketch (#48).** 11 more, so 13 of 87 walls (under 1 in 6, which allows 14):
  - Ring 3: `Pressure ×2` on Gneiss (1,−3) and (−2,3), and `Only Arm damage` on Obsidian (3,0).
  - Ring 4: `Only Arm damage` on Quartz (−2,−2) and (−2,4), and `Pressure ×2` on Granite (3,−4) and (3,1).
  - Ring 5 (all Corundum): `Pressure ×2` on (−2,−3) and (2,3), and `Only Arm damage` on (5,−4) and (−5,4).
  - They're spread around each ring. Gneiss (1,−3) borders the marked Flint, so once Flint falls, the next wall out presses twice as hard.
- **The two Basalts and ring 2 (#48).** Ring 1's three walls are Shale (−1,1) and two Basalts: (−1,0), which carries `Pressure ×2`, and (0,−1), the only ring-1 wall bordering the marked Flint. So Roadie opens only when (0,−1) falls. Ring 2 is the agreed layout: the marked Flint at (0,−2), the marked Schist at (−2,1), and the other ten cells alternating Flint and Schist clockwise from a Flint at (2,−2).
- **Arms placeable anywhere (#53, #54).** An Arm goes on any owned cell, like every module, and does nothing away from a wall. A Blade facing anything but a wall deals 0, and a Guard Plate bordering no wall is inactive. Both read `No wall in reach`, as the sketch's Arms rule has it.
- **Ring 2's plain Flints border opening cells (#48).** The agreed alternation puts plain Flints at (2,−2) and (2,0), next to the opening cells. Only the marked Flint at (0,−2) opens Roadie, so they don't open it early.
- **Doubled pressure in the Hex detail (#48).** The doubled Basalt reads `Pressure ×2` and then `Pressure 16%`: the line shows the pressure the wall actually exerts, not its kind's 8%.
- **The Hex detail before HP (#48).** The HP line reads `<full> / <full> HP`, through `fmt` (so Schist reads `1e6 / 1e6 HP`), until walls take damage over time later in the chunk. `Taking <d>/s` becomes the wall's one effect line, so the old `Taking … · regen …` line splits into the HP line and the effect line. A full-HP, unfought wall has no effect line.
- **The glyphs (#48).** The Mixer mark is a fader cap across its slot, since Mixer's craft is Effects on the console. `Pressure ×2` is two chevrons pressing inward, and `Only Arm damage` is a blade's wedge. Both glyphs sit at the slab's upper right, stroked in the marks' muted stone tone, never a hue.
- **`progression-map.md` (#48).** The Roadie row now says the marked Flint is in ring 2, to match the corrected sketch.
- **The conquest instant (#49).** A wall falls when its time-to-zero (HP ÷ net, as a double) is within a relative 1e-9 of the span's end, and walls whose instants are that close fall together. That keeps `600 ÷ 0.9` s exact despite Decimal rounding, and makes a tie one recompute.
- **Which walls the step moves (#49).** The walls with an HP entry and the walls in `rates.walls`, while their cell is still a wall. An unfought wall moves at −regen and is capped at full, where its entry is dropped. An entry the step doesn't touch, such as one beyond the arc, keeps its place.
- **Practice credit inside a split span (#49).** The trusted walk credits the session habit's class per piece, so a Producer session's conquest recompute reads the Flywheels' output at the conquest instant. The acceptance test of piecewise ν uses that: a second Flywheel's reach onto a Sine grows at the recompute. Until pressure (#52), a conquest in the opening layouts changes no other rate.
- **Prior tests that changed (#49).** Chunk 03's "advance applies nothing to a wall" now covers upgrade mode alone. The pace test that prints a patched wall's damage/s patches Basalt (net 0, so it stands) instead of Shale, which now falls inside the run's first session. The Goal test past Shale now expects `Conquer Basalt`.
- **Saved wall HP (#49).** An entry needs its HP as a save string (a bare number is dropped), a lifetime cell that is a wall inside the arc and not yet open, and a finite HP in (0, full). A second entry for the same wall is dropped. Wall HP isn't money, so an unreadable entry is dropped rather than raising the lost-money recovery.
- **The HP bar (#50).** It has 10 cells, as in the sketch, and it rounds up: a cell stays lit while any HP is left, so the bar empties only at the conquest. 412 / 600 then reads 7 cells, as sketched. The HP figure is `fmt`'s, truncated. To hold the row's size (ADR-0031), the name reserves 8ch (the longest kind names) and the figures reserve the width of `<full> / <full> HP`. The row carries `data-cell` so that two walls of one kind can be told apart. At phone width the class line and HP row drop to 12px, and `Ready · N` wraps under the HP row.
- **What the tally counts (#50).** A wall joins the session's tally in the first span that damages it. A wall that only regenerates is never listed. From then on, every span adds the wall's net HP change, healing included. A fallen wall's entry moves to the end of the list, so the conquered walls read in conquest order. The summary's `fought` flag is computed once at close, from the same rule, before the mode changes. It holds only for a standing wall, so the line reads the session's end even if the summary is read after the board changes.
- **A loss that truncates to 0 (#50).** If the fought wall's loss shows as `0` (under 1 HP), the line adds no ` · <Wall> −0 HP`.
- **Saved tallies (#50).** An entry needs an authored wall's cell, `lost` as a save string and a boolean `conquered`. A second entry for one wall is dropped. Lost HP is a readout, not money, so an unreadable entry is dropped without raising a recovery. The v15 migration's session and summary read `[]`. The breather result's `walls` stays out of scope, because the breather's wall step comes in a later ticket.
- **Pressure as a derivation (#52).** Pressure reads only the board's cell kinds, so #49's conquest needs no pressure code: adding the cell to `board.open` and recomputing once is enough. Its tests open the cell through the `ownCells` fixture, as a conquest would leave it, and recompute through the next placement; with #49 merged, `pressure.test.ts` also checks it through `advance`: Shale falls and the Sine at (0,1) goes from 39% to 34% at that instant.
- **`on <n> modules` (#52).** n counts the bordering oscillators whose pressure is above 0, read from the cached rates, so a modulator beside a wall isn't counted and an oscillator a Guard Plate shields won't be. One reads `on 1 module`, singular, where the spec's form would say `1 modules`.
- **Shown percents (#52).** Pressure reads as a whole percent through `fmtPercent` (`num.ts`), truncated like every figure with fmtRate's nudge, so 0.29 doesn't show as 28. A Release's legs line shows its pressure too, though its flow rate is 0, because its breather rate takes it.
- **The Pressure entry (#52)** gains a third line, `Several walls add up · 60% at most`, so the cap is readable where the concept is.
- **The opening is pressed everywhere (#52).** Every opening cell borders a wall: (0,0) 29% (Shale 5, the doubled Basalt 16, Basalt 8), (1,0) 34%, (0,1) 39% and (1,−1) 42%. So the first oscillator placed reveals Pressure, and the chunk 02–04 acceptance layout makes 2.9325 ν/s, not 4.5. The tests that fixed those figures (nous, summary, flow, end, breather, Hex detail, pace) now state them under pressure, with the per-cell percentages in comments. The pace player's Flywheel now faces N from (0,1) onto the Sine at (0,0), the less pressed of the two.
- **The pace runner after #52** (consulted, not asserted): 250 credited hours end on `3 oscillators, 1 modulator, 3.79 ν/s, 3.0 charge/s` and `Era ν: 4.7e6`, down from 6.17 ν/s and 7.66e6 at the end of chunk 04. The same after merging #49: the greedy player never patches a wall (it lowers ν/s), so no wall falls in the run until the Goal-following player lands.
- **The replay pays nothing (#51).** The held wall seconds replay with a segment that pays no ν and credits no practice: the held ν and the answer's credit settle as in chunk 04, so a conquest in the replay changes only the walls, the rates (once per instant) and the session's tally. Both non-missed answers replay all the held seconds, even when `planned` credits less practice than the pool, as both bank all the held ν.
- **Older saves' held seconds (#51).** A save without `wallSeconds` holds the pool's seconds, as the spec says. That includes a v15 migration's running session, so the v15 tests in `save.test.ts` and `save-recovery.test.ts` now read `wallSeconds` equal to `poolSeconds`.
- **The breather's tally and fought wall (#51).** The breather keeps its own tally, built by the same rule as the session's (#50), so the result's line reads like the summary's. The `fought` flag is read at completion from `foughtWall` over the rates with each wall's damage doubled, so the breather's own soonest-to-fall wall is the one named. The result's `walls` defaults to `[]` in the save.
- **Roadie's Lv 0 grants (#53).** A ladder gains an optional `start`: grants a class brings the moment it opens, ordered at threshold 0, so the Blade arrives right after the opening types. Lv 2 is the Guard Plate's level and grants nothing until #54 declares the type. The `ArmType` union holds only `blade` for now.
- **The Arm hue (#53).** `--hue-arm` takes the retired forge amber `#bc9239`, as the Modulator took the retired generator green. The Blade's glyph is a hilt and a tapering wedge. Its face carries the Flywheel's facing pointer but no jack, because only a modulator has a jack.
- **The Blade's Hex detail (#53).** The damage reads through `fmtRate`, as every rate on the board does, so 14/s reads `14.0/s to Basalt`. A Blade that faces a cell other than a wall reads `No wall in reach`. That covers a Blade that borders no wall, since it can only face a non-wall.
- **A Patch into an `Only Arm damage` wall (#53).** The route rule already refuses one (#48). The rates also count no Patch damage into such a wall, so no other path can damage it.
- **The Arms entry (#53).** `Roadie's craft · opened by reaching Flint`, `Arms work only beside a wall`, `Blade · 10 × charge received as damage`, `Turn a Blade to choose its wall`. #54 adds the Guard Plate's line.
- **Fixtures (#53).** `woundWall` sets a wall's HP entry, standing in for an earlier fight, so a test conquers Basalt in seconds. `openRoadie` owns Shale and Basalt (0,−1) and opens Roadie, as that conquest leaves the state. The UI tests and the Goal's walk use it.
- **What a Guard Plate shields (#54).** `shields` counts the oscillators beside an active Guard Plate that border a wall, since pressure touches ν only and such an oscillator is the only kind a wall would press on. An inactive one shields 0. The line says `1 module` in the singular, as the wall's pressure line does.
- **`ArmRate` becomes a union (#54).** `BladeRate` keeps #53's fields. `GuardPlateRate` carries `active` and `shields` and no charge, because charge delivered to it is wasted (`takesCharge` stays false for it). The Roadie tests read the Blade's rate through a narrowing helper.
- **The Guard Plate's glyph (#54).** A shield's outline, a flat top over a point, with a rib down its middle. Like the Blade's face, it has no jack, and with no facing it has no pointer either.
- **The Arms entry (#54).** It gains `Guard Plate · cancels pressure on its neighbours`, the catalogue's effect line.
- **Which wall the Goal means (#55).** For `Conquer Basalt`, either Basalt counts. For `Reach Flint`, any standing wall that borders the marked Flint counts. When two walls fall equally soon at equal ν/s, the player takes the one that also serves the next Goal: the Basalt at (0,−1), beside Flint. Without that tie-break, the run took the doubled Basalt (−1,0) first and Roadie opened a session later.
- **Building up to a fall (#55).** When no single feeder outpaces a wall's regen, the feeder pass takes the step that most raises the damage on the Goal's wall, so two Flywheels that only win together still go down. If the finished layout still loses to the regen, the player lays out for ν/s and waits for growth.
- **Arms in the ν/s pass (#55).** The greedy placement now puts an Arm down only where it raises ν/s, so a Guard Plate goes where it shields the most ν. A Blade the fight layout doesn't feed goes back to the tray. Modulators and oscillators are still placed even when they raise nothing.
- **When the player replans (#55).** Only when the Goal, the owned cells, the grants or the whole Producer hour change. A Flywheel's output grows 0.1 per Producer hour, so that last one catches a fight that becomes winnable.
- **Milestones read each minute (#55).** Flow now advances a minute at a time, and the probes are read after each minute, so a conquest is timed within a minute, not at the session's end. The two worked timings in `pace.test.ts` moved with it. Engineer Lv 5 now reads 15.5 h: it is reached 30 minutes into Engineer's 10th session, not at that session's end.
- **Prior pace tests (#55).** The class-level and resonance tests are about the ν/s greedy, so they now pin `placeAllowance: placeAllowanceGreedily`. The Goal player opens Roadie, which would change the rotation, and it patches the Flywheel into walls.

### Code-review fixes

- **HP figures round up.** `fmtHp` (`num.ts`) is the one HP figure: rounded up to a whole HP, so it agrees with the HP bar and reads 0 only at the conquest (a wall at 0.4 HP reads `1 / 600 HP`). The Hex detail and the flow screen's HP row both read through it. A test that read 412.7 HP as `412` now reads `413`.
- **The HP row holds its size at every wall size (ADR-0031).** It reserves `widestHp(full)` (`num.ts`): the widest of the grouped digits up to `999 999` and `9.99e<n>` at the full HP's exponent, so a Gneiss reserves `999 999 / 3e7 HP` and a Corundum `9.99e15 / 1e16 HP`. In the browser the row kept its width, 319 px on desktop and 274 px at 360 px, for `3e7`, `2.99e7` and `478 582` against `3e7`.
- **`WallRate` carries its full HP, its pressure and how many oscillators it presses**, as the spec asks. `rates.ts` builds every `WallRate` in one place, and `wallRateAt` reads any wall from the cached rates (a wall taking no damage reads as one at 0 damage), so the Hex detail no longer derives pressed modules or pressure itself. `wallHp` (`board.ts`) is the one reader of a wall's current HP, used by the fought wall, the Hex detail and the pace runner. `rates.walls` still lists only walls taking damage.
- **`wallOf` (`map.ts`) throws** for a cell already known to be a wall. It replaces every `wallAt(...)!` and the summary's silent empty-name fallback. `wallAt` stays for cells that may not be walls.
- **Arms branch on their role.** `ArmRate` is `StrikeRate | GuardRate`, discriminated by `role`, and `armRole` (`modules.ts`) reads it from the type's capabilities. The rates, the Hex detail and the pace runner branch on the role, so a third Arm with an existing role touches only `MODULES`.
- **The Guard Plate's nameplate fits its hex.** A two-word module name breaks onto two lines under a raised glyph.
- **Acceptance tests added.** These cover the spec's Shale Hex detail at 412 / 600 HP, no upgrade-mode `apply` changing a damaged `board.walls`, and two save checks. In the first, a genuine chunk-04 v16 save (`v16-chunk04.json`, written at `be8557e`) loads with every wall full. In the second, the v15 fixture loads as chunk 04 read it (`v15-migration.chunk04-load.json`), apart from what chunk 05 adds, each named: the empty wall fields, and the Pressure entry the chunk-04 save's pressed Sine now reveals.

### Pace runner

At the end of the chunk, `npm run pace` (250 credited hours):

```
Pace run: 300 sessions, 250.0h credited
Board: 4 oscillators, 4 modulators, 43.76 ν/s, 9.0 charge/s — Saw (0,0), Saw (0,-2), Saw (0,-1), Saw (0,1), Flywheel (1,0) facing NW, Flywheel (-1,1) facing SE, Guard Plate (1,-1), Flywheel (-2,1) facing SE, Patch (-1,1) → (0,-1), Patch (-2,1) → (0,-2)
Era ν: 5.19e7
Classes: Engineer Lv 14, Producer Lv 14, Roadie Lv 14
Breathers taken: 300

Milestone                         Reached       Target
--------------------------------  ------------  --------------------------------------------------
Roadie opens                      3.7h          first contact with Flint, by about 3h (spec 05)
Mixer opens                       not reached   conquering the marked Schist (Demo, 15–60h)
First Shale conquered             0.2h          the first session or two, under about 1h (spec 05)
First Basalt conquered            3.7h          Sketch, 0–15h (ring 1)
First Flint conquered             5.0h          Sketch, 0–15h (rings 1–2)
First Schist conquered            10.0h         Demo, 15–60h (rings 1–2)
First Gneiss conquered            not reached   Demo, 15–60h (rings 2–3)
...
Marked Flint conquered            5.0h          after Roadie opens (Sketch, 0–15h)
Marked Schist conquered           10.0h         about 8–12h (spec 05)
Engineer level 5                  20.5h         8h on the class
Producer level 5                  23.8h         8h on the class
Roadie level 5                    27.2h         8h on the class
...

DRY 0.2h–3.7h: 3.5h with no new milestone
DRY 5.0h–10.0h: 5.0h with no new milestone
DRY 10.0h–20.5h: 10.5h with no new milestone
DRY 20.5h–23.8h: 3.3h with no new milestone
DRY 23.8h–27.2h: 3.3h with no new milestone
DRY 27.2h–250.0h: 222.8h with no new milestone
```

- **Shale (target: the first session or two, under about 1 h).** It falls 12 minutes into the first session, at 0.2 h. Before that session, the opening Flywheel is patched into Shale, and 600 HP at a net 0.9/s falls in 667 s, as the spec's arithmetic says.
- **Roadie (target: by about 3 h). Not tuned.** It opens at 3.7 h, the instant Basalt (0,−1) falls, which is inside the spec's own arithmetic of "near 3–4 h on an alternating schedule". Until Producer Lv 2, one patched Flywheel at about 1.08 charge/s barely beats Basalt's regen of 1. Lv 2 arrives with the fourth session (3.3 h), and the second Patch makes it 2.3/s, as the arithmetic has it. Reaching 3.0 h would take Basalt down with one cable, or a second cable at the start. Neither was needed to land in the spec's window, so the numbers stay.
- **Flint (no spec target).** It falls at 5.0 h, 77 minutes of flow after Roadie opens. A Blade on (0,−1) faces it, and both Flywheels feed the Blade: one by Patch, one by reach. That is 23.3 damage/s against regen 10. The spec's arithmetic had about 100 minutes.
- **The marked Schist (target: about 8–12 h). Tuned.** With Schist at 1e6 HP and regen 100 it never fell. From 5 h to 12 h the board has two modulators: Producer Lv 4 (the third) comes at 5 h on Producer, about 14 h credited. A Flywheel makes 1.2–1.4 charge/s, so the most a Blade on (−1,1) can deal is about 25 damage/s. The spec's "several Blades fed by capped Flywheels" needs 20 Producer hours for the cap, and even three capped Flywheels into Blades deal 90/s, under regen 100. The pacing law prefers an unlock to a flatter curve, but none of chunk 05's parts is charge, and charge is what limits damage. The next lever by design is the Console's Blade fader, which is chunk 06's. So Schist moves from 1e6 HP and regen 100/s to 3e5 HP and regen 15/s, in `mechanics-sketch.md` and in `map.ts`. The runner then has the marked Schist fall at 10.0 h, the middle of the window. Flint, at 6e4 and regen 10, stays the step before it, and Gneiss (3e7, 2e3) is past the Sketch radius. The tests that read Schist's figures moved with it (`walls.test.ts`, `hexReadout.test.ts`). #48's note that Schist reads `1e6 / 1e6 HP` is now out of date: it reads `300 000 / 300 000 HP · regen 15.0/s`.
- **After the marked Schist.** Its conquest does not open Mixer yet, since that is Demo's. The Goal's next entry, `Prestige`, is not shown until chunk 06, so the Goal names nothing and the player lays out for ν/s from 10 h on. The board owns 8 cells by then, against chunk 04's 4. The queued grants find room, and the board ends at 43.76 ν/s with four Saws (chunk 04: 6.17). The era's ν is 5.19e7 (#52's run: 4.7e6). The dry stretch from 27 h on is the run waiting for prestige, the next milestone it can read.
- **Levels.** Roadie joins the rotation at 3.7 h, so each class gets about a third of the credit from then on. Lv 5 (8 h on the class) arrives at 20.5 h for Engineer, 23.8 h for Producer and 27.2 h for Roadie.


## Chunk 06: Console and prestige

Issues #58–#64 (parent #57), on `integration/spec-06-console`.

### Built

- **The console and channel faders (#58, #59).** All the console's rules live in `console.ts`: `costOf`, `affordable`, `maxAffordable`, `buyFader`, and the multipliers the rates read. Every catalogue type has a channel base in `modules.ts`. The strip appears the first time any fader is affordable and stays (a saved, monotonic flag). A channel level multiplies the type's ν, charge, Blade damage, Guard Plate shielding or Release breather ν. The Hex detail's `Faders ×…` line shows the product.
- **Bus faders (#60).** One per category the player has. Each level multiplies the whole category, on top of the type's channel. The bus row shows from the first affordable bus.
- **Era ν and the Prestige Goal (#61).** Every ν credit goes through `earn`, which adds to both the balance and `eraNous`. `Prestige` is the Goal from 1e6 era ν, and `prestigeGainOf` = `floor(sqrt(era ν / 1e6))`.
- **Prestige (#62).** `apply({ type: "prestige" })` works in upgrade mode at 1e6 era ν. It banks the Arete, counts the prestige, and zeroes ν, era ν and the channel and bus levels. The board and everything else stay. The confirmation lists what resets and what's kept.
- **The master section (#63).** Shown from the first prestige: Channel Taper, Bus Taper and Drive, each bought with Arete at `level + 1`. Their levels survive prestige.
- **The pace runner plays the chunk (#64).** The `buyCheapestFader` hook now buys the cheapest affordable ν fader, channel or bus, one level at a time through `apply`, until none is affordable. Ties keep the console's order. A new last tending seam, `prestigeWhenWorthwhile`, comes after the breather, so the breather pays into the era it ends. At each visit it reads the Arete the era would bank per credited hour of the era. It prestiges at the first visit where that figure has not risen since the last one. Then it spends all its Arete on the master faders, cheapest first, ties in console order. `PaceTurn` gains `eraStartHours`. The `first-prestige` milestone now has a probe (prestiges ≥ 1), and `Second era ends` and `Third era ends` join it (≥ 2, ≥ 3). The report lists each ended era (length, Arete, the hour it ended) and the current era's hours so far.

### Improvised

- **"Stops rising" is read, not forecast (#64).** The player compares this visit's Arete per era hour with the last visit's. An era worth no Arete reads as 0, so the first Arete always counts as a rise. A lookahead version came first: it estimated the hours to the next Arete from the board's flow ν/s. It ended the first era at 2.5 h, because flow ν/s leaves out breathers and the faders still to buy. Then, once faders compounded, it never ended another era. The read version is the ticket's rule as written. The last reading is kept per turn in a `WeakMap`, so every run reads its own.
- **Master spending order (#64).** At level 0 all three master faders cost 1, so the console's order decides ties: the first three Arete buy Channel Taper, Bus Taper, then Drive.
- **Prior pace tests pin the new hooks (#64).** The opening-layout, fight-layout and class-level tests pin `buyCheapestFader: () => {}`, because faders change the figures they read. The breather-ν comparison pins `prestigeWhenWorthwhile: () => {}`, because a prestige mid-run would zero the ν it compares. The prestige tests set era ν as `arete² × PRESTIGE_AT`, so they hold if the divisor is tuned.

### Pace runner

`npm run pace` (250 credited hours) was run at the start of #64 with the authored numbers and the new hooks. It never finished: a 40-hour run was stopped after 12 minutes. Era ν went past 1e1190 by 18 h. The numbers below are from after the tuning.

#### Why the authored console diverged

The ticket's tuning order is master numbers, then the Arete divisor, then fader bases. None of the three reaches the cause, which sits in the steps. Spending S ν on faders whose cost grows by g per level buys about log_g S levels. A ×s step therefore multiplies output by about S^(ln s / ln g). With channel ×1.25 and bus ×1.1 at g = 1.6, an oscillator's own path is S^0.68, so era ν grows like t^3 on a fixed board. The board doesn't stay fixed: classes level, Saws arrive and walls fall. The runner measured local exponents of 5–8.

- **Arete per hour never falls.** Arete is `sqrt(era ν)`, so Arete per hour falls only once era ν grows slower than t². At t^3 or faster, it keeps rising, and no era after the first ever ends.
- **Shielded oscillators diverge.** A shielded oscillator's ν also takes the Guard Plate's channel and the Arms bus, which adds another 0.68 to the exponent. Past 1 the economy blows up in finite time. Era 2 went from 3.9e4 to 1e1190 ν in 14 hours.
- **Tapers make it worse.** They lower g toward 1.30, which raises every exponent.

Raising bases only delays the onset, and the divisor only moves where the first Arete lands. Neither changes the exponent.

#### Tuning

All three changes are recorded in `mechanics-sketch.md`:

- **Channel step ×1.25 → ×1.1, bus step ×1.05 (was ×1.1)** (`console.ts`). An oscillator's own path is now S^0.31, with the shielded path at S^0.61. An era's ν settles below t² once its faders are rebought, so Arete per hour peaks soon after the first Arete and the era ends there. The divisor (1e6), the bases, the 1.6 growth and the master numbers are unchanged. Sweeps of Drive at ×1.1–×1.5 and of the taper at −0.02 a level barely moved the first eras, so they stay.
- **Schist 3e5 → 3e6 HP** (`map.ts`). Faders on the Flywheel, the Blade and the Arms bus multiply Blade damage. With the new steps, the marked Schist fell at 3.6 h at 3e5 (3.3 h at the old steps). At 3e6 it falls at 6.3 h.

The tests that read these figures moved with them: `console.test.ts`, `console-bus.test.ts`, `console-channels.test.ts`, `save-console.test.ts` and `hexReadout.test.ts`. Schist's Hex detail now reads `3e6 / 3e6 HP · regen 15.0/s`, not chunk 05's `300 000 / 300 000`.

The sweep (40–60 h runs) tried: Guard Plate shielding taken as the larger of the oscillator's own faders and the Plate's rather than their product; the divisor at 7e5–3e6; Flywheel and Blade channel bases ×8–×4 000; the bus base at 2e4; and Schist at 2e6–3e7. Two findings shaped the choice:

- **Schist and the first prestige are tied.** The first prestige lands about 3–4 h after the marked Schist falls, because the conquest is what opens room for the board that reaches 1e6. A Schist inside 8–12 h put the first prestige at 11–19 h.
- **The first era runs 2–3 times as long as later ones.** Later eras start with the board already built. A divisor that put the first prestige in 8–10 h made later eras of 3.3–5 h. One that made later eras 4–8 h put the first at 12 h or later.

The chosen numbers keep the first prestige and the next two eras on target and leave the Schist window short by 1.7 h. The never-a-product Plate changed nothing inside 60 h (eras end before shielding compounds), so the Plate stays a product. The latent divergence is noted below.

#### The run

```
Pace run: 300 sessions, 250.0h credited
Board: 6 oscillators, 2 modulators, 3.64e9 ν/s, 8.42e6 charge/s — Saw (0,0), Saw (0,-2), Saw (0,-1), Saw (0,1), Saw (1,0), Triangle (1,-1), Flywheel (-1,1) facing NE, Flywheel (-2,1) facing SE, Patch (-2,1) → (0,-2)
Era ν: 1.03e15
Classes: Engineer Lv 14, Producer Lv 14, Roadie Lv 14
Breathers taken: 300
Era 1: 9.2h, 1 Arete, ended at 9.2h
Era 2: 4.2h, 1 Arete, ended at 13.3h
Era 3: 4.2h, 1 Arete, ended at 17.5h
Era 4: 3.3h, 1 Arete, ended at 20.8h
...
Era 9: 3.3h, 1 Arete, ended at 37.5h
Era 10: 2.5h, 1 Arete, ended at 40.0h
...
Era 17: 2.5h, 1 Arete, ended at 57.5h
Era 18: 3.3h, 2 Arete, ended at 60.8h
Era 19: 8.3h, 8 Arete, ended at 69.2h
Era 20: 17.5h, 19 Arete, ended at 86.7h
Era 21: 5.0h, 12 Arete, ended at 91.7h
Era 22: 6.7h, 19 Arete, ended at 98.3h
Era 23: 13.3h, 80 Arete, ended at 111.7h
Era 24: 138.3h so far

Milestone                         Reached       Target
--------------------------------  ------------  --------------------------------------------------
Roadie opens                      2.0h          first contact with Flint, by about 3h (spec 05)
Mixer opens                       not reached   conquering the marked Schist (Demo, 15–60h)
First Shale conquered             0.2h          the first session or two, under about 1h (spec 05)
First Basalt conquered            2.0h          Sketch, 0–15h (ring 1)
First Flint conquered             2.5h          Sketch, 0–15h (rings 1–2)
First Schist conquered            6.3h          Demo, 15–60h (rings 1–2)
...
Marked Flint conquered            2.5h          after Roadie opens (Sketch, 0–15h)
Marked Schist conquered           6.3h          about 8–12h (spec 05)
Engineer level 5                  20.5h         8h on the class
Producer level 5                  23.8h         8h on the class
Roadie level 5                    27.2h         8h on the class
First prestige (Sketch gate)      9.2h          8–10h, Demo by 15h
Second era ends                   13.3h         4–8h after the first (spec 06)
Third era ends                    17.5h         4–8h after the second (spec 06)
...

DRY 2.5h–6.3h: 3.8h with no new milestone
DRY 6.3h–9.2h: 2.8h with no new milestone
DRY 9.2h–13.3h: 4.2h with no new milestone
DRY 13.3h–17.5h: 4.2h with no new milestone
DRY 17.5h–20.5h: 3.0h with no new milestone
DRY 20.5h–23.8h: 3.3h with no new milestone
DRY 23.8h–27.2h: 3.3h with no new milestone
DRY 27.2h–250.0h: 222.8h with no new milestone
```

#### Targets

- **First worthwhile prestige (target: about 8–10 h). Met: 9.2 h.** The era reaches 1e6 during the 10th session. At the next visit, 1 Arete over more hours reads as a fall, and the player prestiges.
- **Later Sketch eras (target: 4–8 h). Met for the Sketch arc.** Eras 2 and 3 run 4.2 h each and end at 13.3 h and 17.5 h. **Not met past it.** Eras 4–17 run 2.5–3.3 h, as Drive, the tapers and class levels speed each rebuild. The progression map's "4–8 h in Demo" belongs to the Demo arc, whose gates aren't built yet. Each era ends one visit after its first Arete, so through 57 h every era banks exactly 1 Arete.
- **Long eras after 60 h.** Eras 18–23 bank 2–80 Arete and run 3.3–17.5 h. Era 24 has not ended after 138 h. By then the master section has several Taper levels, and the class levels have brought Saws. The era's growth is back above t², so Arete per hour keeps creeping up. Era ν reaches 1e15, but the run stays bounded and finishes 250 h in about 70 s. This is past this chunk's horizon, but a later chunk tuning Demo should expect it. The Guard Plate's stacking on an oscillator's own faders is the other latent divergence: it is bounded only because eras end before it compounds.
- **The marked Schist (target: about 8–12 h). Re-checked with faders: not met, 6.3 h.** Faders took it from 10.0 h (chunk 05) to 3.3 h. The step change and the 3e6 HP bring it back to 6.3 h. Any later Schist pushed the first prestige past 10 h (see Tuning above). A better fix could split what drives the two: for example, ν after Schist that doesn't depend on the conquest's extra cells, or a Blade fader with its own growth. That is a design choice, so it's left open here.
- **Roadie (target: by about 3 h). Met: 2.0 h.** The Flywheel's channel fader helps the first Basalt fall sooner (chunk 05: 3.7 h).
- **Dry stretches.** The era ends fill the Sketch arc every 4.2 h, but each gap is still over 2 h, and so is 2.5–6.3 h before the marked Schist. No unlock this chunk adds would fill them: walls and classes are the only other milestones. The tail from 27.2 h is the Demo and Record gates, which the engine doesn't track yet.
