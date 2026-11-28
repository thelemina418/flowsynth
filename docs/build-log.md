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
